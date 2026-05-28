# LSO100 在训训练时长看板 · lkus-lso-train-dashboard

Internal HR-ops board for Luckin Coffee North America (tenant `LKUS`). Tracks
every associate still training toward the LSO100 certification — their
cumulative actual clocked-in work hours since hire, against the **112-hour**
target.

- Stack: Next.js 14 (App Router) + TypeScript, deployed to Vercel.
- Pipeline: Python 3.11 (`pymysql` + `boto3` + `requests`), runs on an internal
  cron host with VPC reach to the production RDS instances.
- Refresh: hourly. Pipeline pushes one static JSON payload to GitHub, Vercel
  rebuilds on push, client polls the payload every 5 minutes for early pickup.
- Theme: light, Luckin navy, Simplified-Chinese-facing.

> The client **never** touches MySQL. The only network path between the public
> Vercel dashboard and the internal databases is the static `public/data.json`
> payload that the pipeline commits.

---

## Data flow

```
                ┌────────────────────────────────────────────────┐
                │   Internal VPC (cron host on dbtools or EC2)    │
                │                                                 │
                │   ┌────────────┐    SELECT-only    ┌─────────┐  │
                │   │ collect.py ├───────────────────► RDS:    │  │
                │   │            │                   │ iEHR    │  │
                │   │            ◄───────────────────┤         │  │
                │   │            │                   └─────────┘  │
                │   │            │    SELECT-only    ┌──────────┐ │
                │   │            ├───────────────────► RDS:     │ │
                │   │            │                   │ opemp-   │ │
                │   │            ◄───────────────────┤ efficien.│ │
                │   │            │                   └──────────┘ │
                │   │            │                                │
                │   │  hours +   │                                │
                │   │  bands +   │                                │
                │   │  KPIs      │                                │
                │   └─────┬──────┘                                │
                │         │ writes public/data.json               │
                │         ▼                                       │
                │   ┌────────────┐    Contents API   ┌─────────┐  │
                │   │  push_to_  ├───────────────────► GitHub  │  │
                │   │  github.py │   GET sha →base64 │  repo   │  │
                │   │            │    PUT (retry 3×) │         │  │
                │   └────────────┘                   └────┬────┘  │
                └────────────────────────────────────────┼────────┘
                                                         │
                                                         │ webhook
                                                         ▼
                                                   ┌─────────────┐
                                                   │   Vercel    │
                                                   │   rebuild   │
                                                   └──────┬──────┘
                                                          │
                                                          ▼
                                          ┌──────────────────────────┐
                                          │  Static Next.js page     │
                                          │  fetches ./data.json     │
                                          │  every 5 min, cache-bust │
                                          │  → real-age freshness    │
                                          │     badge + UI render    │
                                          └──────────────────────────┘
```

---

## Confirmed sources (from live, read-only discovery 2026-05-28)

| Concern | Server / schema.table | Field(s) | Status |
|---|---|---|---|
| Cohort roster | `aws-luckyus-iehr-rw` · `luckyus_iehr.t_ehr_employee` + `t_ehr_employee_post_relation` + `t_ehr_post` + `t_ehr_department` | `emp_no, name, join_date, status, belong_dept_id, post_code, post_name, dept.name (store), dept.parent_code` | ✅ confirmed |
| LSO100 acquisition (negative filter) | `luckyus_iehr.t_ehr_employee_training_record` | `course_title LIKE '%LSO100%'` | ✅ confirmed (NOT `t_ehr_yxt_certificate`, which holds cert *templates*, not employee acquisitions) |
| Worked hours | `aws-luckyus-opempefficiency-rw` · `luckyus_opempefficiency.t_attendance` | `effective_hours` (float 7,2), `attendance_date` (DATE), `emp_no`, `tenant` | ✅ confirmed — pre-aggregated daily model |
| Tenant scope | both schemas | `tenant='LKUS'` | ✅ confirmed (explicit column, no implicit-by-server) |
| Reporting TZ | `t_attendance.attendance_date` already local-NY date | — | ✅ confirmed (`t_shop_info.time_zone='America/New_York'` for all LKUS stores) |
| Join key | `emp_no` matches across both schemas | format `US<YYMMDD><seq>`, e.g. `US202505130005` | ✅ confirmed |
| Store dictionary | `aws-luckyus-opshop-rw` · `luckyus_opshop.t_shop_info` | `shop_name`, 15 LKUS stores + 1 JFK kiosk | ✅ confirmed (used for cross-reference only; the cohort SQL pulls store name from `t_ehr_department`) |

## Pending sources (rendered "—", flagged in payload)

| Concern | Why pending | How to wire it on |
|---|---|---|
| **所在区域 / region** | `t_shop_info.administrative_area_name`, `locality_name`, `sublocality_name` are NULL for all LKUS stores. `t_ehr_department.parent_code` rolls everyone up to one HQ (`LKUS00000041`), which is not a useful region distinction. | Once HR-ops publishes a store→region map (e.g. "Midtown / Downtown / Uptown / JFK"), add a CSV at `pipeline/config/region_map.csv` keyed on `store_name`, load it in `collect.py::build_payload` and set `row.region` from the lookup. The UI already supports per-region filter chips; flipping the data on is a one-line change. |
| **Cohort floor** | Cohort (a) currently includes long-tenured store managers without an LSO100 record. Counted live: 198 employees. | If HR-ops wants to scope to recent hires only, switch to cohort (b) (78 trainee-post rows) by running `./refresh.sh COHORT=b`, or add a `join_date >= DATE_SUB(NOW(),INTERVAL X MONTH)` floor in `pipeline/collect.py::COHORT_A_SQL`. |
| **Open-enrollment cohort (c)** | No enrollment table exists in iEHR. `t_ehr_yxt_user` carries 云学堂 user registration only, no per-course progress. | Wait for the 云学堂 mirror to land a `t_ehr_yxt_enrollment` (or equivalent) before implementing cohort (c). |

---

## The three refresh paths

### A — pymysql + AWS Secrets Manager on an internal cron host  · **PRIMARY**

```bash
# crontab.example
0 * * * * cd /opt/lkus-lso-train-dashboard && ./refresh.sh >> logs/cron.log 2>&1
```

`refresh.sh` runs `schema_probe → collect.py → validate JSON → push_to_github.py`
and bails on any failure so no stale or empty payload is ever pushed.

Required env (set in `/etc/profile.d/lkus-lso.sh` or systemd EnvironmentFile):

```bash
MYSQL_SECRET_NAME=collector/mysql          # AWS Secrets Manager secret name
AWS_REGION=us-east-1
IEHR_HOST=<iehr-rds-endpoint>              # optional per-DB host override
OPEMPEFFICIENCY_HOST=<opemp-rds-endpoint>  # optional per-DB host override
GITHUB_TOKEN=ghp_xxx                       # repo-scope PAT, never committed
GITHUB_REPO=xiangyuzeng/lkus-lso-train-dashboard
GITHUB_BRANCH=main
GITHUB_FILE_PATH=public/data.json
```

The Secrets Manager secret payload is the same shape used by the sibling
`luckin-ops-dashboard` and `luckin-efficiency-dashboard` pipelines:

```json
{
  "host":     "...",
  "port":     3306,
  "username": "...",
  "password": "...",
  "dbname":   "luckyus_iehr"
}
```

### B — MCP DB Gateway · ad-hoc only

The MCP DB gateway at `http://10.238.3.43:8080` is what this session used for
discovery (the `mcp__mcp-db-gateway__mysql_query` tool, server names
`aws-luckyus-iehr-rw` and `aws-luckyus-opempefficiency-rw`). It speaks the
MCP SSE protocol — there is no plain-HTTP query endpoint, so it's used from
Claude Code / a local MCP client rather than a Python script. For an
out-of-band manual refresh, use path C below.

### C — Scheduled Claude Code agent · fallback

When the cron host is down or the operator only has Claude Code in reach:

```bash
0 * * * * cd /opt/lkus-lso-train-dashboard && \
  claude --dangerously-skip-permissions -p "$(cat refresh_prompt.md)" >> logs/cron.log 2>&1
```

The agent runs the same two queries from `refresh_prompt.md`, rewrites
`public/data.json` with `meta.source='confirmed'`, and pushes via the GitHub
Contents API. `GITHUB_TOKEN` is read from the agent's environment.

---

## Cohort definition (default = **a** per §6 of the build spec)

> Active + `tenant='LKUS'` + assigned to a store dept (`t_ehr_department.type=0`) +
> no LSO100 row in `t_ehr_employee_training_record`.

Live cohort sizes (confirmed 2026-05-28):

- (a) 198 employees ← **default**
- (b) Active + LKUS + primary post in (95, 96, 97, 98) trainee codes + no LSO100 → 78 employees
- (c) Open enrollment — not currently buildable; no enrollment table exists in iEHR

To switch: set `COHORT=b` in the cron env, or pass `--cohort b` to `collect.py`.

---

## Payload shape (`public/data.json`)

```jsonc
{
  "meta": {
    "board_id":      "LCNA-HR-LSO-TRAIN-2026",
    "generated_at":  "2026-05-28T22:30:00.000Z",   // ISO UTC
    "generated_by":  "collect.py",
    "tz":            "America/New_York",
    "target_hours":  112,
    "thresholds":    { "yellow": 72, "orange": 96, "red": 112 },
    "cohort_def":    "a",
    "source":        "confirmed",                  // or "seed"
    "attend_source": "luckyus_opempefficiency.t_attendance"
  },
  "kpis":    { "total": 198, "ge72": 92, "ge96": 55, "ge112": 22, "target_rate": 0.1111, "avg": 65.4, "median": 58.2 },
  "regions": ["—"],                                // until a region map is wired
  "rows": [
    {
      "full_name":   "Yaqing Zuo",
      "employee_no": "US202505130005",
      "store":       "33rd & 10th",
      "region":      "—",
      "position":    "Store Manager",
      "hire_date":   "2026-02-12",
      "hours":       168.5,
      "band":        "red",                        // none | yellow | orange | red
      "status":      "Active"                      // or "Separated"
    }
  ]
}
```

Rows are sorted by `hours` descending. The collector computes `band` from
`hours` using the same thresholds the UI uses for filter chips and cell colour,
so the two never disagree.

---

## Local dev

```bash
npm install
npm run dev      # http://localhost:3000 — renders against public/data.json
npm run build    # production build; final acceptance gate
```

The shipped `public/data.json` is a clearly-labeled **SEED** payload (22
realistic rows spanning all four heat bands). The `SeedBadge` chip stays
visible until the pipeline overwrites the file with `meta.source='confirmed'`.

To preview the stale state, change `meta.generated_at` to a timestamp older
than 90 minutes — the whole board greys out via the `.board--stale` class.

---

## Acceptance gates (run before declaring done)

1. `npm run build` → zero TypeScript / lint errors, zero console warnings.
2. `npm run dev` → SeedBadge visible, FreshnessBadge shows "刚刚", KPI row + table populated, search & chip filters work, default sort is 训练时长 desc.
3. Heat-band check: rows with hours `70.0 / 80.0 / 100.0 / 120.0` render as `none / yellow / orange / red`.
4. Stale check: `meta.generated_at` set 2h ago → board greys out, badge reads "2 小时前".
5. Pipeline dry-run (internal host): `python3 -m pipeline.collect --cohort a` writes a valid payload with `meta.source='confirmed'` and `len(rows) > 0`.
6. Push test: `python3 -m pipeline.sender.push_to_github` returns 0 against a throwaway path, retries on simulated 409.
7. Bail-on-failure: simulate a broken collector — `refresh.sh` exits non-zero and does NOT call `push_to_github.py`.

---

## File map

```
app/                    Next.js App Router
  layout.tsx
  page.tsx              Header + FreshnessBadge + KpiRow + TrainingTable
  globals.css           CSS variables + .board--stale gray treatment
lib/
  tokens.ts             palette + space + radius + shadow + bandStyle
  freshness.ts          freshness(generatedAt, staleMin=90), formatAge(mins)
  types.ts              Payload, PayloadMeta, PayloadKpis, PayloadRow, Band
  payload.ts            usePayload() — fetch ./data.json?ts=<ms> every 5 min
components/
  FreshnessBadge.tsx    Real-age pill, gold when stale, no fake countdown
  SeedBadge.tsx         Amber chip while meta.source === 'seed'
  KpiCard.tsx           One KPI tile w/ accent rail
  KpiRow.tsx            Six tiles per §3b
  HoursCell.tsx         1-dp number + 0→112 progress bar, heat-band coloured
  TrainingTable.tsx     Search + band chips + region chips + sortable + sticky/frozen
public/
  data.json             SEED initially; overwritten by pipeline
pipeline/
  collect.py            §5/§6 SQL → cumulative hours + KPIs + bands → public/data.json
  schema_probe.py       CHECKPOINT-1/2 drift detection → pipeline/schema_map.json
  sender/
    push_to_github.py   Contents API PUT, 3 retries 2/4/8 s
  config/
    settings.py         Secrets Manager loader + per-DB host override + assert_read_only
  requirements.txt      pymysql, boto3, requests
refresh.sh              collect → validate → push; bails on any failure
refresh_prompt.md       Mode-C fallback prompt for Claude Code agent
crontab.example         The hourly cron line, with env var documentation
vercel.json             cleanUrls + security headers + Cache-Control max-age=60 on /data.json
.github/workflows/
  refresh.yml           workflow_dispatch fallback (real cron runs on internal host)
```

---

## Safety + read-only guarantees

- All SQL is constructed in `pipeline/collect.py` and `pipeline/schema_probe.py`.
- Every SQL string is passed through `assert_read_only(sql)` before execute,
  which rejects any string containing `insert / update / delete / drop /
  truncate / replace / alter / grant / revoke / create`.
- `GITHUB_TOKEN` is read from the environment — never committed and never
  written to disk by the pipeline.
- The MySQL secret is fetched from AWS Secrets Manager at run-time only;
  the secret name itself must be passed in via `MYSQL_SECRET_NAME` and has no
  default, so a misconfigured host cannot accidentally use a stale fallback.
