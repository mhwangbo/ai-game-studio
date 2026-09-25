// @ts-check
/**
 * world.js [PURE]: the procedural night garden. Moon (W1), candles (W2),
 * zappers (W3), decoy flowers (W4), placement (W5) and silhouettes for render.
 * Owner: gameplay-3. Must not import moths.js or touch the DOM.
 *
 * Night-length scaling: every world timing in tuning (zapper.on_at_s,
 * candle.extra_at_s, moon.set_start_s, flower.bloom_window_s/duration_s,
 * night.dawn_fade_start_s) is authored for a reference night of
 * `night.timeline_ref_s` seconds (defaults to `night.length_s`, i.e. no scaling).
 * They are multiplied by `timelineScale(tuning)` so a shorter night keeps the
 * same pacing. All randomness is rolled in createWorld, so updateWorld never
 * consumes the shared sim rng (moth rolls stay independent of world ticks).
 */

import { EVENT, emit } from './events.js';

export const LIGHT_KIND = Object.freeze({
  LANTERN: 'lantern',
  MOON: 'moon',
  CANDLE: 'candle',
  ZAPPER: 'zapper',
  FLOWER: 'flower',
});

/** Silhouette generation (pure visual layout, not gameplay tuning). */
const SILHOUETTE = Object.freeze({
  STEP_PX: 32,                 // horizontal spacing of ridge control points
  FAR_BASE_PCT: 0.70,          // far hedge line, fraction of canvas height
  FAR_AMPLITUDE_PX: 34,
  NEAR_BASE_PCT: 0.93,         // near fence/grass line
  NEAR_AMPLITUDE_PX: 14,
  TREE_COUNT: 3,
  TREE_RADIUS_PX: [34, 58],
  TREE_POINTS: 14,
  TREE_WOBBLE: 0.18,           // radius jitter as a fraction of the tree radius
});
/** Flower open/close animation length for render (visual only; gameplay uses `active`). */
const FLOWER_OPEN_S = 0.8;
/** Candle flicker: value-noise hash constants (arbitrary large odd primes). */
const HASH_A = 0x27d4eb2d;
const HASH_B = 0x165667b1;
const UINT32 = 4294967296;
const SEED_MAX = 0x7fffffff;
/** JAM-11: extra sampling budget (× placement.max_attempts) for hazards with a hard keep-out. */
const KEEP_OUT_ATTEMPT_MULT = 4;
/**
 * JAM-19: S1 moths overshoot and orbit past the lantern start (up to ~80 px at b~0.7), so a
 * start candle's pull disc must also stay this far beyond its range from the lantern start.
 */
const START_ORBIT_CLEARANCE_PX = 110;

/**
 * @typedef {import('./state.js').Light} Light
 * @typedef {Light & { onAt: number, offAt: number, baseIntensity: number, noiseSeed: number,
 *                     lit: boolean, warmup: number, openness: number }} WorldLight
 *   onAt/offAt: s of night time the light is active in (0/Infinity = always).
 *   warmup: zapper 0..1 (1 = lethal). openness: flower bloom 0..1 for render.
 * @typedef {{ layer: 'far' | 'near', points: { x: number, y: number }[] }} Silhouette
 * @typedef {{ width: number, height: number, moon: WorldLight, candles: WorldLight[], zappers: WorldLight[],
 *             flowers: WorldLight[], silhouettes: Silhouette[],
 *             moonBase: { x: number, y: number }, moonSet: { start: number, end: number } }} World
 * @typedef {{ ax: number, ay: number, bx: number, by: number, clearance: number, startClearance: number }} KeepOut
 *   JAM-11/19 tutorial keep-out: segment a→b (S1 spawn → lantern start) plus a disc around b.
 * @typedef {{ tuning: any, rng: import('./rng.js').Rng, nightTime: number, endFade: number,
 *             events?: import('./events.js').GameEvent[] }} WorldContext
 *   `events` is optional: when present, world emits LIGHT_ON into it.
 */

/**
 * Multiplier from authored timings to this night's timings (length_s / timeline_ref_s).
 * @param {any} tuning
 * @returns {number}
 */
export function timelineScale(tuning) {
  const length = tuning.night.length_s;
  const ref = tuning.night.timeline_ref_s ?? length;
  return ref > 0 ? length / ref : 1;
}

/**
 * Builds one night's garden from the seeded rng: W1 moon, W5 placement of
 * candles (incl. future ones, unlit), zappers (unlit until on_at), flowers, and silhouettes.
 * @param {any} tuning
 * @param {import('./rng.js').Rng} rng
 * @returns {World}
 */
export function createWorld(tuning, rng) {
  const { width, height } = tuning.canvas;
  const k = timelineScale(tuning);
  const moon = createMoon(tuning, rng);
  const placed = [{ x: moon.x, y: moon.y }];

  const candleCfg = tuning.candle;
  const candleTimes = [];
  for (let i = 0; i < candleCfg.count_start; i += 1) candleTimes.push(0);
  for (const at of candleCfg.extra_at_s) candleTimes.push(at * k);
  // JAM-11/JAM-19: candles lit from t=0 must not reach the S1 tutorial moths on their way to the
  // lantern, nor while they orbit/overshoot it at the start position.
  const tutorial = tutorialClearance(tuning, candleCfg.range);
  const candles = candleTimes.map((onAt, i) => {
    const pos = placeHazard(tuning, rng, placed, onAt === 0 ? tutorial : null);
    return makeLight(`candle-${i}`, LIGHT_KIND.CANDLE, pos, candleCfg.intensity, candleCfg.range,
      candleCfg.kill_radius, { lethal: true, onAt, noiseSeed: rng.int(1, SEED_MAX) });
  });

  const zapCfg = tuning.zapper;
  const zappers = zapCfg.on_at_s.map((at, i) => {
    const pos = placeHazard(tuning, rng, placed);
    return makeLight(`zapper-${i}`, LIGHT_KIND.ZAPPER, pos, zapCfg.intensity, zapCfg.range,
      zapCfg.kill_radius, { lethal: false, onAt: at * k, noiseSeed: rng.int(1, SEED_MAX) });
  });

  const flowerCfg = tuning.flower;
  const flowers = [];
  for (let i = 0; i < flowerCfg.count; i += 1) {
    const pos = placeHazard(tuning, rng, placed);
    const onAt = rng.between(flowerCfg.bloom_window_s) * k;
    flowers.push(makeLight(`flower-${i}`, LIGHT_KIND.FLOWER, pos, flowerCfg.intensity, flowerCfg.range,
      flowerCfg.hover_radius, { orbit: true, onAt, offAt: onAt + flowerCfg.bloom_duration_s * k,
        noiseSeed: rng.int(1, SEED_MAX) }));
  }

  return {
    width,
    height,
    moon,
    candles,
    zappers,
    flowers,
    silhouettes: createSilhouettes(width, height, rng),
    moonBase: { x: moon.x, y: moon.y },
    moonSet: { start: tuning.moon.set_start_s * k, end: tuning.night.length_s },
  };
}

/**
 * Time-driven changes: W2 flicker + extra candle, W3 zapper warm-up, W1 moon
 * setting, W4 flower blooms, N3 endFade dimming (every light off at endFade 1).
 * Emits LIGHT_ON (extra candle, zapper warm-up start, flower bloom) when ctx.events is given.
 * @param {World} world
 * @param {WorldContext} ctx
 * @param {number} dt
 * @returns {void}
 */
// eslint-disable-next-line no-unused-vars
export function updateWorld(world, ctx, dt) {
  const { tuning, nightTime: t } = ctx;
  const fade = 1 - clamp01(ctx.endFade);
  updateMoon(world, tuning, t, fade);
  for (const candle of world.candles) updateCandle(candle, tuning.candle, t, fade, ctx.events);
  for (const zapper of world.zappers) updateZapper(zapper, tuning.zapper, t, fade, ctx.events);
  for (const flower of world.flowers) updateFlower(flower, t, fade, ctx.events);
}

/**
 * All active world lights (never the lantern), as a fresh array the caller may modify.
 * @param {World} world
 * @returns {Light[]}
 */
export function getLights(world) {
  /** @type {Light[]} */
  const lights = [];
  if (world.moon.active) lights.push(world.moon);
  pushActive(lights, world.candles);
  pushActive(lights, world.zappers);
  pushActive(lights, world.flowers);
  return lights;
}

// ---------------------------------------------------------------- private

/** @param {Light[]} out @param {WorldLight[]} group */
function pushActive(out, group) {
  for (let i = 0; i < group.length; i += 1) if (group[i].active) out.push(group[i]);
}

/**
 * @param {string} id @param {string} kind @param {{ x: number, y: number }} pos
 * @param {number} intensity @param {number} range @param {number} radius
 * @param {{ lethal?: boolean, scoring?: boolean, orbit?: boolean, onAt?: number, offAt?: number, noiseSeed?: number }} opts
 * @returns {WorldLight}
 */
function makeLight(id, kind, pos, intensity, range, radius, opts) {
  return {
    id,
    kind,
    x: pos.x,
    y: pos.y,
    intensity: 0,
    range,
    radius,
    lethal: opts.lethal ?? false,
    scoring: opts.scoring ?? false,
    orbit: opts.orbit ?? false,
    active: false,
    onAt: opts.onAt ?? 0,
    offAt: opts.offAt ?? Infinity,
    baseIntensity: intensity,
    noiseSeed: opts.noiseSeed ?? 1,
    lit: false,
    warmup: 0,
    openness: 0,
  };
}

/** W1: moon somewhere in its allowed band, lit from the start. */
function createMoon(tuning, rng) {
  const { width, height } = tuning.canvas;
  const cfg = tuning.moon;
  const pos = { x: width * rng.between(cfg.x_range_pct), y: height * rng.between(cfg.y_range_pct) };
  const moon = makeLight('moon', LIGHT_KIND.MOON, pos, cfg.intensity, cfg.range, cfg.capture_radius, { scoring: true });
  moon.intensity = cfg.intensity;
  moon.active = true;
  moon.lit = true;
  moon.openness = 1;
  return moon;
}

/**
 * JAM-11 / GDD S1: the first cluster spawns first_cluster_dist_from_lantern px from the lantern
 * start toward the nearest side edge (mirrors moths.js spawnFirstCluster; world must not import it)
 * and flies straight to the lantern. A start candle must stay farther than its range plus the
 * cluster spread from that whole segment, so the tutorial never teaches "moths die" first.
 * JAM-19: it must also stay range + START_ORBIT_CLEARANCE_PX from the lantern start itself, since
 * the arriving moths overshoot and orbit there (far-side candles stole them in 7/200 seeds).
 * @param {any} tuning @param {number} range  candle pull range
 * @returns {KeepOut}
 */
function tutorialClearance(tuning, range) {
  const [startX, startY] = tuning.lantern.start_pos;
  const towardLeft = startX <= tuning.canvas.width / 2;
  const spawnX = startX + (towardLeft ? -1 : 1) * tuning.spawn.first_cluster_dist_from_lantern;
  // spawnCluster jitters ±spread on each axis, so a moth can land up to spread·√2 from the centre.
  return { ax: spawnX, ay: startY, bx: startX, by: startY, clearance: range + tuning.spawn.cluster_spread_px * Math.SQRT2,
    startClearance: range + START_ORBIT_CLEARANCE_PX };
}

/**
 * W5 rejection sampling: up to max_attempts candidates; the first that meets every
 * distance rule wins, otherwise the one with the largest worst-case slack.
 * Appends the chosen point to `placed` (index 0 is the moon).
 * `keepOut` (JAM-11/19) is an extra segment the light must stay `clearance` px away from, plus a
 * `startClearance` px disc around its end (the lantern start).
 * @param {any} tuning @param {import('./rng.js').Rng} rng @param {{ x: number, y: number }[]} placed
 * @param {KeepOut | null} [keepOut]
 * @returns {{ x: number, y: number }}
 */
function placeHazard(tuning, rng, placed, keepOut = null) {
  const cfg = tuning.placement;
  const { width, height } = tuning.canvas;
  const [startX, startY] = tuning.lantern.start_pos;
  let best = { x: width / 2, y: height / 2 };
  let bestSlack = -Infinity;
  let bestKeepOk = false;
  // The keep-out is a hard rule: a candidate that honours it beats any that doesn't, and we
  // sample a little longer (bounded) rather than fall back to a tutorial-breaking spot.
  const maxAttempts = keepOut ? cfg.max_attempts * KEEP_OUT_ATTEMPT_MULT : cfg.max_attempts;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (attempt >= cfg.max_attempts && bestKeepOk) break;
    const x = rng.range(cfg.hazard_x_margin, width - cfg.hazard_x_margin);
    const y = height * rng.between(cfg.hazard_y_pct);
    let slack = Math.hypot(x - startX, y - startY) - cfg.min_dist_hazard_to_lantern_start;
    for (let i = 0; i < placed.length; i += 1) {
      const need = i === 0 ? cfg.min_dist_hazard_to_moon : cfg.min_dist_between_hazards;
      slack = Math.min(slack, Math.hypot(x - placed[i].x, y - placed[i].y) - need);
    }
    const keepOk = !keepOut || (distToSegment(x, y, keepOut) > keepOut.clearance
      && Math.hypot(x - keepOut.bx, y - keepOut.by) > keepOut.startClearance);
    if ((keepOk && !bestKeepOk) || (keepOk === bestKeepOk && slack > bestSlack)) {
      bestSlack = slack;
      bestKeepOk = keepOk;
      best = { x, y };
    }
    if (keepOk && slack >= 0) break;
  }
  placed.push(best);
  return best;
}

/** W1: sinks set_drop_px and dims to set_end_intensity between set start and night end. */
function updateMoon(world, tuning, t, fade) {
  const cfg = tuning.moon;
  const { start, end } = world.moonSet;
  const p = end > start ? clamp01((t - start) / (end - start)) : (t >= start ? 1 : 0);
  const moon = world.moon;
  moon.y = world.moonBase.y + cfg.set_drop_px * p;
  moon.intensity = lerp(cfg.intensity, cfg.set_end_intensity, p) * fade;
  moon.active = fade > 0;
}

/** W2: candles flicker with smooth value noise at flicker_hz; the extra candle lights at its onAt. */
function updateCandle(candle, cfg, t, fade, events) {
  const on = t >= candle.onAt;
  if (on && !candle.lit && candle.onAt > 0) emitLightOn(events, candle);
  candle.lit = on;
  const flicker = valueNoise(t * cfg.flicker_hz, candle.noiseSeed) * cfg.flicker_amp;
  candle.intensity = on ? Math.max(0, (candle.baseIntensity + flicker) * fade) : 0;
  candle.active = on && fade > 0;
  candle.openness = on ? 1 : 0;
}

/** W3: inactive until onAt, then warm-up ramps intensity 0→max; lethal only once fully warm. */
function updateZapper(zapper, cfg, t, fade, events) {
  const on = t >= zapper.onAt;
  if (on && !zapper.lit) emitLightOn(events, zapper);
  zapper.lit = on;
  zapper.warmup = on ? (cfg.warmup_s > 0 ? clamp01((t - zapper.onAt) / cfg.warmup_s) : 1) : 0;
  zapper.intensity = zapper.baseIntensity * zapper.warmup * fade;
  zapper.lethal = zapper.warmup >= 1;
  zapper.active = on && fade > 0;
}

/** W4: blooms once for its window; openness eases in/out for render only. */
function updateFlower(flower, t, fade, events) {
  const on = t >= flower.onAt && t < flower.offAt;
  if (on && !flower.lit) emitLightOn(events, flower);
  flower.lit = on;
  flower.intensity = on ? flower.baseIntensity * fade : 0;
  flower.active = on && fade > 0;
  const opening = clamp01((t - flower.onAt) / FLOWER_OPEN_S);
  const closing = clamp01((flower.offAt - t) / FLOWER_OPEN_S);
  flower.openness = t < flower.onAt || t >= flower.offAt ? 0 : Math.min(opening, closing) * fade;
}

function emitLightOn(events, light) {
  if (events) emit(events, EVENT.LIGHT_ON, { lightId: light.id, kind: light.kind });
}

/**
 * Far hedge ridge (+ a few round tree crowns) and a near fence/grass ridge,
 * as closed polygons render fills with smoothed curves.
 * @param {number} width @param {number} height @param {import('./rng.js').Rng} rng
 * @returns {Silhouette[]}
 */
function createSilhouettes(width, height, rng) {
  /** @type {Silhouette[]} */
  const out = [];
  for (let i = 0; i < SILHOUETTE.TREE_COUNT; i += 1) {
    const r = rng.between(SILHOUETTE.TREE_RADIUS_PX);
    const cx = rng.range(0, width);
    const cy = height * SILHOUETTE.FAR_BASE_PCT - r * 0.6;
    out.push({ layer: 'far', points: blob(cx, cy, r, rng) });
  }
  out.push({ layer: 'far', points: ridge(width, height, height * SILHOUETTE.FAR_BASE_PCT, SILHOUETTE.FAR_AMPLITUDE_PX, rng) });
  out.push({ layer: 'near', points: ridge(width, height, height * SILHOUETTE.NEAR_BASE_PCT, SILHOUETTE.NEAR_AMPLITUDE_PX, rng) });
  return out;
}

/** Noise-offset ridgeline closed along the bottom edge. */
function ridge(width, height, baseY, amplitude, rng) {
  const points = [{ x: 0, y: height }];
  const steps = Math.ceil(width / SILHOUETTE.STEP_PX);
  let drift = 0;
  for (let i = 0; i <= steps; i += 1) {
    // Random walk pulled back to the base line gives rolling, organic hedges.
    drift = drift * 0.6 + rng.range(-1, 1) * 0.8;
    points.push({ x: Math.min(width, i * SILHOUETTE.STEP_PX), y: baseY + drift * amplitude });
  }
  points.push({ x: width, y: height });
  return points;
}

/** Wobbly round crown (organic, no hard angles). */
function blob(cx, cy, r, rng) {
  const points = [];
  for (let i = 0; i < SILHOUETTE.TREE_POINTS; i += 1) {
    const a = (i / SILHOUETTE.TREE_POINTS) * Math.PI * 2;
    const rr = r * (1 + rng.range(-SILHOUETTE.TREE_WOBBLE, SILHOUETTE.TREE_WOBBLE));
    points.push({ x: cx + Math.cos(a) * rr, y: cy + Math.sin(a) * rr });
  }
  return points;
}

/** Smooth 1D value noise in [-1, 1], deterministic per seed (no rng consumption per tick). */
function valueNoise(x, seed) {
  const i = Math.floor(x);
  const f = x - i;
  const s = f * f * (3 - 2 * f);
  return lerp(hash01(i, seed), hash01(i + 1, seed), s) * 2 - 1;
}

/** Integer hash → [0, 1). */
function hash01(n, seed) {
  let h = Math.imul(n ^ seed, HASH_A);
  h ^= h >>> 15;
  h = Math.imul(h, HASH_B);
  h ^= h >>> 13;
  return (h >>> 0) / UINT32;
}

/** Distance from (x, y) to the segment a→b. */
function distToSegment(x, y, seg) {
  const dx = seg.bx - seg.ax;
  const dy = seg.by - seg.ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? clamp01(((x - seg.ax) * dx + (y - seg.ay) * dy) / len2) : 0;
  return Math.hypot(x - (seg.ax + dx * t), y - (seg.ay + dy * t));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
