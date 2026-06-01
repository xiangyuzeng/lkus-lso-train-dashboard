# LSO Training Progress · lkus-lso-train-dashboard

Internal HR-ops board for Luckin Coffee North America (tenant `LKUS`). Tracks the
four in-training rosters — **LSO100 / LSO200 / LSO300 / LSO400** — listing every
associate still working toward each certification and their cumulative actual
clocked-in training time since hire, against per-level targets.

- Stack: Next.js 14 (App Router) + TypeScript, deployed to Vercel.
- Pipeline: Python 3.11 (`pymysql` + `boto3` + `requests`) on an internal cron
  host with VPC reach to the production RDS instances.
- Refresh: at least daily (hourly cron). The pipeline pushes one static JSON
  payload to GitHub; Vercel rebuilds on push; the client polls the payload every
  5 minutes for early pickup.

> The client **never** touches MySQL. The only path between the public Vercel
> dashboard and the internal databases is the static `public/data.json` payload
> the pipeline commits.

---

## The four levels

| Level | Role | In-training = | Metric | Target | yellow / orange / red | LSO Course col |
|---|---|---|---|---|---|---|
| LSO100 | Barista | no LSO100 | **hours** | 112h | 72 / 96 / 112 | — |
| LSO200 | Shift Supervisor | has LSO100, no LSO200 | **days** (h÷8) | 45d | 30 / 35 / 45 | ✓ |
| LSO300 | Assistant Store Manager | has 100+200, no LSO300 | **days** | 60d | 52 / 55 / 60 | ✓ |
| LSO400 | Store Manager | has 100+200+300, no LSO400 | **days** | 90d | 75 / 80 / 90 | ✓ |

Base population = Active + `tenant='LKUS'` + assigned to a store dept
(`t_ehr_department.type=0`). A row's value is the cumulative `effective_hours`
from hire to today (hours for LSO100; the same total ÷ 8 expressed as days for
the higher levels). The heat band is `value >= red → red`, else `>= orange`, else
`>= yellow`, else neutral.

Live cohort sizes (confirmed 2026-06-01): **LSO100 = 45, LSO200 = 63, LSO300 = 51,
LSO400 = 17** across **18** active-staffed stores.

---

## Confirmed sources (live, read-only)

| Concern | Server · schema.table | Field(s) |
|---|---|---|
| Roster | `aws-luckyus-iehr-rw` · `t_ehr_employee` + `t_ehr_department` + `t_ehr_employee_post_relation` + `t_ehr_post` | `emp_no, name, join_date, status, dept.name (store), post.name (position)` |
| **Cert presence** | `luckyus_iehr.t_ehr_employee_qualification_info` + `t_ehr_yxt_certificate` | `cer_id` → level (see map below) |
| Worked hours | `aws-luckyus-opempefficiency-rw` · `t_attendance` | `effective_hours` (sum since hire), `attendance_date`, `emp_no`, `tenant` |
| LSO Course | `aws-luckyus-opempefficiency-rw` · `t_working_time_apply` + `t_working_time_apply_relate_emp` | `sub_type` (1/2/3), `apply_name`, `re.emp_no` |

**cer_id → level:** LSO100 `83a7b425…` · LSO200 `35a26709…` · LSO300 `7bab460e…`
(+ legacy `803c8627…`) · LSO400 `09fe6ae9…`.

**LSO Course (`t_working_time_apply`, `work_type=4`):** `sub_type=1` DUTY_SUPERVISOR →
"Course for Shift Supervisor" (LSO200) · `sub_type=3` DEPUTY_SHOP_MANAGER →
"Course for Assistant Store Manager" (LSO300) · `sub_type=2` SHOP_MANAGER →
"Course for Store Manager" (LSO400). `sub_type=99` (other, incl. Food Hygiene) and
`work_type=3` (meetings) are ignored. When a trainee has no matching application the
cell renders **"pending"** — never guessed.

> **Source note:** `t_ehr_employee_training_record` (the table an earlier LSO100-only
> build filtered on) is **empty for LKUS** — it cannot distinguish levels. Cert
> acquisitions live in `t_ehr_employee_qualification_info`, which this build uses.

## Pending (rendered "—")

**Region.** All 18 stores roll up to a single HQ parent (`LKUS00000041`); no
Midtown/Downtown/etc. rollup exists upstream. Region renders `—` and its filter is
hidden. To wire it on later, add `pipeline/config/region_map.csv` keyed on store
name and set `row.region` from the lookup in the collector.

---

## Payload shape (`public/data.json`, schema v2)

```jsonc
{
  "meta": {
    "board_id": "LCNA-HR-LSO-TRAIN-2026", "schema_version": 2,
    "generated_at": "…Z", "generated_by": "collect.py", "tz": "America/New_York",
    "source": "confirmed",                       // or "seed"
    "base_def": "active_store", "store_count": 18, "regions": ["—"],
    "cert_source": "luckyus_iehr.t_ehr_employee_qualification_info",
    "attend_source": "luckyus_opempefficiency.t_attendance",
    "course_source": "luckyus_opempefficiency.t_working_time_apply"
  },
  "levels": [
    {
      "key": "LSO200", "title": "Shift Supervisor", "unit": "days", "target": 45,
      "thresholds": { "yellow": 30, "orange": 35, "red": 45 },
      "in_training_def": "Holds LSO100, no LSO200", "has_course_col": true,
      "kpis": { "total": 63, "ge_yellow": 60, "ge_orange": 57, "ge_red": 48, "target_rate": 0.76, "avg": 70.8, "median": 0 },
      "rows": [
        {
          "full_name": "…", "employee_no": "US…", "store": "21st & 3rd", "region": "—",
          "position": "Barista", "hire_date": "2025-06-27",
          "value": 199.5, "band": "red",
          "lso_course": "Course for Shift Supervisor", "lso_course_date": "2026-04-15",
          "status": "Active"
        }
      ]
    }
    // LSO100 (unit hours, no course col), LSO300, LSO400 …
  ]
}
```

Rows are sorted by `value` descending. `lso_course` is `null` for LSO100,
`"pending"` when unresolved, else the level's course label.

---

## Refresh paths

### A — `pymysql` + AWS Secrets Manager on the cron host · **PRIMARY**

```bash
0 * * * * cd /opt/lkus-lso-train-dashboard && ./refresh.sh >> logs/cron.log 2>&1
```

`refresh.sh` runs `schema_probe → collect.py → validate → push_to_github` and
bails on any failure so no stale/empty payload is pushed. Required env:
`MYSQL_SECRET_NAME=collector/mysql`, `AWS_REGION=us-east-1`,
optional `IEHR_HOST` / `OPEMPEFFICIENCY_HOST` per-DB overrides, `GITHUB_TOKEN`.

### B / C — MCP DB Gateway via a Claude Code agent · fallback

When the cron host is down, run `refresh_prompt.md` through a scheduled Claude Code
agent: three read-only gateway queries → `pipeline/bootstrap_from_mcp.py` →
`public/data.json` → push. See `refresh_prompt.md`.

---

## Local dev

```bash
npm install
npm run dev        # http://localhost:3000 — renders against public/data.json
npm run build      # production build; final acceptance gate
npm run typecheck  # tsc --noEmit

python -m pipeline.make_seed   # regenerate the PII-free SEED payload (zero DB)
```

The repo ships a clearly-labelled payload; the `SeedBadge` chip stays visible
while `meta.source==='seed'`. To preview the stale state, set `meta.generated_at`
older than 90 minutes — the board greys out via `.board--stale`.

---

## Acceptance gates

1. `npm run typecheck` and `npm run build` → zero errors.
2. `npm run dev` → four tabs switch; each level's KPI row + table populate;
   LSO100 shows hours, LSO200/300/400 show days + the LSO Course column with
   "pending" where unresolved; search / band-filter / sort work; all English.
3. Heat-band check (per level): LSO200 values 25 / 32 / 40 / 50 d → none / yellow / orange / red.
4. Stale check: `meta.generated_at` 2 h ago → board greys, badge reads "2 hr ago".
5. Pipeline dry-run (host): `python -m pipeline.collect` writes a valid 4-level
   payload with `meta.source='confirmed'` and rows in each non-empty level.

---

## File map

```
app/            layout.tsx · page.tsx (tabs + KPI + table) · globals.css
lib/            types.ts (v2 payload) · payload.ts · freshness.ts · tokens.ts
components/     LevelTabs · KpiRow/KpiCard · TrainingTable · ValueCell · FreshnessBadge · SeedBadge
public/         data.json
pipeline/
  collect.py            4-level SQL → value + bands + course + KPIs → public/data.json
  make_seed.py          synthetic PII-free seed (zero DB)
  bootstrap_from_mcp.py Mode-B/C assembler from gateway JSON results
  schema_probe.py       drift detection over the source tables
  sender/push_to_github.py
  config/settings.py
refresh.sh · refresh_prompt.md · crontab.example · vercel.json
```

## Safety + read-only guarantees

- All SQL is built in `pipeline/*.py`; every string passes `assert_read_only()`,
  which rejects `insert/update/delete/drop/truncate/replace/alter/grant/revoke/create`.
- `GITHUB_TOKEN` and the MySQL secret are read from the environment / Secrets
  Manager at run time — never committed.
