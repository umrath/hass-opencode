// ============================================================================
// HA WebSocket helpers — Extracted from index.js.
//
// Exports `createWebSocketHelpers(cfg)` returning { callHAWebSocketCommand,
// getRegistry, invalidateRegistryCache }. Dependencies injected at init time.
// ============================================================================

import WebSocket from "ws";

export function createWebSocketHelpers({ supervisorToken, sendLog }) {

  function callHAWebSocketCommand(commandType, timeoutMs = 5000) {
    return new Promise((promiseResolve, promiseReject) => {
      let settled = false;
      const settle = (fn, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        try { ws.close(); } catch (_) {}
        fn(value);
      };
      const timeout = setTimeout(() => {
        settle(promiseReject, new Error(`WebSocket command '${commandType}' timed out`));
      }, timeoutMs);

      let ws;
      try {
        ws = new WebSocket("ws://supervisor/core/websocket");
      } catch (error) {
        clearTimeout(timeout);
        promiseReject(error);
        return;
      }

      ws.on("message", (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === "auth_required") {
            ws.send(JSON.stringify({ type: "auth", access_token: supervisorToken }));
          } else if (msg.type === "auth_ok") {
            ws.send(JSON.stringify({ id: 1, type: commandType }));
          } else if (msg.type === "auth_invalid") {
            settle(promiseReject, new Error("WebSocket authentication failed"));
          } else if (msg.type === "result") {
            if (msg.success) {
              settle(promiseResolve, msg.result);
            } else {
              settle(promiseReject, new Error(msg.error?.message || `WebSocket command '${commandType}' failed`));
            }
          }
        } catch (_) { /* ignore parse errors, wait for timeout */ }
      });

      ws.on("error", (error) => {
        settle(promiseReject, error);
      });
    });
  }

  // Area/device registries change rarely; cache them to avoid a WS round trip per call
  const registryCache = new Map();
  const REGISTRY_CACHE_TTL = 300000; // 5 minutes

  async function getRegistry(commandType) {
    const cached = registryCache.get(commandType);
    const now = Date.now();
    if (cached && (now - cached.fetchedAt) < REGISTRY_CACHE_TTL) {
      return cached.data;
    }
    const data = await callHAWebSocketCommand(commandType);
    registryCache.set(commandType, { data, fetchedAt: now });
    return data;
  }

  function invalidateRegistryCache() {
    registryCache.clear();
  }

  return { callHAWebSocketCommand, getRegistry, invalidateRegistryCache };
}
