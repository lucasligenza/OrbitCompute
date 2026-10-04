import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("ORBITCOMPUTE_DB", str(tmp_path / "test.sqlite3"))
    from orbitcompute import api

    api.store.cache_clear()
    return TestClient(api.app)


def test_catalog_and_preset(client):
    cat = client.get("/api/catalog").json()
    assert len(cat["scenarios"]) >= 5 and cat["reference_tle"]["provenance"] == "REAL"
    sc = client.get("/api/presets/leo-inference").json()
    assert sc["provenance"] == "PRESET"


def test_simulate_is_cached_and_immutable(client):
    sc = client.get("/api/presets/power-constrained-training").json()
    r1 = client.post("/api/simulate", json=sc).json()
    r2 = client.post("/api/simulate", json=sc).json()
    assert r1["hash"] == r2["hash"] and r1["created_utc"] == r2["created_utc"]  # served from store
    assert client.get(f"/api/results/{r1['hash']}").json()["hash"] == r1["hash"]
    sc["sim"]["scheduler"] = "fifo"
    r3 = client.post("/api/simulate", json=sc).json()
    assert r3["hash"] != r1["hash"]


def test_scenario_crud(client):
    sc = client.get("/api/presets/leo-inference").json()
    sid = client.post("/api/scenarios", json=sc).json()["id"]
    sc["name"] = "Edited"
    client.put(f"/api/scenarios/{sid}", json=sc)
    assert client.get(f"/api/scenarios/{sid}").json()["name"] == "Edited"
    assert any(s["id"] == sid for s in client.get("/api/scenarios").json())
    assert client.delete(f"/api/scenarios/{sid}").status_code == 200


def test_orbit_preview(client):
    p = client.post("/api/orbit/preview", json={"orbit": {"altitude_km": 550, "inclination_deg": 53}}).json()
    assert 5700 < p["period_s"] < 5760 and 0 <= p["eclipse_fraction"] < 0.45
    assert len(p["r_eci"]) == 240
    sso = client.post("/api/orbit/preview", json={"orbit": {"altitude_km": 600, "sun_synchronous": True,
                                                             "ltan_h": 18}}).json()
    assert sso["elements"]["inclination_deg"] > 97 and sso["eclipse_fraction"] == 0.0


def test_invalid_scenario_rejected(client):
    sc = client.get("/api/presets/leo-inference").json()
    sc["nodes"] = []
    assert client.post("/api/simulate", json=sc).status_code == 422


def test_compare(client):
    a = client.get("/api/presets/monolith-128").json()
    b = client.get("/api/presets/distributed-4x32").json()
    out = client.post("/api/compare", json={"a": a, "b": b}).json()
    assert "jobs_completed" in out["delta"]
