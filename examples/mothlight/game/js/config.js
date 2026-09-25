// @ts-check
/**
 * config.js [PURE]: engine constants, default tuning, tuning loader.
 * Owner: tech-lead (tl-1). Shared contract, changes go via #engineering.
 *
 * DEFAULT_TUNING mirrors Game/data/tuning.json (owned by gd-1) key for key, so
 * the game still runs when the file is missing, partial or malformed.
 */

/** Engine constants (not design tuning). */
export const SIM = Object.freeze({
  TICK_RATE: 60,
  MAX_STEPS_PER_FRAME: 5,
  MAX_FRAME_DT: 0.25,
});

/** Default tuning: keep in sync with data/tuning.json (smoke test checks for drift). */
export const DEFAULT_TUNING = deepFreeze({
  version: 1,
  canvas: { width: 960, height: 540 },
  night: {
    length_s: 180,
    spawn_stop_s: 169,
    dawn_fade_start_s: 165,
    end_lights_fade_s: 2.0,
    end_screen_delay_s: 3.0,
  },
  lantern: {
    max_speed: 420,
    follow_lerp_per_s: 12,
    touch_offset_y: -60,
    brightness_rise_per_s: 0.9,
    brightness_fall_per_s: 2.5,
    dark_threshold: 0.05,
    intensity_per_brightness: 1.0,
    range_base: 40,
    range_per_brightness: 220,
    start_pos: [480, 400],
  },
  heat: {
    start_brightness: 0.6,
    full_brightness_span: 0.4,
    max_gain_per_s: 60,
    cool_per_s: 20,
    burn_at: 100,
    warn_ring_at: 40,
  },
  moth: {
    orbit_radius: 36,
    orbit_tangent_weight: 0.8,
    seek_weight: 1.0,
    separation_weight: 1.4,
    separation_radius: 14,
    wander_weight: 0.3,
    max_accel: 300,
    score_min_dist: 20,
    unattracted_speed_mult: 0.12,
    leave_after_unattracted_s: 20,
    gather_join_dist: 60,
    fade_s: 1.5,
    wander_turn_per_s: 3.0,
  },
  species: {
    dusty: { weight: 0.7, max_speed: 110, attract_mult: 1.0, heat_mult: 1.0, value: 1, size_px: 7 },
    silkwing: { weight: 0.2, max_speed: 170, attract_mult: 1.0, heat_mult: 1.6, value: 3, size_px: 6 },
    atlas: { weight: 0.1, max_speed: 80, attract_mult: 0.6, heat_mult: 0.5, value: 5, size_px: 10 },
  },
  spawn: {
    first_cluster_at_s: 1.0,
    first_cluster_size: 3,
    first_cluster_species: 'dusty',
    first_cluster_dist_from_lantern: 180,
    interval_s: 6.0,
    interval_jitter_s: 1.5,
    cluster_min: 3,
    cluster_max: 6,
    cluster_spread_px: 30,
    max_alive: 80,
    edges: ['left', 'right', 'bottom'],
  },
  moon: {
    intensity: 0.6,
    range: 240,
    capture_radius: 40,
    x_range_pct: [0.15, 0.85],
    y_range_pct: [0.12, 0.3],
    set_start_s: 135,
    set_drop_px: 120,
    set_end_intensity: 0.45,
  },
  candle: {
    count_start: 2,
    extra_at_s: [90],
    intensity: 0.35,
    flicker_amp: 0.08,
    flicker_hz: 8,
    range: 90,
    kill_radius: 14,
  },
  zapper: {
    on_at_s: [60, 115],
    warmup_s: 2.0,
    intensity: 0.55,
    range: 120,
    kill_radius: 18,
  },
  flower: {
    count: 4,
    bloom_window_s: [15, 150],
    bloom_duration_s: 23,
    intensity: 0.12,
    range: 90,
    hover_radius: 12,
  },
  placement: {
    hazard_y_pct: [0.26, 0.8],
    hazard_x_margin: 130,
    min_dist_hazard_to_moon: 220,
    min_dist_between_hazards: 120,
    min_dist_hazard_to_lantern_start: 160,
    max_attempts: 50,
  },
  scoring: {
    combo_window_s: 1.5,
    combo_step: 0.1,
    combo_max: 3.0,
    best_key: 'mothlight.best',
  },
  onboarding: {
    hint_hold_until_brightness: 0.5,
    hint_release_carry_min: 3,
    hint_release_moon_dist: 240,
    start_hold_s: 0.6,
  },
});

/**
 * Deep-merges `override` over `base` and returns a new plain object. Plain
 * objects recurse, while arrays and scalars replace. Keys starting with "_" are
 * designer comments and get dropped. Neither argument is mutated.
 * @param {any} base
 * @param {any} override
 * @returns {any}
 */
export function mergeTuning(base, override) {
  const out = cloneData(base);
  if (!isPlainObject(override)) return out;
  for (const key of Object.keys(override)) {
    if (key.startsWith('_')) continue;
    const value = override[key];
    out[key] = isPlainObject(out[key]) && isPlainObject(value)
      ? mergeTuning(out[key], value)
      : cloneData(value);
  }
  return out;
}

/**
 * Loads tuning JSON and merges it over DEFAULT_TUNING. Never throws: any
 * failure (missing file, file://, bad JSON) returns the defaults and the reason.
 * @param {string} [url]
 * @param {(url: string) => Promise<{ ok: boolean, status: number, json: () => Promise<any> }>} [fetchFn]
 * @returns {Promise<{ tuning: any, source: 'file' | 'default', error: string | null }>}
 */
export async function loadTuning(url = 'data/tuning.json', fetchFn = globalThis.fetch) {
  try {
    if (typeof fetchFn !== 'function') throw new Error('fetch unavailable');
    const response = await fetchFn(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const json = await response.json();
    return { tuning: mergeTuning(DEFAULT_TUNING, json), source: 'file', error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { tuning: mergeTuning(DEFAULT_TUNING, {}), source: 'default', error: message };
  }
}

/** @param {any} value @returns {boolean} */
function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Deep-copies JSON-like data (and drops "_" comment keys) so merged tuning is mutable and unshared. */
function cloneData(value) {
  if (Array.isArray(value)) return value.map(cloneData);
  if (!isPlainObject(value)) return value;
  /** @type {Record<string, any>} */
  const out = {};
  for (const key of Object.keys(value)) {
    if (!key.startsWith('_')) out[key] = cloneData(value[key]);
  }
  return out;
}

/** @template T @param {T} obj @returns {T} */
function deepFreeze(obj) {
  if (obj && typeof obj === 'object') {
    for (const key of Object.keys(obj)) deepFreeze(/** @type {any} */ (obj)[key]);
    Object.freeze(obj);
  }
  return obj;
}
