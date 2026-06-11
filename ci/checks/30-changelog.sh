#!/usr/bin/env bash
# Advisory: the version in each config.yaml should have a matching heading in
# the sibling CHANGELOG.md (this repo uses `## <version>` headings, no dates).
#
# Advisory rather than blocking: the release flow bumps config.yaml on tag and
# the CHANGELOG is maintained by hand under an `## Unreleased` section, so a
# brief drift is normal. CI surfaces it without blocking the parallel work.
set -u
. "$(dirname "$0")/../lib.sh"
cd "$CI_REPO_ROOT"

section "version ↔ CHANGELOG entry (advisory)"

if ! have python3 || ! python3 -c 'import yaml' >/dev/null 2>&1; then
  warn "python3 + PyYAML not available — skipping"
  finish_check; exit $?
fi

# addon-dir:changelog pairs
pairs="ha_opencode ha_opencode_beta"

for dir in $pairs; do
  cfg="$dir/config.yaml"
  log="$dir/CHANGELOG.md"
  [ -f "$cfg" ] || { warn "$cfg not found — skipping"; continue; }
  [ -f "$log" ] || { warn "$log not found — skipping"; continue; }

  ver=$(python3 -c 'import sys,yaml; print(yaml.safe_load(open(sys.argv[1]))["version"])' "$cfg" 2>/dev/null)
  if [ -z "$ver" ]; then
    warn "$cfg — could not read version"
    continue
  fi

  # Accept exactly `## <version>` (optionally followed by a date/suffix).
  if grep -qE "^## \[?${ver}\]?( |\$)" "$log"; then
    pass "$dir — v$ver documented in CHANGELOG"
  else
    top=$(grep -m1 -E '^## ' "$log" | sed 's/^## //')
    warn "$dir — v$ver has no '## $ver' entry (top heading is '${top}')"
    info "rename the '## Unreleased' section to '## $ver' on release, or add an entry"
  fi
done

# This check never fails the build; warnings are reported by the orchestrator.
exit 0
