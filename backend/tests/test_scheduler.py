import json

import numpy as np
import pytest

from orbitcompute.presets import scenario_preset
from orbitcompute.schema import JobSpec
from orbitcompute.scheduler import POLICIES, Ctx, fifo, priority
from orbitcompute.simulate import run, scenario_hash
from orbitcompute.workloads import Job, generate_jobs


def _ctx(**kw):
    base = dict(t=0.0, dt=30.0, n_acc=8, throughput=1.0, s=1.0, per_acc_kw=0.75, p_gen_kw=100.0,
                p_batt_avail_kw=50.0, p_base_kw=10.0, battery_kwh=40.0, battery_min_kwh=10.0,
                battery_max_charge_kw=20.0, charge_eff=0.95, discharge_eff=0.95, illum=1.0, time_to_sun_s=0.0,
                time_to_eclipse_s=1800.0, next_eclipse_s=2100.0, link=True, downlink_backlog_gbit=0.0,
                downlink_rate_gbps=2.0, t_e=300.0, t_target=343.0, q_reject_net_w=50_000.0, c_e=3e6)
    base.update(kw)
    return Ctx(**base)


def _job(i, width, prio, arrival, typ="batch", dep="none", deadline=None):
    return Job(i, JobSpec(job_id=f"J{i}", type=typ, arrival_s=arrival, priority=prio, accelerators=width,
                          work_ref_acc_h=1.0, network_dependency=dep, deadline_s=deadline))


def test_fifo_head_of_line_blocking():
    jobs = [_job(0, 4, 5, 0), _job(1, 8, 5, 1), _job(2, 2, 9, 2)]
    assert fifo(_ctx(), jobs) == {0: 4}  # job 1 does not fit -> blocks job 2


def test_priority_backfills():
    jobs = [_job(0, 4, 5, 0), _job(1, 8, 5, 1), _job(2, 2, 9, 2)]
    assert priority(_ctx(), jobs) == {2: 2, 0: 4}


def test_all_policies_respect_capacity_and_are_pure():
    jobs = [_job(i, w, p, i, typ=t) for i, (w, p, t) in enumerate(
        [(4, 3, "training"), (2, 9, "inference"), (8, 1, "background"), (3, 6, "batch"), (16, 2, "training")])]
    for name, pol in POLICIES.items():
        a1 = pol(_ctx(), jobs)
        a2 = pol(_ctx(), list(reversed(jobs)))
        assert a1 == a2, name
        assert sum(a1.values()) <= 8, name


def test_energy_aware_respects_budget_in_eclipse():
    jobs = [_job(0, 8, 3, 0), _job(1, 2, 9, 1)]
    ctx = _ctx(illum=0.0, p_gen_kw=0.0, time_to_sun_s=1800, battery_kwh=11.0, p_batt_avail_kw=40)
    alloc = POLICIES["energy"](ctx, jobs)
    assert 0 not in alloc  # low-priority work deferred in eclipse with little battery margin
    assert alloc.get(1) == 2  # high-priority work still served


def test_network_aware_skips_realtime_without_link():
    jobs = [_job(0, 2, 9, 0, typ="inference", dep="realtime"), _job(1, 2, 5, 1)]
    assert POLICIES["network"](_ctx(link=False), jobs) == {1: 2}
    assert POLICIES["priority"](_ctx(link=False), jobs) == {0: 2, 1: 2}


def test_workload_generation_deterministic():
    sc = scenario_preset("leo-inference")
    a = generate_jobs(sc.workload, sc.nodes, sc.sim.duration_s)
    b = generate_jobs(sc.workload, sc.nodes, sc.sim.duration_s)
    assert [j.model_dump() for j in a] == [j.model_dump() for j in b]
    sc.workload.seed += 1
    c = generate_jobs(sc.workload, sc.nodes, sc.sim.duration_s)
    assert [j.model_dump() for j in a] != [j.model_dump() for j in c]


def test_simulation_deterministic():
    sc = scenario_preset("distributed-4x32")
    r1, r2 = run(sc), run(sc)
    for r in (r1, r2):
        r.pop("created_utc")
    assert json.dumps(r1, sort_keys=True) == json.dumps(r2, sort_keys=True)
    assert scenario_hash(sc) == r1["hash"]


@pytest.mark.parametrize("preset", ["leo-inference", "large-training"])
def test_allocations_never_exceed_capacity(preset):
    res = run(scenario_preset(preset))
    for nd, cfg in zip(res["nodes"], res["scenario"]["nodes"]):
        n_acc = cfg["compute"]["accelerator_count"]
        assert all(sum(a[1] for a in step) <= n_acc for step in nd["alloc"])
        util = np.asarray(nd["series"]["util"])
        assert util.min() >= 0 and util.max() <= 1 + 1e-9


def test_energy_aware_reduces_power_shortage_vs_fifo():
    base = scenario_preset("power-constrained-training")
    out = {}
    for sch in ("fifo", "energy"):
        sc = base.model_copy(deep=True)
        sc.sim.scheduler = sch
        out[sch] = run(sc)["metrics"]
    assert out["energy"]["power_limited_time_s"] < 0.1 * out["fifo"]["power_limited_time_s"]
    assert out["energy"]["min_soc"] >= base.nodes[0].battery.min_soc - 0.01


def test_thermal_aware_reduces_throttling():
    base = scenario_preset("large-training")
    out = {}
    for sch in ("priority", "thermal"):
        sc = base.model_copy(deep=True)
        sc.sim.scheduler = sch
        out[sch] = run(sc)["metrics"]
    assert out["thermal"]["throttled_time_s"] < 0.2 * out["priority"]["throttled_time_s"]


def test_job_lifecycle_consistency():
    res = run(scenario_preset("sso-batch"))
    for j in res["jobs"]:
        if j["status"] == "completed":
            assert j["completion_s"] >= j["first_start_s"] >= j["ready_s"] - 1e-6
            assert j["progress"] == pytest.approx(j["work_ref_acc_h"], rel=1e-9)
        if j["missed"] and j["completion_s"] is not None:
            assert j["completion_s"] > j["deadline_s"]
