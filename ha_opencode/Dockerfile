# Stage 1: Build hab CLI from source (pinned release)
ARG BUILD_ARCH
FROM --platform=$BUILDPLATFORM golang:1.24-trixie AS hab-builder

ARG BUILD_ARCH
ARG TARGETARCH
ARG HAB_VERSION=1.6.4
RUN git clone --depth 1 --branch "${HAB_VERSION}" https://github.com/balloob/home-assistant-build-cli.git /src
WORKDIR /src

RUN _A="${BUILD_ARCH:-$TARGETARCH}" \
    && GOARCH=$(case "$_A" in aarch64|arm64) echo arm64 ;; *) echo amd64 ;; esac) \
    && CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /hab .

# Stage 2: App image — inherits from our pre-built base (apt, npm, pip pre-baked)
FROM ghcr.io/umrath/ha_opencode-base:latest

ARG BUILD_VERSION
ARG BUILD_ARCH

# Copy hab CLI from builder stage
COPY --from=hab-builder /hab /usr/local/bin/hab

# Copy package.json first so npm install layer is cached separately from rootfs
COPY rootfs/opt/ha-mcp-server/package*.json /opt/ha-mcp-server/
COPY rootfs/opt/ha-lsp-server/package*.json /opt/ha-lsp-server/

RUN (cd /opt/ha-mcp-server && npm install --omit=dev) & \
    (cd /opt/ha-lsp-server && npm install --omit=dev) & \
    wait && npm cache clean --force

# Copy our source (scripts, MCP/LSP server code, config)
COPY rootfs /

RUN chmod +x /usr/local/bin/* \
    && chmod +x /etc/s6-overlay/s6-rc.d/init-opencode/run \
    && chmod +x /etc/s6-overlay/s6-rc.d/ha-opencode/run \
    && chmod +x /etc/s6-overlay/s6-rc.d/ha-opencode-server/run \
    && chmod +x /etc/s6-overlay/s6-rc.d/ppq-private-proxy/run \
    && chmod +x /etc/profile.d/hab-esphome.sh \
    && chmod +x /etc/profile.d/zigporter-z2m.sh \
    && chmod +x /usr/share/oc-proxy/proxy.py \
    && mkdir -p /data/.local/share/opencode /data/.config/opencode

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

WORKDIR /homeassistant

# HA Supervisor manages health checks via Ingress. A separate Docker HEALTHCHECK
# would race with the Supervisor watchdog and cause premature container restarts.

LABEL \
    io.hass.name="OpenCode" \
    io.hass.description="AI coding agent for editing Home Assistant configuration" \
    io.hass.type="app" \
    io.hass.version="${BUILD_VERSION}"
