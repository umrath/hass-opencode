// ============================================================================
// SCREENSHOT HELPERS — Extracted from index.js.
//
// Exports `createScreenshotHelpers(cfg)` returning { takeScreenshot }.
// Dependencies (tokens, paths, logger) injected at init time.
// ============================================================================

export function createScreenshotHelpers({
  CHROMIUM_PATH, HA_ACCESS_TOKEN,
  sendLog,
}) {

let sharedBrowser = null;
let browserIdleTimer = null;
const BROWSER_IDLE_MS = 120000;

// puppeteer-core's module tree costs tens of MB of RSS; screenshots are
// disabled by default, so load it only when the tool is actually used
let puppeteerModule = null;

async function getPuppeteer() {
  if (!puppeteerModule) {
    puppeteerModule = (await import("puppeteer-core")).default;
  }
  return puppeteerModule;
}

async function getSharedBrowser() {
  if (browserIdleTimer) {
    clearTimeout(browserIdleTimer);
    browserIdleTimer = null;
  }
  if (sharedBrowser?.connected) {
    return sharedBrowser;
  }
  const puppeteer = await getPuppeteer();
  sharedBrowser = await puppeteer.launch({
    executablePath: CHROMIUM_PATH,
    headless: "new",
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--no-first-run",
      "--disable-extensions",
    ],
  });
  return sharedBrowser;
}

function scheduleBrowserClose() {
  if (browserIdleTimer) clearTimeout(browserIdleTimer);
  browserIdleTimer = setTimeout(() => {
    const browser = sharedBrowser;
    sharedBrowser = null;
    browserIdleTimer = null;
    if (browser) {
      browser.close().catch(() => {});
    }
  }, BROWSER_IDLE_MS);
  // Don't keep the process alive just for the idle close
  browserIdleTimer.unref?.();
}

async function takeScreenshot(haCoreUrl, urlPath, options = {}) {
  const { width = 1280, height = 720, waitSeconds = 3, fullPage = false } = options;

  const browser = await getSharedBrowser();
  let page;

  try {
    page = await browser.newPage();
    await page.setViewport({ width, height });

    // â”€â”€ Auth Strategy 1: localStorage tokens â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // The HA frontend reads "hassTokens" from localStorage on startup.
    // We inject a token entry with a non-empty refresh_token (empty string
    // is falsy and causes the auth module to reject the token) and a
    // far-future expiry so it won't attempt a refresh during our brief
    // screenshot window.
    await page.evaluateOnNewDocument((config) => {
      try {
        localStorage.setItem("hassTokens", JSON.stringify({
          hassUrl: config.hassUrl,
          clientId: config.hassUrl + "/",
          access_token: config.token,
          token_type: "Bearer",
          refresh_token: "ha-screenshot-tool",
          expires_in: 1800,
          expires: Date.now() + 1800000,
        }));
      } catch (e) {
        // localStorage may be unavailable in rare cases â€” fall through
        // to the other auth strategies
      }

      // â”€â”€ Auth Strategy 2: WebSocket interceptor â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      // Monkey-patch the WebSocket constructor so that when the HA
      // frontend opens /api/websocket, our listener auto-responds to
      // the auth_required handshake with the LLAT.  This covers cases
      // where localStorage auth fails or the frontend ignores it.
      const _WebSocket = window.WebSocket;
      window.WebSocket = function (url, protocols) {
        const ws = protocols !== undefined
          ? new _WebSocket(url, protocols)
          : new _WebSocket(url);

        if (url && url.includes("/api/websocket")) {
          let authSent = false;
          ws.addEventListener("message", function (event) {
            try {
              const msg = JSON.parse(event.data);
              if (msg.type === "auth_required" && !authSent) {
                authSent = true;
                ws.send(JSON.stringify({
                  type: "auth",
                  access_token: config.token,
                }));
              }
            } catch (_) { /* ignore parse errors on non-JSON frames */ }
          });
        }

        return ws;
      };
      // Preserve prototype chain so instanceof checks still work
      window.WebSocket.prototype = _WebSocket.prototype;
      window.WebSocket.CONNECTING = _WebSocket.CONNECTING;
      window.WebSocket.OPEN = _WebSocket.OPEN;
      window.WebSocket.CLOSING = _WebSocket.CLOSING;
      window.WebSocket.CLOSED = _WebSocket.CLOSED;
    }, { hassUrl: haCoreUrl, token: HA_ACCESS_TOKEN });

    // â”€â”€ Auth Strategy 3: HTTP request interception â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // Add the Authorization header to every request targeting the HA
    // server.  External requests (fonts, map tiles, etc.) are left
    // untouched so we don't leak the token to third parties.
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      if (req.url().startsWith(haCoreUrl)) {
        req.continue({
          headers: { ...req.headers(), Authorization: `Bearer ${HA_ACCESS_TOKEN}` },
        });
      } else {
        req.continue();
      }
    });

    // Navigate to the target page
    const normalizedPath = urlPath.startsWith("/") ? urlPath : `/${urlPath}`;
    const fullUrl = `${haCoreUrl}${normalizedPath}`;

    sendLog("info", "screenshot", { action: "navigating", url: fullUrl, width, height });

    // Use "load" rather than "networkidle0"/"networkidle2" because the HA
    // frontend keeps a persistent WebSocket open (/api/websocket) for the
    // lifetime of the page.  "networkidle0" waits for zero active connections,
    // which is never satisfied, causing every screenshot to time out.  "load"
    // fires once the page and its subresources are fetched, ignoring ongoing
    // connections.  Dynamic content rendering is handled by the waitSeconds
    // delay below.
    await page.goto(fullUrl, {
      waitUntil: "load",
      timeout: 30000,
    });

    // Wait for dynamic content to render (dashboards, cards, graphs, etc.)
    const clampedWait = Math.max(0, Math.min(waitSeconds, 15));
    if (clampedWait > 0) {
      await new Promise(resolve => setTimeout(resolve, clampedWait * 1000));
    }

    // Take screenshot
    const screenshotBuffer = await page.screenshot({
      type: "png",
      fullPage,
      encoding: "base64",
    });

    sendLog("info", "screenshot", {
      action: "captured",
      path: normalizedPath,
      size: `${Math.round(screenshotBuffer.length / 1024)}KB (base64)`,
    });

    return screenshotBuffer;
  } finally {
    if (page) {
      await page.close().catch(() => {});
    }
    scheduleBrowserClose();
  }
}

  return { takeScreenshot };
}
