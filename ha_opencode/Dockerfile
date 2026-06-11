# Global ARGs (available in FROM instructions)
ARG BUILD_FROM=ghcr.io/home-assistant/base-debian:trixie
ARG BUILD_ARCH

## Stage 1: Build hab CLI from source (pinned release)
# Pinned to the build host's platform — Go cross-compiles via GOARCH below,
# so this stage never needs to run under emulation
FROM --platform=$BUILDPLATFORM golang:1.24-trixie AS hab-builder

ARG BUILD_ARCH
ARG HAB_VERSION=1.6.4
RUN git clone --depth 1 --branch "${HAB_VERSION}" https://github.com/balloob/home-assistant-build-cli.git /src
WORKDIR /src

# Cross-compile for the target architecture
RUN GOARCH=$([ "$BUILD_ARCH" = "aarch64" ] && echo "arm64" || echo "amd64") \
    CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /hab .

## Stage 2: Main add-on image
FROM $BUILD_FROM

# Build arguments
ARG BUILD_VERSION
ARG BUILD_ARCH
ARG TTYD_VERSION=1.7.7
ARG OPENCODE_VERSION=latest
ARG PPQ_PROXY_VERSION=0.1.0
ARG TSX_VERSION=4.20.6

# Environment for better Node.js performance
ENV NODE_ENV=production \
    npm_config_update_notifier=false \
    npm_config_fund=false

# Install system dependencies in a single layer
# - Node 22 from nodesource: Required for opencode-ai (Debian ships Node 20)
# - git: Required by OpenCode for version control operations
# - jq: JSON processing for helper scripts
# - curl/ca-certificates: For downloading ttyd
# - procps: Provides pgrep for health check
# - tmux: Session persistence to prevent multiple OpenCode instances
# - chromium: Headless browser for screenshot_url MCP tool (visual verification)
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl gnupg \
    && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y --no-install-recommends \
        chromium \
        git \
        jq \
        nodejs \
        procps \
        python3 \
        python3-venv \
        tmux \
    && rm -rf /var/lib/apt/lists/*
# npm is included in the nodesource nodejs package

# Chromium path for puppeteer-core (used by screenshot MCP tool)
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Install ttyd from GitHub releases (not in Debian repos)
RUN ARCH=$([ "$BUILD_ARCH" = "aarch64" ] && echo "aarch64" || echo "x86_64") \
    && curl -fsSL "https://github.com/tsl0922/ttyd/releases/download/${TTYD_VERSION}/ttyd.${ARCH}" -o /usr/bin/ttyd \
    && chmod +x /usr/bin/ttyd

# Copy hab CLI binary built from source (pinned release)
# A CLI designed for AI agents to manage HA via REST/WebSocket APIs
COPY --from=hab-builder /hab /usr/local/bin/hab

# Install zigporter CLI in an isolated Python virtual environment
# A Zigbee toolkit for cascade-rename, device inspection, and mesh mapping
RUN python3 -m venv /opt/zigporter-venv \
    && /opt/zigporter-venv/bin/pip install --no-cache-dir zigporter \
    && ln -s /opt/zigporter-venv/bin/zigporter /usr/local/bin/zigporter

# Install OpenCode, platform-specific binary, Prettier, PPQ proxy, tsx
# Nodesource Node 22 uses /usr prefix. Force /usr/local so the init script
# finds packages at the expected path (/usr/local/lib/node_modules/).
# opencode-ai postinstall has platform-detection issues with Node 22:
# install with --ignore-scripts, then manually add the correct binary.
ARG BUILD_ARCH
RUN npm config set prefix /usr/local \
    && npm install -g opencode-ai@${OPENCODE_VERSION} --ignore-scripts \
    && cd /usr/local/lib/node_modules/opencode-ai \
    && case "${BUILD_ARCH}" in \
         aarch64) npm install opencode-linux-arm64@${OPENCODE_VERSION} ;; \
         *)       npm install opencode-linux-x64@${OPENCODE_VERSION} ;; \
       esac \
    && npm install -g prettier ppq-private-mode@${PPQ_PROXY_VERSION} tsx@${TSX_VERSION} \
    && npm cache clean --force

# Copy package.json files first for better layer caching
# Changes to server code won't invalidate npm install cache
COPY rootfs/opt/ha-mcp-server/package*.json /opt/ha-mcp-server/
COPY rootfs/opt/ha-lsp-server/package*.json /opt/ha-lsp-server/

# Install MCP and LSP dependencies in parallel
RUN (cd /opt/ha-mcp-server && npm install --omit=dev) & \
    (cd /opt/ha-lsp-server && npm install --omit=dev) & \
    wait && npm cache clean --force

# Copy root filesystem (server code, scripts, etc.)
COPY rootfs /

# Make scripts executable and create runtime directories
RUN chmod +x /usr/local/bin/* \
    && chmod +x /etc/s6-overlay/s6-rc.d/init-opencode/run \
    && chmod +x /etc/s6-overlay/s6-rc.d/ha-opencode/run \
    && chmod +x /etc/s6-overlay/s6-rc.d/ha-opencode-server/run \
    && chmod +x /etc/s6-overlay/s6-rc.d/ppq-private-proxy/run \
    && chmod +x /etc/profile.d/hab-esphome.sh \
    && chmod +x /etc/profile.d/zigporter-z2m.sh \
    && mkdir -p /data/.local/share/opencode /data/.config/opencode

# Build the custom ttyd index page (served via -I at runtime): ttyd's page is
# a single self-contained HTML file compiled into the binary, so dump it from
# a briefly-running instance and inject the clipboard glue script (OSC 52 →
# browser clipboard, Ctrl+V paste). The injector fails the build if the page
# could not be dumped or has an unexpected layout.
RUN set -e; \
    ttyd -p 18099 -i lo bash & \
    TTYD_PID=$!; \
    ok=0; \
    for i in $(seq 1 50); do \
        if curl -fsS -o /tmp/ttyd-index.html http://127.0.0.1:18099/; then ok=1; break; fi; \
        sleep 0.2; \
    done; \
    kill "$TTYD_PID"; \
    [ "$ok" = "1" ]; \
    python3 /opt/ttyd/inject-clipboard.py /tmp/ttyd-index.html /opt/ttyd/clipboard.js /opt/ttyd/index.html; \
    rm -f /tmp/ttyd-index.html

# Set working directory to HA config (mounted at runtime)
WORKDIR /homeassistant

# Health check - verify ttyd is running
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD pgrep ttyd > /dev/null || exit 1

# Labels for Home Assistant
LABEL \
    io.hass.name="OpenCode" \
    io.hass.description="AI coding agent for editing Home Assistant configuration" \
    io.hass.type="addon" \
    io.hass.version="${BUILD_VERSION}"
