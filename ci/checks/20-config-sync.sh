#!/usr/bin/env bash
# Blocking: in every app config.yaml, the `options` keys and the `schema`
# keys must be exactly in sync. A stray option with no schema entry (or vice
# versa) is silently ignored by Supervisor and a frequent source of bugs.
set -u
. "$(dirname "$0")/../lib.sh"
cd "$CI_REPO_ROOT"

section "options ↔ schema key sync (config.yaml)"

if ! have python3 || ! python3 -c 'import yaml' >/dev/null 2>&1; then
  warn "python3 + PyYAML not available — skipping (advisory)"
  finish_check; exit $?
fi

configs="ha_opencode/config.yaml ha_opencode_beta/config.yaml"

for cfg in $configs; do
  if [ ! -f "$cfg" ]; then
    warn "$cfg not found — skipping"
    continue
  fi
  # Python prints either "OK <n>" or one or more "ERR ..." lines.
  out=$(python3 - "$cfg" <<'PY'
import sys, yaml
cfg = yaml.safe_load(open(sys.argv[1]))
missing = [k for k in ("options", "schema") if k not in (cfg or {})]
if missing:
    print("ERR missing top-level keys: %s" % missing)
    sys.exit(0)
opts, schema = set(cfg["options"]), set(cfg["schema"])
if opts == schema:
    print("OK %d" % len(opts))
else:
    only_opts = sorted(opts - schema)
    only_schema = sorted(schema - opts)
    if only_opts:
        print("ERR options without a schema entry: %s" % only_opts)
    if only_schema:
        print("ERR schema entries without an options default: %s" % only_schema)
PY
)
  if printf '%s' "$out" | grep -q '^ERR'; then
    fail "$cfg"
    printf '%s\n' "$out" | grep '^ERR' | while IFS= read -r l; do info "${l#ERR }"; done
  else
    pass "$cfg (${out#OK } options, schema in sync)"
  fi
done

finish_check; exit $?
