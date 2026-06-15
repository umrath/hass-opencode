// ============================================================================
// State cache + entity relationship helpers — Extracted from index.js.
//
// Exports `createStateHelpers(cfg)` returning { getCachedStates,
// invalidateStatesCache, getEntityRelationships }. callHA is injected.
// ============================================================================

export function createStateHelpers({ callHA }) {

  // Short-lived cache for the full state dump — many tools fetch /states and
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

  return { getCachedStates, invalidateStatesCache, getEntityRelationships };
}
