# LSO train-board · scheduled-agent refresh prompt (Mode-C, 4 levels)

You are refreshing `public/data.json` for the LSO Training Progress board and
pushing it to GitHub. Run silently — no narration, no summary.

## Hard rules

- SELECT-only. No INSERT/UPDATE/DELETE/DDL.
- Every exploratory query gets `LIMIT`. The three production queries below are
  already bounded by tenant + cohort, so they need none.
- Mask PII (email, phone, payment) — none are in the payload by design.

## Sources (verified live; schema-qualify every table — the MCP gateway has no default DB)

- Roster + cohort → `aws-luckyus-iehr-rw` · `luckyus_iehr` (`t_ehr_employee` +
  `t_ehr_department` type=0 + `t_ehr_employee_post_relation` relation_type=0 + `t_ehr_post`).
- Cert presence → `luckyus_iehr.t_ehr_employee_qualification_info.cer_id`
  (NOT `t_ehr_employee_training_record`, which is empty for LKUS). cer_id map:
  LSO100 `83a7b425-40ec-4c86-b766-1f0488843787`, LSO200 `35a26709-b4a0-49ae-96f5-723f0f448d76`,
  LSO300 `7bab460e-360e-462b-bac9-1300331b2176` (+legacy `803c8627-5bef-4aa6-b563-0062b13f3b13`),
  LSO400 `09fe6ae9-78ac-4447-9958-99c834e6a4d3`.
- Hours → `aws-luckyus-opempefficiency-rw` · `t_attendance.effective_hours` (sum since hire).
- LSO course → `aws-luckyus-opempefficiency-rw` · `t_working_time_apply` ⋈
  `t_working_time_apply_relate_emp`, `work_type=4`, `sub_type` 1=Shift Supervisor (LSO200),
  3=Assistant Store Manager (LSO300), 2=Store Manager (LSO400). Ignore sub_type 99 and work_type 3.

## Workflow

1. **Roster + cohort** (server `aws-luckyus-iehr-rw`). Save the result to `/tmp/lso_roster.json`:

   ```sql
   SELECT JSON_ARRAYAGG(JSON_OBJECT(
     'emp_no', emp_no, 'full_name', full_name, 'store', store_name,
     'position', post_name, 'hire_date', join_date, 'cohort', cohort)) AS j
   FROM (
     SELECT e.emp_no, e.name AS full_name, e.join_date, d.name AS store_name, p.name AS post_name,
       CASE
         WHEN COALESCE(c.h100,0)=0 THEN 'LSO100'
         WHEN COALESCE(c.h200,0)=0 THEN 'LSO200'
         WHEN COALESCE(c.h300,0)=0 THEN 'LSO300'
         WHEN COALESCE(c.h400,0)=0 THEN 'LSO400'
         ELSE 'DONE' END AS cohort
     FROM luckyus_iehr.t_ehr_employee e
     JOIN luckyus_iehr.t_ehr_department d ON d.id=e.belong_dept_id AND d.type=0 AND d.tenant='LKUS'
     LEFT JOIN luckyus_iehr.t_ehr_employee_post_relation pr ON pr.emp_no=e.emp_no AND pr.relation_type=0 AND pr.tenant='LKUS'
     LEFT JOIN luckyus_iehr.t_ehr_post p ON p.id=pr.post_id AND p.tenant='LKUS'
     LEFT JOIN (
       SELECT emp_no,
         MAX(cer_id IN ('83a7b425-40ec-4c86-b766-1f0488843787')) h100,
         MAX(cer_id IN ('35a26709-b4a0-49ae-96f5-723f0f448d76')) h200,
         MAX(cer_id IN ('7bab460e-360e-462b-bac9-1300331b2176','803c8627-5bef-4aa6-b563-0062b13f3b13')) h300,
         MAX(cer_id IN ('09fe6ae9-78ac-4447-9958-99c834e6a4d3')) h400
       FROM luckyus_iehr.t_ehr_employee_qualification_info GROUP BY emp_no
     ) c ON c.emp_no=e.emp_no
     WHERE e.tenant='LKUS' AND e.status=1
   ) x
   WHERE cohort <> 'DONE';
   ```

2. **Hours** (server `aws-luckyus-opempefficiency-rw`) → `/tmp/lso_hours.json`:

   ```sql
   SELECT JSON_OBJECTAGG(emp_no, hrs) AS j FROM (
     SELECT emp_no, ROUND(SUM(effective_hours),1) hrs
     FROM luckyus_opempefficiency.t_attendance WHERE tenant='LKUS' GROUP BY emp_no) t;
   ```

3. **Courses** (server `aws-luckyus-opempefficiency-rw`) → `/tmp/lso_courses.json`:

   ```sql
   SELECT JSON_ARRAYAGG(JSON_OBJECT('emp_no',emp_no,'sub_type',sub_type,'apply_name',apply_name)) AS j
   FROM (
     SELECT re.emp_no, a.sub_type, a.apply_name, a.end_date_time
     FROM luckyus_opempefficiency.t_working_time_apply a
     JOIN luckyus_opempefficiency.t_working_time_apply_relate_emp re ON re.apply_id=a.id AND re.tenant='LKUS'
     WHERE a.tenant='LKUS' AND a.deleted=0 AND a.work_type=4 AND a.sub_type IN (1,2,3)
     ORDER BY a.end_date_time
   ) t;
   ```

   Each result file holds the raw gateway envelope `{"rows":[{"j":"…"}], …}`.
   `bootstrap_from_mcp` applies the position-based cohort exclusions in Python
   (LSO200 drops current Baristas; LSO300 also Shift Supervisors; LSO400 also
   Assistant Store Managers — each incl. its "… Trainee" variant), so the roster
   query above needs no change — it just emits `position` and the filter does the rest.

4. **Assemble + write** `public/data.json` (meta.source='confirmed'):

   ```bash
   python3 -m pipeline.bootstrap_from_mcp /tmp/lso_roster.json /tmp/lso_hours.json /tmp/lso_courses.json 18
   ```

5. **Validate** — `levels` length 4, total rows > 0, `meta.source=='confirmed'`. If not, STOP. Do not push.

6. **Push** to GitHub (`xiangyuzeng/lkus-lso-train-dashboard`, path `public/data.json`, branch `main`)
   via the Contents API (GET sha → base64 → PUT, 3 retries 2/4/8 s). Auth: `GITHUB_TOKEN`.
   Commit message: `[auto] LSO train data refresh YYYY-MM-DD HH:MM`.

7. End. Print only `OK <total rows> across 4 levels at <ISO>`.

> On a host with pymysql + Secrets Manager reach, prefer `./refresh.sh` (Mode-A),
> which runs `pipeline/collect.py` directly and needs none of the above.
