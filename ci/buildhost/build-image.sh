#!/usr/bin/env bash
# Build + push the add-on Docker image for ONE version.
#
# Invoked by the build-host runner's release stage (run-ci.sh:maybe_build_image)
# once the quality gates pass and ci/RELEASE_TARGET names a not-yet-built version.
# It is NOT a per-commit quality gate — it performs an outward-facing push.
#
# Decoupled arch build: amd64 is built first (native, fast) and the release is
# published as soon as amd64 is available. arm64 builds asynchronously in the
# background via QEMU. arm64 users may see a brief delay (~15-20 min) before the
# multi-arch manifest includes their platform.
#
# Config (env or /etc/default/hass-opencode-ci):
#   CI_DOCKER_CONFIG     docker config dir w/ builder + ghcr login (default /root/.docker)
#   CI_BUILDX_BUILDER    buildx builder name                       (default ci-multiarch)
#   CI_IMAGE_TAGS        extra tag(s) beyond :<version>, space-sep (default "latest")
#   CI_STATE_DIR         state directory for background build tracking
# Usage: build-image.sh <version>
set -euo pipefail

VERSION="${1:?usage: build-image.sh <version>}"
REPO_ROOT=$(cd "$(dirname "$0")/../.." && pwd)

export DOCKER_CONFIG="${CI_DOCKER_CONFIG:-/root/.docker}"
BUILDER="${CI_BUILDX_BUILDER:-ci-multiarch}"
EXTRA_TAGS="${CI_IMAGE_TAGS:-latest}"
STATE_DIR="${CI_STATE_DIR:-/opt/ci/hass-opencode/state}"

REGISTRY=ghcr.io
OWNER=umrath
IMAGE=ha_opencode
REF="$REGISTRY/$OWNER/$IMAGE"

# ── amd64 (native, fast) ──────────────────────────────────────────────────────
echo "[build-image] building amd64 (native)…"

# Verify the base image exists for all target architectures before building.
# The app Dockerfile pins the base by digest; if it's missing the build fails
# late with a confusing error. Fail early with a clear message.
BASE_REF="ghcr.io/umrath/ha_opencode-base:latest"
echo "[build-image] checking base image: $BASE_REF"
if ! docker buildx imagetools inspect "$BASE_REF" >/dev/null 2>&1; then
    echo "[build-image] FATAL: base image $BASE_REF not found — build base first with ci/buildhost/build-base.sh"
    exit 1
fi

docker buildx build \
  --builder "$BUILDER" \
  --platform linux/amd64 \
  --file "$REPO_ROOT/ha_opencode/Dockerfile" \
  --build-arg "BUILD_VERSION=$VERSION" \
  --build-arg BUILD_ARCH=amd64 \
  --tag "$REF/amd64:$VERSION" \
  --tag "$REF/amd64:latest" \
  --cache-from "type=registry,ref=$REF/amd64:buildcache" \
  --cache-to   "type=registry,ref=$REF/amd64:buildcache,mode=max" \
  --provenance=false \
  --push \
  "$REPO_ROOT/ha_opencode/"

# ── publish amd64 manifest immediately ────────────────────────────────────────
echo "[build-image] publishing amd64 manifest…"

tag_args=( --tag "$REF:$VERSION" )
for t in $EXTRA_TAGS; do
  tag_args+=( --tag "$REF:$t" )
done

docker buildx imagetools create "${tag_args[@]}" "$REF/amd64:$VERSION"

echo "[build-image] amd64 manifest published — release available for amd64 users"
docker buildx imagetools inspect "$REF:$VERSION" | grep -E 'Platform:' || true

# ── arm64 (QEMU, 15-20 min) — background, tracked ────────────────────────────

ARM_LOG="/tmp/build-arm64-${VERSION}.log"
ARM_STATE="${STATE_DIR}/arm64-pending-${VERSION}"

echo "[build-image] starting arm64 build (QEMU, may take 15-20 min)…"

# Use a dedicated builder for arm64 background builds to prevent BuildKit
# session cancellation when the main CI builder is reused for new releases.
ARM_BUILDER="${CI_BUILDX_BUILDER:-ci-multiarch}-arm64"
if ! docker buildx inspect "$ARM_BUILDER" >/dev/null 2>&1; then
    docker buildx create --name "$ARM_BUILDER" --use 2>/dev/null || true
    docker buildx use ci-multiarch 2>/dev/null || true  # restore default
fi

# Write a state file so the CI runner knows arm64 is still in progress.
# Removed on completion (success or failure).
date -u +%s > "$ARM_STATE"

(
  set -euo pipefail
  echo '[build-image-arm64] building…'

  if docker buildx build \
    --builder "$ARM_BUILDER" \
    --platform linux/arm64 \
    --file "$REPO_ROOT/ha_opencode/Dockerfile" \
    --build-arg "BUILD_VERSION=$VERSION" \
    --build-arg BUILD_ARCH=aarch64 \
    --tag "$REF/aarch64:$VERSION" \
    --tag "$REF/aarch64:latest" \
    --cache-from "type=registry,ref=$REF/aarch64:buildcache" \
    --cache-to   "type=registry,ref=$REF/aarch64:buildcache,mode=max" \
    --provenance=false \
    --push \
    "$REPO_ROOT/ha_opencode/"
  then
    echo '[build-image-arm64] merging into multi-arch manifest…'
    # Include the existing amd64 manifest in the merge so we don't lose it
    # if amd64 was updated between releases.
    docker buildx imagetools create "${tag_args[@]}" \
      "$REF/amd64:$VERSION" "$REF/aarch64:$VERSION"
    echo '[build-image-arm64] multi-arch manifest updated'
    printf 'OK %s\n' "$(date -u +%s)" > "$ARM_STATE"
  else
    printf 'FAIL %s\n' "$(date -u +%s)" > "$ARM_STATE"
    echo '[build-image-arm64] BUILD FAILED — arm64 not available for this release'
  fi
) > "$ARM_LOG" 2>&1 &

ARM_PID=$!
echo "[build-image] arm64 build detached (pid $ARM_PID, state $ARM_STATE)"
echo "[build-image] done: $REF:$VERSION (amd64 ready, arm64 pending)"
