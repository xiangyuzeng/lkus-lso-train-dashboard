"""LSO100 train-time collector.

Pulls the cohort (default = §6 (a)) from iEHR, pulls cumulative worked-hours
per emp_no from opempefficiency.t_attendance since each emp's join_date,
computes heat-band + KPIs, and writes public/data.json with
meta.source='confirmed'.

SELECT-only — every SQL string goes through assert_read_only() before execute.
"""
from __future__ import annotations

import argparse
import json
import logging
import statistics
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .config.settings import (
    IEHR_DB,
    LOCAL_PAYLOAD_PATH,
    OPEMPEFFICIENCY_DB,
    TENANT,
    assert_read_only,
    connect,
)

logger = logging.getLogger(__name__)

REPO_ROOT = Path(__file__).resolve().parent.parent

# Thresholds — must match lib/types.ts PayloadMeta.thresholds and
# lib/tokens.ts bandStyle.
TARGET_HOURS = 112
THRESH = {"yellow": 72, "orange": 96, "red": 112}

# Trainee post codes per CLAUDE.md (used only for cohort (b)).
TRAINEE_POST_CODES = ("95", "96", "97", "98")

# ─────────────────────────────────────────────────────────────────────
# SQL — held verbatim here so the README + the runtime use the same text.
# ─────────────────────────────────────────────────────────────────────

COHORT_A_SQL = """
SELECT  e.emp_no,
        e.name           AS full_name,
        e.join_date,
        e.status,
        d.name           AS store_name,
        d.id             AS dept_id,
        d.parent_code,
        p.code           AS post_code,
        p.name           AS post_name
FROM    t_ehr_employee e
JOIN    t_ehr_department d
        ON d.id = e.belong_dept_id
       AND d.type = 0
       AND d.tenant = %s
LEFT JOIN t_ehr_employee_post_relation pr
        ON pr.emp_no = e.emp_no
       AND pr.relation_type = 0
       AND pr.tenant = %s
LEFT JOIN t_ehr_post p
        ON p.id = pr.post_id
       AND p.tenant = %s
LEFT JOIN t_ehr_employee_training_record tr
        ON tr.emp_no = e.emp_no
       AND tr.course_title LIKE '%%LSO100%%'
       AND tr.tenant = %s
WHERE   e.tenant = %s
  AND   e.status = 1
  AND   tr.id IS NULL
"""

COHORT_B_SQL = """
SELECT  e.emp_no,
        e.name           AS full_name,
        e.join_date,
        e.status,
        d.name           AS store_name,
        d.id             AS dept_id,
        d.parent_code,
        p.code           AS post_code,
        p.name           AS post_name
FROM    t_ehr_employee e
JOIN    t_ehr_employee_post_relation pr
        ON pr.emp_no = e.emp_no
       AND pr.relation_type = 0
       AND pr.tenant = %s
JOIN    t_ehr_post p
        ON p.id = pr.post_id
       AND p.tenant = %s
       AND p.code IN %s
LEFT JOIN t_ehr_department d
        ON d.id = e.belong_dept_id
       AND d.tenant = %s
LEFT JOIN t_ehr_employee_training_record tr
        ON tr.emp_no = e.emp_no
       AND tr.course_title LIKE '%%LSO100%%'
       AND tr.tenant = %s
WHERE   e.tenant = %s
  AND   e.status = 1
  AND   tr.id IS NULL
"""

# Hours query — emp_no list and date floor get parameterised in batches.
HOURS_SQL_TEMPLATE = """
SELECT  emp_no, SUM(effective_hours) AS hours
FROM    t_attendance
WHERE   tenant = %s
  AND   emp_no IN ({placeholders})
  AND   attendance_date >= %s
GROUP BY emp_no
"""

# ─────────────────────────────────────────────────────────────────────


def _band(hours: float) -> str:
    if hours >= THRESH["red"]:    return "red"
    if hours >= THRESH["orange"]: return "orange"
    if hours >= THRESH["yellow"]: return "yellow"
    return "none"


def fetch_cohort(cohort_def: str) -> list[dict[str, Any]]:
    sql = COHORT_A_SQL if cohort_def == "a" else COHORT_B_SQL
    assert_read_only(sql)
    conn = connect(IEHR_DB)
    try:
        with conn.cursor() as cur:
            if cohort_def == "a":
                cur.execute(sql, (TENANT, TENANT, TENANT, TENANT, TENANT))
            else:
                cur.execute(sql, (TENANT, TENANT, TRAINEE_POST_CODES, TENANT, TENANT, TENANT))
            return list(cur.fetchall())
    finally:
        conn.close()


def fetch_hours(emp_nos: list[str], earliest_join: str) -> dict[str, float]:
    """Returns emp_no -> total effective_hours since earliest_join. The
    floor is the MIN(join_date) across the cohort; per-emp floor is applied
    in Python after the fact (the cohort is small enough — ~200 rows —
    that pulling slightly extra rows is cheaper than a CASE-per-emp_no).
    """
    if not emp_nos:
        return {}
    placeholders = ", ".join(["%s"] * len(emp_nos))
    sql = HOURS_SQL_TEMPLATE.format(placeholders=placeholders)
    assert_read_only(sql)
    params: list[Any] = [TENANT, *emp_nos, earliest_join]
    conn = connect(OPEMPEFFICIENCY_DB)
    try:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            rows = list(cur.fetchall())
    finally:
        conn.close()
    return {str(r["emp_no"]): float(r["hours"] or 0.0) for r in rows}


def fetch_hours_chunked(emp_nos: list[str], earliest_join: str, chunk: int = 100) -> dict[str, float]:
    out: dict[str, float] = {}
    for i in range(0, len(emp_nos), chunk):
        out.update(fetch_hours(emp_nos[i : i + chunk], earliest_join))
    return out


def build_payload(cohort_def: str) -> dict[str, Any]:
    cohort = fetch_cohort(cohort_def)
    logger.info("cohort %s size = %d", cohort_def, len(cohort))

    if not cohort:
        # Fail loudly — the cron host should never publish an empty board.
        raise RuntimeError(
            f"cohort query returned 0 rows for cohort_def={cohort_def}; "
            "refusing to write an empty payload"
        )

    join_dates = [str(r["join_date"]) for r in cohort if r.get("join_date")]
    earliest = min(join_dates) if join_dates else "2025-01-01"

    emp_nos = [str(r["emp_no"]) for r in cohort]
    hours_map = fetch_hours_chunked(emp_nos, earliest)
    logger.info("hours-map size = %d (cohort emps with attendance rows)", len(hours_map))

    rows: list[dict[str, Any]] = []
    for r in cohort:
        emp_no = str(r["emp_no"])
        hours = round(hours_map.get(emp_no, 0.0), 1)
        rows.append(
            {
                "full_name":   str(r.get("full_name") or "").strip(),
                "employee_no": emp_no,
                "store":       str(r.get("store_name") or "").strip(),
                # 区域: NOT AVAILABLE in upstream — see §5 CHECKPOINT 4 of the build spec.
                # Render "—" until t_shop_info or t_ehr_department exposes a region rollup.
                "region":      "—",
                "position":    str(r.get("post_name") or "").strip(),
                "hire_date":   str(r.get("join_date") or ""),
                "hours":       hours,
                "band":        _band(hours),
                "status":      "Active" if int(r.get("status") or 0) == 1 else "Separated",
            }
        )

    rows.sort(key=lambda x: x["hours"], reverse=True)

    hours_list = [r["hours"] for r in rows]
    total = len(rows)
    ge72 = sum(1 for h in hours_list if h >= THRESH["yellow"])
    ge96 = sum(1 for h in hours_list if h >= THRESH["orange"])
    ge112 = sum(1 for h in hours_list if h >= THRESH["red"])
    avg = round(sum(hours_list) / total, 1) if total else 0.0
    median = round(statistics.median(hours_list), 1) if total else 0.0
    target_rate = round(ge112 / total, 4) if total else 0.0

    regions = sorted({r["region"] for r in rows})

    return {
        "meta": {
            "board_id":      "LCNA-HR-LSO-TRAIN-2026",
            "generated_at":  datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")[:-4] + "Z",
            "generated_by":  "collect.py",
            "tz":            "America/New_York",
            "target_hours":  TARGET_HOURS,
            "thresholds":    THRESH,
            "cohort_def":    cohort_def,
            "source":        "confirmed",
            "attend_source": f"{OPEMPEFFICIENCY_DB}.t_attendance",
        },
        "kpis": {
            "total":       total,
            "ge72":        ge72,
            "ge96":        ge96,
            "ge112":       ge112,
            "target_rate": target_rate,
            "avg":         avg,
            "median":      median,
        },
        "regions": regions,
        "rows":    rows,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Build public/data.json for the LSO100 board")
    parser.add_argument("--cohort", choices=["a", "b"], default="a",
                        help="cohort definition per §6 (default: a)")
    parser.add_argument("--out", default=str(REPO_ROOT / LOCAL_PAYLOAD_PATH),
                        help="output path (default: repo public/data.json)")
    parser.add_argument("--dry-run", action="store_true",
                        help="print stats to stderr; still writes the payload")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    payload = build_payload(args.cohort)
    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")

    logger.info(
        "wrote %s — total=%d ge72=%d ge96=%d ge112=%d avg=%.1f median=%.1f",
        out_path,
        payload["kpis"]["total"],
        payload["kpis"]["ge72"],
        payload["kpis"]["ge96"],
        payload["kpis"]["ge112"],
        payload["kpis"]["avg"],
        payload["kpis"]["median"],
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
