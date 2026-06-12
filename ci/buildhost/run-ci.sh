#!/usr/bin/env bash
# Build-host CI runner — detect-and-run with coalescing single-flight.
#
# Maintains its OWN dedicated clone — it never touches the image-build checkout
# at /opt/hass-opencode or the buildx builder. On each invocation it cheaply
# probes the tracked branch's remote HEAD (git ls-remote, no object download)
# and only fetches + runs the quality gates (ci/run.sh) when HEAD moved.
#
# Concurrency model — serialize + keep only the latest:
#   At most one run executes at a time (flock). If triggers arrive while a run
#   is active they are COALESCED into a single pending marker (not stacked);
#   when the active run finishes it does exactly one more pass, which picks up
#   the latest origin/<branch>. Net effect: builds serialize and only the most
#   recent request survives the queue.
#
# Trigger sources (all funnel through this single-flight):
#   * the systemd timer    — fast detector + backstop (see hass-opencode-ci.timer)
#   * `run-ci.sh` directly — instant trigger, e.g. from a post-push step:
#         ssh root@buildhost /opt/ci/hass-opencode/bin/run-ci.sh
#
# Self-updating: when a checked-out commit changes the runner or the systemd
# units, the runner reinstalls them automatically (see self_update) — no manual
# install.sh re-run. Only the very first install is manual (bootstrap).
#
# Configuration (env or /etc/default/hass-opencode-ci):
#   CI_HOME        base dir            (default /opt/ci/hass-opencode)
#   CI_REMOTE      git remote to poll  (default https://github.com/umrath/hass-opencode.git)
#   CI_BRANCH      branch to track     (default main)
#   CI_LOG_KEEP    run logs to retain  (default 50)
#   CI_PUSH_REMOTE write-capable remote for version bumps (optional)
#                  Set to a git URL with credentials, e.g.:
#                  https://TOKEN@github.com/umrath/hass-opencode.git
#                  When empty, version-bump is skipped.
#
# Flags:
#   --force    build even if HEAD has not changed
#   --once     accepted for compatibility (this runner is always single-pass +
#              coalesced drain); has no extra effect
set -u

# Optional defaults file (keeps overrides off the command line).
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
PENDING="$CI_HOME/.pending"

mkdir -p "$CI_HOME" "$LOGS" "$STATE"
log() { printf '[ci] %s\n' "$*"; }

ensure_clone() {
  [ -d "$REPO/.git" ] && return 0
  log "cloning $CI_REMOTE ($CI_BRANCH) -> $REPO"
  rm -rf "$REPO"
  git clone --quiet --branch "$CI_BRANCH" "$CI_REMOTE" "$REPO"
}

# Keep the deployed runner + systemd units in sync with the checked-out repo, so
# changes to the build-host pipeline itself ship automatically (no manual
# install.sh re-run). Called with the repo at the latest commit. Never fails the
# run — any hiccup is logged and ignored. A new runner is validated with
# `bash -n` first so a syntactically broken one is never deployed; it takes
# effect on the NEXT invocation (the current process keeps its loaded code).
self_update() {
  local src="$REPO/ci/buildhost" changed=0 u
  [ -d "$src" ] || return 0

  if [ -f "$src/run-ci.sh" ] && ! cmp -s "$src/run-ci.sh" "$CI_HOME/bin/run-ci.sh"; then
    if bash -n "$src/run-ci.sh" 2>/dev/null; then
      install -m 0755 "$src/run-ci.sh" "$CI_HOME/bin/run-ci.sh" \
        && log "self-update: runner refreshed (applies on next run)"
    else
      log "self-update: new runner failed bash -n — keeping current"
    fi
  fi

  command -v systemctl >/dev/null 2>&1 || return 0
  for u in hass-opencode-ci.service hass-opencode-ci.timer; do
    if [ -f "$src/$u" ] && ! cmp -s "$src/$u" "/etc/systemd/system/$u"; then
      install -m 0644 "$src/$u" "/etc/systemd/system/$u" && { changed=1; log "self-update: $u refreshed"; }
    fi
  done
  if [ "$changed" = "1" ]; then
    systemctl daemon-reload 2>/dev/null || true
    systemctl restart hass-opencode-ci.timer 2>/dev/null || true
    log "self-update: systemd reloaded"
  fi
}

# Release stage (runs only after the quality gates pass). Builds + pushes the
# multi-arch image ONLY when ci/RELEASE_TARGET names a version we have not built
# yet — decoupled from config.yaml.version. This guarantees the image for a
# version exists BEFORE config.yaml advertises it to Home Assistant.
# Never changes the repo (no commit) → no detection loop. Arg1 = logfile.
maybe_build_image() {
  local logfile="$1" target last
  [ -f "$REPO/ci/RELEASE_TARGET" ] || { log "image: no ci/RELEASE_TARGET — skipping"; return 0; }
  [ -x "$REPO/ci/buildhost/build-image.sh" ] || { log "image: no build-image.sh — skipping"; return 0; }
  target=$(tr -d ' \t\r\n' < "$REPO/ci/RELEASE_TARGET")
  last=$(cat "$STATE/last-built-version" 2>/dev/null || echo "")
  [ -n "$target" ] || { log "image: empty RELEASE_TARGET — skipping"; return 0; }
  if [ "$target" = "$last" ]; then
    log "image: $target already built — skipping"
    return 0
  fi
  log "image: building $target (last built: ${last:-none})"
  if "$REPO/ci/buildhost/build-image.sh" "$target" 2>&1 | tee -a "$logfile"; then
    echo "$target" > "$STATE/last-built-version"
    printf 'IMAGE_OK %s\n' "$target" > "$STATE/last-image-result"
    log "image: pushed $target"
    activate_version "$target" "$logfile"
  else
    printf 'IMAGE_FAIL %s\n' "$target" > "$STATE/last-image-result"
    log "image: BUILD FAILED for $target — config.yaml version NOT advanced"
  fi
}

# Phase 2 (opt-in): set config.yaml.version = the just-built version and push,
# so HA picks up the release now that the image exists. OFF by default — enable
# with CI_AUTO_ACTIVATE=1 AND a CI_PUSH_REMOTE. Loop-safe: changes config/CHANGELOG
# but NOT ci/RELEASE_TARGET, so it never re-triggers a build; commit carries
# [skip ci] so it doesn't re-run the gates either.
activate_version() {
  local target="$1" logfile="$2" cur
  [ "${CI_AUTO_ACTIVATE:-0}" = "1" ] || { log "image: auto-activate off — set config.yaml version to $target manually (commit 2)"; return 0; }
  [ -n "${CI_PUSH_REMOTE:-}" ] || { log "image: CI_AUTO_ACTIVATE set but no CI_PUSH_REMOTE — skipping activation"; return 0; }
  git -C "$REPO" fetch -q origin "$CI_BRANCH" || { log "activate: fetch failed"; return 0; }
  git -C "$REPO" reset -q --hard "origin/$CI_BRANCH"
  cur=$(grep -m1 '^version:' "$REPO/ha_opencode/config.yaml" | sed 's/.*"\(.*\)".*/\1/')
  [ "$cur" = "$target" ] && { log "activate: already at $target"; return 0; }
  sed -i "s/^version: .*/version: \"$target\"/" "$REPO/ha_opencode/config.yaml"
  if grep -q '^## Unreleased' "$REPO/ha_opencode/CHANGELOG.md" 2>/dev/null; then
    sed -i "0,/^## Unreleased/s//## $target/" "$REPO/ha_opencode/CHANGELOG.md"
  else
    sed -i "1a\\\n## $target\\n\\n- _(auto-activated — no Unreleased section present)_\n" "$REPO/ha_opencode/CHANGELOG.md"
  fi
  git -C "$REPO" -c user.name=ci -c user.email=ci@local \
    commit -qam "chore: activate $target (image built) [skip ci]" || return 0
  if git -C "$REPO" push -q "$CI_PUSH_REMOTE" HEAD:"$CI_BRANCH" 2>&1 | tee -a "$logfile"; then
    log "activate: version $target pushed"
  else
    log "activate: push failed (likely non-fast-forward) — set version manually"
  fi
}

# One detect+build pass. Arg1 = force (0/1). Records state; sets PASS_RC to the
# CI exit code (0 when nothing ran). Returns non-zero only on infrastructure
# failure (clone/ls-remote/fetch), so the caller can distinguish "CI failed"
# (recorded, PASS_RC!=0) from "could not run".
run_pass() {
  local force="$1" remote_sha last_sha short ts logfile rc keep

  ensure_clone || { log "clone failed"; return 1; }

  # Cheap remote HEAD probe — no fetch when nothing changed (the common case).
  remote_sha=$(git -C "$REPO" ls-remote origin "$CI_BRANCH" 2>/dev/null | awk 'NR==1{print $1}')
  [ -n "$remote_sha" ] || { log "ls-remote failed"; return 1; }
  last_sha=$(cat "$STATE/last-sha" 2>/dev/null || echo "")

  if [ "$force" != "1" ] && [ "$remote_sha" = "$last_sha" ]; then
    log "no new commits on $CI_BRANCH ($remote_sha) — nothing to do"
    return 0
  fi

  git -C "$REPO" fetch --quiet origin "$CI_BRANCH" || { log "fetch failed"; return 1; }
  remote_sha=$(git -C "$REPO" rev-parse "origin/$CI_BRANCH")
  log "checking out $remote_sha"
  git -C "$REPO" reset --quiet --hard "origin/$CI_BRANCH"
  git -C "$REPO" clean -qfdx -e node_modules   # keep cached node_modules between runs

  # Skip commits tagged with [skip ci] — they are auto-generated (e.g. version
  # bumps after a successful image build) and must not re-trigger CI.
  if git -C "$REPO" log -1 --format='%B' | grep -qF '[skip ci]'; then
    log "commit contains [skip ci] — skipping CI"
    echo "$remote_sha" > "$STATE/last-sha"
    printf 'PASS %s %s (skip-ci)\n' "$(git -C "$REPO" rev-parse --short HEAD)" "$(date -u +%Y%m%dT%H%M%SZ)" > "$STATE/last-result"
    return 0
  fi

  # Ship pipeline self-changes (runner/units) before running the gates.
  self_update || true

  short=$(git -C "$REPO" rev-parse --short HEAD)
  ts=$(date -u +%Y%m%dT%H%M%SZ)
  logfile="$LOGS/${ts}-${short}.log"

  # The CI scripts may not exist on older revisions — treat as a harmless no-op.
  if [ ! -x "$REPO/ci/run.sh" ]; then
    log "no ci/run.sh at $short — skipping (will run once the CI scripts land)"
    echo "$remote_sha" > "$STATE/last-sha"
    printf 'SKIP %s %s (no ci/run.sh)\n' "$short" "$ts" > "$STATE/last-result"
    return 0
  fi

  log "running quality gates -> $logfile"
  # errexit stays off: a non-zero CI result must not abort the bookkeeping below.
  ( cd "$REPO" && CI_NO_COLOR=1 bash ci/run.sh ) 2>&1 | tee "$logfile"
  rc=${PIPESTATUS[0]}

  ln -sf "$logfile" "$LOGS/latest.log"
  echo "$remote_sha" > "$STATE/last-sha"

  # Prune old run logs, keeping the most recent CI_LOG_KEEP (latest.log is a
  # symlink into this set and always survives as the newest entry).
  keep=${CI_LOG_KEEP:-50}
  ls -1t "$LOGS"/*.log 2>/dev/null | grep -v '/latest\.log$' | tail -n +"$((keep + 1))" | while IFS= read -r old; do
    rm -f "$old"
  done

  if [ "$rc" -eq 0 ]; then
    printf 'PASS %s %s\n' "$short" "$ts" > "$STATE/last-result"
    log "RESULT: PASS ($short)"
    # v2 release flow: build+push the image only when ci/RELEASE_TARGET names a
    # not-yet-built version (decoupled from config.yaml.version), so HA never
    # sees a version before its image exists. Version activation is a SEPARATE,
    # off-by-default step (see activate_version) — never auto-pushed here.
    maybe_build_image "$logfile"
  else
    printf 'FAIL %s %s (rc=%s)\n' "$short" "$ts" "$rc" > "$STATE/last-result"
    log "RESULT: FAIL ($short, rc=$rc)"
  fi
  PASS_RC="$rc"
  return 0
}

# ── single-flight with coalescing ────────────────────────────────────────────
exec 9>"$LOCK"
if ! flock -n 9; then
  # A run is active. Record a single pending request (concurrent triggers all
  # collapse onto this one marker) and exit — the active run will drain it.
  : > "$PENDING"
  log "a run is active — queued a follow-up (coalesced); exiting"
  exit 0
fi

# We hold the lock. Clear any marker left for this execution.
rm -f "$PENDING"

PASS_RC=0
run_pass "$FORCE" || { log "infrastructure error — aborting"; exit 1; }

# Coalescing drain: if trigger(s) arrived while we ran, do one more pass for the
# latest commit. The flag is cleared first, so further triggers during the pass
# re-arm exactly one more iteration (never a backlog).
while [ -f "$PENDING" ]; do
  rm -f "$PENDING"
  log "pending request — running once more for the latest commit"
  run_pass 0 || { log "infrastructure error during drain"; break; }
done

exit "${PASS_RC:-0}"
