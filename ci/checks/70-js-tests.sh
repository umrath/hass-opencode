#!/usr/bin/env bash
# Blocking: the bundled MCP and LSP Node servers must pass their unit tests
# (vitest). Installs dev dependencies on demand. Honors CI_NO_JS=1 to skip
# (used by `run.sh --no-js` for fast local syntax-only runs).
set -u
. "$(dirname "$0")/../lib.sh"
cd "$CI_REPO_ROOT"

section "JS unit tests (vitest: MCP + LSP servers)"

if [ "${CI_NO_JS:-0}" = "1" ]; then
  skip "CI_NO_JS=1 — skipping JS tests"
  exit 0
fi

if ! have npm; then
  warn "npm not available — cannot run JS tests; skipping (advisory)"
  finish_check; exit $?
fi

servers="ha_opencode/rootfs/opt/ha-mcp-server ha_opencode/rootfs/opt/ha-lsp-server"

for dir in $servers; do
  if [ ! -f "$dir/package.json" ]; then
    warn "$dir/package.json not found — skipping"
    continue
  fi
  name=$(basename "$dir")

  # Install deps if missing. Use a lockfile-aware install when one exists,
  # otherwise a plain install (this repo .gitignores lockfiles).
  if [ ! -d "$dir/node_modules" ]; then
    info "$name: installing dependencies…"
    if [ -f "$dir/package-lock.json" ]; then
      ilog=$(cd "$dir" && npm ci 2>&1) || { fail "$name: npm ci failed"; printf '%s\n' "$ilog" | tail -5 | sed 's/^/    /'; continue; }
    else
      ilog=$(cd "$dir" && npm install 2>&1) || { fail "$name: npm install failed"; printf '%s\n' "$ilog" | tail -5 | sed 's/^/    /'; continue; }
    fi
  fi

  info "$name: running tests…"
  if tlog=$(cd "$dir" && npm test 2>&1); then
    # Echo the vitest summary line if present.
    summ=$(printf '%s\n' "$tlog" | grep -E 'Test Files|Tests ' | tail -2 | tr '\n' ' ')
    pass "$name${summ:+ — $summ}"
  else
    fail "$name: tests failed"
    printf '%s\n' "$tlog" | tail -20 | sed 's/^/    /'
  fi
done

finish_check; exit $?
