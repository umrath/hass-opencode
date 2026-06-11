#!/usr/bin/env bash
# Advisory: validate the AppArmor profile syntax with apparmor_parser -Q
# (parse + resolve #includes, no kernel load). Requires apparmor_parser and the
# system abstractions (present on the Debian build host); skips otherwise.
# Never fails the build — enforcement is still verified on-device.
set -u
. "$(dirname "$0")/../lib.sh"
cd "$CI_REPO_ROOT"

section "AppArmor profile syntax (advisory)"

profile="ha_opencode/apparmor.txt"
if [ ! -f "$profile" ]; then
  skip "$profile not found"
  exit 0
fi

if ! have apparmor_parser; then
  skip "apparmor_parser not available — skipping (structural checks cover content)"
  exit 0
fi

if out=$(apparmor_parser -Q "$profile" 2>&1); then
  pass "apparmor_parser -Q: profile parses and includes resolve"
else
  warn "apparmor_parser reported a problem (advisory)"
  printf '%s\n' "$out" | tail -20 | sed 's/^/    /'
fi

exit 0
