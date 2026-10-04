"""Workload scheduling policies (MODEL — simulation, not flight validation).

Each policy is a pure function (ctx, jobs) -> {job_idx: accelerators}. No randomness; all
orderings end in (arrival_s, job_id) so ties are deterministic.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Callable, Iterable, Optional

from .workloads import Job

HIGH_PRIORITY = 7


@dataclass(frozen=True)
class Ctx:
    t: float
    dt: float
    n_acc: int
    throughput: float
    s: float  # thermal clock factor at start of step
    per_acc_kw: float  # incremental bus power per active accelerator (incl. pump) at s
    p_gen_kw: float
    p_batt_avail_kw: float
    p_base_kw: float  # non-compute loads + compute idle (+pump)
    battery_kwh: float
    battery_min_kwh: float
    battery_max_charge_kw: float
    charge_eff: float
    discharge_eff: float
    illum: float
    time_to_sun_s: float
    time_to_eclipse_s: float
    next_eclipse_s: float  # duration of the next (or current) eclipse
    link: bool
    downlink_backlog_gbit: float
    downlink_rate_gbps: float
    t_e: float
    t_target: float
    q_reject_net_w: float  # radiator rejection minus environment absorption, now
    c_e: float


def _arrival_key(j: Job):
    return (j.spec.arrival_s, j.spec.job_id)


def greedy(
    ctx: Ctx,
    order: Iterable[Job],
    budget_kw: Optional[float] = None,
    strict: bool = False,
    free: Optional[int] = None,
    alloc: Optional[dict[int, int]] = None,
) -> dict[int, int]:
    """Allocate accelerators in order. Training jobs may run at >= 50% of their width."""
    alloc = {} if alloc is None else alloc
    free = ctx.n_acc - sum(alloc.values()) if free is None else free
    for j in order:
        if j.idx in alloc:
            continue
        want = min(j.spec.accelerators, ctx.n_acc)
        k = min(want, free)
        if budget_kw is not None:
            k = min(k, int(math.floor(max(budget_kw, 0.0) / ctx.per_acc_kw + 1e-9)) if ctx.per_acc_kw > 0 else k)
        if k < min(j.min_width, ctx.n_acc) or k <= 0:
            if strict:
                break
            continue
        alloc[j.idx] = k
        free -= k
        if budget_kw is not None:
            budget_kw -= k * ctx.per_acc_kw
        if free <= 0:
            break
    return alloc


def fifo(ctx: Ctx, jobs: list[Job]) -> dict[int, int]:
    """Arrival order with head-of-line blocking. Ignores power, thermal and network state."""
    return greedy(ctx, sorted(jobs, key=_arrival_key), strict=True)


def priority(ctx: Ctx, jobs: list[Job]) -> dict[int, int]:
    """Highest priority first, backfilling smaller jobs into free accelerators."""
    return greedy(ctx, sorted(jobs, key=lambda j: (-j.spec.priority, *_arrival_key(j))))


def energy_aware(ctx: Ctx, jobs: list[Job]) -> dict[int, int]:
    """Power-budgeted scheduling.

    High-priority work may use everything the bus can supply. Lower-priority work only uses
    solar surplus after reserving charge for the next eclipse; in eclipse it may only use battery
    energy above what the base load needs until sunrise.
    """
    dt_h = ctx.dt / 3600.0
    full_budget = ctx.p_gen_kw + ctx.p_batt_avail_kw - ctx.p_base_kw
    usable = max(0.0, ctx.battery_kwh - ctx.battery_min_kwh)
    if ctx.illum >= 0.5:
        e_target = ctx.battery_min_kwh + 1.15 * ctx.p_base_kw * (ctx.next_eclipse_s / 3600.0) / ctx.discharge_eff
        deficit = max(0.0, e_target - ctx.battery_kwh)
        t_h = max(ctx.time_to_eclipse_s / 3600.0, dt_h)
        charge_needed = min(deficit / ctx.charge_eff / t_h, ctx.battery_max_charge_kw)
        flex_budget = ctx.p_gen_kw - ctx.p_base_kw - charge_needed
    else:
        t_h = max(ctx.time_to_sun_s / 3600.0, dt_h)
        flex_budget = ctx.p_gen_kw + usable * ctx.discharge_eff / t_h - ctx.p_base_kw
    by_prio = sorted(jobs, key=lambda j: (-j.spec.priority, *_arrival_key(j)))
    high = [j for j in by_prio if j.spec.priority >= HIGH_PRIORITY]
    low = [j for j in by_prio if j.spec.priority < HIGH_PRIORITY]
    alloc = greedy(ctx, high, budget_kw=full_budget)
    used = sum(alloc.values()) * ctx.per_acc_kw
    return greedy(ctx, low, budget_kw=min(full_budget, flex_budget) - used, alloc=alloc)


def thermal_aware(ctx: Ctx, jobs: list[Job]) -> dict[int, int]:
    """Proportional heat-budget controller targeting T_throttle - margin.

    Allowed dissipation = current net radiator rejection + C_e (T_target - T_e) / tau.
    """
    tau = 600.0
    allowed_w = ctx.q_reject_net_w + ctx.c_e * (ctx.t_target - ctx.t_e) / tau
    budget_kw = allowed_w / 1000.0 - ctx.p_base_kw
    return greedy(ctx, sorted(jobs, key=lambda j: (-j.spec.priority, *_arrival_key(j))), budget_kw=budget_kw)


def deadline_aware(ctx: Ctx, jobs: list[Job]) -> dict[int, int]:
    """Earliest deadline first; jobs that can no longer meet their deadline are demoted."""
    def feasible(j: Job) -> bool:
        if j.spec.deadline_s is None:
            return True
        rate = min(j.spec.accelerators, ctx.n_acc) * ctx.throughput * max(ctx.s, 1e-6)
        return ctx.t + j.remaining / rate * 3600.0 <= j.spec.deadline_s

    def key(j: Job):
        dl = j.spec.deadline_s if j.spec.deadline_s is not None else math.inf
        return (0 if feasible(j) else 1, dl, -j.spec.priority, *_arrival_key(j))

    return greedy(ctx, sorted(jobs, key=key))


def network_aware(ctx: Ctx, jobs: list[Job]) -> dict[int, int]:
    """Priority order, but skip realtime jobs without a link and defer output-heavy jobs
    while the downlink backlog exceeds roughly one pass of capacity."""
    pass_capacity = max(ctx.downlink_rate_gbps, 1.0) * 480.0
    congested = ctx.downlink_backlog_gbit > pass_capacity

    def eligible(j: Job) -> bool:
        if j.realtime and not ctx.link:
            return False
        if congested and j.needs_output and j.spec.output_gbit > 1.0:
            urgent = j.spec.deadline_s is not None and j.spec.deadline_s - ctx.t < 3600.0
            return urgent
        return True

    order = sorted((j for j in jobs if eligible(j)), key=lambda j: (-j.spec.priority, *_arrival_key(j)))
    return greedy(ctx, order)


POLICIES: dict[str, Callable[[Ctx, list[Job]], dict[int, int]]] = {
    "fifo": fifo,
    "priority": priority,
    "energy": energy_aware,
    "thermal": thermal_aware,
    "deadline": deadline_aware,
    "network": network_aware,
}

LABELS = {
    "fifo": "FIFO",
    "priority": "Priority",
    "energy": "Energy-aware",
    "thermal": "Thermal-aware",
    "deadline": "Deadline-aware (EDF)",
    "network": "Network-aware",
}
