#!/usr/bin/env bash
# Dedicated arm64 build worker — single-flighted, processes pending markers.
# Runs independently of the main CI runner. One version at a time.
set -euo pipefail

export DOCKER_CONFIG="${CI_DOCKER_CONFIG:-/root/.docker}"
BUILDER="${CI_BUILDX_BUILDER:-ci-multiarch}-arm64"
STATE_DIR="${CI_STATE_DIR:-/opt/ci/hass-opencode/state}"
ARM_MARKER="$STATE_DIR/arm64-pending"
ARM_RESULT="$STATE_DIR/arm64-results"
REPO_ROOT=$(cd "$(dirname "$0")/../.." && pwd)

REGISTRY=ghcr.io
OWNER=umrath
IMAGE=ha_opencode
REF="$REGISTRY/$OWNER/$IMAGE"

mkdir -p "$ARM_MARKER" "$ARM_RESULT"

# Dedicated arm64 builder — separate from CI builder to avoid session cancellation
if ! docker buildx inspect "$BUILDER" >/dev/null 2>&1; then
    docker buildx create --name "$BUILDER" 2>/dev/null || true
fi

log() { echo "[arm64-worker] $*"; }

# Process one pending version
process() {
    local version="$1"
    log "building arm64 for $version"

    if ! docker buildx build \
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
        log "pushing arm64 for $version succeeded — merging into manifest"
        docker buildx imagetools create \
            --tag "$REF:$version" \
            "$REF/amd64:$version" "$REF/aarch64:$version"

        # Update :latest only if this is still the newest version
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
    else
        printf 'FAIL %s\n' "$(date -u +%s)" > "$ARM_RESULT/$version"
        log "arm64 build FAILED for $version — will retry on next run"
    fi

    rm -f "$ARM_MARKER/$version"
}

# Process pending versions (one at a time)
for marker in "$ARM_MARKER"/*; do
    [ -f "$marker" ] || continue
    version=$(cat "$marker")
    process "$version"
    # One at a time — the next cron/timer tick picks up remaining
    break
done

log "worker pass complete"
