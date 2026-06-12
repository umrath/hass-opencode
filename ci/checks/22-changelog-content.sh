#!/usr/bin/env bash
# Blocking: when ci/RELEASE_TARGET exists, the "## Unreleased" section
# in CHANGELOG.md must contain actual content (not just the heading).
# Prevents releases with empty changelog entries.
set -u
. "$(dirname "$0")/../lib.sh"
cd "$CI_REPO_ROOT"

section "CHANGELOG content (release readiness)"

CHANGELOG="ha_opencode/CHANGELOG.md"

if [ ! -f "$CHANGELOG" ]; then
  skip "$CHANGELOG not found"
  finish_check; exit $?
fi

# Only enforce when a release is pending
if [ ! -f "ci/RELEASE_TARGET" ]; then
  skip "no RELEASE_TARGET — release not pending, skipping"
  finish_check; exit $?
fi

target=$(tr -d ' \t\r\n' < ci/RELEASE_TARGET 2>/dev/null || echo "")
if [ -z "$target" ]; then
  skip "empty RELEASE_TARGET"
  finish_check; exit $?
fi

# Extract content between "## Unreleased" and the next "## " heading
unreleased=$(awk '/^## Unreleased/ { found=1; next } found && /^## / { exit } found { print }' "$CHANGELOG")

# Remove empty lines and whitespace for a content check
content_lines=$(printf '%s\n' "$unreleased" | grep -c '[^[:space:]]' 2>/dev/null || echo 0)

if [ "$content_lines" -eq 0 ]; then
  fail "## Unreleased section in $CHANGELOG has no content."
  info "Add release notes under '## Unreleased' before creating ci/RELEASE_TARGET."
else
  pass "## Unreleased has $content_lines line(s) — ready for release"
fi

finish_check; exit $?
