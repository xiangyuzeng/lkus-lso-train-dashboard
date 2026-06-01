"""Assemble a CONFIRMED payload from MCP DB Gateway query results saved as JSON.

This is the README's Mode-B / Mode-C path: when the only reach to production is
the MCP gateway (no pymysql/Secrets Manager on the host), three read-only queries
are run through the gateway and their results saved to files; this script merges
them into public/data.json with meta.source='confirmed' — identical in shape to
what collect.py produces.

Each input file is the raw gateway result: {"rows":[{"j": "<json string>"}], ...}
where <json string> is, respectively:
  roster   : [{emp_no, full_name, store, position, hire_date, cohort}, ...]  (in-training only)
  hours    : {emp_no: hours, ...}
  courses  : [{emp_no, sub_type, apply_name}, ...]  ordered ascending by class date

Usage:
  python -m pipeline.bootstrap_from_mcp <roster.json> <hours.json> <courses.json> [store_count]
"""
from __future__ import annotations

import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

from .collect import EXCLUDE_POSITIONS, LEVELS, REPO_ROOT, _band, _kpis
from .config.settings import ATTEND_SOURCE, CERT_SOURCE, COURSE_SOURCE, LOCAL_PAYLOAD_PATH

_DATE_RE = re.compile(r"\((\d{4}-\d{2}-\d{2})")


def _inner(path: str):
    """Parse a gateway result file → the decoded JSON held in rows[0].j."""
    raw = json.loads(Path(path).read_text(encoding="utf-8"))
    return json.loads(raw["rows"][0]["j"])


def main(argv: list[str]) -> int:
    roster = _inner(argv[1])         # list of dicts
    hours = _inner(argv[2])          # {emp_no: hours}
    courses_rows = _inner(argv[3])   # list of {emp_no, sub_type, apply_name}
    store_count = int(argv[4]) if len(argv) > 4 else len({r["store"] for r in roster if r.get("store")})

    # course_map[emp][sub_type] = latest class date. Rows arrive ascending by
    # class date, so a later row overwrites an earlier one → latest wins.
    course_map: dict[str, dict[int, str | None]] = {}
    for r in courses_rows:
        emp = r["emp_no"]
        st = int(r["sub_type"])
        m = _DATE_RE.search(r.get("apply_name") or "")
        course_map.setdefault(emp, {})[st] = m.group(1) if m else None

    by_level: dict[str, list[dict]] = {lvl["key"]: [] for lvl in LEVELS}
    for r in roster:
        cohort = r["cohort"]
        if cohort not in by_level:
            continue
        # Position-based exclusion — same rule as collect.py (single source of truth).
        if (r.get("position") or "").strip() in EXCLUDE_POSITIONS[cohort]:
            continue
        by_level[cohort].append(r)

    levels_out = []
    for lvl in LEVELS:
        rows = []
        for r in by_level[lvl["key"]]:
            emp = r["emp_no"]
            hrs = round(float(hours.get(emp, 0.0)), 1)
            value = hrs if lvl["unit"] == "hours" else round(hrs / 8.0, 1)
            if lvl["has_course_col"]:
                attended = emp in course_map and lvl["course_sub_type"] in course_map[emp]
                lso_course = lvl["course_label"] if attended else "pending"
                lso_course_date = course_map[emp][lvl["course_sub_type"]] if attended else None
            else:
                lso_course = None
                lso_course_date = None
            rows.append({
                "full_name":       r.get("full_name") or "",
                "employee_no":     emp,
                "store":           r.get("store") or "",
                "region":          "—",
                "position":        r.get("position") or "",
                "hire_date":       r.get("hire_date") or "",
                "value":           value,
                "band":            _band(value, lvl["thresholds"]),
                "lso_course":      lso_course,
                "lso_course_date": lso_course_date,
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

    payload = {
        "meta": {
            "board_id":       "LCNA-HR-LSO-TRAIN-2026",
            "schema_version": 2,
            "generated_at":   datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")[:-4] + "Z",
            "generated_by":   "bootstrap_from_mcp.py (MCP DB Gateway)",
            "tz":             "America/New_York",
            "source":         "confirmed",
            "base_def":       "active_store",
            "store_count":    store_count,
            "regions":        ["—"],
            "cert_source":    CERT_SOURCE,
            "attend_source":  ATTEND_SOURCE,
            "course_source":  COURSE_SOURCE,
        },
        "levels": levels_out,
    }

    out_path = REPO_ROOT / LOCAL_PAYLOAD_PATH
    out_path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    for lvl in payload["levels"]:
        k = lvl["kpis"]
        print(f"{lvl['key']}: total={k['total']} ge_y={k['ge_yellow']} ge_o={k['ge_orange']} ge_r={k['ge_red']} avg={k['avg']}")
    print(f"wrote {out_path} (source=confirmed, stores={store_count})")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
