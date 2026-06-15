#!/usr/bin/env bash
# Idempotent installer for the build-host CI pipeline.
#
# Strictly additive and self-contained:
#   - everything lives under /opt/ci/hass-opencode (its own git clone, logs,
#     state); it never touches /opt/hass-opencode or the buildx builder.
#   - installs two namespaced systemd units: hass-opencode-ci.{service,timer}.
#
# Run on the build host as root:
#   ci/buildhost/install.sh           # install + enable the 5-min timer
#   ci/buildhost/install.sh --no-timer# install files only, don't enable timer
#
# Uninstall: see README.md (a few rm + systemctl disable lines).
set -eu

CI_HOME=${CI_HOME:-/opt/ci/hass-opencode}
ENABLE_TIMER=1
[ "${1:-}" = "--no-timer" ] && ENABLE_TIMER=0

SRC=$(cd "$(dirname "$0")" && pwd)

echo "[install] CI_HOME=$CI_HOME"
mkdir -p "$CI_HOME/bin" "$CI_HOME/logs" "$CI_HOME/state"

install -m 0755 "$SRC/run-ci.sh" "$CI_HOME/bin/run-ci.sh"
echo "[install] runner -> $CI_HOME/bin/run-ci.sh"

# systemd units
install -m 0644 "$SRC/hass-opencode-ci.service" /etc/systemd/system/hass-opencode-ci.service
install -m 0644 "$SRC/hass-opencode-ci.timer"   /etc/systemd/system/hass-opencode-ci.timer
echo "[install] units -> /etc/systemd/system/hass-opencode-ci.{service,timer}"

# Seed an optional defaults file only if absent (don't clobber local overrides).
if [ ! -f /etc/default/hass-opencode-ci ]; then
  cat > /etc/default/hass-opencode-ci <<'EOF'
# Overrides for the hass-opencode CI runner. Uncomment to change.
#CI_REMOTE=https://github.com/umrath/hass-opencode.git
#CI_BRANCH=main
#CI_PUSH_REMOTE=<git remote with credentials for version bumps>
#CI_AUTO_ACTIVATE=0
#CI_REGISTRY=ghcr.io
#CI_OWNER=umrath
#CI_IMAGE=ha_opencode
#CI_BASE_IMAGE=ha_opencode-base
EOF
  echo "[install] wrote default /etc/default/hass-opencode-ci"
else
  # Idempotently add any missing config keys that were introduced later.
  # Don't touch user-set values — only seed commented-out defaults for new keys.
  for key in CI_REMOTE CI_BRANCH CI_PUSH_REMOTE CI_AUTO_ACTIVATE CI_REGISTRY CI_OWNER CI_IMAGE CI_BASE_IMAGE; do
    if ! grep -qE "^[[:space:]]*${key}=" /etc/default/hass-opencode-ci 2>/dev/null; then
      echo "#${key}=<unset>" >> /etc/default/hass-opencode-ci
      echo "[install] added: #${key}=<unset>"
    fi
  done
fi

systemctl daemon-reload

if [ "$ENABLE_TIMER" = "1" ]; then
  systemctl enable --now hass-opencode-ci.timer
  echo "[install] timer enabled:"
  systemctl status --no-pager hass-opencode-ci.timer | sed -n '1,4p' || true
else
  echo "[install] timer NOT enabled (--no-timer). Enable later with:"
  echo "          systemctl enable --now hass-opencode-ci.timer"
fi

echo "[install] done. Trigger a run now with: systemctl start hass-opencode-ci.service"
echo "[install] logs: $CI_HOME/logs/latest.log   state: $CI_HOME/state/last-result"
