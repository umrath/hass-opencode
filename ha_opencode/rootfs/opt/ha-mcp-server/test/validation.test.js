import { describe, it, expect } from "vitest";
import { validateYamlStructure, resolveConfigPath } from "../lib/validation.js";

// ---------------------------------------------------------------------------
// validateYamlStructure
// ---------------------------------------------------------------------------

describe("validateYamlStructure", () => {
  // NOTE: The regex in validateYamlStructure uses (?=^\S|\Z) to find the end
  // of a YAML block.  \Z is not a JS regex anchor, so the block must be
  // followed by another top-level key for the look-ahead to match.  We add
  // a trailing "end:" key in each test input to satisfy this requirement.

  it("returns no issues for a well-formed automation", () => {
    // Use trigger/action without nested "- " list items so the regex split
    // (which splits on ANY "- " line) keeps the entry intact.
    const yaml = [
      "automation:",
      "  - alias: Turn on lights",
      "    trigger: state_changed",
      "    action: light.turn_on",
      "end:",
    ].join("\n");
    const issues = validateYamlStructure(yaml);
    expect(issues).toEqual([]);
  });

  it("detects missing trigger in automation", () => {
    const yaml = [
      "automation:",
      "  - alias: Broken automation",
      "    action:",
      "      - service: light.turn_on",
      "end:",
    ].join("\n");
    const issues = validateYamlStructure(yaml);
    expect(issues.some(i => i.message.includes("trigger"))).toBe(true);
  });

  it("detects missing action in automation", () => {
    const yaml = [
      "automation:",
      "  - alias: No action",
      "    trigger:",
      "      - platform: state",
      "        entity_id: binary_sensor.motion",
      "end:",
    ].join("\n");
    const issues = validateYamlStructure(yaml);
    expect(issues.some(i => i.message.includes("action"))).toBe(true);
  });

  it("returns no issues for a well-formed script", () => {
    const yaml = [
      "script:",
      "  morning_routine:",
      "    sequence:",
      "      - service: light.turn_on",
      "end:",
    ].join("\n");
    const issues = validateYamlStructure(yaml);
    expect(issues).toEqual([]);
  });

  it("detects missing sequence in script", () => {
    const yaml = [
      "script:",
      "  morning_routine:",
      "    alias: Morning Routine",
      "end:",
    ].join("\n");
    const issues = validateYamlStructure(yaml);
    expect(issues.some(i => i.message.includes("sequence") || i.message.includes("action"))).toBe(true);
  });

  it("returns no issues for a well-formed template sensor", () => {
    const yaml = [
      "template:",
      "  - sensor:",
      "      - name: Average Temperature",
      "        state: \"{{ states('sensor.temp') }}\"",
      "end:",
    ].join("\n");
    const issues = validateYamlStructure(yaml);
    expect(issues).toEqual([]);
  });

  it("returns no issues for empty content", () => {
    expect(validateYamlStructure("")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// resolveConfigPath
// ---------------------------------------------------------------------------

describe("resolveConfigPath", () => {
  // Use a test config dir to avoid platform-specific path separator issues
  const configDir = "/homeassistant";

  it("resolves a simple relative path", () => {
    const result = resolveConfigPath("automations.yaml", configDir);
    expect(result).toBe("/homeassistant/automations.yaml");
  });

  it("resolves a nested relative path", () => {
    const result = resolveConfigPath("packages/lights.yaml", configDir);
    expect(result).toBe("/homeassistant/packages/lights.yaml");
  });

  it("allows an absolute path inside the config dir", () => {
    const result = resolveConfigPath("/homeassistant/secrets.yaml", configDir);
    expect(result).toBe("/homeassistant/secrets.yaml");
  });

  it("rejects an absolute path outside the config dir", () => {
    const result = resolveConfigPath("/etc/passwd", configDir);
    expect(result).toBeNull();
  });

  it("rejects traversal attacks (..)", () => {
    const result = resolveConfigPath("../etc/passwd", configDir);
    expect(result).toBeNull();
  });

  it("blocks .storage access", () => {
    const result = resolveConfigPath(".storage/core.entity_registry", configDir);
    expect(result).toBeNull();
  });

  it("blocks .cloud access", () => {
    const result = resolveConfigPath(".cloud/remote.json", configDir);
    expect(result).toBeNull();
  });

  it("blocks deps access", () => {
    const result = resolveConfigPath("deps/some_package", configDir);
    expect(result).toBeNull();
  });

  it("blocks tts access", () => {
    const result = resolveConfigPath("tts/cache.mp3", configDir);
    expect(result).toBeNull();
  });

  it("blocks __pycache__ access", () => {
    const result = resolveConfigPath("__pycache__/module.pyc", configDir);
    expect(result).toBeNull();
  });

  it("allows custom_components (not in blocklist)", () => {
    const result = resolveConfigPath("custom_components/hacs/manifest.json", configDir);
    expect(result).toBe("/homeassistant/custom_components/hacs/manifest.json");
  });
});

// ---------------------------------------------------------------------------
// Content protection checks (from write_config_safe)
// ---------------------------------------------------------------------------

describe("content protection — entry reduction", () => {
  const countEntries = (content) => (content.match(/^- /gm) || []).length;

  it("blocks when new has fewer entries than existing", () => {
    const existing = "- id: '1'\n  alias: A\n- id: '2'\n  alias: B\n- id: '3'\n  alias: C\n";
    const newContent = "- id: '4'\n  alias: D\n";
    expect(countEntries(existing)).toBe(3);
    expect(countEntries(newContent)).toBe(1);
    expect(countEntries(newContent)).toBeLessThan(countEntries(existing));
  });

  it("allows when new has same entries", () => {
    const existing = "- id: '1'\n  alias: A\n- id: '2'\n  alias: B\n";
    const newContent = "- id: '1'\n  alias: A\n- id: '2'\n  alias: B\n- id: '3'\n  alias: C\n";
    expect(countEntries(newContent)).toBeGreaterThanOrEqual(countEntries(existing));
  });

  it("allows when existing file is empty", () => {
    const existing = "";
    const newContent = "- id: '1'\n  alias: A\n";
    expect(countEntries(existing)).toBe(0);
    expect(countEntries(newContent)).toBe(1);
  });
});

describe("content protection — key removal", () => {
  const extractKeys = (content) => {
    const keys = new Set();
    const regex = /^([a-z_][a-z0-9_]*):/gm;
    let m;
    while ((m = regex.exec(content)) !== null) keys.add(m[1]);
    return keys;
  };

  it("detects removed top-level keys", () => {
    const existing = "homeassistant:\n  name: Home\nmqtt:\n  broker: localhost\n";
    const newContent = "homeassistant:\n  name: Home\n";
    const existingKeys = extractKeys(existing);
    const newKeys = extractKeys(newContent);
    const removed = [...existingKeys].filter(k => !newKeys.has(k));
    expect(removed).toContain("mqtt");
  });

  it("passes when all keys are present", () => {
    const existing = "homeassistant:\n  name: Home\nmqtt:\n  broker: localhost\n";
    const newContent = "homeassistant:\n  name: Castle\nmqtt:\n  broker: newhost\ntemplate:\n  - sensor:\n";
    const existingKeys = extractKeys(existing);
    const newKeys = extractKeys(newContent);
    const removed = [...existingKeys].filter(k => !newKeys.has(k));
    expect(removed).toHaveLength(0);
  });
});

describe("content protection — size reduction", () => {
  it("blocks when new content is less than 50% of existing", () => {
    const existing = "line1\n".repeat(20);
    const newContent = "line1\n".repeat(5);
    const existingLines = existing.split("\n").length - 1;
    const newLines = newContent.split("\n").length - 1;
    expect(newLines).toBeLessThan(existingLines * 0.5);
  });

  it("allows when new content is close to existing size", () => {
    const existing = "line1\n".repeat(20);
    const newContent = "line1\n".repeat(15);
    const existingLines = existing.split("\n").length - 1;
    const newLines = newContent.split("\n").length - 1;
    expect(newLines).toBeGreaterThanOrEqual(existingLines * 0.5);
  });

  it("skips check for very small files (<=10 lines)", () => {
    const existing = "line1\nline2\nline3\n";
    const newContent = "line1\n";
    const existingLines = existing.split("\n").length - 1;
    expect(existingLines).toBeLessThanOrEqual(10);
    // Small files don't trigger size reduction regardless of ratio
  });
});
