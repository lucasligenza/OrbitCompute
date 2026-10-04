import numpy as np
import pytest

from orbitcompute.power import Battery, array_power_kw, rated_array_kw, settle_bus
from orbitcompute.presets import scenario_preset
from orbitcompute.schema import BatteryConfig, SolarConfig
from orbitcompute.simulate import run


def test_rated_array_power():
    cfg = SolarConfig(area_m2=100, efficiency=0.3, derate=0.85, pointing_factor=1.0)
    assert rated_array_kw(cfg) == pytest.approx(100 * 0.3 * 1361 * 0.85 / 1000)


def test_array_power_zero_in_umbra_and_scales_with_illum():
    cfg = SolarConfig(area_m2=100)
    p = array_power_kw(cfg, np.array([0.0, 0.5, 1.0]), np.full(3, 1.496e8))
    assert p[0] == 0.0 and p[1] == pytest.approx(p[2] / 2)


def test_bus_identity_and_battery_bounds_random():
    rng = np.random.default_rng(0)
    cfg = BatteryConfig(capacity_kwh=50, max_charge_kw=20, max_discharge_kw=40, charge_efficiency=0.93,
                        discharge_efficiency=0.96, min_soc=0.2, emergency_soc=0.05, initial_soc=0.5)
    bat = Battery.from_config(cfg)
    dt_h = 30 / 3600
    for _ in range(20000):
        gen, load = rng.uniform(0, 80), rng.uniform(0, 80)
        e0 = bat.energy_kwh
        r = settle_bus(bat, gen, load, dt_h)
        assert gen + r.discharge_kw + r.unmet_kw == pytest.approx(load + r.charge_kw + r.curtailed_kw, abs=1e-9)
        assert bat.energy_kwh - e0 == pytest.approx(
            (r.charge_kw * cfg.charge_efficiency - r.discharge_kw / cfg.discharge_efficiency) * dt_h, abs=1e-12)
        assert bat.e_floor - 1e-9 <= bat.energy_kwh <= bat.e_max + 1e-9
        assert r.charge_kw <= cfg.max_charge_kw + 1e-12 and r.discharge_kw <= cfg.max_discharge_kw + 1e-12
        assert min(r.charge_kw, r.discharge_kw) == 0.0


@pytest.mark.parametrize("preset", ["leo-inference", "power-constrained-training", "large-training"])
def test_simulation_energy_conservation(preset):
    res = run(scenario_preset(preset))
    c = res["checks"]
    assert c["energy_identity_max_residual_kw"] < 1e-6
    assert c["battery_update_max_residual_kwh"] < 1e-6
    assert c["battery_bounds_ok"]
    # Cumulative identity over the whole run (kWh)
    dt_h = res["time"]["step_s"] / 3600
    for nd in res["nodes"]:
        s = {k: np.asarray(v) for k, v in nd["series"].items()}
        ch = np.clip(s["p_batt_kw"], 0, None)
        dis = np.clip(-s["p_batt_kw"], 0, None)
        lhs = np.sum(s["p_gen_kw"] + dis + s["p_unmet_kw"]) * dt_h
        rhs = np.sum(s["p_load_kw"] + ch + s["p_curtailed_kw"]) * dt_h
        assert lhs == pytest.approx(rhs, abs=1e-3)  # rounding of stored series only


def test_generation_follows_eclipse():
    res = run(scenario_preset("leo-inference"))
    s = res["nodes"][0]["series"]
    illum, gen = np.asarray(s["illum"]), np.asarray(s["p_gen_kw"])
    assert np.all(gen[illum == 0] == 0)
    assert np.all(gen[illum == 1] > 90)
    # battery discharges in umbra
    batt = np.asarray(s["p_batt_kw"])
    assert np.mean(batt[illum == 0] < 0) > 0.95


def test_compute_shed_at_reserve_keeps_platform_alive():
    sc = scenario_preset("power-constrained-training")
    sc.sim.scheduler = "fifo"
    res = run(sc)
    m = res["metrics"]
    assert m["power_limited_time_s"] > 0
    assert m["outage_time_s"] == 0  # essential loads ride through on the emergency margin
