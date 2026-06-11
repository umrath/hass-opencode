#!/usr/bin/env bash
# Auto-bump version in config.yaml after successful CI + image build.
# Designed to run on the build host AFTER quality gates AND image build pass.
# Version format: MAJOR.MINOR.PATCH — bumps PATCH by 1.
set -euo pipefail

REPO_ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$REPO_ROOT"

CONFIG="ha_opencode/config.yaml"
CHANGELOG="ha_opencode/CHANGELOG.md"

current=$(grep "^version:" "$CONFIG" | sed 's/.*"\(.*\)".*/\1/')
major=$(echo "$current" | cut -d. -f1)
minor=$(echo "$current" | cut -d. -f2)
patch=$(echo "$current" | cut -d. -f3)
new="$major.$minor.$((patch + 1))"

echo "Bumping version: $current → $new"

sed -i "s/^version: .*/version: \"$new\"/" "$CONFIG"

# Move "Unreleased" CHANGELOG entries to a new version section
if grep -q "^## Unreleased" "$CHANGELOG"; then
  sed -i "0,/^## Unreleased/s//## $new/" "$CHANGELOG"
  echo "CHANGELOG updated: Unreleased → $new"
fi

git add "$CONFIG" "$CHANGELOG"
git commit -m "chore: bump version to $new [skip ci]" || true
git push origin main || true
