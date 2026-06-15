#!/usr/bin/env bash
# Dedicated arm64 build worker — single-flighted via flock, processes pending
# markers newest-first. Transient failures retry (marker kept, attempt counted).
set -euo pipefail

[ -f /etc/default/hass-opencode-ci ] && . /etc/default/hass-opencode-ci

export DOCKER_CONFIG="${CI_DOCKER_CONFIG:-/root/.docker}"
BUILDER="${CI_BUILDX_BUILDER:-ci-multiarch}-arm64"
STATE_DIR="${CI_STATE_DIR:-/opt/ci/hass-opencode/state}"
ARM_MARKER="$STATE_DIR/arm64-pending"
ARM_RESULT="$STATE_DIR/arm64-results"
LOCK="$STATE_DIR/arm64-worker.lock"
REPO_ROOT="${CI_HOME:-/opt/ci/hass-opencode}/repo"

REGISTRY="${CI_REGISTRY:-ghcr.io}"
OWNER="${CI_OWNER:-umrath}"
IMAGE="${CI_IMAGE:-ha_opencode}"
REF="$REGISTRY/$OWNER/$IMAGE"
MAX_ATTEMPTS=5

mkdir -p "$ARM_MARKER" "$ARM_RESULT"

if ! docker buildx inspect "$BUILDER" >/dev/null 2>&1; then
    docker buildx create --name "$BUILDER" 2>/dev/null || true
fi

log() { echo "[arm64-worker] $*"; }

process() {
    local version="$1"
    local attempts
    attempts=$(cat "$ARM_RESULT/$version.attempts" 2>/dev/null || echo 0)

    if [ "$attempts" -ge "$MAX_ATTEMPTS" ]; then
        log "version $version failed $MAX_ATTEMPTS times — giving up"
        rm -f "$ARM_MARKER/$version" "$ARM_RESULT/$version.attempts"
        printf 'GIVEN_UP %s\n' "$(date -u +%s)" > "$ARM_RESULT/$version"
        return
    fi

    log "building arm64 for $version (attempt $((attempts + 1))/$MAX_ATTEMPTS)"

    if docker buildx build \
        --builder "$BUILDER" \
        --platform linux/arm64 \
        --file "$REPO_ROOT/ha_opencode/Dockerfile" \
        --build-arg "BUILD_VERSION=$version" \
        --build-arg BUILD_ARCH=aarch64 \
        --tag "$REF/aarch64:$version" \
        --tag "$REF/aarch64:latest" \
        --cache-from "type=registry,ref=$REF/aarch64:buildcache" \
        --cache-to   "type=registry,ref=$REF/aarch64:buildcache,mode=max" \
        --provenance=false \
        --push \
        "$REPO_ROOT/ha_opencode/"
    then
        log "arm64 for $version succeeded — merging into manifest"
        docker buildx imagetools create \
            --tag "$REF:$version" \
            "$REF/amd64:$version" "$REF/aarch64:$version"

        local last_built
        last_built=$(cat "$STATE_DIR/last-built-version" 2>/dev/null || echo "")
        if [ "$version" = "$last_built" ]; then
            docker buildx imagetools create \
                --tag "$REF:latest" \
                "$REF/amd64:$version" "$REF/aarch64:$version"
            log ":latest updated to $version"
        else
            log "skipping :latest update — $version is not newest ($last_built)"
        fi

        printf 'OK %s\n' "$(date -u +%s)" > "$ARM_RESULT/$version"
        rm -f "$ARM_MARKER/$version" "$ARM_RESULT/$version.attempts"
    else
        attempts=$((attempts + 1))
        echo "$attempts" > "$ARM_RESULT/$version.attempts"
        printf 'FAIL %s (attempt %s)\n' "$(date -u +%s)" "$attempts" > "$ARM_RESULT/$version"
        log "arm64 build FAILED for $version (attempt $attempts/$MAX_ATTEMPTS) — marker kept for retry"
    fi
}

# ── single-flighted via flock, newest-first ──────────────────────────────────
exec 9>"$LOCK"
flock -n 9 || { log "another worker is active — exiting"; exit 0; }

# Process pending: newest first so the latest release gets arm64 fastest
for marker in $(ls -1t "$ARM_MARKER/" 2>/dev/null); do
    [ -f "$ARM_MARKER/$marker" ] || continue
    version=$(cat "$ARM_MARKER/$marker")
    process "$version"
    # One version per invocation — the timer handles the next one
    break
done

log "worker pass complete"
