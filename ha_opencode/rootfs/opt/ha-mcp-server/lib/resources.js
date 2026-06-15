// ============================================================================
// RESOURCES DEFINITION — Extracted from index.js.
// ============================================================================

export const RESOURCES = [
  {
    uri: "ha://states/summary",
    name: "state_summary",
    title: "State Summary",
    description: "Human-readable summary of all Home Assistant entity states",
    mimeType: "text/markdown",
  },
  {
    uri: "ha://automations",
    name: "automations",
    title: "Automations List",
    description: "List of all automations with their current state and last triggered time",
    mimeType: "application/json",
  },
  {
    uri: "ha://scripts",
    name: "scripts",
    title: "Scripts List",
    description: "List of all scripts available in Home Assistant",
    mimeType: "application/json",
  },
  {
    uri: "ha://scenes",
    name: "scenes",
    title: "Scenes List",
    description: "List of all scenes that can be activated",
    mimeType: "application/json",
  },
  {
    uri: "ha://areas",
    name: "areas",
    title: "Areas List",
    description: "All areas defined in Home Assistant with associated entities",
    mimeType: "application/json",
  },
  {
    uri: "ha://config",
    name: "config",
    title: "HA Configuration",
    description: "Home Assistant configuration details",
    mimeType: "application/json",
  },
  {
    uri: "ha://integrations",
    name: "integrations",
    title: "Loaded Integrations",
    description: "List of loaded integrations/components",
    mimeType: "application/json",
  },
  {
    uri: "ha://anomalies",
    name: "anomalies",
    title: "Detected Anomalies",
    description: "Currently detected anomalies and potential issues",
    mimeType: "application/json",
  },
  {
    uri: "ha://suggestions",
    name: "suggestions",
    title: "Automation Suggestions",
    description: "Automation and optimization suggestions",
    mimeType: "application/json",
  },
];

export const RESOURCE_TEMPLATES = [
  {
    uriTemplate: "ha://states/{domain}",
    name: "states_by_domain",
    title: "States by Domain",
    description: "Get all entity states for a specific domain (e.g., light, switch, sensor)",
    mimeType: "application/json",
  },
  {
    uriTemplate: "ha://entity/{entity_id}",
    name: "entity_details",
    title: "Entity Details",
    description: "Detailed information about a specific entity",
    mimeType: "application/json",
  },
  {
    uriTemplate: "ha://area/{area_id}",
    name: "area_details",
    title: "Area Details",
    description: "All entities and devices in a specific area",
    mimeType: "application/json",
  },
  {
    uriTemplate: "ha://history/{entity_id}",
    name: "entity_history",
    title: "Entity History",
    description: "Recent state history for an entity (last 24 hours)",
    mimeType: "application/json",
  },
];
