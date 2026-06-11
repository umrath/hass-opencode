#!/usr/bin/env bash
# Build + push the add-on Docker image for ONE version, multi-arch.
#
# Invoked by the build-host runner's release stage (run-ci.sh:maybe_build_image)
# once the quality gates pass and ci/RELEASE_TARGET names a not-yet-built version.
# It is NOT a per-commit quality gate — it performs an outward-facing push.
#
# Deterministic / HOME-independent: the buildx builder and the ghcr login both
# live under a fixed DOCKER_CONFIG, never discovered via $HOME (the systemd
# service overrides HOME). A DEDICATED CI builder is used so the host's existing
# `multiarch` builder (real release builds) is never touched.
#
# Multi-arch: a single `buildx --platform amd64,arm64 --push` invocation builds
# every target and pushes one manifest list. This requires (a) the Dockerfile to
# derive its arch from buildx's TARGETARCH per platform, and (b) the builder to
# support arm64 (qemu/binfmt). See the build-host setup notes in README.
#
# Config (env or /etc/default/hass-opencode-ci):
#   CI_DOCKER_CONFIG    docker config dir w/ builder + ghcr login (default /root/.docker)
#   CI_BUILDX_BUILDER   buildx builder name                       (default ci-multiarch)
#   CI_BUILD_PLATFORMS  target platforms                          (default linux/amd64,linux/arm64)
#   CI_IMAGE_TAGS       extra tag(s) beyond :<version>, space-sep (default "latest")
# Usage: build-image.sh <version>
set -euo pipefail

VERSION="${1:?usage: build-image.sh <version>}"
REPO_ROOT=$(cd "$(dirname "$0")/../.." && pwd)

export DOCKER_CONFIG="${CI_DOCKER_CONFIG:-/root/.docker}"
BUILDER="${CI_BUILDX_BUILDER:-ci-multiarch}"
PLATFORMS="${CI_BUILD_PLATFORMS:-linux/amd64,linux/arm64}"
EXTRA_TAGS="${CI_IMAGE_TAGS:-latest}"

REGISTRY=ghcr.io
OWNER=umrath
IMAGE=ha_opencode
REF="$REGISTRY/$OWNER/$IMAGE"

tag_args=( --tag "$REF:$VERSION" )
for t in $EXTRA_TAGS; do
  tag_args+=( --tag "$REF:$t" )
done

echo "[build-image] $REF:$VERSION  platforms=$PLATFORMS  builder=$BUILDER"

# Single multi-platform invocation → one pushed manifest list for all arches.
docker buildx build \
  --builder "$BUILDER" \
  --platform "$PLATFORMS" \
  --file "$REPO_ROOT/ha_opencode/Dockerfile" \
  --build-arg "BUILD_VERSION=$VERSION" \
  "${tag_args[@]}" \
  --cache-from "type=registry,ref=$REF:buildcache" \
  --cache-to   "type=registry,ref=$REF:buildcache,mode=max" \
  --provenance=false \
  --push \
  "$REPO_ROOT/ha_opencode/"

echo "[build-image] pushed manifest — platforms:"
docker buildx imagetools inspect "$REF:$VERSION" | grep -E 'Platform:' || true
echo "[build-image] done: $REF:$VERSION (+ $EXTRA_TAGS)"
