"""LSO train-time collector (four levels).

For tenant LKUS it builds four in-training rosters — LSO100/200/300/400 — from a
single active-store base population:

  base        = Active + tenant='LKUS' + assigned to a store dept (t_ehr_department.type=0)
  cert flags  = t_ehr_employee_qualification_info.cer_id  (NOT the empty
                t_ehr_employee_training_record); cer_id → level via CER_ID_TO_LEVEL
  cohort      = progression filter (LSO100=no100; LSO200=has100,no200; …)
  value       = SUM(t_attendance.effective_hours) since hire — hours for LSO100,
                days (hours/8) for LSO200/300/400
  LSO course  = t_working_time_apply (the "Working Hour Application") joined via
                t_working_time_apply_relate_emp; sub_type picks the level's class

Writes public/data.json with meta.source='confirmed'. SELECT-only — every SQL
string goes through assert_read_only() before execute.
"""
from __future__ import annotations

import argparse
import json
import logging
import re
import statistics
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .config.settings import (
    ATTEND_SOURCE,
    CERT_SOURCE,
    COURSE_SOURCE,
    IEHR_DB,
    LOCAL_PAYLOAD_PATH,
    OPEMPEFFICIENCY_DB,
    TENANT,
    assert_read_only,
    connect,
)

logger = logging.getLogger(__name__)

REPO_ROOT = Path(__file__).resolve().parent.parent

# ─────────────────────────────────────────────────────────────────────
# Level configuration — thresholds/targets per the build spec. course_sub_type
# is the t_working_time_apply.sub_type (work_type=4 training) that maps to each
# level's prep class; course_label is the human label shown in the LSO Course
# column. LSO100 has no course column.
# ─────────────────────────────────────────────────────────────────────
LEVELS: list[dict[str, Any]] = [
    {"key": "LSO100", "title": "Barista", "unit": "hours", "target": 112,
     "thresholds": {"yellow": 72, "orange": 96, "red": 112}, "has_course_col": False,
     "in_training_def": "No LSO100 certification",
     "course_sub_type": None, "course_label": None},
    {"key": "LSO200", "title": "Shift Supervisor", "unit": "days", "target": 45,
     "thresholds": {"yellow": 30, "orange": 35, "red": 45}, "has_course_col": True,
     "in_training_def": "Holds LSO100, no LSO200",
     "course_sub_type": 1, "course_label": "Course for Shift Supervisor"},
    {"key": "LSO300", "title": "Assistant Store Manager", "unit": "days", "target": 60,
     "thresholds": {"yellow": 52, "orange": 55, "red": 60}, "has_course_col": True,
     "in_training_def": "Holds LSO100 + LSO200, no LSO300",
     "course_sub_type": 3, "course_label": "Course for Assistant Store Manager"},
    {"key": "LSO400", "title": "Store Manager", "unit": "days", "target": 90,
     "thresholds": {"yellow": 75, "orange": 80, "red": 90}, "has_course_col": True,
     "in_training_def": "Holds LSO100 + LSO200 + LSO300, no LSO400",
     "course_sub_type": 2, "course_label": "Course for Store Manager"},
]

# cer_id → LSO level (verified live; LSO300 includes the legacy t_ehr_certificate
# master id so the single emp carrying it is not lost).
CER_ID_TO_LEVEL: dict[str, str] = {
    "83a7b425-40ec-4c86-b766-1f0488843787": "LSO100",
    "35a26709-b4a0-49ae-96f5-723f0f448d76": "LSO200",
    "7bab460e-360e-462b-bac9-1300331b2176": "LSO300",
    "803c8627-5bef-4aa6-b563-0062b13f3b13": "LSO300",  # legacy master
    "09fe6ae9-78ac-4447-9958-99c834e6a4d3": "LSO400",
}

LEVEL_ORDER = ["LSO100", "LSO200", "LSO300", "LSO400"]

# ─────────────────────────────────────────────────────────────────────
# SQL — held verbatim. Table names are bare; connect(db) sets the default DB,
# and the two source DBs live on separate connections (iEHR vs opempefficiency).
# ─────────────────────────────────────────────────────────────────────

BASE_SQL = """
SELECT  e.emp_no,
        e.name      AS full_name,
        e.join_date,
        e.status,
        d.name      AS store_name,
        p.name      AS post_name
FROM    t_ehr_employee e
JOIN    t_ehr_department d
        ON d.id = e.belong_dept_id AND d.type = 0 AND d.tenant = %s
LEFT JOIN t_ehr_employee_post_relation pr
        ON pr.emp_no = e.emp_no AND pr.relation_type = 0 AND pr.tenant = %s
LEFT JOIN t_ehr_post p
        ON p.id = pr.post_id AND p.tenant = %s
WHERE   e.tenant = %s AND e.status = 1
"""

# Long-format cert acquisitions. Filtered to the cer_ids we map; emp_no scope is
# applied in Python against the base roster.
CERT_SQL = "SELECT emp_no, cer_id FROM t_ehr_employee_qualification_info"

STORE_COUNT_SQL = """
SELECT COUNT(DISTINCT d.id) AS n
FROM   t_ehr_employee e
JOIN   t_ehr_department d
       ON d.id = e.belong_dept_id AND d.type = 0 AND d.tenant = %s
WHERE  e.tenant = %s AND e.status = 1
"""

HOURS_SQL_TEMPLATE = """
SELECT  emp_no, SUM(effective_hours) AS hours
FROM    t_attendance
WHERE   tenant = %s
  AND   emp_no IN ({placeholders})
  AND   attendance_date >= %s
GROUP BY emp_no
"""

COURSE_SQL_TEMPLATE = """
SELECT  re.emp_no, a.sub_type, a.apply_name, a.end_date_time
FROM    t_working_time_apply a
JOIN    t_working_time_apply_relate_emp re
        ON re.apply_id = a.id AND re.tenant = %s
WHERE   a.tenant = %s
  AND   a.deleted = 0
  AND   a.work_type = 4
  AND   a.sub_type IN (1, 2, 3)
  AND   re.emp_no IN ({placeholders})
"""

# apply_name looks like "{TrainingTypeEnum.DUTY_SUPERVISOR}(2026-04-15~2026-04-15)";
# pull the first date in the parens as the class date.
_DATE_RE = re.compile(r"\((\d{4}-\d{2}-\d{2})")

# ─────────────────────────────────────────────────────────────────────


def _band(value: float, t: dict[str, int]) -> str:
    if value >= t["red"]:    return "red"
    if value >= t["orange"]: return "orange"
    if value >= t["yellow"]: return "yellow"
    return "none"


def _parse_course_date(apply_name: str | None) -> str | None:
    m = _DATE_RE.search(apply_name or "")
    return m.group(1) if m else None


def _assign_cohort(held: set[str]) -> str | None:
    """Progression filter: the first level (in order) the emp has NOT earned."""
    for level in LEVEL_ORDER:
        if level not in held:
            return level
    return None  # holds all four → not in any in-training roster


def fetch_base() -> list[dict[str, Any]]:
    assert_read_only(BASE_SQL)
    conn = connect(IEHR_DB)
    try:
        with conn.cursor() as cur:
            cur.execute(BASE_SQL, (TENANT, TENANT, TENANT, TENANT))
            return list(cur.fetchall())
    finally:
        conn.close()


def fetch_cert_levels() -> dict[str, set[str]]:
    """emp_no -> set of LSO levels held (from qualification_info via cer_id map)."""
    assert_read_only(CERT_SQL)
    conn = connect(IEHR_DB)
    try:
        with conn.cursor() as cur:
            cur.execute(CERT_SQL)
            rows = list(cur.fetchall())
    finally:
        conn.close()
    out: dict[str, set[str]] = {}
    for r in rows:
        level = CER_ID_TO_LEVEL.get(str(r["cer_id"]))
        if level:
            out.setdefault(str(r["emp_no"]), set()).add(level)
    return out


def fetch_store_count() -> int:
    assert_read_only(STORE_COUNT_SQL)
    conn = connect(IEHR_DB)
    try:
        with conn.cursor() as cur:
            cur.execute(STORE_COUNT_SQL, (TENANT, TENANT))
            row = cur.fetchone()
    finally:
        conn.close()
    return int(row["n"]) if row and row.get("n") is not None else 0


def fetch_hours(emp_nos: list[str], earliest_join: str) -> dict[str, float]:
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


def fetch_courses_chunked(emp_nos: list[str], chunk: int = 100) -> dict[str, dict[int, str | None]]:
    """emp_no -> {sub_type: class_date|None}. Keeps the latest class date per
    (emp, sub_type). Presence of the sub_type key == 'attended that class'."""
    out: dict[str, dict[int, str | None]] = {}
    for i in range(0, len(emp_nos), chunk):
        part = emp_nos[i : i + chunk]
        if not part:
            continue
        placeholders = ", ".join(["%s"] * len(part))
        sql = COURSE_SQL_TEMPLATE.format(placeholders=placeholders)
        assert_read_only(sql)
        params: list[Any] = [TENANT, TENANT, *part]
        conn = connect(OPEMPEFFICIENCY_DB)
        try:
            with conn.cursor() as cur:
                cur.execute(sql, params)
                rows = list(cur.fetchall())
        finally:
            conn.close()
        for r in rows:
            emp = str(r["emp_no"])
            sub_type = int(r["sub_type"])
            date = _parse_course_date(r.get("apply_name"))
            slot = out.setdefault(emp, {})
            prev = slot.get(sub_type)
            # keep the most recent class date; presence of the key marks attendance
            if sub_type not in slot or (date or "") > (prev or ""):
                slot[sub_type] = date
    return out


def _kpis(rows: list[dict[str, Any]], t: dict[str, int]) -> dict[str, Any]:
    vals = [r["value"] for r in rows]
    total = len(rows)
    ge_y = sum(1 for v in vals if v >= t["yellow"])
    ge_o = sum(1 for v in vals if v >= t["orange"])
    ge_r = sum(1 for v in vals if v >= t["red"])
    return {
        "total":       total,
        "ge_yellow":   ge_y,
        "ge_orange":   ge_o,
        "ge_red":      ge_r,
        "target_rate": round(ge_r / total, 4) if total else 0.0,
        "avg":         round(sum(vals) / total, 1) if total else 0.0,
        "median":      round(statistics.median(vals), 1) if total else 0.0,
    }


def build_payload() -> dict[str, Any]:
    base = fetch_base()
    if not base:
        raise RuntimeError("base roster query returned 0 rows; refusing to write an empty payload")

    cert = fetch_cert_levels()
    store_count = fetch_store_count()

    emp_nos = [str(r["emp_no"]) for r in base]
    join_dates = [str(r["join_date"]) for r in base if r.get("join_date")]
    earliest = min(join_dates) if join_dates else "2025-01-01"

    hours_map = fetch_hours_chunked(emp_nos, earliest)
    course_map = fetch_courses_chunked(emp_nos)
    logger.info("base=%d hours_map=%d course_emps=%d stores=%d",
                len(base), len(hours_map), len(course_map), store_count)

    by_level: dict[str, list[dict[str, Any]]] = {lvl["key"]: [] for lvl in LEVELS}
    for r in base:
        cohort = _assign_cohort(cert.get(str(r["emp_no"]), set()))
        if cohort is not None:
            by_level[cohort].append(r)

    levels_out: list[dict[str, Any]] = []
    for lvl in LEVELS:
        rows: list[dict[str, Any]] = []
        for r in by_level[lvl["key"]]:
            emp = str(r["emp_no"])
            hours = round(hours_map.get(emp, 0.0), 1)
            value = hours if lvl["unit"] == "hours" else round(hours / 8.0, 1)

            if lvl["has_course_col"]:
                attended = emp in course_map and lvl["course_sub_type"] in course_map[emp]
                lso_course = lvl["course_label"] if attended else "pending"
                lso_course_date = course_map[emp][lvl["course_sub_type"]] if attended else None
            else:
                lso_course = None
                lso_course_date = None

            rows.append({
                "full_name":       str(r.get("full_name") or "").strip(),
                "employee_no":     emp,
                "store":           str(r.get("store_name") or "").strip(),
                "region":          "—",  # no store→region rollup upstream; never fabricated
                "position":        str(r.get("post_name") or "").strip(),
                "hire_date":       str(r.get("join_date") or ""),
                "value":           value,
                "band":            _band(value, lvl["thresholds"]),
                "lso_course":      lso_course,
                "lso_course_date": lso_course_date,
                "status":          "Active" if int(r.get("status") or 0) == 1 else "Separated",
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
            "generated_by":   "collect.py",
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


def main() -> int:
    parser = argparse.ArgumentParser(description="Build public/data.json for the LSO train board (4 levels)")
    parser.add_argument("--out", default=str(REPO_ROOT / LOCAL_PAYLOAD_PATH),
                        help="output path (default: repo public/data.json)")
    parser.add_argument("--dry-run", action="store_true", help="print stats to stderr; still writes the payload")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    payload = build_payload()
    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")

    for lvl in payload["levels"]:
        k = lvl["kpis"]
        logger.info("%s: total=%d ge_y=%d ge_o=%d ge_r=%d avg=%.1f median=%.1f",
                    lvl["key"], k["total"], k["ge_yellow"], k["ge_orange"], k["ge_red"], k["avg"], k["median"])
    logger.info("wrote %s", out_path)
    return 0


if __name__ == "__main__":
    sys.exit(main())
