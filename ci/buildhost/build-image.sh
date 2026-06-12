#!/usr/bin/env bash
# Build + push the app Docker image for ONE version.
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
#   CI_DOCKER_CONFIG    docker config dir w/ builder + ghcr login (default /root/.docker)
#   CI_BUILDX_BUILDER   buildx builder name                       (default ci-multiarch)
#   CI_IMAGE_TAGS       extra tag(s) beyond :<version>, space-sep (default "latest")
# Usage: build-image.sh <version>
set -euo pipefail

VERSION="${1:?usage: build-image.sh <version>}"
REPO_ROOT=$(cd "$(dirname "$0")/../.." && pwd)

export DOCKER_CONFIG="${CI_DOCKER_CONFIG:-/root/.docker}"
BUILDER="${CI_BUILDX_BUILDER:-ci-multiarch}"
EXTRA_TAGS="${CI_IMAGE_TAGS:-latest}"

REGISTRY=ghcr.io
OWNER=umrath
IMAGE=ha_opencode
REF="$REGISTRY/$OWNER/$IMAGE"

# ── amd64 (native, fast) ──────────────────────────────────────────────────────
echo "[build-image] building amd64 (native)…"

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

# ── arm64 (QEMU, 15-20 min) — background, best-effort ─────────────────────────
echo "[build-image] starting arm64 build (QEMU, may take 15-20 min)…"

nohup bash -c "
set -euo pipefail
echo '[build-image-arm64] building…'
docker buildx build \
  --builder \"$BUILDER\" \
  --platform linux/arm64 \
  --file \"$REPO_ROOT/ha_opencode/Dockerfile\" \
  --build-arg \"BUILD_VERSION=$VERSION\" \
  --build-arg BUILD_ARCH=aarch64 \
  --tag \"$REF/aarch64:$VERSION\" \
  --tag \"$REF/aarch64:latest\" \
  --cache-from \"type=registry,ref=$REF/aarch64:buildcache\" \
  --cache-to   \"type=registry,ref=$REF/aarch64:buildcache,mode=max\" \
  --provenance=false \
  --push \
  \"$REPO_ROOT/ha_opencode/\"

echo '[build-image-arm64] merging into multi-arch manifest…'
docker buildx imagetools create "${tag_args[@]}" \"$REF/amd64:$VERSION\" \"$REF/aarch64:$VERSION\"
echo '[build-image-arm64] multi-arch manifest updated'
" > "/tmp/build-arm64-$VERSION.log" 2>&1 &

echo "[build-image] arm64 build detached (pid $!) — will merge into manifest when done"
echo "[build-image] done: $REF:$VERSION (amd64 ready, arm64 pending)"
