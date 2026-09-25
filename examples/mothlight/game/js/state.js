// @ts-check
/**
 * state.js [PURE]: game state machine (title → night → dawn), lantern,
 * scoring/combo, onboarding hints. stepGame() is the single sim entry point
 * used by main.js and tests/smoke.mjs. It must never touch the DOM.
 * Owner: gameplay-1 (scaffolded by tl-1). Rules: GDD §3.1, §3.7, §3.8, §6.
 */

import { createRng } from './rng.js';
import { EVENT, emit } from './events.js';
import { createSwarm, updateSwarm, countTargeting } from './moths.js';
import { createWorld, updateWorld, getLights, LIGHT_KIND } from './world.js';

export const STATE = Object.freeze({ TITLE: 'title', NIGHT: 'night', DAWN: 'dawn' });

const LANTERN_LIGHT_ID = 'lantern';
const SEED_MAX = 0x7fffffff;

/**
 * @typedef {{ x: number, y: number, held: boolean, pressed: boolean, released: boolean, hasPointer: boolean }} InputFrame
 * @typedef {{ x: number, y: number, vx: number, vy: number, brightness: number, held: boolean, dark: boolean }} Lantern
 * @typedef {{ id: string, kind: string, x: number, y: number, intensity: number, range: number, radius: number,
 *             lethal: boolean, scoring: boolean, orbit: boolean, active: boolean }} Light
 */

/**
 * Creates a new game in the title state.
 * @param {any} tuning  merged tuning (config.js mergeTuning output)
 * @param {number} seed  seed for the first night's garden
 * @returns {any} Game (shape in TDD.md)
 */
export function createGame(tuning, seed) {
  const rng = createRng(seed);
  return {
    tuning,
    state: STATE.TITLE,
    stateTime: 0,
    time: 0,
    tick: 0,
    seed,
    rng,
    holdTime: 0,
    night: { elapsed: 0, length: tuning.night.length_s },
    lantern: createLantern(tuning),
    world: createWorld(tuning, rng),
    swarm: createSwarm(tuning),
    score: createScore(),
    hints: { hold: true, release: false, brightReached: false, firstDelivery: false },
    best: 0,
    isNewBest: false,
    endFade: 0,
    events: [],
  };
}

/**
 * Advances the simulation by one fixed step.
 * @param {any} game
 * @param {InputFrame} input
 * @param {number} dt  seconds (fixed step)
 * @returns {void}
 */
export function stepGame(game, input, dt) {
  game.events = [];
  game.tick += 1;
  game.time += dt;
  game.stateTime += dt;
  game.holdTime = input.held ? game.holdTime + dt : 0;

  switch (game.state) {
    case STATE.TITLE: stepTitle(game, input, dt); break;
    case STATE.NIGHT: stepNight(game, input, dt); break;
    case STATE.DAWN: stepDawn(game, input, dt); break;
    default: throw new Error(`Unknown state ${game.state}`);
  }
}

/**
 * Starts a fresh night with a new procedural garden.
 * @param {any} game
 * @param {number} [seed]  defaults to a value drawn from game.rng
 * @returns {void}
 */
export function startNight(game, seed = game.rng.int(1, SEED_MAX)) {
  const { tuning } = game;
  game.seed = seed;
  game.rng = createRng(seed);
  game.world = createWorld(tuning, game.rng);
  game.swarm = createSwarm(tuning);
  game.score = createScore();
  game.night = { elapsed: 0, length: tuning.night.length_s };
  game.hints = { hold: !game.hints.brightReached, release: false, brightReached: game.hints.brightReached, firstDelivery: false };
  game.isNewBest = false;
  game.endFade = 0;
  setState(game, STATE.NIGHT);
  emit(game.events, EVENT.NIGHT_START, { seed });
}

/**
 * @param {any} game
 * @returns {number} night progress 0..1
 */
export function nightProgress(game) {
  return Math.min(1, game.night.elapsed / game.night.length);
}

/**
 * Seconds left until dawn (0 outside the night).
 * @param {any} game
 * @returns {number}
 */
export function secondsToDawn(game) {
  if (game.state !== STATE.NIGHT) return 0;
  return Math.max(0, game.night.length - game.night.elapsed);
}

/**
 * C1 combo multiplier for the n-th delivery of a group (1-based), capped at combo_max.
 * @param {number} count  delivery index in the group (0 = no group → 1)
 * @param {any} tuning
 * @returns {number}
 */
export function comboMultiplier(count, tuning) {
  const cfg = tuning.scoring;
  if (count <= 1) return 1;
  return Math.min(1 + cfg.combo_step * (count - 1), cfg.combo_max);
}

/**
 * Neutral input frame (no pointer, not held). Used by tests and before input exists.
 * @param {Partial<InputFrame>} [overrides]
 * @returns {InputFrame}
 */
export function createInputFrame(overrides = {}) {
  return { x: 0, y: 0, held: false, pressed: false, released: false, hasPointer: false, ...overrides };
}

/**
 * @param {any} tuning
 * @returns {Lantern}
 */
export function createLantern(tuning) {
  const [x, y] = tuning.lantern.start_pos;
  return { x, y, vx: 0, vy: 0, brightness: 0, held: false, dark: true };
}

/**
 * L1 exponential follow (speed-capped, clamped to canvas) and L3/L4 brightness ramp.
 * @param {Lantern} lantern
 * @param {InputFrame} input
 * @param {number} dt
 * @param {any} tuning
 * @returns {void}
 */
export function updateLantern(lantern, input, dt, tuning) {
  const cfg = tuning.lantern;
  const targetX = input.hasPointer ? input.x : lantern.x;
  const targetY = input.hasPointer ? input.y : lantern.y;
  let vx = (targetX - lantern.x) * cfg.follow_lerp_per_s;
  let vy = (targetY - lantern.y) * cfg.follow_lerp_per_s;
  const speed = Math.hypot(vx, vy);
  if (speed > cfg.max_speed) {
    vx *= cfg.max_speed / speed;
    vy *= cfg.max_speed / speed;
  }
  lantern.vx = vx;
  lantern.vy = vy;
  lantern.x = clamp(lantern.x + vx * dt, 0, tuning.canvas.width);
  lantern.y = clamp(lantern.y + vy * dt, 0, tuning.canvas.height);

  lantern.held = input.held;
  const rate = input.held ? cfg.brightness_rise_per_s : -cfg.brightness_fall_per_s;
  lantern.brightness = clamp(lantern.brightness + rate * dt, 0, 1);
  lantern.dark = lantern.brightness < cfg.dark_threshold;
}

/**
 * L5 lantern range in px for a brightness.
 * @param {number} brightness
 * @param {any} tuning
 * @returns {number}
 */
export function lanternRange(brightness, tuning) {
  return tuning.lantern.range_base + tuning.lantern.range_per_brightness * brightness;
}

/**
 * The lantern as a Light, or null when dark (L4: a dark lantern emits nothing).
 * @param {Lantern} lantern
 * @param {any} tuning
 * @returns {Light | null}
 */
export function lanternToLight(lantern, tuning) {
  if (lantern.dark) return null;
  return {
    id: LANTERN_LIGHT_ID,
    kind: LIGHT_KIND.LANTERN,
    x: lantern.x,
    y: lantern.y,
    intensity: lantern.brightness * tuning.lantern.intensity_per_brightness,
    range: lanternRange(lantern.brightness, tuning),
    radius: 0,
    lethal: false,
    scoring: false,
    orbit: true,
    active: true,
  };
}

// ---------------------------------------------------------------- private

function createScore() {
  return { points: 0, delivered: 0, singed: 0, lostToLights: 0, lost: 0, combo: { count: 0, timer: 0, points: 0 } };
}

function setState(game, state) {
  game.state = state;
  game.stateTime = 0;
}

function stepTitle(game, input, dt) {
  updateLantern(game.lantern, input, dt, game.tuning);
  if (game.holdTime >= game.tuning.onboarding.start_hold_s) startNight(game);
}

function stepNight(game, input, dt) {
  const { tuning } = game;
  updateLantern(game.lantern, input, dt, tuning);
  simulateWorldAndSwarm(game, dt, { endFade: 0, spawning: game.night.elapsed < tuning.night.spawn_stop_s, fleeing: false });
  applyScoring(game);
  tickCombo(game, dt);
  updateHints(game);

  game.night.elapsed += dt;
  if (game.night.elapsed >= game.night.length) enterDawn(game);
}

function stepDawn(game, input, dt) {
  const { tuning } = game;
  // N3: input is ignored and the lantern goes dark while the lights fade.
  updateLantern(game.lantern, createInputFrame(), dt, tuning);
  game.endFade = Math.min(1, game.stateTime / tuning.night.end_lights_fade_s);
  simulateWorldAndSwarm(game, dt, { endFade: game.endFade, spawning: false, fleeing: true });

  const endScreenShown = game.stateTime >= tuning.night.end_screen_delay_s;
  // Only a hold that happens while the end screen is visible counts toward a restart.
  if (!endScreenShown) game.holdTime = 0;
  if (endScreenShown && game.holdTime >= tuning.onboarding.start_hold_s) startNight(game);
}

function simulateWorldAndSwarm(game, dt, phase) {
  const { tuning, rng } = game;
  const nightTime = Math.min(game.night.elapsed, game.night.length);
  updateWorld(game.world, { tuning, rng, nightTime, endFade: phase.endFade, events: game.events }, dt);

  const lights = getLights(game.world);
  const lanternLight = lanternToLight(game.lantern, tuning);
  if (lanternLight) lights.unshift(lanternLight);

  updateSwarm(game.swarm, {
    tuning,
    rng,
    width: tuning.canvas.width,
    height: tuning.canvas.height,
    lantern: game.lantern,
    lights,
    nightTime,
    spawning: phase.spawning,
    fleeing: phase.fleeing,
    events: game.events,
  }, dt);
}

/** C1/C2: scores deliveries and tallies losses from this tick's moth events. */
function applyScoring(game) {
  const { score } = game;
  const cfg = game.tuning.scoring;
  for (const event of game.events) {
    switch (event.type) {
      case EVENT.MOTH_DELIVERED: {
        const combo = score.combo;
        combo.count = combo.timer > 0 ? combo.count + 1 : 1;
        combo.timer = cfg.combo_window_s;
        const points = event.value * comboMultiplier(combo.count, game.tuning);
        event.comboIndex = combo.count - 1;
        event.points = points;
        combo.points += points;
        score.points += points;
        score.delivered += 1;
        game.hints.firstDelivery = true;
        break;
      }
      case EVENT.MOTH_SINGED: score.singed += 1; break;
      case EVENT.MOTH_ZAPPED:
      case EVENT.MOTH_CANDLED: score.lostToLights += 1; break;
      case EVENT.MOTH_LOST: score.lost += 1; break;
      default: break;
    }
  }
}

function tickCombo(game, dt) {
  const combo = game.score.combo;
  if (combo.count === 0) return;
  combo.timer -= dt;
  if (combo.timer <= 0) closeCombo(game);
}

function closeCombo(game) {
  const combo = game.score.combo;
  if (combo.count > 0) emit(game.events, EVENT.COMBO_END, { count: combo.count, points: combo.points });
  combo.count = 0;
  combo.timer = 0;
  combo.points = 0;
}

/** GDD §6 hints: "hold to glow" until b first passes the threshold, then "let go under the moon". */
function updateHints(game) {
  const { hints, lantern, tuning } = game;
  const cfg = tuning.onboarding;
  if (lantern.brightness > cfg.hint_hold_until_brightness) hints.brightReached = true;
  hints.hold = !hints.brightReached;

  const moon = game.world.moon;
  const nearMoon = moon && Math.hypot(lantern.x - moon.x, lantern.y - moon.y) <= cfg.hint_release_moon_dist;
  const carrying = countTargeting(game.swarm, LANTERN_LIGHT_ID) >= cfg.hint_release_carry_min;
  hints.release = !hints.firstDelivery && Boolean(nearMoon) && carrying;
}

function enterDawn(game) {
  closeCombo(game);
  const { score } = game;
  game.isNewBest = score.points > game.best;
  if (game.isNewBest) game.best = score.points;
  game.hints.hold = false;
  game.hints.release = false;
  setState(game, STATE.DAWN);
  emit(game.events, EVENT.NIGHT_END, {
    points: score.points,
    delivered: score.delivered,
    singed: score.singed,
    lostToLights: score.lostToLights,
    lost: score.lost,
    best: game.best,
    isNewBest: game.isNewBest,
  });
}

function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value;
}
