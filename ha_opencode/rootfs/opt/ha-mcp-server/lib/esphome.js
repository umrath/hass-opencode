// ============================================================================
// ESPHOME INTEGRATION HELPERS — Extracted from index.js.
//
// Exports `createEspHomeHelpers(cfg)` returning { discoverESPHome,
// getESPHomeConnection, invalidateESPHomeCache, streamESPHomeLogs,
// getESPHomeDevices }. Dependencies injected at init time.
// ============================================================================

import WebSocket from "ws";

export function createEspHomeHelpers({
  sendLog, callHA, discoverHACoreUrl,
  HA_ACCESS_TOKEN, ESPHOME_TOKEN_ERROR, SUPERVISOR_API,
  callHAWebSocketCommand,
}) {

// ESPHOME INTEGRATION HELPERS
// ============================================================================

/**
 * Discover ESPHome app and return its URL via the Supervisor ingress proxy.
 *
 * ESPHome (since ~2026.2.x) no longer exposes the dashboard on a TCP port.
 * The dashboard binds to a Unix socket, fronted by nginx with IP-based access
 * rules that block requests from other addon containers.
 *
 * We discover HA Core's real LAN URL from /api/config (internal_url), create
 * an ingress session via WebSocket (the only method that works), and route
 * requests through HA Core's ingress proxy using a long-lived access token.
 * This is the exact same path the external CLI uses.
 *
 * Returns { ok: true, ...result } on success,
 *   or { ok: false, error: "...", diagnostics: {...} } on failure.
 */
async function discoverESPHome() {
  const diag = {
    steps: [],
    addonFound: false,
    addonSlug: null,
    addonState: null,
    ingressEntry: null,
    hasAccessToken: !!HA_ACCESS_TOKEN,
    internalUrl: null,
    externalUrl: null,
    haCoreUrl: null,
    urlSource: null,
    networkFallback: null,
    wsSessionResult: null,
  };
  
  function step(name, status, detail = null) {
    diag.steps.push({ name, status, detail });
    sendLog("debug", "esphome", { action: "discover_step", name, status, detail });
  }

  try {
    // Steps 1 and 4 are independent â€” start the HA config fetch now and
    // consume it after the addon checks
    const haConfigPromise = callHA("/config");
    haConfigPromise.catch(() => {});

    // Step 1: Find ESPHome addon
    let addonsInfo;
    try {
      addonsInfo = await callSupervisor("/addons");
      step("fetch_addons", "ok", { addonCount: addonsInfo.addons?.length });
    } catch (e) {
      step("fetch_addons", "error", e.message);
      return { ok: false, error: `Failed to list addons: ${e.message}`, diagnostics: diag };
    }
    
    // The Supervisor /addons endpoint does NOT reliably set `installed: true`.
    // Instead, an installed addon has a `state` field ("started", "stopped", etc.)
    // and/or a `version` field with the installed version string.
    const esphome = addonsInfo.addons?.find(a => 
      a.slug.includes("esphome") && (a.state === "started" || a.state === "stopped" || a.version)
    );
    
    if (!esphome) {
      step("find_esphome", "error", "No installed addon with 'esphome' in slug");
      // Include matching slugs and their fields for debugging
      const slugs = (addonsInfo.addons || [])
        .filter(a => a.slug.includes("esphome"))
        .map(a => ({ slug: a.slug, installed: a.installed, version: a.version, state: a.state }));
      diag.esphomeSlugs = slugs;
      return { ok: false, error: "ESPHome addon not found in addon list.", diagnostics: diag };
    }
    
    diag.addonFound = true;
    diag.addonSlug = esphome.slug;
    step("find_esphome", "ok", { slug: esphome.slug });
    
    // Step 2: Get addon info
    let info;
    try {
      info = await callSupervisor(`/addons/${esphome.slug}/info`);
      diag.addonState = info.state;
      diag.ingressEntry = info.ingress_entry;
      step("addon_info", "ok", { state: info.state, version: info.version, ingress_entry: info.ingress_entry });
    } catch (e) {
      step("addon_info", "error", e.message);
      return { ok: false, error: `Failed to get addon info for ${esphome.slug}: ${e.message}`, diagnostics: diag };
    }
    
    if (!info.ingress_entry) {
      step("ingress_entry", "error", "ingress_entry is null/empty");
      return { ok: false, error: "ESPHome addon has no ingress_entry configured.", diagnostics: diag };
    }
    step("ingress_entry", "ok", info.ingress_entry);
    
    // Step 3: Check access token
    if (!HA_ACCESS_TOKEN) {
      step("access_token", "error", "HA_ACCESS_TOKEN env var is not set");
      return { ok: false, error: "ESPHome ingress requires a long-lived access token. " +
        "Create one at Profile â†’ Long-Lived Access Tokens in the HA UI, " +
        "then paste it into the addon's 'access_token' configuration option.", diagnostics: diag };
    }
    step("access_token", "ok");
    
    // Step 4: Discover HA Core URL
    let haCoreUrl;
    let haConfig;
    try {
      haConfig = await haConfigPromise;
      diag.internalUrl = haConfig.internal_url || null;
      diag.externalUrl = haConfig.external_url || null;
      step("ha_config", "ok", { internal_url: diag.internalUrl, external_url: diag.externalUrl });
    } catch (e) {
      step("ha_config", "error", e.message);
      return { ok: false, error: `Failed to get HA config: ${e.message}`, diagnostics: diag };
    }
    
    haCoreUrl = (haConfig.internal_url || haConfig.external_url || "").replace(/\/+$/, "");
    
    if (haCoreUrl) {
      diag.urlSource = "ha_config";
    } else {
      // internal_url is "automatic" (null) â€” discover from Supervisor APIs
      step("url_fallback", "started", "internal_url and external_url are both null, trying network discovery");
      try {
        const [coreInfo, networkInfo] = await Promise.all([
          callSupervisor("/core/info"),
          callSupervisor("/network/info"),
        ]);
        
        const port = coreInfo.port || 8123;
        const ssl = coreInfo.ssl || false;
        const protocol = ssl ? "https" : "http";
        
        diag.networkFallback = { port, ssl, interfaces: [] };
        
        // Find the primary connected interface and extract its LAN IP
        let hostIp = null;
        if (networkInfo.interfaces) {
          for (const iface of networkInfo.interfaces) {
            diag.networkFallback.interfaces.push({
              name: iface.interface,
              primary: iface.primary,
              connected: iface.connected,
              ipv4_addresses: iface.ipv4?.address || [],
            });
          }
          const primary = networkInfo.interfaces.find(i => i.primary && i.connected);
          const iface = primary || networkInfo.interfaces.find(i => i.connected);
          if (iface?.ipv4?.address?.[0]) {
            hostIp = iface.ipv4.address[0].split("/")[0];
          }
        }
        
        if (hostIp) {
          haCoreUrl = `${protocol}://${hostIp}:${port}`;
          diag.urlSource = "network_fallback";
          step("url_fallback", "ok", { url: haCoreUrl, ip: hostIp, port, ssl });
        } else {
          step("url_fallback", "error", "Could not find a connected interface with an IPv4 address");
        }
      } catch (e) {
        step("url_fallback", "error", e.message);
      }
    }
    
    diag.haCoreUrl = haCoreUrl;
    
    if (!haCoreUrl) {
      return { ok: false, error: "Could not determine HA Core URL. " +
        "Set internal_url in Settings â†’ System â†’ Network, " +
        "or ensure the host has a connected network interface.", diagnostics: diag };
    }
    step("ha_core_url", "ok", { url: haCoreUrl, source: diag.urlSource });
    
    // Step 5: Create ingress session via WebSocket
    let ingressSession;
    try {
      ingressSession = await createIngressSessionViaWebSocket(haCoreUrl, HA_ACCESS_TOKEN);
      if (ingressSession) {
        diag.wsSessionResult = "ok";
        step("ws_session", "ok");
      } else {
        diag.wsSessionResult = "returned_null";
        step("ws_session", "error", "createIngressSessionViaWebSocket returned null (auth failed or no session in response)");
        return { ok: false, error: `WebSocket ingress session creation returned null. ` +
          `Connected to ${haCoreUrl.replace(/^http/, "ws")}/api/websocket but did not get a session token. ` +
          `Check that the access_token is valid.`, diagnostics: diag };
      }
    } catch (e) {
      diag.wsSessionResult = `error: ${e.message}`;
      step("ws_session", "error", e.message);
      return { ok: false, error: `WebSocket ingress session creation failed: ${e.message}. ` +
        `Tried connecting to ${haCoreUrl.replace(/^http/, "ws")}/api/websocket`, diagnostics: diag };
    }
    
    // Step 6: Build final URL
    // ingress_entry from the Supervisor already contains the full path
    // (e.g. "/api/hassio_ingress/AbCdEf..."), so just append it to the base URL.
    const ingressPath = info.ingress_entry.startsWith("/") ? info.ingress_entry : `/${info.ingress_entry}`;
    const url = `${haCoreUrl}${ingressPath}`;
    step("final_url", "ok", url);
    
    const result = {
      ok: true,
      slug: esphome.slug,
      name: esphome.name,
      url,
      ingressSession,
      state: info.state,
      version: info.version,
      diagnostics: diag,
    };
    
    sendLog("debug", "esphome", { action: "discover", result: { ...result, ingressSession: "[redacted]" } });
    return result;
  } catch (error) {
    step("unexpected", "error", error.message);
    return { ok: false, error: `Unexpected error in discoverESPHome: ${error.message}`, diagnostics: diag };
  }
}

// Full discovery costs 4-6 round trips plus a WebSocket handshake per call;
// the slug, ingress entry, HA URL, and ingress session are all stable, so
// cache the successful result across a typical list â†’ compile â†’ upload run
let esphomeCache = { result: null, fetchedAt: 0 };
const ESPHOME_CACHE_TTL = 300000; // 5 minutes â€” well within ingress session lifetime

async function getESPHomeConnection() {
  const now = Date.now();
  if (esphomeCache.result?.ok && (now - esphomeCache.fetchedAt) < ESPHOME_CACHE_TTL) {
    return esphomeCache.result;
  }
  const result = await discoverESPHome();
  if (result.ok) {
    esphomeCache = { result, fetchedAt: Date.now() };
  }
  return result;
}

function invalidateESPHomeCache() {
  esphomeCache = { result: null, fetchedAt: 0 };
}

/**
 * Create an ingress session via HA Core's WebSocket API.
 * This is the ONLY method that works â€” REST-based session creation is rejected
 * by the Supervisor regardless of token type.  The WebSocket `supervisor/api`
 * command lets HA Core make the Supervisor call with its own credentials.
 *
 * @param {string} haCoreUrl - HA Core URL (e.g. http://192.168.1.100:8123)
 * @param {string} token - Long-lived access token
 * @returns {Promise<string|null>} Ingress session token, or null on failure
 */
async function createIngressSessionViaWebSocket(haCoreUrl, token) {
  return new Promise((resolve, reject) => {
    const wsUrl = haCoreUrl.replace(/^http/, "ws") + "/api/websocket";
    sendLog("debug", "esphome", { action: "ws_session", url: wsUrl });

    const ws = new WebSocket(wsUrl);
    let msgId = 1;
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error("WebSocket session creation timed out"));
    }, 15000);

    ws.on("open", () => {
      sendLog("debug", "esphome", { action: "ws_session_open" });
    });

    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString());

        if (msg.type === "auth_required") {
          ws.send(JSON.stringify({ type: "auth", access_token: token }));
        } else if (msg.type === "auth_ok") {
          // Create ingress session via supervisor/api command
          const id = msgId++;
          ws.send(JSON.stringify({
            id,
            type: "supervisor/api",
            endpoint: "/ingress/session",
            method: "post",
          }));
        } else if (msg.type === "auth_invalid") {
          clearTimeout(timeout);
          ws.close();
          sendLog("error", "esphome", { action: "ws_session_auth_failed", message: msg.message });
          resolve(null);
        } else if (msg.type === "result") {
          clearTimeout(timeout);
          ws.close();
          if (msg.success && msg.result?.session) {
            sendLog("debug", "esphome", { action: "ws_session_created" });
            resolve(msg.result.session);
          } else {
            sendLog("error", "esphome", { action: "ws_session_failed", result: msg });
            resolve(null);
          }
        }
      } catch (e) {
        sendLog("error", "esphome", { action: "ws_session_parse_error", error: e.message });
      }
    });

    ws.on("error", (err) => {
      clearTimeout(timeout);
      sendLog("error", "esphome", { action: "ws_session_error", error: err.message });
      reject(err);
    });

    ws.on("close", () => {
      clearTimeout(timeout);
    });
  });
}

/**
 * Stream logs from ESPHome WebSocket endpoint
 * @param {string} baseUrl - ESPHome dashboard URL (Supervisor ingress URL)
 * @param {string} endpoint - WebSocket endpoint (e.g., "compile", "upload")
 * @param {object} params - Parameters to send (e.g., { configuration: "device.yaml" })
 * @param {function} onLine - Callback for each log line
 * @param {number} timeout - Timeout in milliseconds (default: 10 minutes for builds)
 * @param {string|null} ingressSession - Ingress session token for the Supervisor proxy
 * @returns {Promise<{success: boolean, code: number, logs: string[]}>}
 */
async function streamESPHomeLogs(baseUrl, endpoint, params, onLine = null, timeout = 600000, ingressSession = null) {
  return new Promise((resolve, reject) => {
    const logs = [];
    const startTime = Date.now();
    
    // Build WebSocket URL preserving the full path (important for ingress proxy)
    const wsUrl = baseUrl.replace(/^http/, "ws").replace(/\/$/, "") + "/" + endpoint;
    
    sendLog("debug", "esphome", { action: "ws_connect", url: wsUrl, params });
    
    // Pass ingress session cookie + Bearer token in the WebSocket upgrade handshake.
    // HA Core's ingress proxy requires the Bearer token for auth; the Supervisor
    // ingress handler requires the session cookie.
    const wsOptions = { headers: {} };
    if (ingressSession) {
      wsOptions.headers["Cookie"] = `ingress_session=${ingressSession}`;
    }
    if (HA_ACCESS_TOKEN) {
      wsOptions.headers["Authorization"] = `Bearer ${HA_ACCESS_TOKEN}`;
    }
    
    const ws = new WebSocket(wsUrl, wsOptions);
    
    // Set timeout
    const timeoutId = setTimeout(() => {
      ws.close();
      reject(new Error(`ESPHome operation timed out after ${timeout / 1000} seconds`));
    }, timeout);
    
    ws.on("open", () => {
      sendLog("debug", "esphome", { action: "ws_open", endpoint });
      ws.send(JSON.stringify({ type: "spawn", ...params }));
    });
    
    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString());
        
        if (msg.event === "line") {
          logs.push(msg.data);
          if (onLine) onLine(msg.data);
        }
        
        if (msg.event === "exit") {
          clearTimeout(timeoutId);
          ws.close();
          const duration = ((Date.now() - startTime) / 1000).toFixed(1);
          sendLog("info", "esphome", { 
            action: "ws_complete", 
            endpoint, 
            success: msg.code === 0, 
            code: msg.code,
            duration: `${duration}s`,
            logLines: logs.length 
          });
          resolve({ 
            success: msg.code === 0, 
            code: msg.code, 
            logs,
            duration: `${duration}s`
          });
        }
      } catch (parseError) {
        sendLog("warning", "esphome", { action: "ws_parse_error", error: parseError.message });
      }
    });
    
    ws.on("error", (error) => {
      clearTimeout(timeoutId);
      sendLog("error", "esphome", { action: "ws_error", endpoint, error: error.message });
      reject(new Error(`ESPHome WebSocket error: ${error.message}`));
    });
    
    ws.on("close", (code, reason) => {
      clearTimeout(timeoutId);
      // Only log unexpected closes (not our intentional closes)
      if (logs.length === 0) {
        sendLog("warning", "esphome", { action: "ws_close_unexpected", code, reason: reason?.toString() });
      }
    });
  });
}

/**
 * Get list of ESPHome devices via REST API
 * @param {string} esphomeUrl - ESPHome dashboard URL (Supervisor ingress URL)
 * @param {string|null} ingressSession - Ingress session token for the Supervisor proxy
 */
async function getESPHomeDevices(esphomeUrl, ingressSession = null) {
  const headers = {};
  if (ingressSession) {
    headers["Cookie"] = `ingress_session=${ingressSession}`;
  }
  // When routing through HA Core's ingress proxy, the Bearer token is
  // required for HA Core auth; the cookie is for the Supervisor's ingress.
  if (HA_ACCESS_TOKEN) {
    headers["Authorization"] = `Bearer ${HA_ACCESS_TOKEN}`;
  }
  const url = `${esphomeUrl}/devices`;
  sendLog("debug", "esphome", { action: "get_devices", url, hasSession: !!ingressSession, hasToken: !!HA_ACCESS_TOKEN });
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(API_TIMEOUT_MS) });
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      invalidateESPHomeCache();
    }
    let body = "";
    try { body = await response.text(); } catch (_) {}
    const detail = `HTTP ${response.status} from ${url}` +
      (body ? `\nResponse body: ${body.slice(0, 500)}` : "") +
      `\nHeaders sent: Cookie=${ingressSession ? "ingress_session=<set>" : "<none>"}, Authorization=${HA_ACCESS_TOKEN ? "Bearer <set>" : "<none>"}`;
    throw new Error(`Failed to get ESPHome devices: ${detail}`);
  }
  return await response.json();
}

  return { discoverESPHome, getESPHomeConnection, invalidateESPHomeCache,
           streamESPHomeLogs, getESPHomeDevices };
}
