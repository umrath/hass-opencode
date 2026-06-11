#!/usr/bin/env bash
# Blocking: every tracked YAML file must parse with a real YAML loader.
set -u
. "$(dirname "$0")/../lib.sh"
cd "$CI_REPO_ROOT"

section "YAML parse (all tracked *.yaml / *.yml)"

if ! have python3 || ! python3 -c 'import yaml' >/dev/null 2>&1; then
  warn "python3 + PyYAML not available — cannot validate YAML; skipping (advisory)"
  finish_check; exit $?
fi

# Prefer git's view of the tree so parallel-stream additions are covered too;
# fall back to find when not in a git checkout (e.g. an exported tarball).
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  list=$(git ls-files '*.yaml' '*.yml')
else
  list=$(find . -path ./.git -prune -o \( -name '*.yaml' -o -name '*.yml' \) -print | sed 's|^\./||')
fi

if [ -z "$list" ]; then
  warn "no YAML files found"
  finish_check; exit $?
fi

# Process-substitution keeps the counters in this shell (no pipe subshell).
# Multi-document files (`---`) are allowed via safe_load_all.
while IFS= read -r f; do
  [ -n "$f" ] || continue
  if err=$(python3 -c 'import sys,yaml; list(yaml.safe_load_all(open(sys.argv[1])))' "$f" 2>&1); then
    pass "$f"
  else
    fail "$f — $(printf '%s' "$err" | tail -1)"
  fi
done < <(printf '%s\n' "$list")

finish_check; exit $?
