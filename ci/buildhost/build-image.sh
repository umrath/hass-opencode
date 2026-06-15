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

# ── boot smoke test ───────────────────────────────────────────────────────────
# Run the freshly built image and verify it actually boots: the container stays
# up and ttyd binds the ingress port. Catches the "[exited]" / reconnect-loop
# class of regressions BEFORE the manifest is published and the version activated.
# It deliberately does NOT require OpenCode itself to run (this build host lacks
# AVX2, so the regular binary would SIGSEGV) — only container/ttyd liveness, which
# is exactly what the historical boot failures broke. Blocks the release only on a
# demonstrable image failure; harness problems (pull/docker/network) warn and
# continue so infra hiccups never wedge releases. CI_SKIP_SMOKE=1 bypasses.
smoke_test_image() {
  local img="$1"
  local net="ocsmoke-net" sup="ocsmoke-sup" oc="ocsmoke-oc"
  local profile="$REPO_ROOT/ha_opencode/apparmor.txt"
  local aa_arg="" rc=0 ok=0 msup odir i

  echo "[smoke] testing $img"
  if ! docker pull -q "$img" >/dev/null 2>&1; then
    echo "[smoke] WARN: pull failed — skipping smoke test (not blocking)"; return 0
  fi
  docker rm -f "$oc" "$sup" >/dev/null 2>&1 || true
  docker network rm "$net" >/dev/null 2>&1 || true
  if ! docker network create "$net" >/dev/null 2>&1; then
    echo "[smoke] WARN: network create failed — skipping (not blocking)"; return 0
  fi

  msup=$(mktemp); odir=$(mktemp -d)
  cat > "$msup" <<'PY'
import http.server, json
class H(http.server.BaseHTTPRequestHandler):
    def reply(self):
        self.send_response(200); self.send_header("Content-Type", "application/json"); self.end_headers()
        self.wfile.write(json.dumps({"result": "ok", "data": {"version": "smoke", "slug": "ha_opencode", "addons": [], "ingress_port": 8099, "ingress_entry": "/x"}}).encode())
    do_GET = lambda s: s.reply()
    do_POST = lambda s: s.reply()
    def log_message(self, *a): pass
http.server.HTTPServer(("0.0.0.0", 80), H).serve_forever()
PY
  cat > "$odir/options.json" <<'JSON'
{"opencode_update_policy":"bundled","mcp_enabled":true,"lsp_enabled":true,"cpu_mode":"auto","terminal_theme":"breeze","font_size":14,"cursor_style":"block","cursor_blink":false,"screenshot_enabled":false,"ppq_private_enabled":false,"addon_access_enabled":false,"enable_server":false}
JSON

  docker run -d --name "$sup" --network "$net" --network-alias supervisor \
      -v "$msup:/ms.py:ro" --entrypoint python3 "$img" /ms.py >/dev/null 2>&1 || true

  if command -v apparmor_parser >/dev/null 2>&1 && apparmor_parser -r -W "$profile" >/dev/null 2>&1; then
    aa_arg="--security-opt apparmor=ha_opencode"
    echo "[smoke] AppArmor profile loaded (enforced for the test)"
  else
    echo "[smoke] AppArmor profile not loaded — running without it"
  fi

  if ! docker run -d --name "$oc" --network "$net" $aa_arg \
      -e SUPERVISOR_TOKEN=smoke -v "$odir:/data" "$img" >/dev/null 2>&1; then
    echo "[smoke] WARN: container failed to start — skipping (not blocking)"
    docker rm -f "$sup" >/dev/null 2>&1 || true
    docker network rm "$net" >/dev/null 2>&1 || true
    rm -f "$msup"; rm -rf "$odir"
    return 0
  fi

  for i in $(seq 1 25); do
    if ! docker ps -q --filter "name=^/${oc}\$" --filter status=running | grep -q .; then
      echo "[smoke] FAIL: container exited during boot"; docker logs "$oc" 2>&1 | tail -25; rc=1; break
    fi
    if docker logs "$oc" 2>&1 | grep -q "Listening on port: 8099"; then ok=1; break; fi
    sleep 3
  done
  if [ "$rc" = 0 ] && [ "$ok" != 1 ]; then
    echo "[smoke] FAIL: ttyd did not bind 0.0.0.0:8099 within timeout"; docker logs "$oc" 2>&1 | tail -25; rc=1
  fi
  [ "$rc" = 0 ] && echo "[smoke] PASS: container stays up and ttyd is listening on 8099"

  docker rm -f "$oc" "$sup" >/dev/null 2>&1 || true
  docker network rm "$net" >/dev/null 2>&1 || true
  command -v apparmor_parser >/dev/null 2>&1 && apparmor_parser -R "$profile" >/dev/null 2>&1 || true
  rm -f "$msup"; rm -rf "$odir"
  return $rc
}

# ── amd64 (native, fast) ──────────────────────────────────────────────────────
echo "[build-image] building amd64 (native)…"

# Verify the base image for the exact pinned digest exists and covers both arches.
# The app Dockerfile pins by digest; if it's missing the build fails late.
# Extract the pinned digest from the Dockerfile and verify both platforms.
BASE_DIGEST=$(grep -m1 -oE 'ghcr\.io/umrath/ha_opencode-base[^[:space:]]*sha256:[a-f0-9]{64}' "$REPO_ROOT/ha_opencode/Dockerfile" || echo "")
if [ -z "$BASE_DIGEST" ]; then
    echo "[build-image] FATAL: no pinned base image digest found in Dockerfile"
    exit 1
fi
echo "[build-image] checking base image: $BASE_DIGEST"
BASE_INFO=$(docker buildx imagetools inspect "$BASE_DIGEST" 2>&1) || {
    echo "[build-image] FATAL: base image $BASE_DIGEST not found"
    exit 1
}
for arch in linux/amd64 linux/arm64; do
    if ! echo "$BASE_INFO" | grep -q "$arch"; then
        echo "[build-image] FATAL: base image missing platform $arch — rebuild base"
        exit 1
    fi
done
echo "[build-image] base image OK (amd64 + arm64)"

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

# ── boot smoke test (gate before publishing the user-facing manifest) ─────────
if [ "${CI_SKIP_SMOKE:-0}" != "1" ]; then
  if ! smoke_test_image "$REF/amd64:$VERSION"; then
    echo "[build-image] FATAL: boot smoke test failed — NOT publishing manifest for $VERSION."
    echo "[build-image] The arch tag $REF/amd64:$VERSION was pushed but the user-facing $REF:$VERSION is unchanged, so the release is not advertised."
    exit 1
  fi
fi

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
