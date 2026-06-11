#!/usr/bin/env bash
# CI orchestrator for the hass-opencode add-on.
#
# Runs the quality-gate checks under ci/checks/ in order and prints a summary.
# Exit status:
#   0  all blocking checks passed (advisory warnings allowed)
#   1  at least one blocking check failed
#
# Checks classify themselves:
#   blocking : 10-yaml, 20-config-sync, 40-shell-syntax, 70-js-tests
#   advisory : 30-changelog, 50-shellcheck, 60-hadolint  (never fail the build)
#
# Usage:
#   ci/run.sh                 # run everything
#   ci/run.sh --no-js         # skip the vitest JS tests (fast, no npm install)
#   ci/run.sh --no-docker     # skip checks that would pull Docker images
#   ci/run.sh --quick         # implies --no-js --no-docker
#   ci/run.sh 10 40           # run only checks whose number prefix matches
set -u

CI_DIR=$(cd "$(dirname "$0")" && pwd)
. "$CI_DIR/lib.sh"

NO_JS=0
NO_DOCKER=0
filters=""

for a in "$@"; do
  case "$a" in
    --no-js)     NO_JS=1 ;;
    --no-docker) NO_DOCKER=1 ;;
    --quick)     NO_JS=1; NO_DOCKER=1 ;;
    -h|--help)
      sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    [0-9]*)      filters="$filters $a" ;;
    *) echo "unknown arg: $a" >&2; exit 2 ;;
  esac
done

[ "$NO_JS" = "1" ] && export CI_NO_JS=1

# Advisory checks that shell out to Docker — skipped under --no-docker unless a
# native binary is present.
docker_checks="50-shellcheck 60-hadolint"

selected() {
  # name like "10-yaml.sh"; match against numeric filters if any were given.
  [ -z "$filters" ] && return 0
  num=${1%%-*}
  for f in $filters; do [ "$num" = "$f" ] && return 0; done
  return 1
}

echo
printf '%sHass-OpenCode CI%s  (repo: %s)\n' "$C_BLU" "$C_RST" "$CI_REPO_ROOT"
rev=$(git -C "$CI_REPO_ROOT" rev-parse --short HEAD 2>/dev/null || echo '?')
br=$(git -C "$CI_REPO_ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?')
printf '%scommit %s on %s%s\n\n' "$C_DIM" "$rev" "$br" "$C_RST"

blocking_failed=0
ran=0
warn_total=0

for chk in "$CI_DIR"/checks/*.sh; do
  base=$(basename "$chk")
  name=${base%.sh}
  selected "$base" || continue

  if [ "$NO_DOCKER" = "1" ]; then
    case " $docker_checks " in
      *" $name "*)
        # only skip if there's no native binary to fall back on
        if [ "$name" = "50-shellcheck" ] && have shellcheck; then :; \
        elif [ "$name" = "60-hadolint" ] && have hadolint; then :; \
        else section "${name} (skipped: --no-docker)"; echo; continue; fi ;;
    esac
  fi

  ran=$((ran + 1))
  # Run the check in its own process; capture exit status.
  bash "$chk"
  rc=$?
  if [ "$rc" -ne 0 ]; then
    blocking_failed=$((blocking_failed + 1))
  fi
  echo
done

printf '%s──────────────────────────────────────────%s\n' "$C_DIM" "$C_RST"
if [ "$ran" -eq 0 ]; then
  echo "no checks selected"
  exit 2
fi

if [ "$blocking_failed" -eq 0 ]; then
  printf '%sCI PASSED%s — %d check group(s), no blocking failures\n' "$C_GRN" "$C_RST" "$ran"
  exit 0
else
  printf '%sCI FAILED%s — %d blocking check group(s) failed\n' "$C_RED" "$C_RST" "$blocking_failed"
  exit 1
fi
