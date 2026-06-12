#!/usr/bin/env bash
# Build + push the base image for hass-opencode.
# Run manually or via cron. The app Dockerfile inherits from this via
# `FROM ghcr.io/umrath/ha_opencode-base:latest`.
set -euo pipefail

export DOCKER_CONFIG="${CI_DOCKER_CONFIG:-/root/.docker}"
BUILDER="${CI_BUILDX_BUILDER:-ci-multiarch}"
REGISTRY=ghcr.io
OWNER=umrath
IMAGE=ha_opencode-base
REF="$REGISTRY/$OWNER/$IMAGE"
REPO_ROOT=$(cd "$(dirname "$0")/../.." && pwd)

echo "[build-base] $REF:latest — amd64 + arm64"

# Build amd64
docker buildx build --builder "$BUILDER" --platform linux/amd64 \
    --file "$REPO_ROOT/ha_opencode/Dockerfile.base" \
    --tag "$REF/amd64:latest" \
    --build-arg BUILD_ARCH=amd64 \
    --provenance=false --push "$REPO_ROOT/ha_opencode/"

# Build arm64 (QEMU)
docker buildx build --builder "$BUILDER" --platform linux/arm64 \
    --file "$REPO_ROOT/ha_opencode/Dockerfile.base" \
    --tag "$REF/aarch64:latest" \
    --build-arg BUILD_ARCH=aarch64 \
    --provenance=false --push "$REPO_ROOT/ha_opencode/"

# Multi-arch manifest
docker buildx imagetools create --tag "$REF:latest" "$REF/amd64:latest" "$REF/aarch64:latest"

echo "[build-base] done: $REF:latest"
