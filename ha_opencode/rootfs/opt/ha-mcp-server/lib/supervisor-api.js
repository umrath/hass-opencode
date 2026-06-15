// ============================================================================
// Supervisor / HA Core API helpers — Extracted from index.js.
//
// Exports `createApiHelpers(cfg)` which returns { callHA, callSupervisor }.
// Dependencies (token, API base, logger, timeout) are injected at init time
// so this module has no side-effect imports from index.js.
// ============================================================================

export function createApiHelpers({ supervisorToken, supervisorApi, sendLog, apiTimeoutMs }) {

  /**
   * Call Home Assistant via Supervisor API proxy
   * Used for most endpoints that are proxied through supervisor
   */
  async function callHA(endpoint, method = "GET", body = null, timeoutMs = apiTimeoutMs) {
    sendLog("debug", "ha-api", { action: "request", endpoint, method });

    const options = {
      method,
      headers: {
        "Authorization": `Bearer ${supervisorToken}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(timeoutMs),
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(`${supervisorApi}${endpoint}`, options);

    if (!response.ok) {
      const text = await response.text();
      sendLog("error", "ha-api", { action: "error", endpoint, status: response.status, error: text });
      throw new Error(`HA API error (${response.status}): ${text}`);
    }

    const contentType = response.headers.get("content-type");
    if (contentType && contentType.includes("application/json")) {
      const result = await response.json();
      sendLog("debug", "ha-api", { action: "response", endpoint, success: true });
      return result;
    }
    return response.text();
  }

  /**
   * Call Home Assistant Supervisor API directly
   * Used for app management, updates, jobs, and system operations
   */
  async function callSupervisor(endpoint, method = "GET", body = null, timeoutMs = apiTimeoutMs) {
    sendLog("debug", "supervisor-api", { action: "request", endpoint, method });

    const options = {
      method,
      headers: {
        "Authorization": `Bearer ${supervisorToken}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(timeoutMs),
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(`http://supervisor${endpoint}`, options);

    if (!response.ok) {
      const text = await response.text();
      sendLog("error", "supervisor-api", { action: "error", endpoint, status: response.status, error: text });
      throw new Error(`Supervisor API error (${response.status}): ${text}`);
    }

    const contentType = response.headers.get("content-type");
    if (contentType && contentType.includes("application/json")) {
      const result = await response.json();
      sendLog("debug", "supervisor-api", { action: "response", endpoint, success: true });
      // Supervisor API wraps data in { result: "ok", data: {...} }
      return result.data !== undefined ? result.data : result;
    }
    return response.text();
  }

  return { callHA, callSupervisor };
}
