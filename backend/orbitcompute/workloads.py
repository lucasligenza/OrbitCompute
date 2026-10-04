"""Workloads: deterministic job generation and the runtime Job record (MODEL)."""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Optional

import numpy as np

from .schema import MAX_JOBS, JobSpec, NodeConfig, WorkloadConfig

TYPE_PREFIX = {"inference": "INF", "training": "TRN", "batch": "BAT", "background": "BKG"}
NAMES = {
    "inference": ["LLM serving", "Vision inference", "Speech transcription", "Embedding service", "Agent session"],
    "training": ["Fine-tune run", "Pretraining shard", "RL post-training", "Distillation run"],
    "batch": ["Earth-observation tiles", "Video transcoding", "Batch embeddings", "Data curation", "Eval sweep"],
    "background": ["Checkpoint verify", "Index rebuild", "Synthetic data gen", "Model compression"],
}

# Job lifecycle states
PENDING, UPLINK, QUEUED, RUNNING, PAUSED, DOWNLINK, COMPLETED, REJECTED = (
    "pending", "uplink", "queued", "running", "paused", "downlink", "completed", "rejected",
)


@dataclass
class Job:
    idx: int
    spec: JobSpec
    node: int = -1
    state: str = PENDING
    ready_s: Optional[float] = None
    first_start_s: Optional[float] = None
    compute_done_s: Optional[float] = None
    completion_s: Optional[float] = None
    progress: float = 0.0  # reference accelerator-hours completed
    missed: bool = False
    input_left: float = 0.0
    output_left: float = 0.0
    est_runtime_s: float = 0.0
    est_energy_kwh: float = 0.0
    segments: list = field(default_factory=list)  # [t0, t1, k, p0, p1, stalled]

    @property
    def remaining(self) -> float:
        return max(0.0, self.spec.work_ref_acc_h - self.progress)

    @property
    def min_width(self) -> int:
        w = self.spec.accelerators
        return max(1, math.ceil(0.5 * w)) if self.spec.type == "training" else w

    @property
    def needs_input(self) -> bool:
        return self.spec.network_dependency in ("input", "both") and self.spec.input_gbit > 0

    @property
    def needs_output(self) -> bool:
        return self.spec.network_dependency in ("output", "both") and self.spec.output_gbit > 0

    @property
    def realtime(self) -> bool:
        return self.spec.network_dependency == "realtime"


def _template(kind: str, rng: np.random.Generator, n_max: int, thr: float):
    if kind == "inference":
        width = int(rng.choice([1, 2, 4, 8], p=[0.4, 0.3, 0.2, 0.1]))
        dur_h = rng.uniform(0.2, 1.0)  # a serving session, not a single request
        prio = int(rng.integers(7, 11))
        slack_s = dur_h * 3600 * 2 + 1800
        dep = "realtime" if rng.random() < 0.6 else "both"
        io = (rng.uniform(0.2, 2.0), rng.uniform(0.2, 2.0))
    elif kind == "training":
        width = max(1, round(n_max * float(rng.choice([0.25, 0.5, 1.0], p=[0.4, 0.4, 0.2]))))
        dur_h = rng.uniform(1.5, 6.0)
        prio = int(rng.integers(2, 5))
        slack_s = dur_h * 3600 * 2.5 + 7200
        dep = "both"
        io = (rng.uniform(100.0, 800.0), rng.uniform(5.0, 50.0))
    elif kind == "batch":
        width = int(rng.choice([4, 8, 16, 32]))
        dur_h = rng.uniform(0.3, 1.5)
        prio = int(rng.integers(4, 7))
        slack_s = 6 * 3600.0
        dep = "both"
        io = (rng.uniform(20.0, 200.0), rng.uniform(10.0, 100.0))
    else:
        width = int(rng.choice([1, 2, 4, 8]))
        dur_h = rng.uniform(1.0, 3.0)
        prio = int(rng.integers(0, 2))
        slack_s = None
        dep = "none"
        io = (0.0, 0.0)
    width = max(1, min(width, n_max))
    return width, dur_h, prio, slack_s, dep, io


def expected_work(kind: str, n_max: int, thr: float, samples: int = 4000) -> float:
    """Monte-Carlo mean work per job of a type (deterministic seed)."""
    rng = np.random.default_rng(12345)
    tot = 0.0
    for _ in range(samples):
        w, d, *_ = _template(kind, rng, n_max, thr)
        tot += w * d * thr
    return tot / samples


def generate_jobs(cfg: WorkloadConfig, nodes: list[NodeConfig], duration_s: float) -> list[JobSpec]:
    """Poisson arrivals per job type scaled so offered load = intensity x nominal capacity."""
    if cfg.mode == "explicit":
        return sorted(cfg.jobs, key=lambda j: (j.arrival_s, j.job_id))[:MAX_JOBS]
    rng = np.random.default_rng(cfg.seed)
    counts = [n.compute.accelerator_count for n in nodes]
    n_max = max(counts) if counts else 0
    capacity = sum(n.compute.accelerator_count * n.compute.relative_throughput for n in nodes)
    if n_max == 0 or capacity <= 0 or cfg.intensity <= 0:
        return []
    thr = capacity / sum(counts)
    hours = duration_s / 3600.0
    mix = cfg.mix.model_dump()
    total_mix = sum(mix.values()) or 1.0
    jobs: list[JobSpec] = []
    for kind in ("inference", "training", "batch", "background"):
        share = mix[kind] / total_mix
        if share <= 0:
            continue
        rate_per_h = share * cfg.intensity * capacity / expected_work(kind, n_max, thr)
        n = int(rng.poisson(rate_per_h * hours))
        arrivals = np.sort(rng.uniform(0.0, duration_s * 0.9, n))
        for k, t in enumerate(arrivals):
            width, dur_h, prio, slack_s, dep, (i_g, o_g) = _template(kind, rng, n_max, thr)
            name = NAMES[kind][int(rng.integers(0, len(NAMES[kind])))]
            jobs.append(JobSpec(
                job_id=f"{TYPE_PREFIX[kind]}-{k + 1:04d}",
                name=name,
                type=kind,
                arrival_s=round(float(t), 1),
                deadline_s=None if slack_s is None else round(float(t + slack_s), 1),
                priority=prio,
                accelerators=width,
                work_ref_acc_h=round(width * dur_h * thr, 4),
                input_gbit=round(float(i_g), 3),
                output_gbit=round(float(o_g), 3),
                network_dependency=dep,
            ))
    jobs.sort(key=lambda j: (j.arrival_s, j.job_id))
    return jobs[:MAX_JOBS]
