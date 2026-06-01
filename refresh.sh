#!/usr/bin/env bash
# Hourly refresh: collect → validate → push.
# Mirrors the bail-on-failure pattern from luckin-spoilage-dashboard so we
# never publish an empty/stale payload.

set -euo pipefail

cd "$(dirname "$0")"

LOG_DIR="${LOG_DIR:-logs}"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/refresh_$(date -u +%Y%m%d).log"

log() {
  echo "[refresh] $(date -u +%Y-%m-%dT%H:%M:%SZ) $*" | tee -a "$LOG_FILE"
}

trap 'log "FAILED with exit $?"' ERR

if [[ -z "${MYSQL_SECRET_NAME:-}" && -z "${MYSQL_HOST:-}" ]]; then
  log "neither MYSQL_SECRET_NAME nor MYSQL_HOST is set; bailing"
  exit 1
fi
if [[ -z "${GITHUB_TOKEN:-}" ]]; then
  log "GITHUB_TOKEN not set; bailing (won't push without auth)"
  exit 1
fi

log "pipeline start"

# 1. Schema probe — best-effort, never blocks the rest.
python3 -m pipeline.schema_probe 2>&1 | tee -a "$LOG_FILE" || \
  log "schema probe non-zero (non-fatal)"

# 2. Collect: must succeed. If it fails, do NOT push.
if ! python3 -m pipeline.collect 2>&1 | tee -a "$LOG_FILE"; then
  log "collect.py failed; refusing to push"
  exit 2
fi

# 3. Validate: the payload must be non-empty JSON with four levels of rows.
python3 - <<'PY' 2>&1 | tee -a "$LOG_FILE"
import json, sys
from pathlib import Path
p = Path("public/data.json")
if not p.exists():
    print("[validate] public/data.json missing"); sys.exit(3)
data = json.loads(p.read_text())
levels = data.get("levels")
if not levels:
    print("[validate] payload has no levels"); sys.exit(4)
total_rows = sum(len(l.get("rows", [])) for l in levels)
if total_rows == 0:
    print("[validate] payload has zero rows across all levels"); sys.exit(4)
if data.get("meta", {}).get("source") != "confirmed":
    print(f"[validate] meta.source != 'confirmed' (got {data['meta'].get('source')!r})"); sys.exit(5)
print(f"[validate] OK — {len(levels)} levels, {total_rows} rows, generated_at={data['meta']['generated_at']}")
PY

# 4. Push.
python3 -m pipeline.sender.push_to_github 2>&1 | tee -a "$LOG_FILE"

log "pipeline done"
