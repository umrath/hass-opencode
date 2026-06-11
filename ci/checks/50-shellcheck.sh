#!/usr/bin/env bash
# Advisory: shellcheck lint on the boot-relevant shell scripts. Uses a local
# shellcheck binary if present, otherwise the koalaman/shellcheck Docker image,
# otherwise skips. Never fails the build (matches the upstream CI policy).
set -u
. "$(dirname "$0")/../lib.sh"
cd "$CI_REPO_ROOT"

section "shellcheck (advisory)"

# Same exclusions the upstream CI uses — style nags that don't apply to these
# bashio/s6 scripts.
EXCLUDES="SC2086,SC2155,SC2046,SC2016"

# The scripts worth linting (boot path + helpers). Limited set to keep noise
# low. Drop *.js helpers; git ls-files only returns tracked, existing paths.
targets=$(git ls-files \
  'ha_opencode/rootfs/etc/s6-overlay/s6-rc.d/*/run' \
  'ha_opencode/rootfs/etc/s6-overlay/s6-rc.d/*/finish' \
  'ha_opencode/rootfs/etc/profile.d/*.sh' \
  'ha_opencode/rootfs/usr/local/bin/*' \
  2>/dev/null | grep -v '\.js$')

if [ -z "$targets" ]; then
  skip "no target scripts found"
  exit 0
fi

run_sc() { :; }
if have shellcheck; then
  info "using local shellcheck"
  run_sc() { shellcheck -e "$EXCLUDES" "$@"; }
elif have docker; then
  info "using koalaman/shellcheck Docker image"
  run_sc() { docker run --rm -v "$CI_REPO_ROOT:/mnt" -w /mnt koalaman/shellcheck:stable -e "$EXCLUDES" "$@"; }
else
  skip "neither shellcheck nor docker available — skipping"
  exit 0
fi

# shellcheck disable=SC2086
if out=$(run_sc $targets 2>&1); then
  pass "no shellcheck findings"
else
  warn "shellcheck reported findings (advisory)"
  printf '%s\n' "$out" | sed 's/^/    /'
fi

exit 0
