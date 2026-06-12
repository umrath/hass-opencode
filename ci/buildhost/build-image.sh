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

# ── arm64 (QEMU, 15-20 min) — enqueue for dedicated worker ──────────────────

ARM_MARKER="${STATE_DIR}/arm64-pending"
mkdir -p "$ARM_MARKER"

# Write marker for the dedicated arm64 worker. The worker picks up
# pending versions one at a time with its own flock — no races.
echo "$VERSION" > "$ARM_MARKER/$VERSION"

echo "[build-image] arm64 enqueued for dedicated worker (version $VERSION in $ARM_MARKER)"
echo "[build-image] done: $REF:$VERSION (amd64 ready, arm64 pending)"
