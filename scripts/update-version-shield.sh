#!/bin/bash
# Update version shield in README.md to match version in config.yaml

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CONFIG_FILE="$REPO_ROOT/ha_opencode/config.yaml"
README_FILE="$REPO_ROOT/README.md"

# Extract version from config.yaml
VERSION=$(grep -E "^version:" "$CONFIG_FILE" | sed -E 's/^version:[[:space:]]*"([^"]+)"/\1/')

if [ -z "$VERSION" ]; then
    echo "Error: Could not extract version from $CONFIG_FILE"
    exit 1
fi

echo "Found version: $VERSION"

# Update version shield in README.md
SHIELD_URL="[version-shield]: https://img.shields.io/badge/version-v${VERSION}-blue.svg?style=for-the-badge"
if [[ "$OSTYPE" == "darwin"* ]]; then
    sed -i '' "s|\[version-shield\]: https://img.shields.io/badge/version-v[0-9.]*-blue.svg[^[:space:]]*|${SHIELD_URL}|" "$README_FILE"
else
    sed -i "s|\[version-shield\]: https://img.shields.io/badge/version-v[0-9.]*-blue.svg[^[:space:]]*|${SHIELD_URL}|" "$README_FILE"
fi

echo "Updated version shield in README.md to v${VERSION}"
