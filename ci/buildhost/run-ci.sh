#!/usr/bin/env bash
# Build-host CI runner (poll-and-run).
#
# Maintains its OWN dedicated clone — it never touches the image-build checkout
# at /opt/hass-opencode or the buildx builder. On each invocation it fetches the
# tracked branch, and if HEAD moved since the last run, checks it out and runs
# the in-repo quality gates (ci/run.sh). Designed to be driven by a systemd
# timer (see hass-opencode-ci.timer) but is also safe to run by hand.
#
# Configuration (env or /etc/default/hass-opencode-ci):
#   CI_HOME    base dir            (default /opt/ci/hass-opencode)
#   CI_REMOTE  git remote to poll  (default https://github.com/umrath/hass-opencode.git)
#   CI_BRANCH  branch to track     (default main)
#
# Flags:
#   --force    run even if HEAD has not changed
#   --once     (default) single pass; provided for clarity
set -u

# Optional defaults file (keeps secrets/overrides off the command line).
[ -f /etc/default/hass-opencode-ci ] && . /etc/default/hass-opencode-ci

CI_HOME=${CI_HOME:-/opt/ci/hass-opencode}
CI_REMOTE=${CI_REMOTE:-https://github.com/umrath/hass-opencode.git}
CI_BRANCH=${CI_BRANCH:-main}

FORCE=0
for a in "$@"; do
  case "$a" in
    --force) FORCE=1 ;;
    --once)  : ;;
    *) echo "unknown arg: $a" >&2; exit 2 ;;
  esac
done

REPO="$CI_HOME/repo"
LOGS="$CI_HOME/logs"
STATE="$CI_HOME/state"
LOCK="$CI_HOME/.lock"

mkdir -p "$CI_HOME" "$LOGS" "$STATE"

# Serialize: if a previous run is still going, bail quietly.
exec 9>"$LOCK"
if ! flock -n 9; then
  echo "[ci] another run holds the lock; skipping"
  exit 0
fi

log() { printf '[ci] %s\n' "$*"; }

# Clone on first use (shallow-ish but keep history shallow=1 to save space).
if [ ! -d "$REPO/.git" ]; then
  log "cloning $CI_REMOTE ($CI_BRANCH) -> $REPO"
  rm -rf "$REPO"
  if ! git clone --quiet --branch "$CI_BRANCH" "$CI_REMOTE" "$REPO"; then
    log "clone failed"
    exit 1
  fi
fi

# Fetch the tracked branch.
if ! git -C "$REPO" fetch --quiet origin "$CI_BRANCH"; then
  log "fetch failed"
  exit 1
fi

remote_sha=$(git -C "$REPO" rev-parse "origin/$CI_BRANCH")
last_sha=$(cat "$STATE/last-sha" 2>/dev/null || echo "")

if [ "$FORCE" != "1" ] && [ "$remote_sha" = "$last_sha" ]; then
  log "no new commits on $CI_BRANCH ($remote_sha) — nothing to do"
  exit 0
fi

log "checking out $remote_sha"
# Dedicated clone -> hard reset is safe and keeps the tree pristine.
git -C "$REPO" reset --quiet --hard "origin/$CI_BRANCH"
git -C "$REPO" clean -qfdx -e node_modules   # keep cached node_modules between runs

short=$(git -C "$REPO" rev-parse --short HEAD)
ts=$(date -u +%Y%m%dT%H%M%SZ)
logfile="$LOGS/${ts}-${short}.log"

# The CI scripts may not exist yet on older revisions / before they are merged.
# Treat that as a harmless no-op so the timer can be enabled ahead of the merge.
if [ ! -x "$REPO/ci/run.sh" ]; then
  log "no ci/run.sh at $short — skipping (will run once the CI scripts land)"
  echo "$remote_sha" > "$STATE/last-sha"
  printf 'SKIP %s %s (no ci/run.sh)\n' "$short" "$ts" > "$STATE/last-result"
  exit 0
fi

log "running quality gates -> $logfile"
# errexit stays off (the script never enables it): a non-zero CI result must
# not abort the state bookkeeping below — we record PASS/FAIL and exit with rc.
( cd "$REPO" && CI_NO_COLOR=1 bash ci/run.sh ) 2>&1 | tee "$logfile"
rc=${PIPESTATUS[0]}

ln -sf "$logfile" "$LOGS/latest.log"
echo "$remote_sha" > "$STATE/last-sha"
if [ "$rc" -eq 0 ]; then
  printf 'PASS %s %s\n' "$short" "$ts" > "$STATE/last-result"
  log "RESULT: PASS ($short)"
else
  printf 'FAIL %s %s (rc=%s)\n' "$short" "$ts" "$rc" > "$STATE/last-result"
  log "RESULT: FAIL ($short, rc=$rc)"
fi
exit "$rc"
