// ============================================================================
// DOCUMENTATION FETCHING HELPERS — Extracted from index.js.
// ============================================================================

export function createDocHelpers({ sendLog }) {

  /**
   * Fetch a URL and return its text content
   */
  async function fetchUrl(url) {
    sendLog("debug", "docs", { action: "fetch", url });

    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent": "HomeAssistant-MCP-Server/2.1.0",
          "Accept": "text/html,application/xhtml+xml,text/plain",
        },
        signal: AbortSignal.timeout(15000),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.text();
    } catch (error) {
      sendLog("error", "docs", { action: "fetch_error", url, error: error.message });
      throw error;
    }
  }

  // Parsed documentation cache — agents frequently re-request the same page,
  // and each fetch is ~1 MB of HTML plus a heavy regex parsing pass
  const docsCache = new Map();
  const DOCS_CACHE_TTL = 3600000; // 1 hour

  function getCachedDoc(key) {
    const hit = docsCache.get(key);
    return hit && (Date.now() - hit.fetchedAt) < DOCS_CACHE_TTL ? hit.data : null;
  }

  function setCachedDoc(key, data) {
    docsCache.set(key, { data, fetchedAt: Date.now() });
  }

  return { fetchUrl, getCachedDoc, setCachedDoc };
}
