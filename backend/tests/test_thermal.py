import numpy as np
import pytest

from orbitcompute.constants import R_EARTH, ZERO_C_K
from orbitcompute.presets import scenario_preset
from orbitcompute.schema import ThermalConfig
from orbitcompute.simulate import run
from orbitcompute.thermal import LIMIT, NORMAL, THROTTLED, WARM, ThermalModel, earth_view_factor_edge_on


def test_view_factor_limits():
    assert earth_view_factor_edge_on(np.array([R_EARTH * 1.000001]))[0] == pytest.approx(0.5, abs=1e-3)
    h = 20.0
    # far field: edge-on plate sees half a small disc of angular radius 1/H -> F = 2/(3 pi H^3)
    assert earth_view_factor_edge_on(np.array([R_EARTH * h]))[0] == pytest.approx(2 / (3 * np.pi * h**3), rel=0.01)
    f550 = earth_view_factor_edge_on(np.array([R_EARTH + 550]))[0]
    assert 0.2 < f550 < 0.3


def test_converges_to_analytic_steady_state():
    th = ThermalModel(ThermalConfig(radiator_area_m2=150, conductance_kw_per_k=4.0))
    q, q_env = 50_000.0, 8_000.0
    te, tr = 300.0, 280.0
    for _ in range(2000):
        te, tr, _ = th.step(te, tr, q, q_env, 30.0)
    te_ss, tr_ss = th.steady_state(q, q_env)
    assert te == pytest.approx(te_ss, abs=0.5)
    assert tr == pytest.approx(tr_ss, abs=0.5)
    assert th.rejection_w(tr) == pytest.approx(q + q_env, rel=1e-3)


def test_no_radiator_heats_monotonically():
    th = ThermalModel(ThermalConfig(radiator_area_m2=0.0))
    te, tr = 293.0, 293.0
    temps = []
    for _ in range(50):
        te, tr, _ = th.step(te, tr, 10_000.0, 0.0, 30.0)
        temps.append(te)
    assert np.all(np.diff(temps) > 0)


def test_stable_with_small_heat_capacity():
    th = ThermalModel(ThermalConfig(radiator_area_m2=200, equipment_heat_capacity_kj_per_k=20,
                                    radiator_areal_heat_capacity_kj_per_k_m2=0.5))
    te, tr = 300.0, 300.0
    for _ in range(500):
        te, tr, _ = th.step(te, tr, 30_000.0, 5_000.0, 60.0)
        assert np.isfinite(te) and 3 < te < 600


def test_throttle_curve_and_states():
    cfg = ThermalConfig(warm_c=60, throttle_c=75, limit_c=90, min_throttle=0.25)
    th = ThermalModel(cfg)
    c = lambda x: x + ZERO_C_K  # noqa: E731
    assert th.throttle(c(70)) == 1.0
    assert th.throttle(c(82.5)) == pytest.approx(0.625)
    assert th.throttle(c(90)) == 0.0
    s = [th.throttle(c(x)) for x in np.linspace(70, 89.9, 50)]
    assert np.all(np.diff(s) <= 0)
    assert [th.state(c(x)) for x in (20, 65, 80, 95)] == [NORMAL, WARM, THROTTLED, LIMIT]


def test_heater_holds_minimum():
    th = ThermalModel(ThermalConfig(min_operating_c=0, heater_max_kw=5))
    assert th.heater_kw(c := ZERO_C_K - 10) == 5.0 and th.heater_kw(ZERO_C_K + 10) == 0.0 and c < ZERO_C_K


def test_simulated_temperatures_bounded_and_throttling_reduces_power():
    res = run(scenario_preset("large-training"))
    assert res["checks"]["thermal_bounds_ok"]
    s = {k: np.asarray(v) for k, v in res["nodes"][0]["series"].items()}
    assert s["t_equip_c"].max() < res["scenario"]["nodes"][0]["thermal"]["limit_c"] + 5
    throttled = s["throttle"] < 0.999
    assert throttled.any()
    # throttled steps with full allocation draw less compute power than unthrottled ones
    full = s["alloc_frac"] > 0.95
    assert s["p_compute_kw"][throttled & full].mean() < s["p_compute_kw"][~throttled & full & (s["power_factor"] > 0.999)].mean()
