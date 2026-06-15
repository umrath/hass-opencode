#!/usr/bin/env node
/**
 * Home Assistant MCP Server for OpenCode (Safe Config Edition v2.7)
 * 
 * A cutting-edge MCP server providing deep integration with Home Assistant.
 * Implements the latest MCP specification (2025-06-18) features:
 * 
 * - Structured tool output with outputSchema
 * - Tool annotations (destructive, idempotent, etc.)
 * - Human-readable title fields
 * - Resource links in tool results
 * - Logging capability for debugging
 * - Content annotations (audience/priority)
 * - Live documentation fetching
 * - Breaking changes awareness
 * - Deprecation pattern detection (shared DB with remote GitHub updates)
 * - Real-time update progress monitoring
 * - ESPHome build and flash integration
 * - Visual firmware update monitoring with timeline
 * - Safe config writing with automatic validation and backup/restore
 * - Jinja2 template pre-validation through HA's engine
 * - Structural YAML validation for automations, scripts, templates
 * - HA Repairs API integration (instance-specific deprecation warnings)
 * - HA Alerts feed integration (global integration issue awareness)
 * - Visual verification via headless Chromium screenshots
 * 
 * TOOLS (34):
 * - Entity state management (get, search, history)
 * - Service calls with intelligent targeting
 * - Configuration validation and safe writing
 * - Jinja2 template validation through HA's engine
 * - Calendar, logbook, and history access
 * - Anomaly detection and suggestions
 * - Documentation fetching and syntax checking
 * - Update management with real-time progress monitoring
 * - ESPHome device management, compile, and upload
 * - Visual verification screenshots of HA frontend pages
 * 
 * RESOURCES (9 + 4 templates):
 * - Live entity states by domain
 * - Automations, scripts, and scenes
 * - Area and device mappings
 * - System configuration
 * 
 * PROMPTS (6):
 * - Troubleshooting workflows
 * - Automation creation guides
 * - Energy optimization analysis
 * - Scene building assistance
 * 
 * Environment variables:
 * - SUPERVISOR_TOKEN: The Home Assistant Supervisor token (auto-provided in app)
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  ListResourceTemplatesRequestSchema,
  SetLevelRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import WebSocket from "ws";
import { readFileSync, writeFileSync, copyFileSync, unlinkSync, existsSync, mkdirSync } from "fs";
import { createHash } from "crypto";
import { execFile } from "child_process";
import { dirname, join, resolve, isAbsolute, normalize } from "path";
import { fileURLToPath } from "url";

// Extracted pure-function modules (testable in isolation)
import { defineTools } from "./lib/tools.js";
import { RESOURCES, RESOURCE_TEMPLATES } from "./lib/resources.js";
import { PROMPTS } from "./lib/prompts.js";
import { createApiHelpers } from "./lib/supervisor-api.js";
import { createWebSocketHelpers } from "./lib/websocket.js";
import { createScreenshotHelpers } from "./lib/screenshot.js";
import { createEspHomeHelpers } from "./lib/esphome.js";
import { detectAnomaly, searchEntities, generateSuggestions, generateStateSummary } from "./lib/intelligence.js";
import { validateYamlStructure, resolveConfigPath } from "./lib/validation.js";
import { extractContentFromHtml, extractConfigurationSection, extractYamlExamples } from "./lib/html-parser.js";
import { createTextContent, createImageContent, createResourceLink } from "./lib/helpers.js";

process.on("unhandledRejection", (reason, promise) => {
  console.error("unhandledRejection:", reason);
});
process.on("uncaughtException", (error) => {
  console.error("uncaughtException:", error);
  // Prevent process exit — keep the server alive.
  // This is unsafe for stateful errors; the server may need restart.
  // In practice HA API fetch failures are the main cause and are stateless.
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SUPERVISOR_API = "http://supervisor/core/api";
const HA_CONFIG_DIR = "/homeassistant";
const SUPERVISOR_TOKEN = process.env.SUPERVISOR_TOKEN;
const HA_ACCESS_TOKEN = process.env.HA_ACCESS_TOKEN;   // Long-lived token for direct HA Core calls

// Clear error message when ESPHome tools are used without an access token
const ESPHOME_TOKEN_ERROR = "ESPHome tools require a Long-Lived Access Token.\n\n" +
  "To configure:\n" +
  "1. Go to your Home Assistant Profile page (click your user icon)\n" +
  "2. Scroll to Long-Lived Access Tokens and create one\n" +
  "3. Go to Settings â†’ Add-ons â†’ OpenCode â†’ Configuration\n" +
  "4. Paste the token into the 'access_token' field\n" +
  "5. Restart the OpenCode app (with ESPHome already running)";

// Screenshot feature (visual verification of dashboards and UI)
const SCREENSHOT_ENABLED = process.env.SCREENSHOT_ENABLED === "true";
const CHROMIUM_PATH = process.env.PUPPETEER_EXECUTABLE_PATH || "/usr/bin/chromium";

const SCREENSHOT_DISABLED_ERROR = "Screenshot tool is disabled.\n\n" +
  "To enable visual verification:\n" +
  "1. Go to Settings â†’ Add-ons â†’ OpenCode â†’ Configuration\n" +
  "2. Enable 'Screenshot tool'\n" +
  "3. Set a Long-Lived Access Token (Profile â†’ Long-Lived Access Tokens)\n" +
  "4. Restart the OpenCode app";

const SCREENSHOT_TOKEN_ERROR = "Screenshot tool requires a Long-Lived Access Token.\n\n" +
  "To configure:\n" +
  "1. Go to your Home Assistant Profile page (click your user icon)\n" +
  "2. Scroll to Long-Lived Access Tokens and create one\n" +
  "3. Go to Settings â†’ Add-ons â†’ OpenCode â†’ Configuration\n" +
  "4. Paste the token into the 'access_token' field\n" +
  "5. Restart the OpenCode app";

// Home Assistant documentation base URLs
const HA_DOCS_BASE = "https://www.home-assistant.io";
const HA_INTEGRATIONS_URL = `${HA_DOCS_BASE}/integrations`;
const HA_BLOG_URL = `${HA_DOCS_BASE}/blog`;

if (!SUPERVISOR_TOKEN) {
  console.error("Error: SUPERVISOR_TOKEN environment variable is required");
  console.error("MCP server will stay alive but API calls will fail.");
  console.error("Ensure SUPERVISOR_TOKEN is in the parent environment.");
}

// ============================================================================
// LOGGING SYSTEM
// ============================================================================

let currentLogLevel = "info";
const LOG_LEVELS = ["debug", "info", "notice", "warning", "error", "critical", "alert", "emergency"];

function getLogLevelIndex(level) {
  return LOG_LEVELS.indexOf(level);
}

function shouldLog(level) {
  return getLogLevelIndex(level) >= getLogLevelIndex(currentLogLevel);
}

function sendLog(level, logger, data) {
  if (shouldLog(level)) {
    // Log notifications are sent via server.notification
    // For now, we log to stderr which the client can capture
    console.error(JSON.stringify({
      type: "log",
      level,
      logger,
      data,
      timestamp: new Date().toISOString(),
    }));
  }
}

// ============================================================================
// HOME ASSISTANT API HELPERS
// ============================================================================

// Default timeout for local Supervisor/HA calls; long-running operations
// (check_config, updates) pass explicit overrides
const API_TIMEOUT_MS = 30000;
const CHECK_CONFIG_TIMEOUT_MS = 120000;
const UPDATE_TIMEOUT_MS = 600000;

// HA / Supervisor API helpers — provided by lib/supervisor-api.js
const { callHA, callSupervisor } = createApiHelpers({
  supervisorToken: SUPERVISOR_TOKEN,
  supervisorApi: SUPERVISOR_API,
  sendLog,
  apiTimeoutMs: API_TIMEOUT_MS,
});

// HA WebSocket helpers — provided by lib/websocket.js
const { callHAWebSocketCommand, getRegistry, invalidateRegistryCache } = createWebSocketHelpers({
  supervisorToken: SUPERVISOR_TOKEN,
  sendLog,
});

// Screenshot helpers — provided by lib/screenshot.js
const { takeScreenshot } = createScreenshotHelpers({
  CHROMIUM_PATH, HA_ACCESS_TOKEN,
  sendLog,
});

// ESPHome helpers — provided by lib/esphome.js
const { discoverESPHome, getESPHomeConnection, invalidateESPHomeCache,
        streamESPHomeLogs, getESPHomeDevices } = createEspHomeHelpers({
  sendLog, callHA, discoverHACoreUrl,
  HA_ACCESS_TOKEN, ESPHOME_TOKEN_ERROR, SUPERVISOR_API,
  callHAWebSocketCommand,
});

// Short-lived cache for the full state dump â€” many tools fetch /states and
// filter in JS; this collapses repeat fetches within a burst of agent calls
const statesCache = { data: null, fetchedAt: 0, inflight: null };
const STATES_CACHE_TTL = 3000;

async function getCachedStates() {
  const now = Date.now();
  if (statesCache.data && (now - statesCache.fetchedAt) < STATES_CACHE_TTL) {
    return statesCache.data;
  }
  if (statesCache.inflight) {
    return statesCache.inflight;
  }
  statesCache.inflight = callHA("/states")
    .then((states) => {
      statesCache.data = states;
      statesCache.fetchedAt = Date.now();
      return states;
    })
    .finally(() => { statesCache.inflight = null; });
  return statesCache.inflight;
}

function invalidateStatesCache() {
  statesCache.data = null;
  statesCache.fetchedAt = 0;
}

// ============================================================================
// HA CORE URL DISCOVERY
// ============================================================================

/**
 * Discover the Home Assistant Core frontend URL.
 *
 * Tries internal_url / external_url from /api/config first, then falls back
 * to network interface discovery via the Supervisor API.
 *
 * @returns {Promise<string>} The HA Core URL (e.g. "http://192.168.1.100:8123")
 * @throws {Error} If the URL cannot be determined
 */
// The HA Core URL changes essentially never â€” cache it across calls
const haCoreUrlCache = { url: null, fetchedAt: 0 };
const HA_CORE_URL_TTL = 600000; // 10 minutes

async function discoverHACoreUrl() {
  if (haCoreUrlCache.url && (Date.now() - haCoreUrlCache.fetchedAt) < HA_CORE_URL_TTL) {
    return haCoreUrlCache.url;
  }

  let haConfig;
  try {
    haConfig = await callHA("/config");
  } catch (e) {
    throw new Error(`Failed to get HA config: ${e.message}`);
  }

  let haCoreUrl = (haConfig.internal_url || haConfig.external_url || "").replace(/\/+$/, "");

  if (!haCoreUrl) {
    // internal_url is "automatic" (null) â€” discover from Supervisor APIs
    try {
      const [coreInfo, networkInfo] = await Promise.all([
        callSupervisor("/core/info"),
        callSupervisor("/network/info"),
      ]);

      const port = coreInfo.port || 8123;
      const ssl = coreInfo.ssl || false;
      const protocol = ssl ? "https" : "http";

      let hostIp = null;
      if (networkInfo.interfaces) {
        const primary = networkInfo.interfaces.find(i => i.primary && i.connected);
        const iface = primary || networkInfo.interfaces.find(i => i.connected);
        if (iface?.ipv4?.address?.[0]) {
          hostIp = iface.ipv4.address[0].split("/")[0];
        }
      }

      if (hostIp) {
        haCoreUrl = `${protocol}://${hostIp}:${port}`;
      }
    } catch (e) {
      sendLog("warning", "ha-core-url", { action: "network_fallback_failed", error: e.message });
    }
  }

  if (!haCoreUrl) {
    throw new Error(
      "Could not determine HA Core URL. " +
      "Set internal_url in Settings â†’ System â†’ Network, " +
      "or ensure the host has a connected network interface."
    );
  }

  sendLog("debug", "ha-core-url", { action: "discovered", url: haCoreUrl });
  haCoreUrlCache.url = haCoreUrl;
  haCoreUrlCache.fetchedAt = Date.now();
  return haCoreUrl;
}

// ============================================================================
// COMMON SCHEMAS FOR STRUCTURED OUTPUT
// ============================================================================

const SCHEMAS = {
  entityState: {
    type: "object",
    properties: {
      entity_id: { type: "string", description: "Entity identifier" },
      state: { type: "string", description: "Current state value" },
      friendly_name: { type: "string", description: "Human-readable name" },
      device_class: { type: "string", description: "Device classification" },
      last_changed: { type: "string", description: "ISO timestamp of last state change" },
      last_updated: { type: "string", description: "ISO timestamp of last update" },
    },
    required: ["entity_id", "state"],
  },
  
  entityStateArray: {
    type: "array",
    items: {
      type: "object",
      properties: {
        entity_id: { type: "string" },
        state: { type: "string" },
        friendly_name: { type: "string" },
        device_class: { type: "string" },
      },
      required: ["entity_id", "state"],
    },
  },
  
  searchResult: {
    type: "array",
    items: {
      type: "object",
      properties: {
        entity_id: { type: "string" },
        state: { type: "string" },
        friendly_name: { type: "string" },
        device_class: { type: "string" },
        score: { type: "number", description: "Search relevance score" },
      },
      required: ["entity_id", "state", "score"],
    },
  },
  
  entityDetails: {
    type: "object",
    properties: {
      entity_id: { type: "string" },
      friendly_name: { type: "string" },
      state: { type: "string" },
      domain: { type: "string" },
      device_class: { type: "string" },
      device_id: { type: "string" },
      area_id: { type: "string" },
      attributes: { type: "object" },
      related_entities: {
        type: "array",
        items: {
          type: "object",
          properties: {
            entity_id: { type: "string" },
            friendly_name: { type: "string" },
            state: { type: "string" },
            relationship: { type: "string", enum: ["same_device", "same_area"] },
          },
        },
      },
    },
    required: ["entity_id", "state", "domain"],
  },
  
  serviceCallResult: {
    type: "object",
    properties: {
      success: { type: "boolean" },
      domain: { type: "string" },
      service: { type: "string" },
      affected_entities: { type: "array", items: { type: "string" } },
    },
    required: ["success", "domain", "service"],
  },
  
  anomaly: {
    type: "object",
    properties: {
      entity_id: { type: "string" },
      reason: { type: "string" },
      severity: { type: "string", enum: ["info", "warning", "error"] },
    },
    required: ["entity_id", "reason", "severity"],
  },
  
  anomalyArray: {
    type: "array",
    items: {
      type: "object",
      properties: {
        entity_id: { type: "string" },
        reason: { type: "string" },
        severity: { type: "string", enum: ["info", "warning", "error"] },
      },
      required: ["entity_id", "reason", "severity"],
    },
  },
  
  suggestion: {
    type: "object",
    properties: {
      type: { type: "string" },
      title: { type: "string" },
      description: { type: "string" },
      entities: { type: "array", items: { type: "string" } },
    },
    required: ["type", "title", "description"],
  },
  
  suggestionArray: {
    type: "array",
    items: {
      type: "object",
      properties: {
        type: { type: "string" },
        title: { type: "string" },
        description: { type: "string" },
      },
      required: ["type", "title", "description"],
    },
  },
  
  diagnostics: {
    type: "object",
    properties: {
      entity_id: { type: "string" },
      timestamp: { type: "string" },
      current_state: { type: "object" },
      checks: {
        type: "array",
        items: {
          type: "object",
          properties: {
            check: { type: "string" },
            status: { type: "string", enum: ["ok", "info", "warning", "error"] },
            details: { type: "string" },
          },
        },
      },
      history_summary: { type: "object" },
      relationships: { type: "object" },
    },
    required: ["entity_id", "timestamp", "checks"],
  },
  
  configValidation: {
    type: "object",
    properties: {
      result: { type: "string", enum: ["valid", "invalid"] },
      errors: { type: "string" },
    },
    required: ["result"],
  },
  
  integrationDocs: {
    type: "object",
    properties: {
      integration: { type: "string", description: "Integration name" },
      url: { type: "string", description: "Documentation URL" },
      title: { type: "string", description: "Integration title" },
      description: { type: "string", description: "Integration description" },
      configuration: { type: "string", description: "Configuration section content" },
      ha_version: { type: "string", description: "Current HA version" },
      fetched_at: { type: "string", description: "Timestamp when docs were fetched" },
    },
    required: ["integration", "url"],
  },
  
  breakingChanges: {
    type: "object",
    properties: {
      ha_version: { type: "string", description: "Current Home Assistant version" },
      changes: {
        type: "array",
        items: {
          type: "object",
          properties: {
            version: { type: "string" },
            title: { type: "string" },
            description: { type: "string" },
            integration: { type: "string" },
            url: { type: "string" },
          },
        },
      },
    },
    required: ["ha_version", "changes"],
  },
  
  configSyntaxCheck: {
    type: "object",
    properties: {
      valid: { type: "boolean", description: "Whether the syntax appears valid" },
      deprecated: { type: "boolean", description: "Whether deprecated syntax was detected" },
      warnings: { 
        type: "array", 
        items: { type: "string" },
        description: "List of warnings about the configuration" 
      },
      suggestions: { 
        type: "array", 
        items: { type: "string" },
        description: "Suggestions for improving the configuration" 
      },
      docs_url: { type: "string", description: "URL to relevant documentation" },
    },
    required: ["valid", "deprecated", "warnings", "suggestions"],
  },
  
  safeWriteResult: {
    type: "object",
    properties: {
      success: { type: "boolean", description: "Whether the config was successfully written and validated" },
      dry_run: { type: "boolean", description: "Whether this was a dry-run (no file written)" },
      file_path: { type: "string", description: "The resolved file path" },
      validation_result: { type: "string", enum: ["valid", "invalid", "skipped"], description: "Result of HA core config validation" },
      validation_errors: { type: "string", description: "HA config validation error details" },
      deprecation_warnings: { type: "array", items: { type: "string" }, description: "Deprecation patterns detected" },
      template_results: {
        type: "array",
        items: {
          type: "object",
          properties: {
            template: { type: "string" },
            status: { type: "string", enum: ["valid", "error", "skipped"] },
            error: { type: "string" },
          },
        },
        description: "Template validation results",
      },
      structural_issues: { type: "array", items: { type: "string" }, description: "Structural YAML issues found" },
      suggestions: { type: "array", items: { type: "string" }, description: "Improvement suggestions" },
      file_written: { type: "boolean", description: "Whether the file was actually written to disk" },
      backup_restored: { type: "boolean", description: "Whether the backup was restored due to validation failure" },
    },
    required: ["success", "dry_run", "validation_result"],
  },
  
  area: {
    type: "object",
    properties: {
      id: { type: "string" },
      name: { type: "string" },
    },
    required: ["id", "name"],
  },
  
  areaArray: {
    type: "array",
    items: {
      type: "object",
      properties: {
        id: { type: "string" },
        name: { type: "string" },
      },
      required: ["id", "name"],
    },
  },
};

// ============================================================================
// INTELLIGENCE LAYER - imported from ./lib/intelligence.js
//   detectAnomaly, searchEntities, generateSuggestions, generateStateSummary
// ============================================================================

/**
 * Get entity relationships
 */
async function getEntityRelationships(entityId, prefetchedStates = null) {
  const states = prefetchedStates || await getCachedStates();
  const entity = states.find(s => s.entity_id === entityId);
  
  if (!entity) {
    return { error: "Entity not found" };
  }
  
  const [domain] = entityId.split(".");
  const deviceId = entity.attributes?.device_id;
  const areaId = entity.attributes?.area_id;
  
  const related = states.filter(s => {
    if (s.entity_id === entityId) return false;
    if (deviceId && s.attributes?.device_id === deviceId) return true;
    if (areaId && s.attributes?.area_id === areaId) return true;
    return false;
  }).map(s => ({
    entity_id: s.entity_id,
    friendly_name: s.attributes?.friendly_name,
    state: s.state,
    relationship: s.attributes?.device_id === deviceId ? "same_device" : "same_area",
  }));
  
  return {
    entity_id: entityId,
    friendly_name: entity.attributes?.friendly_name,
    state: entity.state,
    domain,
    device_class: entity.attributes?.device_class,
    device_id: deviceId,
    area_id: areaId,
    attributes: entity.attributes,
    related_entities: related.slice(0, 10),
  };
}

// ============================================================================
// DOCUMENTATION FETCHING HELPERS
// ============================================================================

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

// Parsed documentation cache â€” agents frequently re-request the same page,
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

/**
 * Extract meaningful content from HTML (basic extraction)
 */
// extractContentFromHtml, extractConfigurationSection, extractYamlExamples
// imported from ./lib/html-parser.js

/**
 * Load deprecation patterns from the shared JSON file (local bundled copy).
 * Returns compiled regex patterns ready for use.
 */
function loadLocalDeprecationPatterns() {
  try {
    const patternsPath = resolve(__dirname, "../shared/deprecation-patterns.json");
    const raw = readFileSync(patternsPath, "utf-8");
    const patterns = JSON.parse(raw);
    return patterns.map(p => ({
      ...p,
      pattern: new RegExp(p.pattern, p.flags || "m"),
    }));
  } catch (error) {
    console.error("Warning: Could not load local deprecation patterns:", error.message);
    return [];
  }
}

/**
 * GitHub URL for the latest deprecation patterns.
 * This allows pattern updates between app releases.
 */
const GITHUB_PATTERNS_URL = "https://raw.githubusercontent.com/umrath/hass-opencode/main/ha_opencode/rootfs/opt/shared/deprecation-patterns.json";

/**
 * HA Alerts JSON endpoint (public, no auth required).
 * Contains known integration issues with version ranges.
 */
const HA_ALERTS_URL = "https://alerts.home-assistant.io/alerts.json";

/**
 * Cache for dynamically loaded data with TTL.
 */
const dynamicCache = {
  patterns: { data: null, fetchedAt: 0, lastAttemptAt: 0 },
  alerts: { data: null, fetchedAt: 0, lastAttemptAt: 0 },
  repairs: { data: null, fetchedAt: 0, lastAttemptAt: 0 },
};
const DYNAMIC_CACHE_TTL = 3600000; // 1 hour
// Back off failed fetches so offline installs don't pay a full timeout on every call
const DYNAMIC_CACHE_RETRY_TTL = 600000; // 10 minutes

/**
 * Fetch the latest deprecation patterns from our GitHub repo.
 * Falls back to local bundled patterns if fetch fails.
 */
async function fetchRemoteDeprecationPatterns() {
  const now = Date.now();
  if (dynamicCache.patterns.data && (now - dynamicCache.patterns.fetchedAt) < DYNAMIC_CACHE_TTL) {
    return dynamicCache.patterns.data;
  }
  if ((now - dynamicCache.patterns.lastAttemptAt) < DYNAMIC_CACHE_RETRY_TTL) {
    return dynamicCache.patterns.data;
  }
  dynamicCache.patterns.lastAttemptAt = now;

  try {
    sendLog("debug", "patterns", { action: "fetch_remote", url: GITHUB_PATTERNS_URL });
    const response = await fetch(GITHUB_PATTERNS_URL, {
      headers: { "User-Agent": "HomeAssistant-MCP-Server/2.6.0", "Accept": "application/json" },
      signal: AbortSignal.timeout(5000),
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const patterns = await response.json();
    if (!Array.isArray(patterns) || patterns.length === 0) {
      throw new Error("Invalid patterns format");
    }
    
    const compiled = patterns.map(p => ({
      ...p,
      pattern: new RegExp(p.pattern, p.flags || "m"),
    }));
    
    dynamicCache.patterns.data = compiled;
    dynamicCache.patterns.fetchedAt = now;
    sendLog("info", "patterns", { action: "remote_loaded", count: compiled.length });
    return compiled;
  } catch (error) {
    sendLog("debug", "patterns", { action: "remote_fetch_failed", error: error.message });
    // Fall through to local patterns
    return null;
  }
}

/**
 * Fetch HA alerts from alerts.home-assistant.io (public JSON feed).
 * Returns alerts relevant to specific integrations with version info.
 */
async function fetchHAAlerts() {
  const now = Date.now();
  if (dynamicCache.alerts.data && (now - dynamicCache.alerts.fetchedAt) < DYNAMIC_CACHE_TTL) {
    return dynamicCache.alerts.data;
  }
  if ((now - dynamicCache.alerts.lastAttemptAt) < DYNAMIC_CACHE_RETRY_TTL) {
    return dynamicCache.alerts.data || [];
  }
  dynamicCache.alerts.lastAttemptAt = now;

  try {
    sendLog("debug", "alerts", { action: "fetch", url: HA_ALERTS_URL });
    const response = await fetch(HA_ALERTS_URL, {
      headers: { "User-Agent": "HomeAssistant-MCP-Server/2.6.0", "Accept": "application/json" },
      signal: AbortSignal.timeout(5000),
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const alerts = await response.json();
    dynamicCache.alerts.data = alerts;
    dynamicCache.alerts.fetchedAt = now;
    sendLog("info", "alerts", { action: "loaded", count: alerts.length });
    return alerts;
  } catch (error) {
    sendLog("debug", "alerts", { action: "fetch_failed", error: error.message });
    return dynamicCache.alerts.data || [];
  }
}

/**
 * Query HA Core's repair issues via WebSocket API.
 * Returns deprecations and issues specific to this installation.
 */
async function fetchHARepairs() {
  const now = Date.now();
  if (dynamicCache.repairs.data && (now - dynamicCache.repairs.fetchedAt) < DYNAMIC_CACHE_TTL) {
    return dynamicCache.repairs.data;
  }
  if ((now - dynamicCache.repairs.lastAttemptAt) < DYNAMIC_CACHE_RETRY_TTL) {
    return dynamicCache.repairs.data || [];
  }
  dynamicCache.repairs.lastAttemptAt = now;

  return new Promise((resolve) => {
    const wsUrl = "ws://supervisor/core/websocket";
    let msgId = 1;
    const timeout = setTimeout(() => {
      try { ws.close(); } catch (_) {}
      sendLog("debug", "repairs", { action: "ws_timeout" });
      resolve(dynamicCache.repairs.data || []);
    }, 5000);

    let ws;
    try {
      ws = new WebSocket(wsUrl);
    } catch (error) {
      clearTimeout(timeout);
      sendLog("debug", "repairs", { action: "ws_connect_failed", error: error.message });
      resolve(dynamicCache.repairs.data || []);
      return;
    }

    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString());
        
        // Step 1: HA sends auth_required
        if (msg.type === "auth_required") {
          ws.send(JSON.stringify({
            type: "auth",
            access_token: SUPERVISOR_TOKEN,
          }));
          return;
        }
        
        // Step 2: Auth result
        if (msg.type === "auth_ok") {
          ws.send(JSON.stringify({
            id: msgId++,
            type: "repairs/list_issues",
          }));
          return;
        }
        
        if (msg.type === "auth_invalid") {
          clearTimeout(timeout);
          ws.close();
          sendLog("debug", "repairs", { action: "auth_failed" });
          resolve(dynamicCache.repairs.data || []);
          return;
        }
        
        // Step 3: Repairs result
        if (msg.type === "result" && msg.success && msg.result?.issues) {
          clearTimeout(timeout);
          ws.close();
          const issues = msg.result.issues;
          dynamicCache.repairs.data = issues;
          dynamicCache.repairs.fetchedAt = now;
          sendLog("info", "repairs", { action: "loaded", count: issues.length });
          resolve(issues);
          return;
        }
        
        // Handle unexpected responses
        if (msg.type === "result" && !msg.success) {
          clearTimeout(timeout);
          ws.close();
          sendLog("debug", "repairs", { action: "api_error", error: msg.error });
          resolve(dynamicCache.repairs.data || []);
        }
      } catch (parseError) {
        // Ignore parse errors, wait for timeout
      }
    });

    ws.on("error", (error) => {
      clearTimeout(timeout);
      sendLog("debug", "repairs", { action: "ws_error", error: error.message });
      resolve(dynamicCache.repairs.data || []);
    });

    ws.on("close", () => {
      clearTimeout(timeout);
    });
  });
}
/**
 * Get the best available deprecation patterns.
 * Tries remote (GitHub) first, falls back to local bundled patterns.
 * This is called lazily on first use, not at module load time.
 */
async function getDeprecationPatterns() {
  // Try remote patterns first (cached for 1 hour)
  const remote = await fetchRemoteDeprecationPatterns();
  if (remote && remote.length > 0) {
    return remote;
  }
  // Fall back to local bundled patterns
  return DEPRECATION_PATTERNS;
}

/**
 * Get relevant HA alerts for a specific integration.
 * Returns alerts that affect the given integration on the current HA version.
 */
async function getAlertsForIntegration(integration, haVersion = null) {
  const alerts = await fetchHAAlerts();
  if (!alerts || !Array.isArray(alerts)) return [];
  
  return alerts.filter(alert => {
    // Check if this alert affects the given integration
    const integrations = alert.integrations || [];
    const matchesIntegration = integrations.some(i => 
      i.package === integration || i.package === `homeassistant.components.${integration}`
    );
    if (!matchesIntegration) return false;
    
    // If we know the HA version, check version range
    if (haVersion && alert.homeassistant) {
      const minVersion = alert.homeassistant.min || alert.homeassistant.affected_from_version;
      const maxVersion = alert.homeassistant.max || alert.homeassistant.resolved_in_version;
      // Simple string comparison works for CalVer (YYYY.M.P)
      if (minVersion && haVersion < minVersion) return false;
      if (maxVersion && haVersion >= maxVersion) return false;
    }
    
    return true;
  });
}

/**
 * Get relevant repair issues for a set of integrations.
 * Filters repairs to only those matching the given domains.
 */
async function getRepairsForDomains(domains) {
  const repairs = await fetchHARepairs();
  if (!repairs || !Array.isArray(repairs)) return [];
  
  if (!domains || domains.length === 0) return repairs;
  
  return repairs.filter(issue =>
    domains.includes(issue.domain) || domains.includes(issue.issue_domain)
  );
}

// Load local patterns synchronously at startup (always available as fallback)
const DEPRECATION_PATTERNS = loadLocalDeprecationPatterns();

/**
 * Check YAML configuration for deprecated patterns.
 * Uses the best available patterns (remote if cached, local as fallback).
 * Also checks HA alerts and repair issues for relevant warnings.
 */
async function checkConfigForDeprecations(yamlConfig, integration = null) {
  const warnings = [];
  const suggestions = [];
  let deprecated = false;

  // Get the best available patterns (tries remote/cached, falls back to local)
  // and fetch integration alerts concurrently
  const [patterns, alerts] = await Promise.all([
    getDeprecationPatterns(),
    integration ? getAlertsForIntegration(integration).catch(() => []) : Promise.resolve([]),
  ]);

  for (const pattern of patterns) {
    // Skip patterns not relevant to the specified integration
    if (integration && pattern.integration && pattern.integration !== integration) {
      continue;
    }
    
    if (pattern.pattern.test(yamlConfig)) {
      deprecated = deprecated || pattern.deprecated_in !== undefined;
      
      const severity = pattern.severity || (pattern.deprecated_in ? "warning" : "info");
      const warning = pattern.deprecated_in 
        ? `[DEPRECATED since ${pattern.deprecated_in}] ${pattern.message}`
        : `[INFO] ${pattern.message}`;
      
      warnings.push(warning);
      if (pattern.suggestion) {
        suggestions.push(pattern.suggestion);
      }
    }
  }
  
  // Check HA alerts for the specified integration
  for (const alert of alerts) {
    warnings.push(`[HA ALERT] ${alert.title || alert.id}: Known issue affecting '${integration}'. See: ${alert.alert_url || ""}`);
  }

  return { deprecated, warnings, suggestions };
}

// ============================================================================
// CONFIG VALIDATION HELPERS
// ============================================================================

/**
 * Extract Jinja2 templates from YAML content and validate each through HA's
 * template engine. Templates containing automation context variables (trigger.*,
 * this.*, etc.) are flagged as unverifiable rather than failed.
 */
async function extractAndValidateTemplates(yamlContent) {
  const results = [];
  
  // Match {{ ... }} template expressions (handles multiline)
  const templateRegex = /\{\{[\s\S]*?\}\}/g;
  // Match {% ... %} template blocks
  const blockRegex = /\{%[\s\S]*?%\}/g;
  
  const templates = new Set();
  
  let match;
  while ((match = templateRegex.exec(yamlContent)) !== null) {
    templates.add(match[0]);
  }
  while ((match = blockRegex.exec(yamlContent)) !== null) {
    templates.add(match[0]);
  }
  
  // Context variables that can't be validated statically
  const contextVars = [
    "trigger.", "this.", "context.", "wait.", "repeat.", "response.",
  ];

  const truncate = (t) => t.substring(0, 100) + (t.length > 100 ? "..." : "");

  const validateOne = async (template) => {
    if (contextVars.some(v => template.includes(v))) {
      return {
        template: truncate(template),
        status: "skipped",
        reason: "Contains runtime context variables (trigger/this/wait/repeat) that cannot be validated statically.",
      };
    }

    try {
      const rendered = await callHA("/template", "POST", { template });
      return {
        template: truncate(template),
        status: "valid",
        result: String(rendered).substring(0, 200),
      };
    } catch (error) {
      return {
        template: truncate(template),
        status: "error",
        error: error.message,
      };
    }
  };

  // Validate concurrently in small batches to avoid hammering HA core
  const queue = [...templates];
  const batchSize = 5;
  for (let i = 0; i < queue.length; i += batchSize) {
    results.push(...await Promise.all(queue.slice(i, i + batchSize).map(validateOne)));
  }

  return results;
}

// Content-validation results are memoized briefly so the recommended
// dry-run â†’ write workflow doesn't re-validate identical content twice
const validationMemo = new Map();
const VALIDATION_MEMO_TTL = 60000;

function getValidationMemo(key) {
  const hit = validationMemo.get(key);
  return hit && (Date.now() - hit.at) < VALIDATION_MEMO_TTL ? hit.data : null;
}

function setValidationMemo(key, data) {
  if (validationMemo.size >= 10) {
    validationMemo.delete(validationMemo.keys().next().value);
  }
  validationMemo.set(key, { data, at: Date.now() });
}

/**
 * Validate YAML structure for common HA configuration patterns.
 * Checks for required keys, correct nesting, and structural issues.
 * This is a lightweight structural check, not a full schema validation.
 */
// validateYamlStructure, resolveConfigPath imported from ./lib/validation.js
// createTextContent, createResourceLink imported from ./lib/helpers.js

// ============================================================================
// MCP SERVER SETUP
// ============================================================================

const server = new Server(
  {
    name: "home-assistant",
    version: "2.2.0",
  },
  {
    capabilities: {
      tools: {
        listChanged: false,
      },
      resources: {
        subscribe: false,
        listChanged: false,
      },
      prompts: {
        listChanged: false,
      },
      logging: {},
    },
  }
);

// ============================================================================
// TOOLS DEFINITION — provided by lib/tools.js
// ============================================================================

const TOOLS = defineTools(SCHEMAS);


// ============================================================================
// REQUEST HANDLERS
// ============================================================================

// --- Logging: Set Level ---
server.setRequestHandler(SetLevelRequestSchema, async (request) => {
  const { level } = request.params;
  if (LOG_LEVELS.includes(level)) {
    currentLogLevel = level;
    sendLog("info", "mcp-server", { action: "log_level_changed", level });
    return {};
  }
  throw new Error(`Invalid log level: ${level}`);
});

// --- List Tools ---
server.setRequestHandler(ListToolsRequestSchema, async () => {
  sendLog("debug", "mcp-server", { action: "list_tools" });
  // Strip newer MCP spec fields that some clients may not support
  // Keep only: name, description, inputSchema (standard fields)
  const compatibleTools = TOOLS.map(tool => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
  }));
  return { tools: compatibleTools };
});

// --- Call Tool ---
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  sendLog("info", "mcp-server", { action: "call_tool", tool: name, args });

  // Helper to strip unsupported MCP features from response for OpenCode compatibility
  const makeCompatibleResponse = (result) => {
    // Keep only standard fields: content, isError
    // Remove: structuredContent, resourceLinks (not supported by OpenCode)
    return {
      content: result.content,
      ...(result.isError && { isError: result.isError }),
    };
  };

  try {
    let result;
    switch (name) {
      // === STATE MANAGEMENT ===
      case "get_states": {
        if (args?.entity_id) {
          const state = await callHA(`/states/${args.entity_id}`);
          return makeCompatibleResponse({
            content: [
              createTextContent(JSON.stringify(state, null, 2), { audience: ["assistant"], priority: 0.8 }),
            ],
          });
        }
        
        let states = await getCachedStates();
        if (args?.domain) {
          states = states.filter((s) => s.entity_id.startsWith(`${args.domain}.`));
        }

        if (args?.summarize) {
          const summary = generateStateSummary(states);
          return makeCompatibleResponse({
            content: [createTextContent(summary, { audience: ["user", "assistant"], priority: 0.9 })],
          });
        }

        const simplified = states.map((s) => ({
          entity_id: s.entity_id,
          state: s.state,
          friendly_name: s.attributes?.friendly_name,
          device_class: s.attributes?.device_class,
        }));
        // Unfiltered dumps on large installs waste tokens; cap and point at the filters
        const CAP = 500;
        const truncated = !args?.domain && simplified.length > CAP;
        const payload = truncated
          ? `Showing ${CAP} of ${simplified.length} entities (use domain or summarize to narrow):\n` +
            JSON.stringify(simplified.slice(0, CAP))
          : JSON.stringify(simplified);
        return makeCompatibleResponse({
          content: [createTextContent(payload, { audience: ["assistant"], priority: 0.7 })],
        });
      }

      case "search_entities": {
        const states = await getCachedStates();
        const results = searchEntities(states, args.query);
        
        return makeCompatibleResponse({
          content: [
            createTextContent(
              results.length > 0 
                ? JSON.stringify(results, null, 2)
                : `No entities found matching "${args.query}"`,
              { audience: ["assistant"], priority: 0.8 }
            ),
          ],
        });
      }

      case "get_entity_details": {
        const relationships = await getEntityRelationships(args.entity_id);
        return makeCompatibleResponse({
          content: [createTextContent(JSON.stringify(relationships, null, 2), { audience: ["assistant"], priority: 0.8 })],
        });
      }

      // === SERVICE CALLS ===
      case "call_service": {
        const { domain, service, target, data } = args;
        sendLog("notice", "ha-service", { action: "call", domain, service, target });
        
        const payload = { ...data };
        if (target) {
          Object.assign(payload, target);
        }
        const result = await callHA(`/services/${domain}/${service}`, "POST", payload);
        invalidateStatesCache();

        return makeCompatibleResponse({
          content: [
            createTextContent(
              `Service ${domain}.${service} called successfully.\n${JSON.stringify(result, null, 2)}`,
              { audience: ["user", "assistant"], priority: 0.9 }
            ),
          ],
        });
      }

      case "get_services": {
        const services = await callHA("/services");
        if (args?.domain) {
          const filtered = services.filter((s) => s.domain === args.domain);
          return makeCompatibleResponse({
            content: [createTextContent(JSON.stringify(filtered, null, 2), { audience: ["assistant"], priority: 0.6 })],
          });
        }
        // Full catalog with field docs is enormous; unfiltered calls get the
        // domain/service index and a hint to re-query with a domain
        const index = services.map((s) => ({
          domain: s.domain,
          services: Object.keys(s.services || {}),
        }));
        return makeCompatibleResponse({
          content: [createTextContent(
            `Service index (${index.length} domains). Pass domain for full schemas.\n` +
            JSON.stringify(index),
            { audience: ["assistant"], priority: 0.6 }
          )],
        });
      }

      // === HISTORY & LOGBOOK ===
      case "get_history": {
        const entityId = args.entity_id;
        const startTime = args.start_time || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const params = new URLSearchParams({ filter_entity_id: entityId });
        if (args.end_time) params.append("end_time", args.end_time);
        // Full attribute payloads are opt-in; minimal keeps chatty sensors cheap
        if (args.minimal !== false) {
          params.append("minimal_response", "true");
          params.append("no_attributes", "true");
        }

        const history = await callHA(`/history/period/${encodeURIComponent(startTime)}?${params}`);
        return makeCompatibleResponse({
          content: [createTextContent(JSON.stringify(history), { audience: ["assistant"], priority: 0.7 })],
        });
      }

      case "get_logbook": {
        const startTime = args.start_time || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const params = new URLSearchParams();
        if (args.entity_id) params.append("entity", args.entity_id);
        if (args.end_time) params.append("end_time", args.end_time);

        const logbook = await callHA(`/logbook/${encodeURIComponent(startTime)}?${params}`);
        return makeCompatibleResponse({
          content: [createTextContent(JSON.stringify(logbook), { audience: ["assistant"], priority: 0.7 })],
        });
      }

      // === CONFIGURATION ===
      case "get_config": {
        const config = await callHA("/config");
        return makeCompatibleResponse({
          content: [createTextContent(JSON.stringify(config, null, 2), { audience: ["assistant"], priority: 0.6 })],
        });
      }

      case "get_areas": {
        const areas = await getRegistry("config/area_registry/list");
        const result = JSON.stringify(areas.map((a) => ({ id: a.area_id, name: a.name })));
        return makeCompatibleResponse({
          content: [createTextContent(result, { audience: ["assistant"], priority: 0.7 })],
        });
      }

      case "get_devices": {
        let devices = await getRegistry("config/device_registry/list");
        if (args?.area_id) {
          devices = devices.filter((d) => d.area_id === args.area_id);
        }
        const result = JSON.stringify(devices.map((d) => ({
          id: d.id,
          name: d.name_by_user || d.name,
          manufacturer: d.manufacturer,
          model: d.model,
          ...(args?.area_id ? {} : { area: d.area_id }),
        })));
        return makeCompatibleResponse({
          content: [createTextContent(result, { audience: ["assistant"], priority: 0.6 })],
        });
      }

      case "validate_config": {
        const result = await callHA("/config/core/check_config", "POST", null, CHECK_CONFIG_TIMEOUT_MS);
        return makeCompatibleResponse({
          content: [
            createTextContent(
              JSON.stringify(result, null, 2),
              { audience: ["user", "assistant"], priority: 0.9 }
            ),
          ],
        });
      }

      case "get_error_log": {
        // Supervisor proxies http://supervisor/core/api/* to HA's /api/*
        const log = await callHA("/error_log");
        const lines = args?.lines || 100;
        const logLines = log.split("\n").slice(-lines).join("\n");
        return makeCompatibleResponse({
          content: [createTextContent(logLines, { audience: ["assistant"], priority: 0.8 })],
        });
      }

      // === EVENTS & TEMPLATES ===
      case "fire_event": {
        const { event_type, event_data } = args;
        sendLog("notice", "ha-event", { action: "fire", event_type });
        await callHA(`/events/${event_type}`, "POST", event_data || {});
        return makeCompatibleResponse({
          content: [createTextContent(`Event '${event_type}' fired successfully.`, { audience: ["user"], priority: 0.9 })],
        });
      }

      case "render_template": {
        const result = await callHA("/template", "POST", { template: args.template });
        return makeCompatibleResponse({
          content: [createTextContent(result, { audience: ["assistant"], priority: 0.8 })],
        });
      }

      // === CALENDARS ===
      case "get_calendars": {
        const calendars = await callHA("/calendars");
        return makeCompatibleResponse({
          content: [createTextContent(JSON.stringify(calendars, null, 2), { audience: ["assistant"], priority: 0.6 })],
        });
      }

      case "get_calendar_events": {
        const { calendar_entity } = args;
        const start = args.start || new Date().toISOString();
        const end = args.end || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
        const events = await callHA(
          `/calendars/${calendar_entity}?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`
        );
        return makeCompatibleResponse({
          content: [createTextContent(JSON.stringify(events, null, 2), { audience: ["assistant"], priority: 0.7 })],
        });
      }

      // === INTELLIGENCE ===
      case "detect_anomalies": {
        let states = await getCachedStates();
        if (args?.domain) {
          states = states.filter((s) => s.entity_id.startsWith(`${args.domain}.`));
        }
        
        const anomalies = states
          .map(detectAnomaly)
          .filter(Boolean)
          .sort((a, b) => (b.severity === "warning" ? 1 : 0) - (a.severity === "warning" ? 1 : 0));
        
        if (anomalies.length === 0) {
          return makeCompatibleResponse({
            content: [createTextContent("No anomalies detected. All entities appear to be operating normally.", { audience: ["user"], priority: 0.9 })],
          });
        }
        
        return makeCompatibleResponse({
          content: [
            createTextContent(
              `Found ${anomalies.length} potential anomalies:\n\n${JSON.stringify(anomalies, null, 2)}`,
              { audience: ["user", "assistant"], priority: 0.9 }
            ),
          ],
        });
      }

      case "get_suggestions": {
        const states = await getCachedStates();
        const suggestions = generateSuggestions(states);
        
        if (suggestions.length === 0) {
          return makeCompatibleResponse({
            content: [createTextContent("No suggestions at this time. Your Home Assistant setup looks well configured!", { audience: ["user"], priority: 0.8 })],
          });
        }
        
        return makeCompatibleResponse({
          content: [createTextContent(JSON.stringify(suggestions, null, 2), { audience: ["user", "assistant"], priority: 0.8 })],
        });
      }

      case "diagnose_entity": {
        const { entity_id } = args;
        sendLog("info", "diagnostics", { action: "diagnose", entity_id });
        
        const diagnostics = {
          entity_id,
          timestamp: new Date().toISOString(),
          checks: [],
        };
        
        try {
          const startTime = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
          const params = new URLSearchParams({
            filter_entity_id: entity_id,
            minimal_response: "true",
          });
          // One states fetch serves both the entity lookup and relationships;
          // history runs concurrently
          const [states, history] = await Promise.all([
            getCachedStates(),
            callHA(`/history/period/${encodeURIComponent(startTime)}?${params}`),
          ]);

          const state = states.find(s => s.entity_id === entity_id);
          if (!state) {
            throw new Error(`Entity ${entity_id} not found`);
          }
          diagnostics.current_state = state;
          diagnostics.checks.push({ check: "Current State", status: "ok", details: state.state });

          if (state.state === "unavailable" || state.state === "unknown") {
            diagnostics.checks.push({
              check: "Availability",
              status: "warning",
              details: `Entity is ${state.state}. Check device connectivity.`
            });
          }

          const relationships = await getEntityRelationships(entity_id, states);
          diagnostics.relationships = relationships;
          diagnostics.checks.push({
            check: "Relationships",
            status: "ok",
            details: `Found ${relationships.related_entities?.length || 0} related entities`
          });
          
          if (history && history[0]) {
            const stateChanges = history[0].length;
            diagnostics.history_summary = {
              state_changes_24h: stateChanges,
              last_changed: state.last_changed,
              last_updated: state.last_updated,
            };
            
            diagnostics.checks.push({ 
              check: "Activity", 
              status: stateChanges === 0 ? "info" : "ok", 
              details: stateChanges === 0 ? "No state changes in last 24 hours" : `${stateChanges} state changes in last 24 hours`
            });
          }
          
          const anomaly = detectAnomaly(state);
          if (anomaly) {
            diagnostics.checks.push({ 
              check: "Anomaly Detection", 
              status: anomaly.severity, 
              details: anomaly.reason 
            });
          }
          
        } catch (error) {
          diagnostics.checks.push({ 
            check: "Entity Lookup", 
            status: "error", 
            details: error.message 
          });
        }
        
        return makeCompatibleResponse({
          content: [createTextContent(JSON.stringify(diagnostics, null, 2), { audience: ["assistant"], priority: 0.9 })],
        });
      }

      // === DOCUMENTATION ===
      case "get_integration_docs": {
        const { integration, section = "configuration" } = args;
        sendLog("info", "docs", { action: "get_integration_docs", integration, section });
        
        const url = `${HA_INTEGRATIONS_URL}/${integration}/`;

        // Resolve the HA version while the docs page is fetched/parsed
        const versionPromise = callHA("/config")
          .then((config) => config.version || "unknown")
          .catch((e) => {
            sendLog("warning", "docs", { action: "version_fetch_failed", error: e.message });
            return "unknown";
          });
        let haVersion = "unknown";

        try {
          const cacheKey = `integration-docs:${integration}:${section}`;
          let parsed = getCachedDoc(cacheKey);
          if (!parsed) {
            const html = await fetchUrl(url);
            const { title, description, content } = extractContentFromHtml(html);

            let resultContent = content;
            const examples = extractYamlExamples(content);

            // Filter to configuration section if requested
            if (section === "configuration") {
              const configSection = extractConfigurationSection(content);
              if (configSection) {
                resultContent = configSection;
              }
            } else if (section === "examples" && examples.length > 0) {
              resultContent = "## YAML Examples\n\n" + examples.map((ex, i) => `### Example ${i + 1}\n\`\`\`yaml\n${ex}\n\`\`\``).join("\n\n");
            }

            parsed = {
              title: title || integration,
              resultContent: resultContent.substring(0, 15000), // Limit content size
              fetched_at: new Date().toISOString(),
            };
            setCachedDoc(cacheKey, parsed);
          }
          haVersion = await versionPromise;

          return makeCompatibleResponse({
            content: [
              createTextContent(
                `# ${parsed.title}\n\n` +
                `**Integration:** ${integration}\n` +
                `**Docs URL:** ${url}\n` +
                `**Your HA Version:** ${haVersion}\n` +
                `**Fetched:** ${parsed.fetched_at}\n\n` +
                `---\n\n${parsed.resultContent}`,
                { audience: ["assistant"], priority: 0.9 }
              ),
            ],
          });
        } catch (error) {
          haVersion = await versionPromise;
          // Provide helpful fallback if docs can't be fetched
          return makeCompatibleResponse({
            content: [
              createTextContent(
                `Unable to fetch documentation for '${integration}'.\n\n` +
                `**Docs URL:** ${url}\n` +
                `**Error:** ${error.message}\n\n` +
                `**Suggestion:** You can:\n` +
                `1. Try visiting the URL directly: ${url}\n` +
                `2. Check if the integration name is correct\n` +
                `3. Use \`validate_config\` to check your configuration\n\n` +
                `**Your HA Version:** ${haVersion}`,
                { audience: ["assistant"], priority: 0.8 }
              ),
            ],
          });
        }
      }

      case "get_breaking_changes": {
        const { integration, version } = args;
        sendLog("info", "docs", { action: "get_breaking_changes", integration, version });
        
        let haVersion = "unknown";
        try {
          const config = await callHA("/config");
          haVersion = config.version || "unknown";
        } catch (e) {
          sendLog("warning", "docs", { action: "version_fetch_failed", error: e.message });
        }
        
        // Build a list of known breaking changes (curated, since parsing release notes is complex)
        // This provides immediate value without complex web scraping
        const knownBreakingChanges = [
          {
            version: "2024.12",
            title: "Template sensor/binary_sensor syntax change",
            description: "Legacy 'platform: template' under sensor/binary_sensor is deprecated. Use top-level 'template:' key.",
            integration: "template",
            url: "https://www.home-assistant.io/integrations/template/",
          },
          {
            version: "2024.11",
            title: "MQTT discovery changes",
            description: "MQTT discovery payload format updated for better device support.",
            integration: "mqtt",
            url: "https://www.home-assistant.io/integrations/mqtt/",
          },
          {
            version: "2024.10",
            title: "REST sensor authentication",
            description: "REST sensors now support digest authentication; some configurations may need updating.",
            integration: "rest",
            url: "https://www.home-assistant.io/integrations/rest/",
          },
          {
            version: "2024.8",
            title: "Automation trigger variables",
            description: "Trigger variables are now more strictly typed in automations.",
            integration: "automation",
            url: "https://www.home-assistant.io/docs/automation/trigger/",
          },
          {
            version: "2024.6",
            title: "Time & Date sensor deprecation",
            description: "The time_date platform is deprecated. Use template sensors with now() instead.",
            integration: "time_date",
            url: "https://www.home-assistant.io/integrations/time_date/",
          },
          {
            version: "2024.4",
            title: "Template switch/cover/fan syntax",
            description: "Template platforms for switch, cover, and fan can now use the top-level 'template:' key.",
            integration: "template",
            url: "https://www.home-assistant.io/integrations/template/",
          },
          {
            version: "2024.1",
            title: "Legacy template sensor syntax deprecated",
            description: "The 'platform: template' syntax under sensor: is deprecated in favor of the template: integration.",
            integration: "template",
            url: "https://www.home-assistant.io/integrations/template/",
          },
          {
            version: "2023.12",
            title: "Entity naming convention changes",
            description: "Entities now follow stricter naming conventions. Some entity IDs may have changed.",
            integration: null,
            url: "https://www.home-assistant.io/blog/2023/12/",
          },
          {
            version: "2023.8",
            title: "entity_namespace deprecated",
            description: "The entity_namespace option is deprecated. Use unique_id instead.",
            integration: null,
            url: "https://www.home-assistant.io/blog/2023/08/",
          },
          {
            version: "2023.3",
            title: "white_value deprecated in light services",
            description: "Use 'white' instead of 'white_value' in light service calls.",
            integration: "light",
            url: "https://www.home-assistant.io/integrations/light/",
          },
        ];
        
        // Filter by integration if specified
        let filteredChanges = knownBreakingChanges;
        if (integration) {
          filteredChanges = knownBreakingChanges.filter(
            c => c.integration === integration || c.integration === null
          );
        }
        
        // Filter by version if specified
        if (version) {
          filteredChanges = filteredChanges.filter(c => c.version === version);
        }
        
        // Try to fetch the release notes page for additional context
        let releaseNotesContent = "";
        const targetVersion = version || haVersion.split(".").slice(0, 2).join(".");

        const notesCacheKey = `release-notes:${targetVersion}`;
        const cachedNotes = getCachedDoc(notesCacheKey);
        if (cachedNotes !== null) {
          releaseNotesContent = cachedNotes;
        } else {
          try {
            const releaseUrl = `${HA_BLOG_URL}/${targetVersion.replace(".", "/")}/`;
            const html = await fetchUrl(releaseUrl);
            const { content } = extractContentFromHtml(html);

            // Extract breaking changes section if present
            const breakingMatch = content.match(/breaking changes?[\s\S]*?(?=\n## |$)/i);
            if (breakingMatch) {
              releaseNotesContent = breakingMatch[0].substring(0, 5000);
            }
            setCachedDoc(notesCacheKey, releaseNotesContent);
          } catch (e) {
            sendLog("debug", "docs", { action: "release_notes_fetch_failed", error: e.message });
          }
        }
        
        const result = {
          ha_version: haVersion,
          queried_version: version || "recent",
          queried_integration: integration || "all",
          changes: filteredChanges,
          release_notes_excerpt: releaseNotesContent || null,
        };
        
        let responseText = `# Breaking Changes\n\n` +
          `**Your HA Version:** ${haVersion}\n` +
          `**Queried:** ${integration ? `integration '${integration}'` : "all integrations"}` +
          `${version ? ` for version ${version}` : ""}\n\n`;
        
        if (filteredChanges.length > 0) {
          responseText += `## Known Breaking Changes\n\n`;
          for (const change of filteredChanges) {
            responseText += `### ${change.version}: ${change.title}\n`;
            responseText += `${change.description}\n`;
            responseText += `**More info:** ${change.url}\n\n`;
          }
        } else {
          responseText += `No specific breaking changes found for the query.\n\n`;
        }
        
        if (releaseNotesContent) {
          responseText += `## From Release Notes\n\n${releaseNotesContent}\n`;
        }
        
        responseText += `\n---\n**Tip:** Always check ${HA_BLOG_URL}/categories/release-notes/ for the latest changes.`;
        
        return makeCompatibleResponse({
          content: [createTextContent(responseText, { audience: ["assistant"], priority: 0.9 })],
        });
      }

      case "check_config_syntax": {
        const { yaml_config, integration } = args;
        sendLog("info", "docs", { action: "check_config_syntax", integration });
        
        const { deprecated, warnings, suggestions } = await checkConfigForDeprecations(yaml_config, integration);
        
        // Additional basic YAML validation hints
        const additionalWarnings = [];
        const additionalSuggestions = [];
        
        // Check for common YAML issues
        if (yaml_config.includes("\t")) {
          additionalWarnings.push("Tab characters detected. YAML requires spaces for indentation.");
          additionalSuggestions.push("Replace all tabs with spaces (2 spaces per indent level is standard for Home Assistant).");
        }
        
        if (!/^[a-z_]+:/m.test(yaml_config)) {
          additionalWarnings.push("No top-level key detected. Configuration should start with a domain key.");
        }
        
        // Check for common mistakes
        if (/: \|$/m.test(yaml_config)) {
          additionalSuggestions.push("Multi-line strings with '|' should have content on the following lines, indented.");
        }
        
        if (/entity_id:.*,/m.test(yaml_config)) {
          additionalSuggestions.push("Multiple entity_ids should be formatted as a YAML list, not comma-separated.");
        }
        
        const allWarnings = [...warnings, ...additionalWarnings];
        const allSuggestions = [...suggestions, ...additionalSuggestions];
        
        const docsUrl = integration 
          ? `${HA_INTEGRATIONS_URL}/${integration}/`
          : "https://www.home-assistant.io/docs/configuration/";
        
        const result = {
          valid: allWarnings.filter(w => w.includes("DEPRECATED")).length === 0,
          deprecated,
          warnings: allWarnings,
          suggestions: allSuggestions,
          docs_url: docsUrl,
        };
        
        let responseText = `# Configuration Syntax Check\n\n`;
        responseText += `**Status:** ${result.valid ? "OK" : "Issues Found"}\n`;
        responseText += `**Deprecated Syntax:** ${deprecated ? "Yes" : "No"}\n`;
        responseText += `**Docs:** ${docsUrl}\n\n`;
        
        if (allWarnings.length > 0) {
          responseText += `## Warnings\n\n`;
          for (const warning of allWarnings) {
            responseText += `- ${warning}\n`;
          }
          responseText += "\n";
        }
        
        if (allSuggestions.length > 0) {
          responseText += `## Suggestions\n\n`;
          for (const suggestion of allSuggestions) {
            responseText += `- ${suggestion}\n`;
          }
          responseText += "\n";
        }
        
        if (allWarnings.length === 0 && allSuggestions.length === 0) {
          responseText += "No issues detected in the configuration syntax.\n\n";
          responseText += "**Note:** This is a basic syntax check. Use `validate_config` for full Home Assistant validation.\n";
        }
        
        return makeCompatibleResponse({
          content: [createTextContent(responseText, { audience: ["assistant"], priority: 0.9 })],
        });
      }

      // === SAFE CONFIG WRITER ===
      case "write_config_safe": {
        const { file_path, content, dry_run = false, validate_templates = true, confirm_deletions = false } = args;
        sendLog("info", "config", { action: "write_config_safe", file_path, dry_run });
        
        // Step 1: Validate and resolve the file path
        const resolvedPath = resolveConfigPath(file_path);
        if (!resolvedPath) {
          return makeCompatibleResponse({
            content: [createTextContent(
              `# Safe Config Write - BLOCKED\n\n` +
              `**Error:** Invalid or unsafe file path: \`${file_path}\`\n\n` +
              `The path must be relative to /homeassistant/ and cannot point to internal directories (.storage, .cloud, deps, etc.).\n` +
              `Example valid paths: \`configuration.yaml\`, \`automations.yaml\`, \`packages/lights.yaml\``,
              { audience: ["user", "assistant"], priority: 1.0 }
            )],
            isError: true,
          });
        }
        
        // Steps 2-6 depend only on the content â€” reuse a recent dry-run's results
        const memoKey = createHash("sha256").update(`${validate_templates}:${content}`).digest("hex");
        let contentChecks = getValidationMemo(memoKey);

        if (!contentChecks) {
          // Step 3: Run structural YAML checks
          const structuralIssues = validateYamlStructure(content);

          // Step 4: Basic YAML lint checks (same as check_config_syntax)
          const lintWarnings = [];
          if (content.includes("\t")) {
            lintWarnings.push("Tab characters detected. YAML requires spaces for indentation.");
          }
          if (/: \|$/m.test(content)) {
            lintWarnings.push("Multi-line strings with '|' should have content on the following lines, indented.");
          }
          if (/entity_id:.*,/m.test(content)) {
            lintWarnings.push("Multiple entity_ids should be formatted as a YAML list, not comma-separated.");
          }

          // Steps 2 (deprecations), 5 (repairs), and 6 (templates) are
          // independent network checks â€” run them concurrently
          const [deprecationResult, repairWarnings, templateResults] = await Promise.all([
            checkConfigForDeprecations(content),
            (async () => {
              const warnings = [];
              try {
                // Extract integration domains from the YAML content
                const domainMatches = content.match(/^([a-z_]+):/gm);
                const domains = domainMatches
                  ? [...new Set(domainMatches.map(m => m.replace(":", "").trim()))]
                  : [];

                if (domains.length > 0) {
                  const repairs = await getRepairsForDomains(domains);
                  for (const issue of repairs) {
                    const breaksIn = issue.breaks_in_ha_version ? ` (breaks in ${issue.breaks_in_ha_version})` : "";
                    const url = issue.learn_more_url ? ` See: ${issue.learn_more_url}` : "";
                    warnings.push(
                      `[HA REPAIR - ${issue.severity || "warning"}] ${issue.domain}: ${issue.translation_key || issue.issue_id}${breaksIn}${url}`
                    );
                  }
                }
              } catch (_) { /* non-critical â€” repairs check is best-effort */ }
              return warnings;
            })(),
            (async () => {
              if (!validate_templates) return [];
              try {
                return await extractAndValidateTemplates(content);
              } catch (error) {
                sendLog("warning", "config", { action: "template_validation_failed", error: error.message });
                return [{ template: "(all)", status: "skipped", reason: `Template validation unavailable: ${error.message}` }];
              }
            })(),
          ]);

          contentChecks = { deprecationResult, structuralIssues, lintWarnings, repairWarnings, templateResults };
          setValidationMemo(memoKey, contentChecks);
        }

        const { warnings: depWarnings, suggestions: depSuggestions } = contentChecks.deprecationResult;
        const { structuralIssues, lintWarnings, repairWarnings, templateResults } = contentChecks;

        const templateErrors = templateResults.filter(r => r.status === "error");
        const structuralErrors = structuralIssues.filter(i => i.severity === "error");
        
        // Step 6b: Content protection checks â€” prevent accidental data loss
        // These checks compare the new content against the existing file to catch
        // cases where the AI writes a replacement instead of an augmentation.
        // Three layers of defense:
        //   1. List-entry reduction  (automations.yaml, scripts.yaml, scenes.yaml)
        //   2. Top-level key removal (mapping files like configuration.yaml)
        //   3. Significant size reduction (generic safety net for all files)
        let contentProtectionError = null;

        if (!confirm_deletions && existsSync(resolvedPath)) {
          try {
            const existingContent = readFileSync(resolvedPath, "utf-8");

            // --- Check 1: List-entry reduction (list-based config files) ---
            const LIST_CONFIG_FILES = ["automations.yaml", "scripts.yaml", "scenes.yaml"];
            const isListConfig = LIST_CONFIG_FILES.some(f => resolvedPath.endsWith("/" + f));

            if (isListConfig) {
              const existingCount = (existingContent.match(/^- /gm) || []).length;
              const newCount = (content.match(/^- /gm) || []).length;
              if (existingCount > 0 && newCount < existingCount) {
                contentProtectionError = {
                  type: "entry_reduction",
                  detail: `The existing file has ${existingCount} top-level list entries but the new content only has ${newCount} (${existingCount - newCount} would be lost).`,
                  action: `Read the existing \`${file_path}\` first, then include ALL existing entries plus your changes in the content you write. If you intentionally want to remove entries, pass \`confirm_deletions: true\`.`,
                };
              }
            }

            // --- Check 2: Top-level key preservation (mapping-based files) ---
            // For files like configuration.yaml that use top-level keys (homeassistant:,
            // automation:, sensor:, etc.), block writes that would remove existing keys.
            if (!contentProtectionError && !isListConfig) {
              const keyRegex = /^([a-z_][a-z0-9_]*):/gm;
              const existingKeys = new Set();
              const newKeys = new Set();
              let m;
              while ((m = keyRegex.exec(existingContent)) !== null) existingKeys.add(m[1]);
              keyRegex.lastIndex = 0;
              while ((m = keyRegex.exec(content)) !== null) newKeys.add(m[1]);

              const removedKeys = [...existingKeys].filter(k => !newKeys.has(k));
              if (existingKeys.size > 0 && removedKeys.length > 0) {
                contentProtectionError = {
                  type: "key_removal",
                  detail: `The existing file has ${existingKeys.size} top-level keys but the new content is missing ${removedKeys.length}: \`${removedKeys.join("`, `")}\`.`,
                  action: `Read the existing \`${file_path}\` first, then include ALL existing top-level keys plus your changes. If you intentionally want to remove keys, pass \`confirm_deletions: true\`.`,
                };
              }
            }

            // --- Check 3: Significant size reduction (generic safety net) ---
            // For ANY config file, if the new content is dramatically smaller than
            // the existing file, it likely means the AI didn't read the file first.
            if (!contentProtectionError) {
              const existingLines = existingContent.split("\n").length;
              const newLines = content.split("\n").length;
              if (existingLines > 10 && newLines < existingLines * 0.5) {
                contentProtectionError = {
                  type: "size_reduction",
                  detail: `The existing file has ${existingLines} lines but the new content only has ${newLines} lines (${Math.round((1 - newLines / existingLines) * 100)}% reduction).`,
                  action: `Read the existing \`${file_path}\` first and ensure your new content includes all intended configuration. If this reduction is intentional, pass \`confirm_deletions: true\`.`,
                };
              }
            }

          } catch (_) { /* best effort â€” don't block if we can't read the existing file */ }
        }

        // Step 6c: Check for pre-write blocking errors (template errors + structural errors + content protection)
        const hasBlockingErrors = templateErrors.length > 0 || structuralErrors.length > 0 || contentProtectionError !== null;
        
        // If dry_run, report results without touching disk
        if (dry_run) {
          let responseText = `# Safe Config Write - Dry Run\n\n`;
          responseText += `**File:** \`${file_path}\`\n`;
          responseText += `**Mode:** Validation only (no file changes)\n\n`;
          
          if (hasBlockingErrors) {
            responseText += `## BLOCKING ERRORS (must fix before writing)\n\n`;
            for (const te of templateErrors) {
              responseText += `- **Template Error:** \`${te.template}\` - ${te.error}\n`;
            }
            for (const si of structuralErrors) {
              responseText += `- **Structural Error:** ${si.message}\n`;
            }
            if (contentProtectionError) {
              const label = contentProtectionError.type === "entry_reduction" ? "Entry Reduction Blocked"
                : contentProtectionError.type === "key_removal" ? "Top-Level Key Removal Blocked"
                : "Significant Size Reduction Blocked";
              responseText += `- **${label}:** ${contentProtectionError.detail}\n`;
              responseText += `  **Action:** ${contentProtectionError.action}\n`;
            }
            responseText += `\n`;
          }
          
          if (depWarnings.length > 0) {
            responseText += `## Deprecation Warnings\n\n`;
            for (const w of depWarnings) responseText += `- ${w}\n`;
            responseText += `\n`;
          }
          
          if (lintWarnings.length > 0) {
            responseText += `## Lint Warnings\n\n`;
            for (const w of lintWarnings) responseText += `- ${w}\n`;
            responseText += `\n`;
          }
          
          const structuralWarnings = structuralIssues.filter(i => i.severity === "warning");
          if (structuralWarnings.length > 0) {
            responseText += `## Structural Warnings\n\n`;
            for (const w of structuralWarnings) responseText += `- ${w.message}\n`;
            responseText += `\n`;
          }
          
          if (repairWarnings.length > 0) {
            responseText += `## HA Repair Issues (from your installation)\n\n`;
            for (const w of repairWarnings) responseText += `- ${w}\n`;
            responseText += `\n`;
          }
          
          if (templateResults.length > 0) {
            const validTemplates = templateResults.filter(r => r.status === "valid");
            const skippedTemplates = templateResults.filter(r => r.status === "skipped");
            responseText += `## Template Validation\n\n`;
            responseText += `- Valid: ${validTemplates.length}\n`;
            responseText += `- Errors: ${templateErrors.length}\n`;
            responseText += `- Skipped (runtime context): ${skippedTemplates.length}\n\n`;
          }
          
          if (depSuggestions.length > 0) {
            responseText += `## Suggestions\n\n`;
            for (const s of depSuggestions) responseText += `- ${s}\n`;
            responseText += `\n`;
          }
          
          const dryRunPassed = !hasBlockingErrors;
          responseText += `---\n**Result:** ${dryRunPassed ? "PASSED - Safe to write" : "FAILED - Fix errors above before writing"}\n`;
          
          if (dryRunPassed && (depWarnings.length > 0 || lintWarnings.length > 0 || repairWarnings.length > 0)) {
            responseText += `**Note:** Warnings were found but won't block writing. Consider addressing them for best practices.\n`;
          }
          
          return makeCompatibleResponse({
            content: [createTextContent(responseText, { audience: ["assistant"], priority: 1.0 })],
          });
        }
        
        // Step 7: If blocking errors exist, refuse to write
        if (hasBlockingErrors) {
          let responseText = `# Safe Config Write - REFUSED\n\n`;
          responseText += `**File:** \`${file_path}\`\n`;
          responseText += `**Reason:** Blocking errors detected. File was NOT written.\n\n`;
          responseText += `## Errors (must fix)\n\n`;
          for (const te of templateErrors) {
            responseText += `- **Template Error:** \`${te.template}\` - ${te.error}\n`;
          }
          for (const si of structuralErrors) {
            responseText += `- **Structural Error:** ${si.message}\n`;
          }
          if (contentProtectionError) {
            const label = contentProtectionError.type === "entry_reduction" ? "Entry Reduction Blocked"
              : contentProtectionError.type === "key_removal" ? "Top-Level Key Removal Blocked"
              : "Significant Size Reduction Blocked";
            responseText += `- **${label}:** ${contentProtectionError.detail}\n`;
            responseText += `\n**Action:** ${contentProtectionError.action}\n`;
          } else {
            responseText += `\n**Action:** Fix the errors above and retry. Use \`dry_run: true\` to validate before writing.\n`;
          }
          
          return makeCompatibleResponse({
            content: [createTextContent(responseText, { audience: ["assistant"], priority: 1.0 })],
          });
        }
        
        // Step 8: Backup existing file (if it exists)
        const backupPath = resolvedPath + ".bak";
        let hadExistingFile = false;
        try {
          if (existsSync(resolvedPath)) {
            copyFileSync(resolvedPath, backupPath);
            hadExistingFile = true;
            sendLog("info", "config", { action: "backup_created", path: backupPath });
          }
        } catch (error) {
          return makeCompatibleResponse({
            content: [createTextContent(
              `# Safe Config Write - ERROR\n\n` +
              `**Error:** Could not create backup of existing file: ${error.message}\n` +
              `File was NOT modified.`,
              { audience: ["user", "assistant"], priority: 1.0 }
            )],
            isError: true,
          });
        }
        
        // Step 9: Write the new content
        try {
          // Ensure parent directory exists
          const parentDir = dirname(resolvedPath);
          if (!existsSync(parentDir)) {
            mkdirSync(parentDir, { recursive: true });
          }
          writeFileSync(resolvedPath, content, "utf-8");
          sendLog("info", "config", { action: "file_written", path: resolvedPath });
        } catch (error) {
          // Restore backup if write failed
          if (hadExistingFile) {
            try { copyFileSync(backupPath, resolvedPath); } catch (_) { /* best effort */ }
          }
          return makeCompatibleResponse({
            content: [createTextContent(
              `# Safe Config Write - ERROR\n\n` +
              `**Error:** Could not write file: ${error.message}\n` +
              `${hadExistingFile ? "Original file has been restored from backup." : "No file was created."}`,
              { audience: ["user", "assistant"], priority: 1.0 }
            )],
            isError: true,
          });
        }
        
        // Step 10: Run HA's full config validation
        let validationResult = "skipped";
        let validationErrors = "";
        let backupRestored = false;
        
        try {
          const haCheck = await callHA("/config/core/check_config", "POST", null, CHECK_CONFIG_TIMEOUT_MS);
          validationResult = haCheck.result || "valid";
          validationErrors = haCheck.errors || "";
          
          if (validationResult === "invalid") {
            sendLog("warning", "config", { action: "validation_failed", errors: validationErrors });
            
            // Restore the backup
            if (hadExistingFile) {
              try {
                copyFileSync(backupPath, resolvedPath);
                backupRestored = true;
                sendLog("info", "config", { action: "backup_restored", path: resolvedPath });
              } catch (restoreError) {
                sendLog("error", "config", { action: "backup_restore_failed", error: restoreError.message });
              }
            } else {
              // No original file existed - remove the invalid one
              try {
                unlinkSync(resolvedPath);
                backupRestored = true;
              } catch (_) { /* best effort */ }
            }
          }
        } catch (error) {
          sendLog("error", "config", { action: "validation_call_failed", error: error.message });
          validationResult = "skipped";
          validationErrors = `Could not run HA config check: ${error.message}`;
          
          // Cannot confirm the config is valid â€” restore backup same as "invalid"
          if (hadExistingFile) {
            try {
              copyFileSync(backupPath, resolvedPath);
              backupRestored = true;
              sendLog("info", "config", { action: "backup_restored", path: resolvedPath });
            } catch (restoreError) {
              sendLog("error", "config", { action: "backup_restore_failed", error: restoreError.message });
            }
          } else {
            // No original file existed â€” remove the unvalidated one
            try {
              unlinkSync(resolvedPath);
              backupRestored = true;
            } catch (_) { /* best effort */ }
          }
        }
        
        // Retain .bak file as a recovery point â€” do NOT delete on success.
        // The backup always contains the file content from right before this write.
        // The next write_config_safe call to this file will overwrite it with the
        // then-current version, so there is always one recovery point available.
        
        // Step 11: Build response
        const success = validationResult === "valid";
        let responseText = `# Safe Config Write - ${success ? "SUCCESS" : "FAILED"}\n\n`;
        responseText += `**File:** \`${file_path}\`\n`;
        responseText += `**HA Config Validation:** ${validationResult}\n`;
        responseText += `**File Written:** ${success ? "Yes" : "No (restored original)"}\n\n`;
        
        if (!success) {
          responseText += `## Validation Errors\n\n`;
          responseText += `\`\`\`\n${validationErrors}\n\`\`\`\n\n`;
          responseText += `**The original file has been restored.** Fix the errors above and retry.\n\n`;
          
          // Include any error log entries that might help
          try {
            const log = await callHA("/error_log");
            const recentLines = log.split("\n").slice(-20).join("\n");
            if (recentLines.trim()) {
              responseText += `## Recent Error Log\n\n\`\`\`\n${recentLines}\n\`\`\`\n\n`;
            }
          } catch (_) { /* best effort */ }
        }
        
        if (depWarnings.length > 0) {
          responseText += `## Deprecation Warnings\n\n`;
          for (const w of depWarnings) responseText += `- ${w}\n`;
          responseText += `\n`;
        }
        
        if (lintWarnings.length > 0) {
          responseText += `## Lint Warnings\n\n`;
          for (const w of lintWarnings) responseText += `- ${w}\n`;
          responseText += `\n`;
        }
        
        const structuralWarnings = structuralIssues.filter(i => i.severity === "warning");
        if (structuralWarnings.length > 0) {
          responseText += `## Structural Warnings\n\n`;
          for (const w of structuralWarnings) responseText += `- ${w.message}\n`;
          responseText += `\n`;
        }
        
        if (repairWarnings.length > 0) {
          responseText += `## HA Repair Issues (from your installation)\n\n`;
          for (const w of repairWarnings) responseText += `- ${w}\n`;
          responseText += `\n`;
        }
        
        if (templateResults.length > 0) {
          const validCount = templateResults.filter(r => r.status === "valid").length;
          const skippedCount = templateResults.filter(r => r.status === "skipped").length;
          responseText += `## Template Validation: ${validCount} valid, ${skippedCount} skipped (runtime context)\n\n`;
        }
        
        if (depSuggestions.length > 0) {
          responseText += `## Suggestions\n\n`;
          for (const s of depSuggestions) responseText += `- ${s}\n`;
          responseText += `\n`;
        }
        
        if (success) {
          responseText += `---\n**Config is valid and has been written to disk.** You can reload or restart HA to apply changes.\n`;
        }
        
        return makeCompatibleResponse({
          content: [createTextContent(responseText, { audience: ["user", "assistant"], priority: 1.0 })],
          ...((!success) && { isError: true }),
        });
      }

      // === UPDATE MANAGEMENT ===
      case "get_available_updates": {
        const component = args?.component || "all";
        sendLog("info", "updates", { action: "check_updates", component });
        
        const updates = [];

        // The component checks are independent â€” fetch them concurrently
        const wants = (c) => component === "all" || component === c;
        const [coreResult, osResult, supResult, addonsResult] = await Promise.allSettled([
          wants("core") ? callSupervisor("/core/info") : Promise.resolve(null),
          wants("os") ? callSupervisor("/os/info") : Promise.resolve(null),
          wants("supervisor") ? callSupervisor("/supervisor/info") : Promise.resolve(null),
          wants("addons") ? callSupervisor("/addons") : Promise.resolve(null),
        ]);

        if (coreResult.status === "fulfilled" && coreResult.value) {
          const coreInfo = coreResult.value;
          updates.push({
            type: "core",
            name: "Home Assistant Core",
            installed: coreInfo.version,
            latest: coreInfo.version_latest,
            update_available: coreInfo.update_available,
          });
        } else if (coreResult.status === "rejected") {
          sendLog("warning", "updates", { action: "core_check_failed", error: coreResult.reason?.message });
        }

        // OS info not available on supervised installs
        if (osResult.status === "fulfilled" && osResult.value?.version) {
          const osInfo = osResult.value;
          updates.push({
            type: "os",
            name: "Home Assistant OS",
            installed: osInfo.version,
            latest: osInfo.version_latest,
            update_available: osInfo.update_available,
          });
        } else if (osResult.status === "rejected") {
          sendLog("debug", "updates", { action: "os_not_available" });
        }

        if (supResult.status === "fulfilled" && supResult.value) {
          const supInfo = supResult.value;
          updates.push({
            type: "supervisor",
            name: "Home Assistant Supervisor",
            installed: supInfo.version,
            latest: supInfo.version_latest,
            update_available: supInfo.update_available,
          });
        } else if (supResult.status === "rejected") {
          sendLog("warning", "updates", { action: "supervisor_check_failed", error: supResult.reason?.message });
        }

        if (addonsResult.status === "fulfilled" && addonsResult.value) {
          for (const addon of addonsResult.value.addons.filter(a => a.installed)) {
            updates.push({
              type: "addon",
              slug: addon.slug,
              name: addon.name,
              installed: addon.version,
              latest: addon.version_latest,
              update_available: addon.update_available,
            });
          }
        } else if (addonsResult.status === "rejected") {
          sendLog("warning", "updates", { action: "addons_check_failed", error: addonsResult.reason?.message });
        }
        
        // Format output
        const pendingUpdates = updates.filter(u => u.update_available);
        let responseText = `# Available Updates\n\n`;
        responseText += `**Checked:** ${new Date().toISOString()}\n`;
        responseText += `**Updates Available:** ${pendingUpdates.length}\n\n`;
        
        if (pendingUpdates.length > 0) {
          responseText += `## Pending Updates\n\n`;
          for (const u of pendingUpdates) {
            responseText += `- **${u.name}** ${u.type === 'addon' ? `(${u.slug})` : ''}: ${u.installed} â†’ ${u.latest}\n`;
          }
          responseText += `\n`;
        }
        
        responseText += `## All Components\n\n`;
        responseText += `| Component | Type | Installed | Latest | Update |\n`;
        responseText += `|-----------|------|-----------|--------|--------|\n`;
        for (const u of updates) {
          responseText += `| ${u.name} | ${u.type} | ${u.installed} | ${u.latest} | ${u.update_available ? 'â¬†ï¸ Yes' : 'âœ“ Current'} |\n`;
        }
        
        return makeCompatibleResponse({
          content: [createTextContent(responseText, { audience: ["user", "assistant"], priority: 0.9 })],
        });
      }

      case "get_addon_changelog": {
        const { addon_slug } = args;
        sendLog("info", "updates", { action: "get_changelog", addon: addon_slug });
        
        try {
          const [addonInfo, changelog] = await Promise.all([
            callSupervisor(`/addons/${addon_slug}/info`),
            callSupervisor(`/addons/${addon_slug}/changelog`),
          ]);
          
          let responseText = `# Changelog: ${addonInfo.name}\n\n`;
          responseText += `**Current Version:** ${addonInfo.version}\n`;
          responseText += `**Latest Version:** ${addonInfo.version_latest}\n`;
          responseText += `**Update Available:** ${addonInfo.update_available ? 'Yes' : 'No'}\n\n`;
          responseText += `---\n\n`;
          responseText += changelog;
          
          return makeCompatibleResponse({
            content: [createTextContent(responseText, { audience: ["user", "assistant"], priority: 0.8 })],
          });
        } catch (e) {
          throw new Error(`Failed to get changelog for '${addon_slug}': ${e.message}`);
        }
      }

      case "update_component": {
        const { component, addon_slug, backup = true } = args;
        sendLog("notice", "updates", { action: "initiate_update", component, addon_slug, backup });
        
        // Prevent self-update
        if (component === "addon" && addon_slug === "local_ha_opencode") {
          throw new Error("Cannot update OpenCode from within itself. The container will be stopped during update. Please use the Home Assistant UI to update this app.");
        }
        
        let endpoint;
        let payload = { background: true };
        let componentName;
        
        switch (component) {
          case "core":
            endpoint = "/core/update";
            payload.backup = backup;
            componentName = "Home Assistant Core";
            break;
          case "os":
            endpoint = "/os/update";
            componentName = "Home Assistant OS";
            break;
          case "supervisor":
            endpoint = "/supervisor/update";
            componentName = "Supervisor";
            break;
          case "addon":
            if (!addon_slug) {
              throw new Error("addon_slug is required when component is 'addon'");
            }
            endpoint = `/store/addons/${addon_slug}/update`;
            payload.backup = backup;
            componentName = addon_slug;
            break;
          default:
            throw new Error(`Unknown component type: ${component}`);
        }
        
        try {
          const result = await callSupervisor(endpoint, "POST", payload, UPDATE_TIMEOUT_MS);

          // Background mode returns job_id
          const jobId = result?.job_id || result;
          
          let responseText = `# Update Initiated\n\n`;
          responseText += `**Component:** ${componentName}\n`;
          responseText += `**Job ID:** ${jobId}\n`;
          responseText += `**Backup:** ${backup ? 'Yes' : 'No'}\n\n`;
          responseText += `## Monitor Progress\n\n`;
          responseText += `Use \`get_update_progress\` with job_id \`${jobId}\` to monitor the update.\n\n`;
          responseText += `**Example:** \`get_update_progress({ job_id: "${jobId}" })\`\n`;
          
          return makeCompatibleResponse({
            content: [createTextContent(responseText, { audience: ["user", "assistant"], priority: 1.0 })],
          });
        } catch (e) {
          throw new Error(`Failed to initiate update for ${componentName}: ${e.message}`);
        }
      }

      case "get_update_progress": {
        const { job_id } = args;
        sendLog("debug", "updates", { action: "check_progress", job_id });
        
        try {
          const job = await callSupervisor(`/jobs/${job_id}`);
          
          let statusEmoji;
          if (job.done) {
            statusEmoji = job.errors ? "âŒ" : "âœ…";
          } else {
            statusEmoji = "â³";
          }
          
          let responseText = `# Job Progress: ${job_id}\n\n`;
          responseText += `**Status:** ${statusEmoji} ${job.done ? (job.errors ? 'Failed' : 'Completed') : 'In Progress'}\n`;
          responseText += `**Name:** ${job.name}\n`;
          responseText += `**Progress:** ${job.progress || 0}%\n`;
          
          if (job.stage) {
            responseText += `**Stage:** ${job.stage}\n`;
          }
          
          if (job.reference) {
            responseText += `**Reference:** ${job.reference}\n`;
          }
          
          responseText += `\n`;
          
          // Progress bar visualization
          const progressBar = "â–ˆ".repeat(Math.floor((job.progress || 0) / 5)) + "â–‘".repeat(20 - Math.floor((job.progress || 0) / 5));
          responseText += `**[${progressBar}] ${job.progress || 0}%**\n\n`;
          
          if (job.child_jobs && job.child_jobs.length > 0) {
            responseText += `## Sub-tasks\n\n`;
            for (const child of job.child_jobs) {
              const childStatus = child.done ? (child.errors ? "âŒ" : "âœ…") : "â³";
              responseText += `- ${childStatus} ${child.name}: ${child.progress || 0}%\n`;
            }
            responseText += `\n`;
          }
          
          if (job.errors) {
            responseText += `## Errors\n\n`;
            responseText += `\`\`\`\n${JSON.stringify(job.errors, null, 2)}\n\`\`\`\n`;
          }
          
          if (!job.done) {
            responseText += `---\n\n*Poll again in a few seconds to see updated progress.*\n`;
          }
          
          return makeCompatibleResponse({
            content: [createTextContent(responseText, { audience: ["user", "assistant"], priority: 0.9 })],
          });
        } catch (e) {
          throw new Error(`Failed to get job progress: ${e.message}`);
        }
      }

      case "get_running_jobs": {
        sendLog("debug", "updates", { action: "list_jobs" });
        
        try {
          const jobsInfo = await callSupervisor("/jobs/info");
          const jobs = jobsInfo.jobs || [];
          
          let responseText = `# Supervisor Jobs\n\n`;
          responseText += `**Total Jobs:** ${jobs.length}\n\n`;
          
          if (jobs.length === 0) {
            responseText += `*No running or recent jobs found.*\n`;
          } else {
            const runningJobs = jobs.filter(j => !j.done);
            const completedJobs = jobs.filter(j => j.done);
            
            if (runningJobs.length > 0) {
              responseText += `## Running Jobs\n\n`;
              responseText += `| Job ID | Name | Progress | Stage |\n`;
              responseText += `|--------|------|----------|-------|\n`;
              for (const job of runningJobs) {
                responseText += `| ${job.uuid.substring(0, 8)}... | ${job.name} | ${job.progress || 0}% | ${job.stage || '-'} |\n`;
              }
              responseText += `\n`;
            }
            
            if (completedJobs.length > 0) {
              responseText += `## Completed Jobs\n\n`;
              responseText += `| Job ID | Name | Status |\n`;
              responseText += `|--------|------|--------|\n`;
              for (const job of completedJobs.slice(0, 10)) {
                const status = job.errors ? "âŒ Failed" : "âœ… Success";
                responseText += `| ${job.uuid.substring(0, 8)}... | ${job.name} | ${status} |\n`;
              }
            }
          }
          
          return makeCompatibleResponse({
            content: [createTextContent(responseText, { audience: ["user", "assistant"], priority: 0.7 })],
          });
        } catch (e) {
          throw new Error(`Failed to list jobs: ${e.message}`);
        }
      }

      // === ESPHOME INTEGRATION ===
      case "esphome_list_devices": {
        sendLog("info", "esphome", { action: "list_devices" });
        
        if (!HA_ACCESS_TOKEN) {
          throw new Error(ESPHOME_TOKEN_ERROR);
        }
        
        // Discover ESPHome app
        const esphome = await getESPHomeConnection();
        if (!esphome.ok) {
          const d = esphome.diagnostics;
          let msg = `ESPHome discovery failed: ${esphome.error}\n\n`;
          msg += `## Discovery Steps\n`;
          for (const s of d.steps) {
            msg += `- **${s.name}**: ${s.status}${s.detail ? ` â€” ${typeof s.detail === "object" ? JSON.stringify(s.detail) : s.detail}` : ""}\n`;
          }
          if (d.esphomeSlugs) msg += `\nESPHome-matching slugs: ${JSON.stringify(d.esphomeSlugs)}`;
          if (d.networkFallback) msg += `\nNetwork fallback data: ${JSON.stringify(d.networkFallback, null, 2)}`;
          throw new Error(msg);
        }
        
        if (esphome.state !== "started") {
          throw new Error(`ESPHome app is not running (current state: ${esphome.state}). Please start the ESPHome app first.`);
        }
        
        try {
          const devices = await getESPHomeDevices(esphome.url, esphome.ingressSession);
          
          let responseText = `# ESPHome Devices\n\n`;
          responseText += `**ESPHome Version:** ${esphome.version}\n`;
          responseText += `**Add-on:** ${esphome.name} (${esphome.slug})\n`;
          responseText += `**Ingress URL:** ${esphome.url}\n`;
          responseText += `**URL Source:** ${esphome.diagnostics?.urlSource || "unknown"}\n\n`;
          
          const configured = devices.configured || [];
          const importable = devices.importable || [];
          
          if (configured.length === 0 && importable.length === 0) {
            responseText += `*No ESPHome devices configured yet.*\n\n`;
            responseText += `Create a new device in the ESPHome dashboard to get started.\n`;
          } else {
            if (configured.length > 0) {
              responseText += `## Configured Devices (${configured.length})\n\n`;
              responseText += `| Device | Platform | Current | Deployed | Status |\n`;
              responseText += `|--------|----------|---------|----------|--------|\n`;
              
              for (const device of configured) {
                const needsUpdate = device.current_version !== device.deployed_version;
                const status = needsUpdate ? "â¬†ï¸ Update available" : "âœ“ Current";
                responseText += `| ${device.name} | ${device.target_platform} | ${device.current_version || '-'} | ${device.deployed_version || '-'} | ${status} |\n`;
              }
              responseText += `\n`;
            }
            
            if (importable.length > 0) {
              responseText += `## Discoverable Devices (${importable.length})\n\n`;
              responseText += `These devices can be adopted into ESPHome:\n\n`;
              for (const device of importable) {
                responseText += `- **${device.name}** (${device.project_name} v${device.project_version}) - ${device.network}\n`;
              }
            }
          }
          
          return makeCompatibleResponse({
            content: [createTextContent(responseText, { audience: ["user", "assistant"], priority: 0.8 })],
          });
        } catch (e) {
          const d = esphome.diagnostics;
          let msg = `${e.message}\n\n## Discovery was OK\n`;
          msg += `**URL:** ${esphome.url}\n`;
          msg += `**URL Source:** ${d?.urlSource || "unknown"}\n`;
          msg += `**HA Core URL:** ${d?.haCoreUrl || "unknown"}\n`;
          msg += `**Ingress Entry:** ${d?.ingressEntry || "unknown"}\n`;
          msg += `**Addon Slug:** ${d?.addonSlug || "unknown"}\n`;
          if (d?.steps) {
            msg += `\n## Discovery Steps\n`;
            for (const s of d.steps) {
              msg += `- **${s.name}**: ${s.status}${s.detail ? ` â€” ${typeof s.detail === "object" ? JSON.stringify(s.detail) : s.detail}` : ""}\n`;
            }
          }
          if (d?.networkFallback) msg += `\nNetwork fallback: ${JSON.stringify(d.networkFallback, null, 2)}`;
          throw new Error(msg);
        }
      }

      case "esphome_compile": {
        const { device } = args;
        sendLog("info", "esphome", { action: "compile", device });
        
        if (!HA_ACCESS_TOKEN) {
          throw new Error(ESPHOME_TOKEN_ERROR);
        }
        
        // Discover ESPHome app
        const esphome = await getESPHomeConnection();
        if (!esphome.ok) {
          const d = esphome.diagnostics;
          let msg = `ESPHome discovery failed: ${esphome.error}\n\nSteps: `;
          msg += d.steps.map(s => `${s.name}=${s.status}`).join(", ");
          throw new Error(msg);
        }
        
        if (esphome.state !== "started") {
          throw new Error(`ESPHome app is not running (current state: ${esphome.state}). Please start the ESPHome app first.`);
        }
        
        // Ensure device has .yaml extension
        const configuration = device.endsWith(".yaml") ? device : `${device}.yaml`;
        
        try {
          const result = await streamESPHomeLogs(
            esphome.url,
            "compile",
            { configuration },
            null,
            600000,  // 10 minute timeout for compilation
            esphome.ingressSession
          );
          
          // Format the output
          let responseText = `# ESPHome Compile: ${device}\n\n`;
          responseText += `**Status:** ${result.success ? "âœ… Success" : "âŒ Failed"}\n`;
          responseText += `**Duration:** ${result.duration}\n`;
          responseText += `**Exit Code:** ${result.code}\n\n`;
          
          responseText += `## Build Log\n\n`;
          responseText += "```\n";
          
          // Truncate logs if too long (keep last 200 lines for errors, first 50 for context)
          const logs = result.logs;
          if (logs.length > 300) {
            responseText += logs.slice(0, 50).join("\n");
            responseText += `\n\n... (${logs.length - 250} lines omitted) ...\n\n`;
            responseText += logs.slice(-200).join("\n");
          } else {
            responseText += logs.join("\n");
          }
          
          responseText += "\n```\n";
          
          if (!result.success) {
            responseText += `\n## Troubleshooting\n\n`;
            responseText += `The compilation failed. Check the build log above for errors.\n`;
            responseText += `Common issues:\n`;
            responseText += `- Syntax errors in YAML configuration\n`;
            responseText += `- Missing or incompatible components\n`;
            responseText += `- Platform-specific issues\n`;
          }
          
          return makeCompatibleResponse({
            content: [createTextContent(responseText, { audience: ["user", "assistant"], priority: 0.9 })],
          });
        } catch (e) {
          throw new Error(`ESPHome compile failed: ${e.message}`);
        }
      }

      case "esphome_upload": {
        const { device, port } = args;
        sendLog("info", "esphome", { action: "upload", device, port });
        
        if (!HA_ACCESS_TOKEN) {
          throw new Error(ESPHOME_TOKEN_ERROR);
        }
        
        // Discover ESPHome app
        const esphome = await getESPHomeConnection();
        if (!esphome.ok) {
          const d = esphome.diagnostics;
          let msg = `ESPHome discovery failed: ${esphome.error}\n\nSteps: `;
          msg += d.steps.map(s => `${s.name}=${s.status}`).join(", ");
          throw new Error(msg);
        }
        
        if (esphome.state !== "started") {
          throw new Error(`ESPHome app is not running (current state: ${esphome.state}). Please start the ESPHome app first.`);
        }
        
        // Ensure device has .yaml extension
        const configuration = device.endsWith(".yaml") ? device : `${device}.yaml`;
        
        try {
          const result = await streamESPHomeLogs(
            esphome.url,
            "upload",
            { configuration, port },
            null,
            300000,  // 5 minute timeout for upload
            esphome.ingressSession
          );
          
          // Format the output
          let responseText = `# ESPHome Upload: ${device}\n\n`;
          responseText += `**Status:** ${result.success ? "âœ… Success" : "âŒ Failed"}\n`;
          responseText += `**Target:** ${port}\n`;
          responseText += `**Duration:** ${result.duration}\n`;
          responseText += `**Exit Code:** ${result.code}\n\n`;
          
          responseText += `## Upload Log\n\n`;
          responseText += "```\n";
          
          // Truncate logs if too long
          const logs = result.logs;
          if (logs.length > 200) {
            responseText += logs.slice(0, 30).join("\n");
            responseText += `\n\n... (${logs.length - 130} lines omitted) ...\n\n`;
            responseText += logs.slice(-100).join("\n");
          } else {
            responseText += logs.join("\n");
          }
          
          responseText += "\n```\n";
          
          if (result.success) {
            responseText += `\n## Next Steps\n\n`;
            responseText += `The firmware has been uploaded successfully. The device should restart automatically.\n`;
            responseText += `You can verify the device is online using \`esphome_list_devices\`.\n`;
          } else {
            responseText += `\n## Troubleshooting\n\n`;
            responseText += `The upload failed. Common issues:\n`;
            responseText += `- Device not reachable (check network connectivity)\n`;
            responseText += `- Wrong port/IP address\n`;
            responseText += `- Device in deep sleep mode\n`;
            responseText += `- Firewall blocking OTA port (default: 3232)\n`;
          }
          
          return makeCompatibleResponse({
            content: [createTextContent(responseText, { audience: ["user", "assistant"], priority: 0.9 })],
          });
        } catch (e) {
          throw new Error(`ESPHome upload failed: ${e.message}`);
        }
      }

      // === FIRMWARE UPDATE MONITORING ===
      case "watch_firmware_update": {
        const { entity_id, start_update = false } = args;
        sendLog("info", "firmware-update", { action: "watch", entity_id, start_update });
        
        // Validate entity_id format
        if (!entity_id.startsWith("update.")) {
          throw new Error(`Invalid entity_id: ${entity_id}. Must be an update entity (update.xxx)`);
        }
        
        const formatTime = (date) => date.toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
        
        // Get current state
        let entityState = await callHA(`/states/${entity_id}`);
        const attrs = entityState.attributes || {};
        const installedVersion = attrs.installed_version || "unknown";
        const latestVersion = attrs.latest_version || "unknown";
        const deviceName = attrs.friendly_name || entity_id.replace("update.", "");
        const inProgress = attrs.in_progress === true;
        const progress = attrs.update_percentage;
        const currentState = entityState.state;
        
        let responseText = `# Firmware Update: ${deviceName}\n\n`;
        responseText += `**Entity:** \`${entity_id}\`\n`;
        responseText += `**Time:** ${formatTime(new Date())}\n\n`;
        
        // Determine status and take action
        let statusEmoji, statusText;
        
        if (inProgress) {
          statusEmoji = "â³";
          statusText = "Update In Progress";
          responseText += `## ${statusEmoji} ${statusText}\n\n`;
          responseText += `| Field | Value |\n`;
          responseText += `|-------|-------|\n`;
          responseText += `| Installed Version | ${installedVersion} |\n`;
          responseText += `| Target Version | ${latestVersion} |\n`;
          if (progress !== null && progress !== undefined) {
            const filled = Math.floor(progress / 5);
            const empty = 20 - filled;
            responseText += `| Progress | ${"â–ˆ".repeat(filled)}${"â–‘".repeat(empty)} ${progress}% |\n`;
          } else {
            responseText += `| Progress | Compiling/Installing (no percentage reported) |\n`;
          }
          responseText += `\n**The update is running.** Call this tool again in a few seconds to check progress.\n`;
          
        } else if (currentState === "unavailable") {
          statusEmoji = "ðŸ”„";
          statusText = "Device Rebooting";
          responseText += `## ${statusEmoji} ${statusText}\n\n`;
          responseText += `The device is currently unavailable - likely rebooting after firmware update.\n\n`;
          responseText += `**Wait a minute and call this tool again** to check if the device comes back online.\n`;
          
        } else if (currentState === "off") {
          statusEmoji = "âœ…";
          statusText = "Up to Date";
          responseText += `## ${statusEmoji} ${statusText}\n\n`;
          responseText += `| Field | Value |\n`;
          responseText += `|-------|-------|\n`;
          responseText += `| Installed Version | ${installedVersion} |\n`;
          responseText += `| Latest Version | ${latestVersion} |\n`;
          responseText += `\nNo update available. The device is running the latest version.\n`;
          
        } else if (currentState === "on") {
          // Update is available
          if (start_update) {
            // Start the update
            await callHA("/services/update/install", "POST", { entity_id }, UPDATE_TIMEOUT_MS);
            
            statusEmoji = "ðŸš€";
            statusText = "Update Started";
            responseText += `## ${statusEmoji} ${statusText}\n\n`;
            responseText += `| Field | Value |\n`;
            responseText += `|-------|-------|\n`;
            responseText += `| Current Version | ${installedVersion} |\n`;
            responseText += `| Target Version | ${latestVersion} |\n`;
            responseText += `\n**Update has been initiated!**\n\n`;
            responseText += `The device will now download and install the firmware. This typically takes 1-5 minutes.\n\n`;
            responseText += `**Call this tool again** (without \`start_update\`) to monitor progress.\n`;
          } else {
            statusEmoji = "â¬†ï¸";
            statusText = "Update Available";
            responseText += `## ${statusEmoji} ${statusText}\n\n`;
            responseText += `| Field | Value |\n`;
            responseText += `|-------|-------|\n`;
            responseText += `| Installed Version | ${installedVersion} |\n`;
            responseText += `| Available Version | ${latestVersion} |\n`;
            responseText += `\nAn update is available but not yet started.\n\n`;
            responseText += `**To start the update**, call this tool with \`start_update: true\`.\n`;
          }
        } else {
          statusEmoji = "â“";
          statusText = `Unknown State: ${currentState}`;
          responseText += `## ${statusEmoji} ${statusText}\n\n`;
          responseText += `The device is in an unexpected state. Check the Home Assistant UI for more details.\n`;
        }
        
        return makeCompatibleResponse({
          content: [createTextContent(responseText, { audience: ["user", "assistant"], priority: 0.9 })],
        });
      }

      // === HAB CLI INTEGRATION ===
      case "hab_run": {
        const { command } = args;
        if (!command || typeof command !== "string") {
          throw new Error("command parameter is required and must be a string");
        }
        
        // Security: block dangerous commands
        const lowerCmd = command.toLowerCase().trim();
        if (lowerCmd.startsWith("auth ") || lowerCmd === "auth") {
          throw new Error("Auth commands are not needed - hab is pre-authenticated via Supervisor token.");
        }
        if (lowerCmd.startsWith("update") && !lowerCmd.startsWith("update ")) {
          throw new Error("Self-update of hab is not supported inside the container. hab is updated with the app.");
        }
        
        sendLog("info", "hab", { action: "run_command", command });
        
        // Parse command string into args array for execFile (safe, no shell injection)
        const cmdArgs = command.match(/(?:[^\s"']+|"[^"]*"|'[^']*')/g) || [];
        // Strip quotes from args
        const cleanArgs = cmdArgs.map(arg => arg.replace(/^["']|["']$/g, ""));
        
        // For esphome subcommands, pre-discover the ESPHome ingress URL so
        // hab can skip its own (broken direct-connection) discovery and route
        // through the Supervisor ingress proxy instead.
        let esphomeEnv = {};
        if (lowerCmd.startsWith("esphome ") || lowerCmd === "esphome") {
          if (!HA_ACCESS_TOKEN) {
            throw new Error(ESPHOME_TOKEN_ERROR);
          }
          try {
            const esphome = await getESPHomeConnection();
            if (esphome.ok && esphome.url && esphome.ingressSession) {
              esphomeEnv.HAB_ESPHOME_URL = esphome.url;
              esphomeEnv.HAB_ESPHOME_SESSION = esphome.ingressSession;
            } else if (!esphome.ok) {
              sendLog("warning", "hab", {
                action: "esphome_prediscovery_failed",
                error: esphome.error,
                steps: esphome.diagnostics?.steps,
              });
            }
          } catch (e) {
            sendLog("warning", "hab", { action: "esphome_prediscovery_failed", error: e.message });
          }
        }
        
        const result = await new Promise((resolvePromise, rejectPromise) => {
          const proc = execFile("/usr/local/bin/hab", cleanArgs, {
            timeout: 30000,
            maxBuffer: 1024 * 1024,
            env: {
              ...process.env,
              SUPERVISOR_TOKEN: SUPERVISOR_TOKEN,
              HAB_URL: "http://supervisor/core",
              HAB_TOKEN: SUPERVISOR_TOKEN,
              ...(HA_ACCESS_TOKEN ? { HA_ACCESS_TOKEN } : {}),
              ...esphomeEnv,
            },
          }, (error, stdout, stderr) => {
            if (error) {
              // hab may return non-zero exit code with useful output
              const output = stdout || stderr || error.message;
              rejectPromise(new Error(`hab command failed: ${output}`));
            } else {
              resolvePromise(stdout);
            }
          });
        });
        
        // Try to parse as JSON for structured output
        let responseText;
        try {
          const parsed = JSON.parse(result);
          responseText = "```json\n" + JSON.stringify(parsed, null, 2) + "\n```";
        } catch {
          // Not JSON, return as plain text
          responseText = result.trim();
        }
        
        return makeCompatibleResponse({
          content: [createTextContent(responseText, { audience: ["user", "assistant"], priority: 0.7 })],
        });
      }

      // === ZIGPORTER CLI INTEGRATION ===
      case "zigporter_run": {
        const { command } = args;
        if (!command || typeof command !== "string") {
          throw new Error("command parameter is required and must be a string");
        }

        // Security: block interactive/dangerous commands
        const zigLowerCmd = command.toLowerCase().trim();
        if (zigLowerCmd.startsWith("migrate") || zigLowerCmd === "migrate") {
          throw new Error(
            "The migrate command requires physical device interaction and cannot be " +
            "run by an AI agent. Use it from the terminal instead."
          );
        }
        if (zigLowerCmd.startsWith("setup") || zigLowerCmd === "setup") {
          throw new Error(
            "Setup is not needed - zigporter is pre-configured via Supervisor credentials."
          );
        }

        sendLog("info", "zigporter", { action: "run_command", command });

        // Parse command string into args array for execFile (safe, no shell injection)
        const zigCmdArgs =
          command.match(/(?:[^\s"']+|"[^"]*"|'[^']*')/g) || [];
        const zigCleanArgs = zigCmdArgs.map((arg) =>
          arg.replace(/^["']|["']$/g, "")
        );

        const zigResult = await new Promise((resolvePromise, rejectPromise) => {
          execFile(
            "/usr/local/bin/zigporter",
            zigCleanArgs,
            {
              timeout: 60000,
              maxBuffer: 2 * 1024 * 1024,
              env: {
                ...process.env,
                // zigporter uses HA_URL + HA_TOKEN (set in /data/.env_vars at init)
                // Ensure they're available even if sourcing didn't propagate
                HA_URL: process.env.HA_URL || "http://supervisor/core",
                HA_TOKEN: process.env.HA_TOKEN || process.env.SUPERVISOR_TOKEN,
                HA_VERIFY_SSL: "false",
                // Z2M config (optional, may be empty)
                ...(process.env.Z2M_URL
                  ? { Z2M_URL: process.env.Z2M_URL }
                  : {}),
                ...(process.env.Z2M_MQTT_TOPIC
                  ? { Z2M_MQTT_TOPIC: process.env.Z2M_MQTT_TOPIC }
                  : {}),
              },
            },
            (error, stdout, stderr) => {
              if (error) {
                const output = stdout || stderr || error.message;
                rejectPromise(
                  new Error(`zigporter command failed: ${output}`)
                );
              } else {
                resolvePromise(stdout);
              }
            }
          );
        });

        // Try to parse as JSON for structured output
        let zigResponseText;
        try {
          const parsed = JSON.parse(zigResult);
          zigResponseText =
            "```json\n" + JSON.stringify(parsed, null, 2) + "\n```";
        } catch {
          // Not JSON, return as plain text (diffs, confirmations, etc.)
          zigResponseText = zigResult.trim();
        }

        return makeCompatibleResponse({
          content: [
            createTextContent(zigResponseText, {
              audience: ["user", "assistant"],
              priority: 0.7,
            }),
          ],
        });
      }

      // === VISUAL VERIFICATION ===
      case "screenshot_url": {
        if (!SCREENSHOT_ENABLED) {
          throw new Error(SCREENSHOT_DISABLED_ERROR);
        }
        if (!HA_ACCESS_TOKEN) {
          throw new Error(SCREENSHOT_TOKEN_ERROR);
        }

        const urlPath = args.url_path;
        const width = args.width || 1280;
        const height = args.height || 720;
        const waitSeconds = args.wait_seconds !== undefined ? args.wait_seconds : 3;
        const fullPage = args.full_page || false;

        sendLog("info", "screenshot", {
          action: "requested",
          path: urlPath,
          width,
          height,
          waitSeconds,
          fullPage,
        });

        // Discover HA Core frontend URL
        const haCoreUrl = await discoverHACoreUrl();

        // Take the screenshot
        const base64Screenshot = await takeScreenshot(haCoreUrl, urlPath, {
          width,
          height,
          waitSeconds,
          fullPage,
        });

        const normalizedPath = urlPath.startsWith("/") ? urlPath : `/${urlPath}`;

        return makeCompatibleResponse({
          content: [
            createTextContent(
              `Screenshot of ${normalizedPath} (${width}x${height}) captured successfully.`,
              { audience: ["user", "assistant"], priority: 0.5 }
            ),
            createImageContent(base64Screenshot, "image/png", {
              audience: ["assistant"],
              priority: 1.0,
            }),
          ],
        });
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    sendLog("error", "mcp-server", { action: "tool_error", tool: name, error: error.message });
    return makeCompatibleResponse({
      content: [createTextContent(`Error: ${error.message}`, { audience: ["user"], priority: 1.0 })],
      isError: true,
    });
  }
});

// --- List Resources ---
server.setRequestHandler(ListResourcesRequestSchema, async () => {
  sendLog("debug", "mcp-server", { action: "list_resources" });
  return { resources: RESOURCES };
});

// --- List Resource Templates ---
server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => {
  return { resourceTemplates: RESOURCE_TEMPLATES };
});

// --- Read Resource ---
server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const { uri } = request.params;
  sendLog("debug", "mcp-server", { action: "read_resource", uri });
  
  try {
    // Static resources
    if (uri === "ha://states/summary") {
      const states = await getCachedStates();
      const summary = generateStateSummary(states);
      return {
        contents: [{ 
          uri, 
          mimeType: "text/markdown", 
          text: summary,
          annotations: { audience: ["user", "assistant"], priority: 0.9 },
        }],
      };
    }
    
    if (uri === "ha://automations") {
      const states = await getCachedStates();
      const automations = states
        .filter(s => s.entity_id.startsWith("automation."))
        .map(s => ({
          entity_id: s.entity_id,
          friendly_name: s.attributes?.friendly_name,
          state: s.state,
          last_triggered: s.attributes?.last_triggered,
        }));
      return {
        contents: [{ 
          uri, 
          mimeType: "application/json", 
          text: JSON.stringify(automations, null, 2),
          annotations: { audience: ["assistant"], priority: 0.7 },
        }],
      };
    }
    
    if (uri === "ha://scripts") {
      const states = await getCachedStates();
      const scripts = states
        .filter(s => s.entity_id.startsWith("script."))
        .map(s => ({
          entity_id: s.entity_id,
          friendly_name: s.attributes?.friendly_name,
          state: s.state,
        }));
      return {
        contents: [{ 
          uri, 
          mimeType: "application/json", 
          text: JSON.stringify(scripts, null, 2),
          annotations: { audience: ["assistant"], priority: 0.6 },
        }],
      };
    }
    
    if (uri === "ha://scenes") {
      const states = await getCachedStates();
      const scenes = states
        .filter(s => s.entity_id.startsWith("scene."))
        .map(s => ({
          entity_id: s.entity_id,
          friendly_name: s.attributes?.friendly_name,
        }));
      return {
        contents: [{ 
          uri, 
          mimeType: "application/json", 
          text: JSON.stringify(scenes, null, 2),
          annotations: { audience: ["assistant"], priority: 0.6 },
        }],
      };
    }
    
    if (uri === "ha://areas") {
      const areas = await getRegistry("config/area_registry/list");
      return {
        contents: [{
          uri,
          mimeType: "application/json",
          text: JSON.stringify(areas.map((a) => ({ id: a.area_id, name: a.name }))),
          annotations: { audience: ["assistant"], priority: 0.7 },
        }],
      };
    }
    
    if (uri === "ha://config") {
      const config = await callHA("/config");
      return {
        contents: [{ 
          uri, 
          mimeType: "application/json", 
          text: JSON.stringify(config, null, 2),
          annotations: { audience: ["assistant"], priority: 0.5 },
        }],
      };
    }
    
    if (uri === "ha://integrations") {
      const config = await callHA("/config");
      return {
        contents: [{ 
          uri, 
          mimeType: "application/json", 
          text: JSON.stringify(config.components || [], null, 2),
          annotations: { audience: ["assistant"], priority: 0.4 },
        }],
      };
    }
    
    if (uri === "ha://anomalies") {
      const states = await getCachedStates();
      const anomalies = states.map(detectAnomaly).filter(Boolean);
      return {
        contents: [{ 
          uri, 
          mimeType: "application/json", 
          text: JSON.stringify(anomalies, null, 2),
          annotations: { audience: ["user", "assistant"], priority: 0.8 },
        }],
      };
    }
    
    if (uri === "ha://suggestions") {
      const states = await getCachedStates();
      const suggestions = generateSuggestions(states);
      return {
        contents: [{ 
          uri, 
          mimeType: "application/json", 
          text: JSON.stringify(suggestions, null, 2),
          annotations: { audience: ["user", "assistant"], priority: 0.7 },
        }],
      };
    }
    
    // Template-based resources
    const statesMatch = uri.match(/^ha:\/\/states\/(\w+)$/);
    if (statesMatch) {
      const domain = statesMatch[1];
      const states = await getCachedStates();
      const filtered = states
        .filter(s => s.entity_id.startsWith(`${domain}.`))
        .map(s => ({
          entity_id: s.entity_id,
          state: s.state,
          friendly_name: s.attributes?.friendly_name,
          device_class: s.attributes?.device_class,
        }));
      return {
        contents: [{ 
          uri, 
          mimeType: "application/json", 
          text: JSON.stringify(filtered, null, 2),
          annotations: { audience: ["assistant"], priority: 0.7 },
        }],
      };
    }
    
    const entityMatch = uri.match(/^ha:\/\/entity\/(.+)$/);
    if (entityMatch) {
      const entityId = entityMatch[1];
      const relationships = await getEntityRelationships(entityId);
      return {
        contents: [{ 
          uri, 
          mimeType: "application/json", 
          text: JSON.stringify(relationships, null, 2),
          annotations: { audience: ["assistant"], priority: 0.8 },
        }],
      };
    }
    
    const areaMatch = uri.match(/^ha:\/\/area\/(.+)$/);
    if (areaMatch) {
      const areaId = areaMatch[1];
      const [states, areas] = await Promise.all([
        getCachedStates(),
        getRegistry("config/area_registry/list"),
      ]);
      const areaEntities = states.filter(s => s.attributes?.area_id === areaId);
      const areaNameResult = areas.find(a => a.area_id === areaId)?.name || areaId;
      return {
        contents: [{ 
          uri, 
          mimeType: "application/json", 
          text: JSON.stringify({
            area_id: areaId,
            area_name: areaNameResult,
            entities: areaEntities.map(s => ({
              entity_id: s.entity_id,
              state: s.state,
              friendly_name: s.attributes?.friendly_name,
            })),
          }, null, 2),
          annotations: { audience: ["assistant"], priority: 0.7 },
        }],
      };
    }
    
    const historyMatch = uri.match(/^ha:\/\/history\/(.+)$/);
    if (historyMatch) {
      const entityId = historyMatch[1];
      const startTime = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const params = new URLSearchParams({
        filter_entity_id: entityId,
        minimal_response: "true",
      });
      const history = await callHA(`/history/period/${encodeURIComponent(startTime)}?${params}`);
      return {
        contents: [{ 
          uri, 
          mimeType: "application/json", 
          text: JSON.stringify(history, null, 2),
          annotations: { audience: ["assistant"], priority: 0.6 },
        }],
      };
    }
    
    throw new Error(`Unknown resource: ${uri}`);
  } catch (error) {
    sendLog("error", "mcp-server", { action: "read_resource_error", uri, error: error.message });
    throw new Error(`Failed to read resource ${uri}: ${error.message}`);
  }
});

// --- List Prompts ---
server.setRequestHandler(ListPromptsRequestSchema, async () => {
  sendLog("debug", "mcp-server", { action: "list_prompts" });
  return { prompts: PROMPTS };
});

// --- Get Prompt ---
server.setRequestHandler(GetPromptRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  sendLog("info", "mcp-server", { action: "get_prompt", prompt: name });
  
  try {
    switch (name) {
      case "troubleshoot_entity": {
        const entityId = args?.entity_id;
        if (!entityId) throw new Error("entity_id is required");
        const problemDesc = args?.problem_description || "not working as expected";
        
        return {
          description: `Troubleshooting guide for ${entityId}`,
          messages: [{
            role: "user",
            content: {
              type: "text",
              text: `I need help troubleshooting an entity in Home Assistant.

**Entity:** ${entityId}
**Problem:** ${problemDesc}

Please help me diagnose and fix this issue. Start by:
1. Using the \`diagnose_entity\` tool to get current state and history
2. Check if the entity is available and responding
3. Look at related entities that might be affected
4. Review the error log for any related messages
5. Suggest specific fixes based on what you find

Focus on practical solutions I can implement.`,
              annotations: { audience: ["assistant"], priority: 1.0 },
            },
          }],
        };
      }
      
      case "create_automation": {
        const goal = args?.goal;
        if (!goal) throw new Error("goal is required");
        
        return {
          description: "Automation creation guide",
          messages: [{
            role: "user",
            content: {
              type: "text",
              text: `I want to create a new Home Assistant automation.

**Goal:** ${goal}

Please help me create this automation by following these steps in order:
1. **Read the existing automations file** using \`read_file\` on \`automations.yaml\` (or wherever automations are stored). You MUST include ALL existing automations in the final write â€” never overwrite them.
2. Use \`search_entities\` to find relevant entities for this automation
3. Check if similar automations already exist using \`get_states\` with domain "automation"
4. Identify the best trigger(s) for this use case
5. Suggest any conditions that might be needed
6. Define the action(s) to take
7. Provide the complete YAML that contains ALL existing automations PLUS the new one

**CRITICAL:** When writing to ANY config file, the content must include everything that was already there. Writing only new content will permanently delete existing configuration. \`write_config_safe\` will block writes that would lose list entries, drop top-level keys, or significantly shrink the file â€” but always verify yourself first by reading the file before writing.

Consider edge cases and make the automation robust.`,
              annotations: { audience: ["assistant"], priority: 1.0 },
            },
          }],
        };
      }
      
      case "energy_audit": {
        return {
          description: "Energy usage analysis and optimization",
          messages: [{
            role: "user",
            content: {
              type: "text",
              text: `Please perform an energy audit of my Home Assistant setup.

Steps:
1. Use \`search_entities\` to find all energy/power related sensors
2. Check the current state of all lights using \`get_states\` with domain "light"
3. Review climate/thermostat entities
4. Look for smart plugs and their power consumption
5. Get suggestions using the \`get_suggestions\` tool

Provide a summary including:
- Current energy consumers that are active
- Potential energy savings opportunities
- Automation suggestions to reduce energy usage
- Any anomalies in power consumption`,
              annotations: { audience: ["assistant"], priority: 1.0 },
            },
          }],
        };
      }
      
      case "scene_builder": {
        const area = args?.area || "the specified area";
        const mood = args?.mood || "comfortable";
        
        return {
          description: "Interactive scene creation",
          messages: [{
            role: "user",
            content: {
              type: "text",
              text: `Help me create a new scene for ${area} with a "${mood}" mood.

Steps:
1. Use \`get_areas\` to understand the available areas
2. Use \`search_entities\` to find controllable entities in the area (lights, switches, etc.)
3. For lights, suggest appropriate brightness and color temperature settings
4. For climate devices, suggest appropriate temperatures
5. Consider any media players or other relevant devices

Provide:
- A descriptive name for the scene
- Complete scene YAML configuration
- Any automations that might trigger this scene
- Tips for adjusting the scene`,
              annotations: { audience: ["assistant"], priority: 1.0 },
            },
          }],
        };
      }
      
      case "security_review": {
        return {
          description: "Security review of Home Assistant setup",
          messages: [{
            role: "user",
            content: {
              type: "text",
              text: `Please perform a security review of my Home Assistant setup.

Steps:
1. Use \`search_entities\` to find all security-related entities:
   - Door/window sensors (binary_sensor with device_class door/window)
   - Motion sensors
   - Lock entities
   - Alarm panels
   - Camera entities

2. Check current states using \`get_states\`
3. Use \`detect_anomalies\` to find any issues
4. Review automation coverage for security scenarios

Provide:
- Current security status (all doors locked? sensors active?)
- Any vulnerabilities or gaps in coverage
- Suggested automations for better security
- Best practices recommendations`,
              annotations: { audience: ["assistant"], priority: 1.0 },
            },
          }],
        };
      }
      
      case "morning_routine": {
        const wakeTime = args?.wake_time || "7:00 AM";
        
        return {
          description: "Morning routine automation design",
          messages: [{
            role: "user",
            content: {
              type: "text",
              text: `Help me design a morning routine automation for ${wakeTime}.

Steps:
1. Use \`search_entities\` to find relevant devices:
   - Bedroom lights
   - Coffee maker or kitchen appliances
   - Thermostat/climate
   - Window blinds/covers
   - Speakers for announcements

2. Check existing automations with \`get_states\` domain "automation"
3. Consider calendar integration using \`get_calendars\`

Design a routine that:
- Gradually increases lighting
- Adjusts temperature for waking
- Optionally starts coffee/breakfast prep
- Provides weather or calendar briefing

Provide complete automation YAML and any required helper entities.`,
              annotations: { audience: ["assistant"], priority: 1.0 },
            },
          }],
        };
      }
      
      default:
        throw new Error(`Unknown prompt: ${name}`);
    }
  } catch (error) {
    sendLog("error", "mcp-server", { action: "get_prompt_error", prompt: name, error: error.message });
    throw new Error(`Failed to get prompt ${name}: ${error.message}`);
  }
});

// ============================================================================
// START SERVER
// ============================================================================

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  
  sendLog("info", "mcp-server", { 
    action: "started",
    version: "2.7.0",
    tools: TOOLS.length,
    resources: RESOURCES.length,
    prompts: PROMPTS.length,
  });
  
  console.error("Home Assistant MCP server v2.7.0 started (Safe Config Edition)");
  console.error(`Capabilities: Tools (${TOOLS.length}), Resources (${RESOURCES.length}), Prompts (${PROMPTS.length}), Logging`);
  console.error(`Features: Structured Output, Tool Annotations, Resource Links, Content Annotations, Live Docs, Safe Config Writing, Screenshots${SCREENSHOT_ENABLED ? " (enabled)" : " (disabled)"}`);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
