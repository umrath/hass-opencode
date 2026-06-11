#!/usr/bin/env bash
# Advisory: build + push the Docker image (amd64 dev build).
# Runs only on the build host. Skipped locally — the image is built on the host,
# not on developer laptops.
# Set CI_SKIP_IMAGE_BUILD=1 to skip unconditionally.
set -u
. "$(dirname "$0")/../lib.sh"
cd "$CI_REPO_ROOT"

section "Docker image build (amd64)"

if [ "${CI_SKIP_IMAGE_BUILD:-0}" = "1" ]; then
  skip "CI_SKIP_IMAGE_BUILD=1 — skipping image build"
  finish_check; exit $?
fi

if ! have docker; then
  skip "docker not found — not on build host; skipping"
  finish_check; exit $?
fi

VERSION=$(grep "^version:" ha_opencode/config.yaml | sed 's/.*"\(.*\)".*/\1/')
REGISTRY=ghcr.io
OWNER=umrath
IMAGE=ha_opencode
PLATFORM=linux/amd64

info "Building ha_opencode v${VERSION} — amd64 only"
info "This may take several minutes on first run (cached layers speed up subsequent builds)"

if docker buildx build --builder multiarch --platform "$PLATFORM" \
    --file ha_opencode/Dockerfile \
    --tag "$REGISTRY/$OWNER/$IMAGE/amd64:$VERSION" \
    --tag "$REGISTRY/$OWNER/$IMAGE/amd64:latest" \
    --build-arg "BUILD_VERSION=$VERSION" \
    --build-arg BUILD_ARCH=amd64 \
    --cache-from "type=registry,ref=$REGISTRY/$OWNER/$IMAGE/amd64:buildcache" \
    --cache-to "type=registry,ref=$REGISTRY/$OWNER/$IMAGE/amd64:buildcache,mode=max" \
    --push ha_opencode/ 2>&1; then
  pass "image built and pushed: $REGISTRY/$OWNER/$IMAGE/amd64:$VERSION"

  info "creating multi-arch manifest (amd64 only for dev)"
  docker buildx imagetools create \
    --tag "$REGISTRY/$OWNER/$IMAGE:$VERSION" \
    --tag "$REGISTRY/$OWNER/$IMAGE:latest" \
    "$REGISTRY/$OWNER/$IMAGE/amd64:$VERSION" 2>&1
  pass "manifest pushed: $REGISTRY/$OWNER/$IMAGE:$VERSION"
else
  warn "image build failed — check build logs above"
fi

finish_check; exit $?
