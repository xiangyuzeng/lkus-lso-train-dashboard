"""Generate a synthetic, PII-free SEED payload (meta.source='seed').

Purpose: the board must build and demo with ZERO database access. This writes a
self-contained public/data.json using fictional names spanning every heat band
and a mix of resolved / "pending" LSO courses. The live pipeline (collect.py) or
the Mode-C agent overwrites it with real data (meta.source='confirmed').

    python -m pipeline.make_seed            # writes repo public/data.json (seed)

No DB, no network, no secrets.
"""
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .collect import LEVELS, REPO_ROOT, _band, _kpis
from .config.settings import ATTEND_SOURCE, CERT_SOURCE, COURSE_SOURCE, LOCAL_PAYLOAD_PATH

STORES = [
    "33rd & 10th", "8th & Broadway", "100 Maiden Ln", "221 Grand",
    "28th & 6th", "154 Bleecker", "41st & Lexington", "52nd & Madison", "16th & 6th",
]
FIRST = ["Alex", "Jordan", "Sam", "Taylor", "Morgan", "Casey", "Riley", "Jamie", "Avery"]
LAST = ["Rivera", "Chen", "Patel", "Nguyen", "Garcia", "Kim", "Okafor", "Rossi", "Haddad"]
# Per-level seed positions — chosen to survive each level's exclusion set so the
# seed mirrors the real post-exclusion cohorts and gives the position dropdown variety.
POSITIONS = {
    "LSO100": ["Barista Trainee", "Shift Supervisor Trainee", "Assistant Store Manager Trainee", "Store Manager Trainee"],
    "LSO200": ["Shift Supervisor Trainee", "Store Manager Trainee"],
    "LSO300": ["Store Manager Trainee"],
    "LSO400": ["Store Manager Trainee"],
}
COURSE_DATES = ["2026-01-14", "2026-02-19", "2026-03-12", "2026-04-15", "2026-05-19"]


def _value_ladder(t: dict[str, int]) -> list[float]:
    """Nine synthetic values spanning none / yellow / orange / red for a level."""
    y, o, r = t["yellow"], t["orange"], t["red"]
    return [
        round(y * 0.7, 1),   # none
        y - 1,               # none (just under)
        y + 1,               # yellow
        round((y + o) / 2, 1),  # yellow
        o + 1,               # orange
        round((o + r) / 2, 1),  # orange
        r,                   # red
        r + 4,               # red
        round(r * 1.6, 1),   # red (well past — typical for tenured higher-level trainees)
    ]


def build_seed() -> dict[str, Any]:
    levels_out: list[dict[str, Any]] = []
    n_global = 0
    for lvl in LEVELS:
        ladder = _value_ladder(lvl["thresholds"])
        rows: list[dict[str, Any]] = []
        for i, value in enumerate(ladder):
            n_global += 1
            attended = lvl["has_course_col"] and (i % 3 != 0)  # ~2/3 resolved, 1/3 pending
            rows.append({
                "full_name":       f"{FIRST[i % len(FIRST)]} {LAST[(i + n_global) % len(LAST)]}",
                "employee_no":     f"USSEED{n_global:05d}",
                "store":           STORES[(i + n_global) % len(STORES)],
                "region":          "—",
                "position":        POSITIONS[lvl["key"]][i % len(POSITIONS[lvl["key"]])],
                "hire_date":       f"2025-{(i % 12) + 1:02d}-{(i % 27) + 1:02d}",
                "value":           value,
                "band":            _band(value, lvl["thresholds"]),
                "lso_course":      (lvl["course_label"] if attended else ("pending" if lvl["has_course_col"] else None)),
                "lso_course_date": (COURSE_DATES[i % len(COURSE_DATES)] if attended else None),
                "status":          "Active",
            })
        rows.sort(key=lambda x: x["value"], reverse=True)
        levels_out.append({
            "key":             lvl["key"],
            "title":           lvl["title"],
            "unit":            lvl["unit"],
            "target":          lvl["target"],
            "thresholds":      lvl["thresholds"],
            "in_training_def": lvl["in_training_def"],
            "has_course_col":  lvl["has_course_col"],
            "kpis":            _kpis(rows, lvl["thresholds"]),
            "rows":            rows,
        })

    return {
        "meta": {
            "board_id":       "LCNA-HR-LSO-TRAIN-2026",
            "schema_version": 2,
            "generated_at":   datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")[:-4] + "Z",
            "generated_by":   "make_seed.py",
            "tz":             "America/New_York",
            "source":         "seed",
            "base_def":       "active_store",
            "store_count":    len(STORES),
            "regions":        ["—"],
            "cert_source":    CERT_SOURCE,
            "attend_source":  ATTEND_SOURCE,
            "course_source":  COURSE_SOURCE,
        },
        "levels": levels_out,
    }


def main() -> int:
    out_path = REPO_ROOT / LOCAL_PAYLOAD_PATH
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(build_seed(), indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"wrote synthetic seed → {out_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
