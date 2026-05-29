# Deploy — wiring the hourly refresh on the internal cron host

This is what to run by hand on the internal cron host (recommended:
`dbtools02-prod-usa-aws`, the same host that already runs the
luckin-store-ops-dashboard and luckin-efficiency-dashboard refresh
containers). Until these steps are done, the dashboard keeps serving
whatever `public/data.json` last got pushed — the bootstrap commit from
2026-05-28 stays live but doesn't update on its own.

> If you're the operator reading this: yes, every step here needs production
> access. Nothing in this file should be run from outside the VPC.

## 0. Sanity check the host

```bash
ssh dbtools02-prod-usa-aws
# verify python + crond + git + outbound HTTPS to github.com all work
python3 --version          # need 3.11+
which git crontab           # both should be present
curl -sI https://api.github.com | head -1   # HTTP/1.1 or 2 401, not "connection refused"

# verify the host can reach both RDS instances
mysql -h "<iEHR endpoint>"           -u <readonly user> -p < /dev/null   # auth OK
mysql -h "<opempefficiency endpoint>" -u <readonly user> -p < /dev/null   # auth OK
```

## 1. Clone the repo

```bash
sudo mkdir -p /opt && sudo chown "$USER":"$USER" /opt
cd /opt
git clone https://github.com/xiangyuzeng/lkus-lso-train-dashboard.git
cd lkus-lso-train-dashboard
pip3 install --user -r pipeline/requirements.txt
```

## 2. Set environment variables

Pick **one** of these places to put the env vars — whichever matches how the
sibling boards already do it on this host (check `/etc/profile.d/` and
`/etc/systemd/system/`).

### Option A — systemd EnvironmentFile (recommended, matches sibling pattern)

```bash
sudo install -d -m 700 /etc/lkus-lso
sudo tee /etc/lkus-lso/env >/dev/null <<'EOF'
# AWS — Secrets Manager for the DB creds, same canonical secret the
# luckin-store-ops-dashboard and luckin-efficiency-dashboard pipelines use.
AWS_REGION=us-east-1
MYSQL_SECRET_NAME=collector/mysql

# Per-DB host overrides — the canonical secret only carries one endpoint,
# so we redirect each connection to the right RDS. Use the actual
# `aws-luckyus-iehr-rw` and `aws-luckyus-opempefficiency-rw` endpoints
# (look them up in the AWS console or via `aws rds describe-db-instances`).
IEHR_HOST=<paste iEHR RDS endpoint here>
OPEMPEFFICIENCY_HOST=<paste opempefficiency RDS endpoint here>

# GitHub push — create a new fine-grained PAT scoped to this single repo,
# Contents:Read+Write only. Do NOT reuse the broad-scope PAT.
# Generate at: https://github.com/settings/tokens?type=beta
GITHUB_TOKEN=<paste new fine-grained PAT here>
GITHUB_REPO=xiangyuzeng/lkus-lso-train-dashboard
GITHUB_BRANCH=main
GITHUB_FILE_PATH=public/data.json

# Cohort definition — default 'a' per §6 of the build spec.
# Switch to 'b' if HR-ops wants trainee-post-only scope.
COHORT=a
EOF
sudo chmod 600 /etc/lkus-lso/env
```

### Option B — user crontab inline (simpler, less hygienic)

If the host doesn't use systemd EnvironmentFiles, prepend the env vars to
the cron line itself. See step 3.

## 3. Install the cron line

### A — using the systemd EnvironmentFile

```bash
crontab -e
# Append:
0 * * * * cd /opt/lkus-lso-train-dashboard && \
  set -a && . /etc/lkus-lso/env && set +a && \
  ./refresh.sh >> logs/cron.log 2>&1
```

### B — inline vars on the crontab

```bash
crontab -e
# Append (substituting real values, NOT the placeholders):
0 * * * * cd /opt/lkus-lso-train-dashboard && \
  AWS_REGION=us-east-1 \
  MYSQL_SECRET_NAME=collector/mysql \
  IEHR_HOST=<...> OPEMPEFFICIENCY_HOST=<...> \
  GITHUB_TOKEN=<...> GITHUB_REPO=xiangyuzeng/lkus-lso-train-dashboard \
  GITHUB_BRANCH=main GITHUB_FILE_PATH=public/data.json COHORT=a \
  ./refresh.sh >> logs/cron.log 2>&1
```

## 4. Smoke-test the first run by hand

```bash
cd /opt/lkus-lso-train-dashboard
mkdir -p logs
set -a && . /etc/lkus-lso/env && set +a
./refresh.sh
# Expect:
#   [refresh] ... pipeline start (cohort=a)
#   [validate] OK — 198 rows, generated_at=...
#   push OK data.json -> public/data.json (attempt 1, ~XX KB)
#   [refresh] ... pipeline done

# Then verify the push landed:
curl -s https://raw.githubusercontent.com/xiangyuzeng/lkus-lso-train-dashboard/main/public/data.json \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print('generated_at=', d['meta']['generated_at'], 'rows=', len(d['rows']))"
```

If the smoke-test commits and pushes successfully, Vercel will rebuild and
the dashboard will pick up the new payload within a minute or two.

## 5. (After Vercel project exists) link the repo

The Vercel project doesn't exist yet — that's the missing piece for the
public URL. Either:

- From the Vercel dashboard, import `xiangyuzeng/lkus-lso-train-dashboard`,
  framework = Next.js, no env vars needed (the page only reads `public/data.json`).
- Or from a workstation with `vercel` CLI installed:
  ```bash
  vercel link  --project lkus-lso-train-dashboard
  vercel       # first prod deploy
  ```

Once deployed, the production URL goes here — update `README.md` with it.

## 6. Optional: belt-and-suspenders monitoring

The `refresh.sh` script writes `logs/refresh_YYYYMMDD.log`. To get alerted
when a run fails:

- Add a CloudWatch Logs agent (or equivalent) for `/opt/lkus-lso-train-dashboard/logs/`.
- Set a CloudWatch alarm on the literal string `FAILED with exit` (the
  `trap` in `refresh.sh` emits this on any non-zero step).
- Or just check `meta.generated_at` on the live dashboard daily — the
  FreshnessBadge greys the whole board out after 90 minutes of staleness.

---

## What I can NOT pre-build for you

- The values of `IEHR_HOST`, `OPEMPEFFICIENCY_HOST`, `MYSQL_SECRET_NAME`,
  and the dedicated `GITHUB_TOKEN` for this repo. These are
  environment-specific or freshly minted secrets that need to come from your
  hands at deploy time. The pipeline refuses to start without them
  (`pipeline/config/settings.py::_read_secret` raises if `MYSQL_SECRET_NAME`
  is unset; `refresh.sh` bails if `GITHUB_TOKEN` is unset).
- SSH into `dbtools02-prod-usa-aws`. I have read-only DB access via the MCP
  gateway but no shell on the cron host.
- Creating the Vercel project. Vercel needs the GitHub App installation and
  team scope, both of which are your account-level operations.
