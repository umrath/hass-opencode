#!/usr/bin/env bash
# Blocking: the Python unittest suite under tests/ (config, build, assets,
# changelog, translations, Dockerfile, s6 wiring). Stdlib unittest + PyYAML
# only — no pip required, so it runs on the build host as-is.
set -u
. "$(dirname "$0")/../lib.sh"
cd "$CI_REPO_ROOT"

section "Python unittest suite (tests/)"

if [ ! -d tests ]; then
  warn "tests/ directory not found — skipping"
  finish_check; exit $?
fi

if ! have python3 || ! python3 -c 'import yaml' >/dev/null 2>&1; then
  warn "python3 + PyYAML not available — cannot run unittest suite; skipping (advisory)"
  finish_check; exit $?
fi

# Run discovery; capture output so we can show a tidy summary on success and
# the full failure detail otherwise.
if out=$(python3 -m unittest discover -s tests -p 'test_*.py' 2>&1); then
  # unittest prints its summary (ran N tests) on stderr->merged; surface the
  # "Ran N tests" + "OK" tail.
  summ=$(printf '%s\n' "$out" | grep -E '^(Ran |OK|OK \()' | tail -2 | tr '\n' ' ')
  pass "unittest suite green${summ:+ — $summ}"
else
  fail "unittest suite failed"
  printf '%s\n' "$out" | tail -40 | sed 's/^/    /'
fi

finish_check; exit $?
