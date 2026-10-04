"""SQLite persistence: editable scenarios + immutable, content-addressed results."""

from __future__ import annotations

import gzip
import json
import os
import sqlite3
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

DEFAULT_DB = Path(__file__).resolve().parents[1] / ".data" / "orbitcompute.sqlite3"

_SCHEMA = """
CREATE TABLE IF NOT EXISTS scenarios (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS results (
    hash TEXT PRIMARY KEY,
    engine_version TEXT NOT NULL,
    scenario_name TEXT NOT NULL,
    metrics_json TEXT NOT NULL,
    result_gz BLOB NOT NULL,
    created_at TEXT NOT NULL
);
"""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class Store:
    def __init__(self, path: Optional[Path] = None):
        self.path = Path(path or os.environ.get("ORBITCOMPUTE_DB", DEFAULT_DB))
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        with self._conn() as c:
            c.executescript(_SCHEMA)

    def _conn(self) -> sqlite3.Connection:
        return sqlite3.connect(self.path)

    # --- results (immutable) -------------------------------------------------------------------
    def get_result(self, h: str) -> Optional[dict]:
        with self._conn() as c:
            row = c.execute("SELECT result_gz FROM results WHERE hash = ?", (h,)).fetchone()
        return json.loads(gzip.decompress(row[0])) if row else None

    def put_result(self, result: dict) -> None:
        blob = gzip.compress(json.dumps(result, separators=(",", ":")).encode(), compresslevel=6)
        with self._lock, self._conn() as c:
            # INSERT OR IGNORE: a stored result is never overwritten.
            c.execute(
                "INSERT OR IGNORE INTO results VALUES (?, ?, ?, ?, ?, ?)",
                (result["hash"], result["engine_version"], result["scenario"]["name"],
                 json.dumps(result["metrics"]), blob, _now()),
            )

    def list_results(self, limit: int = 50) -> list[dict]:
        with self._conn() as c:
            rows = c.execute(
                "SELECT hash, engine_version, scenario_name, metrics_json, created_at FROM results "
                "ORDER BY created_at DESC LIMIT ?", (limit,)).fetchall()
        return [{"hash": r[0], "engine_version": r[1], "scenario_name": r[2], "metrics": json.loads(r[3]),
                 "created_at": r[4]} for r in rows]

    # --- scenarios (editable) -------------------------------------------------------------------
    def list_scenarios(self) -> list[dict]:
        with self._conn() as c:
            rows = c.execute("SELECT id, name, created_at, updated_at FROM scenarios ORDER BY updated_at DESC")
            return [{"id": r[0], "name": r[1], "created_at": r[2], "updated_at": r[3]} for r in rows]

    def get_scenario(self, sid: str) -> Optional[dict]:
        with self._conn() as c:
            row = c.execute("SELECT json FROM scenarios WHERE id = ?", (sid,)).fetchone()
        return json.loads(row[0]) if row else None

    def save_scenario(self, scenario: dict, sid: Optional[str] = None) -> str:
        sid = sid or uuid.uuid4().hex[:12]
        now = _now()
        with self._lock, self._conn() as c:
            exists = c.execute("SELECT 1 FROM scenarios WHERE id = ?", (sid,)).fetchone()
            if exists:
                c.execute("UPDATE scenarios SET name = ?, json = ?, updated_at = ? WHERE id = ?",
                          (scenario["name"], json.dumps(scenario), now, sid))
            else:
                c.execute("INSERT INTO scenarios VALUES (?, ?, ?, ?, ?)",
                          (sid, scenario["name"], json.dumps(scenario), now, now))
        return sid

    def delete_scenario(self, sid: str) -> bool:
        with self._lock, self._conn() as c:
            return c.execute("DELETE FROM scenarios WHERE id = ?", (sid,)).rowcount > 0
