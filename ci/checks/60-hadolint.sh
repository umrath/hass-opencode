#!/usr/bin/env bash
# Advisory: hadolint lint on the add-on Dockerfile. Uses a local hadolint
# binary if present, otherwise the hadolint/hadolint Docker image, otherwise
# skips. Never fails the build.
set -u
. "$(dirname "$0")/../lib.sh"
cd "$CI_REPO_ROOT"

section "hadolint (advisory)"

# DL3008/DL3013/DL3018/DL4006: pinning nags that don't fit a HA add-on build.
IGNORES="--ignore DL3008 --ignore DL3013 --ignore DL3018 --ignore DL4006"

dockerfile="ha_opencode/Dockerfile"
if [ ! -f "$dockerfile" ]; then
  skip "$dockerfile not found"
  exit 0
fi

if have hadolint; then
  info "using local hadolint"
  # shellcheck disable=SC2086
  if out=$(hadolint $IGNORES "$dockerfile" 2>&1); then
    pass "no hadolint findings"
  else
    warn "hadolint reported findings (advisory)"
    printf '%s\n' "$out" | sed 's/^/    /'
  fi
elif have docker; then
  info "using hadolint/hadolint Docker image"
  # shellcheck disable=SC2086
  if out=$(docker run --rm -i hadolint/hadolint hadolint $IGNORES - < "$dockerfile" 2>&1); then
    pass "no hadolint findings"
  else
    warn "hadolint reported findings (advisory)"
    printf '%s\n' "$out" | sed 's/^/    /'
  fi
else
  skip "neither hadolint nor docker available — skipping"
fi

exit 0
