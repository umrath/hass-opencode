# shellcheck shell=bash
# Shared helpers for the CI check scripts.
# Portable across bash 3.2 (macOS) and bash 5.x (Debian buildhost).
#
# A "check" script sources this file, then calls pass/fail/warn/skip to record
# results. The orchestrator (run.sh) aggregates exit codes; an individual check
# script exits non-zero only if it recorded at least one `fail`.

# Resolve repo root (the parent of the ci/ directory) once.
if [ -z "${CI_REPO_ROOT:-}" ]; then
  _ci_lib_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
  CI_REPO_ROOT=$(cd "${_ci_lib_dir}/.." && pwd)
  export CI_REPO_ROOT
fi

# Colors only on a TTY and when not explicitly disabled.
if [ -t 1 ] && [ "${CI_NO_COLOR:-0}" != "1" ]; then
  C_RED=$'\033[31m'; C_GRN=$'\033[32m'; C_YEL=$'\033[33m'
  C_BLU=$'\033[34m'; C_DIM=$'\033[2m'; C_RST=$'\033[0m'
else
  C_RED=''; C_GRN=''; C_YEL=''; C_BLU=''; C_DIM=''; C_RST=''
fi

# Per-process result counters (each check runs in its own process).
CI_FAILS=0
CI_WARNS=0

section() { printf '%s==> %s%s\n' "$C_BLU" "$*" "$C_RST"; }
pass()    { printf '  %s✓%s %s\n' "$C_GRN" "$C_RST" "$*"; }
warn()    { printf '  %s‼%s %s\n' "$C_YEL" "$C_RST" "$*"; CI_WARNS=$((CI_WARNS + 1)); }
skip()    { printf '  %s–%s %s%s%s\n' "$C_DIM" "$C_RST" "$C_DIM" "$*" "$C_RST"; }
fail()    { printf '  %s✗%s %s\n' "$C_RED" "$C_RST" "$*"; CI_FAILS=$((CI_FAILS + 1)); }

# info: dim, non-counting note line.
info()    { printf '    %s%s%s\n' "$C_DIM" "$*" "$C_RST"; }

# have CMD -> 0 if CMD is on PATH.
have() { command -v "$1" >/dev/null 2>&1; }

# Call at the end of a check script to set its exit status.
finish_check() {
  if [ "$CI_FAILS" -gt 0 ]; then
    return 1
  fi
  return 0
}
