// ============================================================================
// PROMPTS DEFINITION — Extracted from index.js.
// ============================================================================

export const PROMPTS = [
  {
    name: "troubleshoot_entity",
    title: "Troubleshoot Entity",
    description: "Guided troubleshooting for a problematic entity. Analyzes state, history, and related entities to identify issues.",
    arguments: [
      { name: "entity_id", description: "The entity ID that's having problems", required: true },
      { name: "problem_description", description: "Brief description of the problem", required: false },
    ],
  },
  {
    name: "create_automation",
    title: "Create Automation",
    description: "Step-by-step guide to create a new automation. Helps identify triggers, conditions, and actions.",
    arguments: [
      { name: "goal", description: "What you want the automation to accomplish", required: true },
    ],
  },
  {
    name: "energy_audit",
    title: "Energy Audit",
    description: "Analyze energy usage and suggest optimizations. Reviews power sensors, lights, climate, and usage patterns.",
    arguments: [],
  },
  {
    name: "scene_builder",
    title: "Scene Builder",
    description: "Interactive scene creation assistant. Captures current states or helps design new scenes.",
    arguments: [
      { name: "area", description: "Area to create scene for (optional)", required: false },
      { name: "mood", description: "Desired mood/atmosphere (e.g., 'relaxing', 'movie night', 'energizing')", required: false },
    ],
  },
  {
    name: "security_review",
    title: "Security Review",
    description: "Review security-related entities and suggest improvements. Checks locks, sensors, cameras, and alarm systems.",
    arguments: [],
  },
  {
    name: "morning_routine",
    title: "Morning Routine Designer",
    description: "Design a morning routine automation based on your devices and preferences.",
    arguments: [
      { name: "wake_time", description: "Usual wake-up time (e.g., '7:00 AM')", required: false },
    ],
  },
];
