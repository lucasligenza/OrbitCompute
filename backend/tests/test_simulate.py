import numpy as np
import pytest
from pydantic import ValidationError

from orbitcompute.eclipse import eclipse_fraction_estimate
from orbitcompute.presets import SCENARIO_PRESETS, scenario_preset
from orbitcompute.schema import Scenario
from orbitcompute.simulate import run


@pytest.mark.parametrize("preset", list(SCENARIO_PRESETS))
def test_every_preset_runs_and_passes_checks(preset):
    res = run(scenario_preset(preset))
    c = res["checks"]
    assert c["battery_bounds_ok"] and c["thermal_bounds_ok"]
    assert c["energy_identity_max_residual_kw"] < 1e-6
    n = res["time"]["n"]
    for nd in res["nodes"]:
        assert all(len(v) == n for v in nd["series"].values())
    ts = [e["t"] for e in res["events"]]
    assert ts == sorted(ts)


def test_eclipse_fraction_consistent_with_beta_estimate():
    res = run(scenario_preset("leo-inference"))
    nd = res["nodes"][0]
    illum = np.asarray(nd["series"]["illum"])
    est = eclipse_fraction_estimate(np.radians(nd["orbit"]["beta_deg_at_epoch"]), nd["orbit"]["altitude_km"])
    # beta drifts over 12 h (RAAN regression ~2.4 deg), allow a few percent of an orbit
    assert abs(np.mean(illum < 0.5) - est) < 0.04


def test_eclipse_events_align_with_illumination():
    res = run(scenario_preset("leo-inference"))
    s = np.asarray(res["nodes"][0]["series"]["illum"])
    dt = res["time"]["step_s"]
    for e in res["events"]:
        if e["type"] == "eclipse_enter":
            k = int(e["t"] // dt)
            assert s[k] >= 0.5 > s[k + 1]


def test_dawn_dusk_sso_has_no_eclipse_in_october():
    res = run(scenario_preset("sso-batch"))
    assert np.min(res["nodes"][0]["series"]["illum"]) == 1.0
    assert res["nodes"][0]["eclipse_windows"] == []


def test_noon_midnight_sso_eclipses():
    sc = scenario_preset("sso-batch")
    sc.nodes[0].orbit.ltan_h = 12.0
    res = run(sc)
    assert len(res["nodes"][0]["eclipse_windows"]) >= 6


def test_bounds_enforced():
    raw = scenario_preset("leo-inference").model_dump()
    raw["nodes"] = raw["nodes"] * 13
    for i, nd in enumerate(raw["nodes"]):
        nd["id"] = f"N{i}"
    with pytest.raises(ValidationError):
        Scenario.model_validate(raw)
    raw = scenario_preset("leo-inference").model_dump()
    raw["sim"]["step_s"] = 5
    raw["sim"]["duration_s"] = 7 * 86400
    with pytest.raises(ValidationError):
        Scenario.model_validate(raw)


def test_sample_index_lookup_is_pure():
    """Scrubbing analogue: the result is an immutable table; reading sample k twice is identical."""
    res = run(scenario_preset("iss-reference"))
    s = res["nodes"][0]["series"]
    k = 321
    snap1 = {key: v[k] for key, v in s.items()}
    _ = [v[10] for v in s.values()]  # "scrub" elsewhere
    snap2 = {key: v[k] for key, v in s.items()}
    assert snap1 == snap2
