#!/usr/bin/env bash
# =============================================================================
# OpenCode Session - Wrapper script that runs inside ttyd
# =============================================================================

# Set up home directory for persistent storage
export HOME="/data"
export XDG_DATA_HOME="/data/.local/share"
export XDG_CONFIG_HOME="/data/.config"

# Load user-defined environment variables (written by init-opencode)
if [ -f /data/.env_vars ]; then
    source /data/.env_vars
fi

# Load discovered service variables (written by background discovery)
if [ -f /data/.env_vars_discovered ]; then
    source /data/.env_vars_discovered
fi

# Ensure SUPERVISOR_TOKEN is available for MCP server
# This is auto-injected by Home Assistant Supervisor
if [ -z "$SUPERVISOR_TOKEN" ]; then
    echo "Warning: SUPERVISOR_TOKEN not set. MCP integration may not work."
fi

# Provide zigporter's HA_TOKEN at runtime from the Supervisor token instead of
# persisting it to /data/.env_vars. Only set when not already supplied (e.g. by
# a user-defined env_var), so an explicit override still wins.
export HA_TOKEN="${HA_TOKEN:-$SUPERVISOR_TOKEN}"


# Ensure directories exist
mkdir -p "${HOME}/.local/share/opencode"
mkdir -p "${HOME}/.config/opencode"

# OpenCode (Bun) extracts the native opentui renderer to $TMPDIR and maps it
# executable. /tmp is mounted noexec (tmpfs: true), so that mmap is refused and
# the TUI crashes at start-up ("An error occurred in Effect.tryPromise") while
# `opencode run`/`serve` (no renderer) keep working. Point Bun at an
# exec-capable dir on the persistent volume. Exported here so both the
# auto-started TUI and the fallback login shell (where the user types
# `opencode`) inherit it.
export TMPDIR="/data/tmp"
mkdir -p "${TMPDIR}"

# KDE Breeze-style colors
BLUE='\033[38;2;29;153;243m'
GREEN='\033[38;2;17;209;22m'
YELLOW='\033[38;2;246;116;0m'
CYAN='\033[38;2;26;188;156m'
WHITE='\033[38;2;252;252;252m'
GRAY='\033[38;2;127;140;141m'
BOLD='\033[1m'
NC='\033[0m'

# Read addon version and CPU mode written by init-opencode
CPU_MODE=$(cat /data/.cpu_mode 2>/dev/null || echo "unknown")
ADDON_VERSION=$(cat /data/.addon_version 2>/dev/null || echo "unknown")
ADDON_ACCESS_ENABLED=$(cat /data/.addon_access_enabled 2>/dev/null || echo "false")
OPENCODE_UPDATE_POLICY=$(cat /data/.opencode_update_policy 2>/dev/null || echo "latest")
OPENCODE_VERSION=$(cat /data/.opencode_version 2>/dev/null || opencode --version 2>/dev/null || echo "unknown")
CPU_INFO=""
if [ "${CPU_MODE}" = "baseline" ]; then
    CPU_INFO=" ${YELLOW}(baseline CPU mode)${NC}"
fi

# Change to Home Assistant config directory
cd /homeassistant

# When update policy is "bundled", ensure the bundled binary at
# /usr/local/bin/opencode takes precedence. When policy is "latest",
# /data/.env_vars already placed /data/.npm-global/bin first — do not override.
if [ "${OPENCODE_UPDATE_POLICY}" = "bundled" ]; then
    export PATH="/usr/local/bin:/usr/bin:/bin:${PATH}"
fi
export OPENCODE_DISABLE_AUTOUPDATE=true

# Configure git if not already configured
if [ ! -f "${HOME}/.gitconfig" ]; then
    git config --global init.defaultBranch main 2>/dev/null || true
    git config --global safe.directory /homeassistant 2>/dev/null || true
fi

# Function to show welcome banner
show_banner() {
    clear
    echo ""
    echo -e "${BLUE}${BOLD}OpenCode${NC} ${GRAY}v${ADDON_VERSION}${NC}${CPU_INFO}"
    echo -e "${GRAY}Runtime: OpenCode ${OPENCODE_VERSION} (${OPENCODE_UPDATE_POLICY})${NC}"
    echo -e "${GRAY}AI-powered coding agent for Home Assistant${NC}"
    echo ""
    echo -e "${GRAY}────────────────────────────────────────────────────────────${NC}"
    echo ""
}

# Function to show shell help (after exiting opencode)
show_shell_help() {
    echo ""
    echo -e "${GRAY}────────────────────────────────────────────────────────────${NC}"
    echo ""
    echo -e "${WHITE}Dropped to shell.${NC} Working directory: ${CYAN}/homeassistant${NC}"
    echo ""
    echo -e "${BOLD}Commands${NC}"
    echo -e "  ${GREEN}opencode${NC}          Restart the AI coding agent"
    echo -e "  ${GREEN}ha-logs${NC} ${GRAY}<type>${NC}    View logs (core, error, supervisor, host)"
    echo -e "  ${GREEN}ha-mcp${NC} ${GRAY}<cmd>${NC}     MCP integration (enable, disable, status)"
    echo -e "  ${GREEN}hab${NC} ${GRAY}<cmd>${NC}         HA admin CLI (entities, areas, dashboards, backups)"
    echo -e "  ${GREEN}zigporter${NC} ${GRAY}<cmd>${NC}   Zigbee tools (rename, inspect, stale, mesh)"
    echo ""
}

# Show initial banner
show_banner

echo -e "${WHITE}Working directory:${NC} ${CYAN}/homeassistant${NC}"
if [ "${ADDON_ACCESS_ENABLED}" = "true" ]; then
    echo -e "${WHITE}Add-on development:${NC} ${CYAN}/addons${NC} ${GRAY}and${NC} ${CYAN}/addon_configs${NC} ${YELLOW}(sensitive)${NC}"
fi
echo -e "${GRAY}First time? Use ${NC}${GREEN}/connect${NC} ${GRAY}inside OpenCode to add your AI provider${NC}"
echo -e "${GRAY}Customize AI behavior by editing ${NC}${GREEN}AGENTS.md${NC} ${GRAY}in your config folder${NC}"
echo -e "${GRAY}Copy: select text (auto-copies) · Paste: ${NC}${GREEN}Ctrl+V${NC}${GRAY} or right-click${NC}"
echo ""

# Launch OpenCode
opencode

# When opencode exits, show help and drop to bash
show_shell_help

# Start interactive bash shell
exec bash --login
