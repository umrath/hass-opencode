// ============================================================================
// TOOLS DEFINITION — Extracted from index.js to reduce monolith size.
//
// Exports a function `defineTools(SCHEMAS)` that returns the complete TOOLS
// array. SCHEMAS is the shared output-schema object defined in index.js.
// This keeps the massive pure-data array in its own module while avoiding
// circular imports (SCHEMAS is passed at call time, not imported).
// ============================================================================

export function defineTools(SCHEMAS) {
  return [
  // === STATE MANAGEMENT ===
  {
    name: "get_states",
    title: "Get Entity States",
    description: "Get the current state of entities. Can return all entities, filter by domain, or get a specific entity. Returns entity_id, state, and key attributes.",
    inputSchema: {
      type: "object",
      properties: {
        entity_id: {
          type: "string",
          description: "Specific entity ID (e.g., 'light.living_room'). If not provided, returns all/filtered entities.",
        },
        domain: {
          type: "string",
          description: "Filter by domain (e.g., 'light', 'switch', 'sensor', 'automation')",
        },
        summarize: {
          type: "boolean",
          description: "If true, returns a human-readable summary instead of raw data",
        },
      },
    },
    outputSchema: SCHEMAS.entityStateArray,
    annotations: {
      readOnly: true,
      idempotent: true,
      openWorld: false,
    },
  },
  {
    name: "search_entities",
    title: "Search Entities",
    description: "Search for entities by name, type, or description. Uses semantic matching to find relevant entities.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query (e.g., 'bedroom lights', 'temperature sensors', 'front door')",
        },
      },
      required: ["query"],
    },
    outputSchema: SCHEMAS.searchResult,
    annotations: {
      readOnly: true,
      idempotent: true,
    },
  },
  {
    name: "get_entity_details",
    title: "Get Entity Details",
    description: "Get detailed information about an entity including its relationships to devices, areas, and related entities.",
    inputSchema: {
      type: "object",
      properties: {
        entity_id: {
          type: "string",
          description: "The entity ID to get details for",
        },
      },
      required: ["entity_id"],
    },
    outputSchema: SCHEMAS.entityDetails,
    annotations: {
      readOnly: true,
      idempotent: true,
    },
  },
  
  // === SERVICE CALLS ===
  {
    name: "call_service",
    title: "Call Home Assistant Service",
    description: "Call a Home Assistant service to control devices or trigger actions. Use for turning on/off lights, running scripts, triggering automations, etc. THIS MODIFIES DEVICE STATE.",
    inputSchema: {
      type: "object",
      properties: {
        domain: {
          type: "string",
          description: "Service domain (e.g., 'light', 'switch', 'automation', 'script', 'climate')",
        },
        service: {
          type: "string",
          description: "Service name (e.g., 'turn_on', 'turn_off', 'toggle', 'trigger', 'set_temperature')",
        },
        target: {
          type: "object",
          description: "Target for the service call",
          properties: {
            entity_id: {
              oneOf: [
                { type: "string" },
                { type: "array", items: { type: "string" } }
              ],
              description: "Entity ID(s) to target"
            },
            area_id: {
              oneOf: [
                { type: "string" },
                { type: "array", items: { type: "string" } }
              ],
              description: "Area ID(s) to target"
            },
            device_id: {
              oneOf: [
                { type: "string" },
                { type: "array", items: { type: "string" } }
              ],
              description: "Device ID(s) to target"
            },
          },
        },
        data: {
          type: "object",
          description: "Additional service data (e.g., brightness: 255, color_temp: 400, temperature: 72)",
        },
      },
      required: ["domain", "service"],
    },
    outputSchema: SCHEMAS.serviceCallResult,
    annotations: {
      destructive: true,
      idempotent: false,
      requiresConfirmation: true,
    },
  },
  {
    name: "get_services",
    title: "List Available Services",
    description: "List available services, optionally filtered by domain. Shows what actions can be performed.",
    inputSchema: {
      type: "object",
      properties: {
        domain: {
          type: "string",
          description: "Filter services by domain (e.g., 'light', 'climate')",
        },
      },
    },
    annotations: {
      readOnly: true,
      idempotent: true,
    },
  },
  
  // === HISTORY & LOGBOOK ===
  {
    name: "get_history",
    title: "Get Entity History",
    description: "Get historical state data for entities. Essential for analyzing trends, debugging issues, or understanding patterns.",
    inputSchema: {
      type: "object",
      properties: {
        entity_id: {
          type: "string",
          description: "Entity ID to get history for (required)",
        },
        start_time: {
          type: "string",
          description: "Start time in ISO format (e.g., '2024-01-15T00:00:00'). Defaults to 24 hours ago.",
        },
        end_time: {
          type: "string",
          description: "End time in ISO format. Defaults to now.",
        },
        minimal: {
          type: "boolean",
          description: "Defaults to true (faster, less data). Set false to include full attribute payloads.",
        },
      },
      required: ["entity_id"],
    },
    annotations: {
      readOnly: true,
      idempotent: true,
    },
  },
  {
    name: "get_logbook",
    title: "Get Activity Logbook",
    description: "Get logbook entries showing what happened in Home Assistant. Useful for understanding recent activity and debugging.",
    inputSchema: {
      type: "object",
      properties: {
        entity_id: { type: "string", description: "Filter by specific entity" },
        start_time: { type: "string", description: "Start time in ISO format. Defaults to 24 hours ago." },
        end_time: { type: "string", description: "End time in ISO format. Defaults to now." },
      },
    },
    annotations: {
      readOnly: true,
      idempotent: true,
    },
  },
  
  // === CONFIGURATION ===
  {
    name: "get_config",
    title: "Get Home Assistant Configuration",
    description: "Get Home Assistant configuration including location, units, version, and loaded components.",
    inputSchema: { type: "object", properties: {} },
    annotations: {
      readOnly: true,
      idempotent: true,
    },
  },
  {
    name: "get_areas",
    title: "List All Areas",
    description: "List all areas defined in Home Assistant with their IDs and names.",
    inputSchema: { type: "object", properties: {} },
    outputSchema: SCHEMAS.areaArray,
    annotations: {
      readOnly: true,
      idempotent: true,
    },
  },
  {
    name: "get_devices",
    title: "List Devices",
    description: "List devices registered in Home Assistant, optionally filtered by area.",
    inputSchema: {
      type: "object",
      properties: {
        area_id: { type: "string", description: "Filter devices by area ID" },
      },
    },
    annotations: {
      readOnly: true,
      idempotent: true,
    },
  },
  {
    name: "validate_config",
    title: "Validate Configuration",
    description: "Validate Home Assistant configuration files. Run this before restarting to catch errors.",
    inputSchema: { type: "object", properties: {} },
    outputSchema: SCHEMAS.configValidation,
    annotations: {
      readOnly: true,
      idempotent: true,
    },
  },
  {
    name: "get_error_log",
    title: "Get Error Log",
    description: "Get the Home Assistant error log. Useful for debugging issues.",
    inputSchema: {
      type: "object",
      properties: {
        lines: { type: "number", description: "Number of lines to return (default: 100)" },
      },
    },
    annotations: {
      readOnly: true,
      idempotent: true,
    },
  },
  
  // === EVENTS & TEMPLATES ===
  {
    name: "fire_event",
    title: "Fire Custom Event",
    description: "Fire a custom event in Home Assistant. Can be used to trigger automations or communicate between systems.",
    inputSchema: {
      type: "object",
      properties: {
        event_type: { type: "string", description: "Event type to fire (e.g., 'custom_event', 'my_notification')" },
        event_data: { type: "object", description: "Optional data to include with the event" },
      },
      required: ["event_type"],
    },
    annotations: {
      destructive: true,
      idempotent: false,
    },
  },
  {
    name: "render_template",
    title: "Render Jinja2 Template",
    description: "Render a Jinja2 template using Home Assistant's template engine. Powerful for complex data extraction and formatting.",
    inputSchema: {
      type: "object",
      properties: {
        template: { type: "string", description: "Jinja2 template (e.g., '{{ states(\"sensor.temperature\") }}', '{{ now() }}')" },
      },
      required: ["template"],
    },
    annotations: {
      readOnly: true,
      idempotent: true,
    },
  },
  
  // === CALENDARS ===
  {
    name: "get_calendars",
    title: "List Calendars",
    description: "List all calendar entities in Home Assistant.",
    inputSchema: { type: "object", properties: {} },
    annotations: {
      readOnly: true,
      idempotent: true,
    },
  },
  {
    name: "get_calendar_events",
    title: "Get Calendar Events",
    description: "Get events from a specific calendar within a time range.",
    inputSchema: {
      type: "object",
      properties: {
        calendar_entity: { type: "string", description: "Calendar entity ID (e.g., 'calendar.family')" },
        start: { type: "string", description: "Start time in ISO format" },
        end: { type: "string", description: "End time in ISO format" },
      },
      required: ["calendar_entity"],
    },
    annotations: {
      readOnly: true,
      idempotent: true,
    },
  },
  
  // === INTELLIGENCE ===
  {
    name: "detect_anomalies",
    title: "Detect Anomalies",
    description: "Scan all entities for potential anomalies like low batteries, unusual sensor readings, or devices in unexpected states.",
    inputSchema: {
      type: "object",
      properties: {
        domain: { type: "string", description: "Limit scan to specific domain" },
      },
    },
    outputSchema: SCHEMAS.anomalyArray,
    annotations: {
      readOnly: true,
      idempotent: true,
    },
  },
  {
    name: "get_suggestions",
    title: "Get Automation Suggestions",
    description: "Get intelligent automation and optimization suggestions based on your current Home Assistant setup.",
    inputSchema: { type: "object", properties: {} },
    outputSchema: SCHEMAS.suggestionArray,
    annotations: {
      readOnly: true,
      idempotent: true,
    },
  },
  {
    name: "diagnose_entity",
    title: "Diagnose Entity",
    description: "Run diagnostics on an entity to help troubleshoot issues. Checks state history, related entities, and common problems.",
    inputSchema: {
      type: "object",
      properties: {
        entity_id: { type: "string", description: "Entity to diagnose" },
      },
      required: ["entity_id"],
    },
    outputSchema: SCHEMAS.diagnostics,
    annotations: {
      readOnly: true,
      idempotent: true,
    },
  },
  
  // === DOCUMENTATION ===
  {
    name: "get_integration_docs",
    title: "Get Integration Documentation",
    description: "Fetch current documentation for a Home Assistant integration. Use this BEFORE writing configuration to ensure you use the latest syntax. Returns configuration examples, setup instructions, and deprecation notices.",
    inputSchema: {
      type: "object",
      properties: {
        integration: {
          type: "string",
          description: "Integration name (e.g., 'template', 'mqtt', 'rest', 'sensor', 'automation')",
        },
        section: {
          type: "string",
          enum: ["all", "configuration", "examples"],
          description: "Which section to focus on (default: 'configuration')",
        },
      },
      required: ["integration"],
    },
    outputSchema: SCHEMAS.integrationDocs,
    annotations: {
      readOnly: true,
      idempotent: true,
    },
  },
  {
    name: "get_breaking_changes",
    title: "Get Breaking Changes",
    description: "Fetch recent breaking changes from Home Assistant release notes. Use this when troubleshooting configurations that stopped working after an update, or to check compatibility before suggesting configurations.",
    inputSchema: {
      type: "object",
      properties: {
        integration: {
          type: "string",
          description: "Filter by specific integration name (optional)",
        },
        version: {
          type: "string",
          description: "Get changes for a specific HA version (e.g., '2024.12'). Defaults to recent versions.",
        },
      },
    },
    outputSchema: SCHEMAS.breakingChanges,
    annotations: {
      readOnly: true,
      idempotent: true,
    },
  },
  {
    name: "check_config_syntax",
    title: "Check Configuration Syntax",
    description: "Analyze YAML configuration for deprecated syntax patterns and suggest modern alternatives. Use this to validate configuration before presenting it to the user.",
    inputSchema: {
      type: "object",
      properties: {
        yaml_config: {
          type: "string",
          description: "The YAML configuration to check",
        },
        integration: {
          type: "string",
          description: "The integration this config is for (helps with specific checks)",
        },
      },
      required: ["yaml_config"],
    },
    outputSchema: SCHEMAS.configSyntaxCheck,
    annotations: {
      readOnly: true,
      idempotent: true,
    },
  },
  {
    name: "write_config_safe",
    title: "Safe Config Writer",
    description: "Write YAML configuration to a file with automatic validation and content protection. Checks for deprecations, validates Jinja2 templates through HA's engine, verifies structural correctness, and runs HA's full config check. If validation fails, the original file is restored and errors are returned for correction. IMPORTANT: This tool blocks writes that would accidentally reduce content â€” removing list entries, dropping top-level keys, or significantly shrinking the file. Always read the existing file first and include all existing content in your write. Use dry_run=true to validate without writing.",
    inputSchema: {
      type: "object",
      properties: {
        file_path: {
          type: "string",
          description: "Path relative to /homeassistant/ (e.g., 'configuration.yaml', 'automations.yaml', 'packages/lights.yaml')",
        },
        content: {
          type: "string",
          description: "The YAML content to write",
        },
        dry_run: {
          type: "boolean",
          description: "If true, validate without writing to disk (default: false). Use this to pre-check config before committing.",
        },
        validate_templates: {
          type: "boolean",
          description: "If true (default), extract and validate Jinja2 templates through HA's template engine.",
        },
        confirm_deletions: {
          type: "boolean",
          description: "If true, confirms that you intentionally want to reduce content in this file. Default: false. Without this flag, writes are blocked if they would: (1) reduce list entries in automations.yaml/scripts.yaml/scenes.yaml, (2) remove top-level keys from mapping files like configuration.yaml, or (3) reduce the file size by more than 50%. This prevents accidental data loss when the AI writes without reading the existing file first.",
        },
      },
      required: ["file_path", "content"],
    },
    annotations: {
      readOnly: false,
      idempotent: false,
      destructive: false,
    },
  },
  
  // === UPDATE MANAGEMENT ===
  {
    name: "get_available_updates",
    title: "Get Available Updates",
    description: "Check for available updates across Home Assistant Core, OS, Supervisor, and all installed apps. Returns version info and update status for each component.",
    inputSchema: {
      type: "object",
      properties: {
        component: {
          type: "string",
          enum: ["all", "core", "os", "supervisor", "addons"],
          description: "Which component to check (default: 'all')",
        },
      },
    },
    annotations: {
      readOnly: true,
      idempotent: true,
    },
  },
  {
    name: "get_addon_changelog",
    title: "Get App Changelog",
    description: "Get the changelog for an installed app to see what changes are included in updates.",
    inputSchema: {
      type: "object",
      properties: {
        addon_slug: {
          type: "string",
          description: "The slug identifier of the app (e.g., 'core_configurator', 'a0d7b954_vscode')",
        },
      },
      required: ["addon_slug"],
    },
    annotations: {
      readOnly: true,
      idempotent: true,
    },
  },
  {
    name: "update_component",
    title: "Update Component",
    description: "Initiate an update for a Home Assistant component (Core, OS, Supervisor) or an app. Returns a job_id for progress monitoring. NOTE: Cannot update OpenCode itself from within - use Home Assistant UI for self-updates.",
    inputSchema: {
      type: "object",
      properties: {
        component: {
          type: "string",
          enum: ["core", "os", "supervisor", "addon"],
          description: "Type of component to update",
        },
        addon_slug: {
          type: "string",
          description: "Required if component is 'addon' - the app's slug identifier",
        },
        backup: {
          type: "boolean",
          description: "Create a backup before updating (default: true for core/addons)",
        },
      },
      required: ["component"],
    },
    annotations: {
      readOnly: false,
      destructive: false,
      idempotent: false,
    },
  },
  {
    name: "get_update_progress",
    title: "Get Update Progress",
    description: "Monitor the progress of a running update job. Poll this endpoint to get real-time progress updates including percentage, current stage, and completion status.",
    inputSchema: {
      type: "object",
      properties: {
        job_id: {
          type: "string",
          description: "The job UUID returned when initiating an update",
        },
      },
      required: ["job_id"],
    },
    annotations: {
      readOnly: true,
      idempotent: true,
    },
  },
  {
    name: "get_running_jobs",
    title: "Get Running Jobs",
    description: "List all currently running or recently completed Supervisor jobs. Useful for monitoring ongoing operations like updates, backups, or restores.",
    inputSchema: {
      type: "object",
      properties: {},
    },
    annotations: {
      readOnly: true,
      idempotent: true,
    },
  },
  
  // === ESPHOME INTEGRATION ===
  {
    name: "esphome_list_devices",
    title: "List ESPHome Devices",
    description: "List all configured ESPHome devices with current and deployed firmware versions. Requires ESPHome app to be installed and running.",
    inputSchema: {
      type: "object",
      properties: {},
    },
    annotations: {
      readOnly: true,
      idempotent: true,
    },
  },
  {
    name: "esphome_compile",
    title: "Compile ESPHome Firmware",
    description: "Compile firmware for an ESPHome device. Returns the full build log including any errors. This may take 1-5 minutes depending on device complexity.",
    inputSchema: {
      type: "object",
      properties: {
        device: {
          type: "string",
          description: "Device name or configuration file name (e.g., 'living-room-sensor' or 'living-room-sensor.yaml')",
        },
      },
      required: ["device"],
    },
    annotations: {
      readOnly: false,
      idempotent: true,
    },
  },
  {
    name: "esphome_upload",
    title: "Upload ESPHome Firmware",
    description: "Upload compiled firmware to an ESPHome device via OTA (Over-The-Air) or USB. For OTA, the device must be online and reachable.",
    inputSchema: {
      type: "object",
      properties: {
        device: {
          type: "string",
          description: "Device name or configuration file name",
        },
        port: {
          type: "string",
          description: "Upload target - device IP/hostname for OTA (e.g., '192.168.1.100') or USB path (e.g., '/dev/ttyUSB0')",
        },
      },
      required: ["device", "port"],
    },
    annotations: {
      readOnly: false,
      idempotent: false,
    },
  },
  
  // === FIRMWARE UPDATE MONITORING ===
  {
    name: "watch_firmware_update",
    title: "Watch Firmware Update Progress",
    description: "Check firmware update status or start an update. Returns current state immediately (does not block). Call repeatedly to monitor progress. For ESPHome, WLED, Zigbee coordinators, and other device updates.",
    inputSchema: {
      type: "object",
      properties: {
        entity_id: {
          type: "string",
          description: "The update entity to check (e.g., 'update.garage_sensor_firmware', 'update.wled_living_room_update')",
        },
        start_update: {
          type: "boolean",
          description: "If true, start the update. If false (default), just check current status.",
        },
      },
      required: ["entity_id"],
    },
    annotations: {
      readOnly: false,
      idempotent: false,
    },
  },
  {
    name: "hab_run",
    title: "Run hab CLI Command",
    description: "Run a Home Assistant Builder (hab) CLI command. hab is a comprehensive admin CLI that covers the full Home Assistant admin area via REST and WebSocket APIs. Use this for: dashboard CRUD (create views, sections, cards), area/floor/zone/label/person/category management, helper entity creation, automation/script/scene CRUD, backup/restore, blueprint management, calendar and todo list management, notification management, integration reload/enable/disable, repair issue management, event firing, template rendering, device management, and search. hab outputs human-readable text by default; add --json for structured JSON output. Examples: 'entity list --domain light --json', 'area create Kitchen', 'scene activate \"Movie Time\"', 'todo item add todo.shopping Milk', 'notification create --message \"Done\" --title \"Status\"', 'integration reload hue', 'repairs list --json', 'template render --expression \"{{ states(\\'sensor.temp\\') }}\"'. Run with just 'help' to see all available command groups.",
    inputSchema: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "The hab command and arguments to run (without the 'hab' prefix). Examples: 'entity list --json', 'area create Kitchen', 'dashboard list', 'automation get my-automation', 'helper create input_boolean --name \"Guest Mode\"', 'scene list --json', 'todo item add todo.shopping \"Buy milk\"', 'notification list --json', 'integration reload hue', 'repairs list --json', 'person list --json', 'backup create', 'system info', 'overview --json'",
        },
      },
      required: ["command"],
    },
    annotations: {
      readOnly: false,
      idempotent: false,
    },
  },
  {
    name: "zigporter_run",
    title: "Run zigporter CLI Command",
    description:
      "Run a zigporter CLI command for Zigbee device management. " +
      "zigporter handles cascade entity/device renames (updating ALL references " +
      "in automations, scripts, scenes, and dashboards), device inspection across " +
      "ZHA and Z2M, stale device cleanup, and mesh visualization. Key commands: " +
      "'rename-entity old new --apply' (cascade rename), " +
      "'rename-device \"Old\" \"New\" --apply', " +
      "'inspect \"Device\" --json', 'list-devices --json', 'list-z2m --json', " +
      "'stale \"Device\" --action remove', 'fix-device \"Device\" --apply', " +
      "'network-map --format table', 'check'. " +
      "Always dry-run renames first (omit --apply).",
    inputSchema: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description:
            "The zigporter command and arguments to run (without the 'zigporter' prefix). " +
            "Examples: 'list-devices --json', 'inspect \"Kitchen\" --json', " +
            "'rename-entity light.old light.new', " +
            "'rename-entity light.old light.new --apply', " +
            "'stale \"Device\" --action remove'",
        },
      },
      required: ["command"],
    },
    annotations: {
      readOnly: false,
      idempotent: false,
    },
  },
  {
    name: "screenshot_url",
    title: "Screenshot Home Assistant Page",
    description: "Take a screenshot of any Home Assistant page for visual verification. Use this after making dashboard changes, creating views or cards via hab, or any time you need to visually verify a result. Returns a PNG image that vision-capable AI models can analyze. Requires the 'screenshot_enabled' option and a Long-Lived Access Token. Examples: '/lovelace/0' (default dashboard), '/energy' (energy panel), '/config/dashboard' (settings), '/dashboard-custom/my-view' (custom dashboard).",
    inputSchema: {
      type: "object",
      properties: {
        url_path: {
          type: "string",
          description: "The HA page path to screenshot (e.g., '/lovelace/0', '/energy', '/config/dashboard', '/dashboard-name/view-index')",
        },
        width: {
          type: "number",
          description: "Viewport width in pixels (default: 1280)",
        },
        height: {
          type: "number",
          description: "Viewport height in pixels (default: 720)",
        },
        wait_seconds: {
          type: "number",
          description: "Seconds to wait after page load for dynamic content to render (default: 3, max: 15)",
        },
        full_page: {
          type: "boolean",
          description: "Capture full scrollable page instead of just viewport (default: false)",
        },
      },
      required: ["url_path"],
    },
    annotations: {
      readOnly: true,
      idempotent: true,
    },
  },
  ];
}
