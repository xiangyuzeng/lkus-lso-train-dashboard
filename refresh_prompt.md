# LSO100 train-board · scheduled-agent refresh prompt

You are refreshing `public/data.json` for the LSO100 在训训练时长看板 and pushing
it to GitHub. Run silently — no narration, no explanations, no summary.

## Hard rules

- SELECT-only. No INSERT/UPDATE/DELETE/DDL.
- Every exploratory query gets `LIMIT`. The two production queries below do
  not need a LIMIT because their scope is already bounded by tenant + cohort.
- Mask PII (email, phone, payment) — none of these are in the output payload
  by design, but never paste them mid-run.

## Workflow

1. **Pull cohort (definition a)** via the MCP DB Gateway:

   ```sql
   -- server = aws-luckyus-iehr-rw
   SELECT e.emp_no, e.name AS full_name, e.join_date, e.status,
          d.name AS store_name, d.id AS dept_id, d.parent_code,
          p.code AS post_code, p.name AS post_name
   FROM   t_ehr_employee e
   JOIN   t_ehr_department d ON d.id=e.belong_dept_id AND d.type=0 AND d.tenant='LKUS'
   LEFT JOIN t_ehr_employee_post_relation pr
          ON pr.emp_no=e.emp_no AND pr.relation_type=0 AND pr.tenant='LKUS'
   LEFT JOIN t_ehr_post p ON p.id=pr.post_id AND p.tenant='LKUS'
   LEFT JOIN t_ehr_employee_training_record tr
          ON tr.emp_no=e.emp_no AND tr.course_title LIKE '%LSO100%' AND tr.tenant='LKUS'
   WHERE  e.tenant='LKUS' AND e.status=1 AND tr.id IS NULL;
   ```

2. **Pull cumulative hours** for the cohort (chunk emp_no in groups of 100):

   ```sql
   -- server = aws-luckyus-opempefficiency-rw
   SELECT emp_no, SUM(effective_hours) AS hours
   FROM   t_attendance
   WHERE  tenant='LKUS'
     AND  emp_no IN (...chunk...)
     AND  attendance_date >= '<earliest join_date in cohort>'
   GROUP  BY emp_no;
   ```

3. **Build payload** matching `lib/types.ts`:
   - `meta.generated_at` = NOW UTC, `meta.generated_by='refresh_prompt.md'`,
     `meta.source='confirmed'`, `meta.tz='America/New_York'`,
     `meta.attend_source='luckyus_opempefficiency.t_attendance'`,
     `meta.thresholds={yellow:72,orange:96,red:112}`, `meta.target_hours=112`,
     `meta.cohort_def='a'`, `meta.board_id='LCNA-HR-LSO-TRAIN-2026'`.
   - `rows`: one row per cohort emp; round hours to 1 dp; band by value
     (`<72`→none, `≥72`→yellow, `≥96`→orange, `≥112`→red).
   - `region` = `"—"` for every row (upstream rollup not yet exposed).
   - Sort `rows` by `hours` desc.
   - `kpis.total=len(rows)`, `ge72/96/112` as counts, `target_rate=ge112/total`,
     `avg` and `median` to 1 dp.
   - `regions=["—"]`.

4. **Validate** — if `len(rows) == 0` or any required `meta` field is missing,
   STOP. Do not push. Do not commit. Exit with a one-line failure message.

5. **Write** `public/data.json` and **push** to GitHub:
   - Repo: `xiangyuzeng/lkus-lso-train-dashboard`
   - Path: `public/data.json` · branch: `main`
   - Commit message: `[auto] LSO train data refresh YYYY-MM-DD HH:MM`
   - Auth: `GITHUB_TOKEN` env var (repo scope).
   - Use the GitHub Contents API (GET sha → base64 → PUT), three retries
     with exponential backoff (2/4/8 s).

6. End. Print only `OK <total> rows pushed at <ISO>` on success.
