// @ts-check
/**
 * moths.js [PURE]: the swarm. Spawning (GDD S1-S3), steering (M1-M5),
 * heat/singe (H1-H4), captures by moon/candle/zapper (W1-W3), flower orbit (W4).
 * Owner: gameplay-2.
 * Must not import world.js or touch the DOM. Everything comes in through SimContext.
 * Hot loop rules (TDD): no closures, spread or map/filter per moth per tick;
 * the separation grid's typed arrays live on the swarm and are reused.
 */

import { EVENT, emit } from './events.js';

export const SPECIES = Object.freeze({ DUSTY: 'dusty', SILKWING: 'silkwing', ATLAS: 'atlas' });

export const MOTH_STATUS = Object.freeze({
  FREE: 'free',
  DRAWN: 'drawn',
  FLEEING: 'fleeing',
  SINGED: 'singed',
  CAPTURED: 'captured',
  DELIVERED: 'delivered',
  LOST: 'lost',
});

// Light ids/kinds are a shared string contract (TDD "Light"). moths.js may not import
// world.js, so the two values it needs to tell apart are mirrored here.
const LANTERN_ID = 'lantern';
const KIND_ZAPPER = 'zapper';

// Fallbacks for knobs requested from gd-1 (not yet in tuning.json). Read via `??`.
const DEFAULT_FADE_S = 1.5;              // H3: ash puff drifts 1.5 s; reused for every exit animation
const DEFAULT_WANDER_TURN_PER_S = 3.0;   // rad/s max random turn of the wander heading

// Pure-visual constant for render: wing phase advance per px travelled, plus an idle beat.
const FLAP_RAD_PER_PX = 0.12;
const FLAP_IDLE_RAD_PER_S = 6;
const TWO_PI = Math.PI * 2;

/**
 * @typedef {{ id: number, species: string, x: number, y: number, vx: number, vy: number, heat: number,
 *             status: string, targetId: string | null, joined: boolean, unattracted: number,
 *             flap: number, fade: number, wander: number, leaving: boolean }} Moth
 *   `wander` = wander heading (rad); `leaving` = M4 edge departure in progress (status FLEEING).
 * @typedef {{ cols: number, rows: number, cell: number, cellStart: Int32Array, cellFill: Int32Array,
 *             items: Int32Array, mothCell: Int32Array }} SeparationGrid
 * @typedef {{ moths: Moth[], nextId: number, spawnTimer: number, firstSpawnDone: boolean,
 *             grid: SeparationGrid | null, scratch: { x: number, y: number } }} Swarm
 *   `grid` and `scratch` are reusable temporaries (no per-tick allocation); they hold no game state.
 * @typedef {{ tuning: any, rng: import('./rng.js').Rng, width: number, height: number, lantern: any,
 *             lights: import('./state.js').Light[], nightTime: number, spawning: boolean, fleeing: boolean,
 *             events: import('./events.js').GameEvent[] }} SimContext
 */

/**
 * Creates an empty swarm. The first cluster (S1) is due at spawn.first_cluster_at_s of night time.
 * @param {any} tuning
 * @returns {Swarm}
 */
export function createSwarm(tuning) {
  return { moths: [], nextId: 1, spawnTimer: tuning.spawn.first_cluster_at_s, firstSpawnDone: false, grid: null, scratch: { x: 0, y: 0 } };
}

/**
 * Advances every moth one step: spawn (S1-S3), steer (M1-M5), heat (H1-H3),
 * captures (W1-W3), M4/dawn departures, then fades and removes finished moths.
 * @param {Swarm} swarm
 * @param {SimContext} ctx
 * @param {number} dt
 * @returns {void}
 */
export function updateSwarm(swarm, ctx, dt) {
  if (ctx.spawning) updateSpawning(swarm, ctx, dt);
  buildGrid(swarm, ctx);

  const moths = swarm.moths;
  for (let i = 0; i < moths.length; i += 1) {
    const moth = moths[i];
    if (isAlive(moth)) updateMoth(swarm, moth, i, ctx, dt);
  }
  removeFinished(swarm, dt);
}

/**
 * Spawns `count` moths around (x, y) within spawn.cluster_spread_px and emits MOTH_SPAWNED.
 * New moths head toward the canvas centre so edge spawns drift on-screen.
 * @param {Swarm} swarm
 * @param {SimContext} ctx
 * @param {number} x
 * @param {number} y
 * @param {number} count
 * @param {string | null} [species]  null = roll by species weight
 * @returns {Moth[]}
 */
export function spawnCluster(swarm, ctx, x, y, count, species = null) {
  const { tuning, rng } = ctx;
  const spread = tuning.spawn.cluster_spread_px;
  /** @type {Moth[]} */
  const spawned = [];
  for (let i = 0; i < count; i += 1) {
    const kind = species ?? rollSpecies(tuning, rng);
    const mx = x + rng.range(-spread, spread);
    const my = y + rng.range(-spread, spread);
    const heading = Math.atan2(ctx.height / 2 - my, ctx.width / 2 - mx);
    const speed = tuning.species[kind].max_speed * tuning.moth.unattracted_speed_mult;
    /** @type {Moth} */
    const moth = {
      id: swarm.nextId++,
      species: kind,
      x: mx,
      y: my,
      vx: Math.cos(heading) * speed,
      vy: Math.sin(heading) * speed,
      heat: 0,
      status: MOTH_STATUS.FREE,
      targetId: null,
      joined: false,
      unattracted: 0,
      flap: rng.range(0, TWO_PI),
      fade: 0,
      wander: heading,
      leaving: false,
    };
    swarm.moths.push(moth);
    spawned.push(moth);
    emit(ctx.events, EVENT.MOTH_SPAWNED, { mothId: moth.id, species: kind, x: mx, y: my });
  }
  return spawned;
}

/**
 * @param {Swarm} swarm
 * @returns {number} moths still flying (free / drawn / fleeing)
 */
export function countAlive(swarm) {
  let alive = 0;
  for (const moth of swarm.moths) if (isAlive(moth)) alive += 1;
  return alive;
}

/**
 * @param {Swarm} swarm
 * @returns {number} highest heat % among living moths (0..100)
 */
export function hottestHeat(swarm) {
  let hottest = 0;
  for (const moth of swarm.moths) {
    if (isAlive(moth) && moth.heat > hottest) hottest = moth.heat;
  }
  return hottest;
}

/**
 * @param {Swarm} swarm
 * @param {string} lightId
 * @returns {number} living moths whose current target is lightId
 */
export function countTargeting(swarm, lightId) {
  let count = 0;
  for (const moth of swarm.moths) {
    if (moth.targetId === lightId && isAlive(moth)) count += 1;
  }
  return count;
}

/**
 * H4 warning-ring alpha for render: 0 below heat.warn_ring_at, rising linearly to 1 at heat.burn_at.
 * @param {Moth} moth
 * @param {any} tuning
 * @returns {number} 0..1
 */
export function heatWarning(moth, tuning) {
  const { warn_ring_at: warnAt, burn_at: burnAt } = tuning.heat;
  if (!isAlive(moth) || moth.heat < warnAt) return 0;
  return Math.min(1, (moth.heat - warnAt) / (burnAt - warnAt));
}

/**
 * @param {Moth} moth
 * @returns {boolean} true while the moth is flying (free / drawn / fleeing)
 */
export function isAlive(moth) {
  return moth.status === MOTH_STATUS.FREE || moth.status === MOTH_STATUS.DRAWN || moth.status === MOTH_STATUS.FLEEING;
}

// ---------------------------------------------------------------- spawning (S1-S3)

function updateSpawning(swarm, ctx, dt) {
  swarm.spawnTimer -= dt;
  if (swarm.spawnTimer > 0) return;

  const cfg = ctx.tuning.spawn;
  swarm.spawnTimer += cfg.interval_s + ctx.rng.range(-cfg.interval_jitter_s, cfg.interval_jitter_s);
  // S3: the cap is a hard ceiling, so a cluster is trimmed rather than overshooting it.
  const room = cfg.max_alive - countAlive(swarm);
  if (room <= 0) return;

  if (!swarm.firstSpawnDone) {
    swarm.firstSpawnDone = true;
    spawnFirstCluster(swarm, ctx, room);
    return;
  }
  const count = Math.min(room, ctx.rng.int(cfg.cluster_min, cfg.cluster_max));
  const edge = ctx.rng.pick(cfg.edges);
  // The cluster centre sits one spread outside the edge, so every moth starts just off-screen.
  const off = cfg.cluster_spread_px;
  let x = 0;
  let y = 0;
  if (edge === 'left') { x = -off; y = ctx.rng.range(0, ctx.height); }
  else if (edge === 'right') { x = ctx.width + off; y = ctx.rng.range(0, ctx.height); }
  else { x = ctx.rng.range(0, ctx.width); y = ctx.height + off; }
  spawnCluster(swarm, ctx, x, y, count, null);
}

/** S1: a small, known cluster near the lantern start, toward the nearest side edge, teaches the glow. */
function spawnFirstCluster(swarm, ctx, room) {
  const cfg = ctx.tuning.spawn;
  const [startX, startY] = ctx.tuning.lantern.start_pos;
  const towardLeft = startX <= ctx.width / 2;
  const x = startX + (towardLeft ? -1 : 1) * cfg.first_cluster_dist_from_lantern;
  spawnCluster(swarm, ctx, x, startY, Math.min(room, cfg.first_cluster_size), cfg.first_cluster_species);
}

function rollSpecies(tuning, rng) {
  let total = 0;
  for (const key in tuning.species) total += tuning.species[key].weight;
  let roll = rng.next() * total;
  let last = SPECIES.DUSTY;
  for (const key in tuning.species) {
    last = key;
    roll -= tuning.species[key].weight;
    if (roll < 0) return key;
  }
  return last;
}

// ---------------------------------------------------------------- per-moth update

function updateMoth(swarm, moth, index, ctx, dt) {
  const { tuning } = ctx;
  const spec = tuning.species[moth.species];
  const cfg = tuning.moth;

  if (ctx.fleeing && !moth.leaving) startLeaving(moth);
  const target = moth.leaving ? null : selectTarget(moth, ctx.lights, spec.attract_mult, cfg.score_min_dist);
  updateTargetState(moth, target, ctx, cfg);

  let speedCap = spec.max_speed;
  let ax = 0;
  let ay = 0;
  if (moth.leaving) {
    const dir = nearestEdgeDir(swarm.scratch, moth.x, moth.y, ctx.width, ctx.height);
    ax += seekAxis(dir.x * speedCap, moth.vx, cfg.max_accel) * cfg.seek_weight;
    ay += seekAxis(dir.y * speedCap, moth.vy, cfg.max_accel) * cfg.seek_weight;
  } else if (target) {
    const force = seekLight(swarm.scratch, moth, target, speedCap, cfg);
    ax += force.x;
    ay += force.y;
  } else {
    // M4: no light in range, so drift slowly along the wander heading and count the time.
    speedCap *= cfg.unattracted_speed_mult;
    ax += seekAxis(Math.cos(moth.wander) * speedCap, moth.vx, cfg.max_accel) * cfg.seek_weight;
    ay += seekAxis(Math.sin(moth.wander) * speedCap, moth.vy, cfg.max_accel) * cfg.seek_weight;
    moth.unattracted += dt;
    if (moth.unattracted >= cfg.leave_after_unattracted_s) startLeaving(moth);
  }

  const sep = separation(swarm.scratch, swarm, moth, index, cfg.separation_radius);
  ax += sep.x * cfg.max_accel * cfg.separation_weight;
  ay += sep.y * cfg.max_accel * cfg.separation_weight;

  moth.wander += ctx.rng.range(-1, 1) * (cfg.wander_turn_per_s ?? DEFAULT_WANDER_TURN_PER_S) * dt;
  ax += Math.cos(moth.wander) * cfg.max_accel * cfg.wander_weight;
  ay += Math.sin(moth.wander) * cfg.max_accel * cfg.wander_weight;

  if (!moth.leaving) {
    const inward = inwardDir(swarm.scratch, moth.x, moth.y, ctx.width, ctx.height);
    ax += inward.x * cfg.max_accel * cfg.seek_weight;
    ay += inward.y * cfg.max_accel * cfg.seek_weight;
  }

  integrate(moth, ax, ay, cfg.max_accel, speedCap, dt);

  if (moth.leaving) {
    if (isOffscreen(moth, ctx, spec.size_px)) finishLeaving(moth, ctx);
    return;
  }
  updateHeat(moth, target, ctx, spec.heat_mult, dt);
  if (moth.heat >= tuning.heat.burn_at) {
    kill(moth, MOTH_STATUS.SINGED, tuning);
    emitMoth(ctx.events, EVENT.MOTH_SINGED, moth, null);
    return;
  }
  checkCaptures(moth, ctx, spec.value);
}

/**
 * M1: the light with the highest intensity × attract_mult / max(d, min)² among those in range.
 * Ties go to the nearest light. Returns null when no light's range contains the moth.
 */
function selectTarget(moth, lights, attractMult, minDist) {
  let best = null;
  let bestScore = 0;
  let bestDist = Infinity;
  for (let i = 0; i < lights.length; i += 1) {
    const light = lights[i];
    if (!light.active) continue;
    const d = Math.hypot(light.x - moth.x, light.y - moth.y);
    if (d > light.range) continue;
    const clamped = Math.max(d, minDist);
    const score = (light.intensity * attractMult) / (clamped * clamped);
    if (score > bestScore || (score === bestScore && d < bestDist)) {
      best = light;
      bestScore = score;
      bestDist = d;
    }
  }
  return best;
}

/** Status, targetId and M5 cloud-join bookkeeping for this tick's target. */
function updateTargetState(moth, target, ctx, cfg) {
  if (moth.leaving) {
    moth.status = MOTH_STATUS.FLEEING;
    moth.targetId = null;
    return;
  }
  moth.status = target ? MOTH_STATUS.DRAWN : MOTH_STATUS.FREE;
  moth.targetId = target ? target.id : null;
  if (!target) return;

  if (target.id !== LANTERN_ID) {
    // A new carry starts once the moth has been pulled toward anything else (M5).
    moth.joined = false;
    return;
  }
  if (!moth.joined && Math.hypot(target.x - moth.x, target.y - moth.y) <= cfg.gather_join_dist) {
    moth.joined = true;
    emitMoth(ctx.events, EVENT.MOTH_JOINED, moth, null);
  }
}

/**
 * M2 seek plus M3 orbit. Orbit lights (lantern, flower) use arrival inside orbit_radius
 * and a tangential push, so the cloud swirls instead of stacking on one point.
 */
function seekLight(out, moth, light, maxSpeed, cfg) {
  const dx = light.x - moth.x;
  const dy = light.y - moth.y;
  const d = Math.hypot(dx, dy);
  if (d < 1e-6) { out.x = 0; out.y = 0; return out; }
  const ux = dx / d;
  const uy = dy / d;
  const inOrbit = light.orbit && d < cfg.orbit_radius;
  const desired = inOrbit ? maxSpeed * (d / cfg.orbit_radius) : maxSpeed;
  out.x = seekAxis(ux * desired, moth.vx, cfg.max_accel) * cfg.seek_weight;
  out.y = seekAxis(uy * desired, moth.vy, cfg.max_accel) * cfg.seek_weight;
  if (inOrbit) {
    // Keep circling the way the moth already moves: sign of cross(r, v), where r points light → moth.
    const spin = (-dx * moth.vy + dy * moth.vx) >= 0 ? 1 : -1;
    const push = cfg.max_accel * cfg.orbit_tangent_weight * spin;
    out.x += uy * push;
    out.y += -ux * push;
  }
  return out;
}

/** One axis of Reynolds steering (desired − current), clamped per axis to max accel. */
function seekAxis(desired, current, maxAccel) {
  const steer = desired - current;
  return steer > maxAccel ? maxAccel : steer < -maxAccel ? -maxAccel : steer;
}

/**
 * Separation from neighbours within `radius`, via the uniform grid (3×3 cells).
 * Returns a direction whose length is ≤ 1 (closer neighbours push harder).
 */
function separation(out, swarm, moth, index, radius) {
  out.x = 0;
  out.y = 0;
  const grid = swarm.grid;
  if (!grid) return out;
  const cell = grid.mothCell[index];
  if (cell < 0) return out;
  const cx = cell % grid.cols;
  const cy = (cell - cx) / grid.cols;
  const r2 = radius * radius;
  const moths = swarm.moths;
  for (let gy = Math.max(0, cy - 1); gy <= Math.min(grid.rows - 1, cy + 1); gy += 1) {
    for (let gx = Math.max(0, cx - 1); gx <= Math.min(grid.cols - 1, cx + 1); gx += 1) {
      const c = gy * grid.cols + gx;
      for (let k = grid.cellStart[c]; k < grid.cellStart[c + 1]; k += 1) {
        const j = grid.items[k];
        if (j === index) continue;
        const other = moths[j];
        const dx = moth.x - other.x;
        const dy = moth.y - other.y;
        const d2 = dx * dx + dy * dy;
        if (d2 >= r2 || d2 < 1e-9) continue;
        const d = Math.sqrt(d2);
        const w = (1 - d / radius) / d;
        out.x += dx * w;
        out.y += dy * w;
      }
    }
  }
  const len = Math.hypot(out.x, out.y);
  if (len > 1) { out.x /= len; out.y /= len; }
  return out;
}

function integrate(moth, ax, ay, maxAccel, maxSpeed, dt) {
  const a = Math.hypot(ax, ay);
  if (a > maxAccel) { ax *= maxAccel / a; ay *= maxAccel / a; }
  moth.vx += ax * dt;
  moth.vy += ay * dt;
  const speed = Math.hypot(moth.vx, moth.vy);
  if (speed > maxSpeed) { moth.vx *= maxSpeed / speed; moth.vy *= maxSpeed / speed; }
  moth.x += moth.vx * dt;
  moth.y += moth.vy * dt;
  moth.flap = (moth.flap + (Math.min(speed, maxSpeed) * FLAP_RAD_PER_PX + FLAP_IDLE_RAD_PER_S) * dt) % TWO_PI;
}

// ---------------------------------------------------------------- heat (H1-H3)

function updateHeat(moth, target, ctx, heatMult, dt) {
  const cfg = ctx.tuning.heat;
  let gain = 0;
  const b = ctx.lantern ? ctx.lantern.brightness : 0;
  if (target && target.id === LANTERN_ID && b > cfg.start_brightness) {
    const d = Math.hypot(target.x - moth.x, target.y - moth.y);
    const closeness = Math.max(0, 1 - d / target.range);
    const bright = Math.min(1, (b - cfg.start_brightness) / cfg.full_brightness_span);
    gain = cfg.max_gain_per_s * bright * closeness * heatMult;
  }
  moth.heat = clamp(moth.heat + (gain - cfg.cool_per_s) * dt, 0, cfg.burn_at);
}

// ---------------------------------------------------------------- captures (W1-W3)

function checkCaptures(moth, ctx, value) {
  const lights = ctx.lights;
  for (let i = 0; i < lights.length; i += 1) {
    const light = lights[i];
    if (!light.active || light.radius <= 0 || !(light.scoring || light.lethal)) continue;
    if (Math.hypot(light.x - moth.x, light.y - moth.y) > light.radius) continue;
    if (light.scoring) {
      kill(moth, MOTH_STATUS.DELIVERED, ctx.tuning);
      emit(ctx.events, EVENT.MOTH_DELIVERED, { mothId: moth.id, species: moth.species, x: moth.x, y: moth.y, value });
    } else {
      kill(moth, MOTH_STATUS.CAPTURED, ctx.tuning);
      emitMoth(ctx.events, light.kind === KIND_ZAPPER ? EVENT.MOTH_ZAPPED : EVENT.MOTH_CANDLED, moth, light.id);
    }
    return;
  }
}

// ---------------------------------------------------------------- departures (M4, N3)

function startLeaving(moth) {
  moth.leaving = true;
  moth.status = MOTH_STATUS.FLEEING;
  moth.targetId = null;
  moth.joined = false;
}

/** M4 leavers are counted lost; dawn (N3) leavers just fly home, silently. */
function finishLeaving(moth, ctx) {
  moth.status = MOTH_STATUS.LOST;
  moth.fade = 0;
  moth.vx = 0;
  moth.vy = 0;
  if (!ctx.fleeing) emitMoth(ctx.events, EVENT.MOTH_LOST, moth, null);
}

function isOffscreen(moth, ctx, margin) {
  return moth.x < -margin || moth.x > ctx.width + margin || moth.y < -margin || moth.y > ctx.height + margin;
}

/** Unit direction straight out through the nearest canvas edge. */
function nearestEdgeDir(out, x, y, width, height) {
  const left = x;
  const right = width - x;
  const top = y;
  const bottom = height - y;
  const min = Math.min(left, right, top, bottom);
  out.x = 0;
  out.y = 0;
  if (min === left) out.x = -1;
  else if (min === right) out.x = 1;
  else if (min === top) out.y = -1;
  else out.y = 1;
  return out;
}

/** Unit push back onto the canvas for a moth outside it (zero when inside). */
function inwardDir(out, x, y, width, height) {
  out.x = x < 0 ? 1 : x > width ? -1 : 0;
  out.y = y < 0 ? 1 : y > height ? -1 : 0;
  const len = Math.hypot(out.x, out.y);
  if (len > 1) { out.x /= len; out.y /= len; }
  return out;
}

// ---------------------------------------------------------------- death / removal

function kill(moth, status, tuning) {
  moth.status = status;
  moth.targetId = null;
  moth.joined = false;
  moth.vx = 0;
  moth.vy = 0;
  moth.fade = tuning.moth.fade_s ?? DEFAULT_FADE_S;
}

/** Counts down exit animations and compacts finished moths out of the array in place. */
function removeFinished(swarm, dt) {
  const moths = swarm.moths;
  let write = 0;
  for (let read = 0; read < moths.length; read += 1) {
    const moth = moths[read];
    if (!isAlive(moth)) {
      moth.fade = Math.max(0, moth.fade - dt);
      if (moth.fade <= 0) continue;
    }
    moths[write] = moth;
    write += 1;
  }
  moths.length = write;
}

function emitMoth(events, type, moth, lightId) {
  if (lightId === null) emit(events, type, { mothId: moth.id, species: moth.species, x: moth.x, y: moth.y });
  else emit(events, type, { mothId: moth.id, species: moth.species, x: moth.x, y: moth.y, lightId });
}

// ---------------------------------------------------------------- separation grid

/**
 * Buckets living moths into a uniform grid (cell = separation_radius) with a counting sort,
 * so separation checks only 3×3 cells instead of every pair. Arrays are reused across ticks.
 * Moths outside the canvas are clamped into the border cells.
 */
function buildGrid(swarm, ctx) {
  const cellSize = ctx.tuning.moth.separation_radius;
  const cols = Math.max(1, Math.ceil(ctx.width / cellSize));
  const rows = Math.max(1, Math.ceil(ctx.height / cellSize));
  const n = swarm.moths.length;
  let grid = swarm.grid;
  if (!grid || grid.cols !== cols || grid.rows !== rows || grid.cell !== cellSize) {
    grid = {
      cols, rows, cell: cellSize,
      cellStart: new Int32Array(cols * rows + 1),
      cellFill: new Int32Array(cols * rows),
      items: new Int32Array(Math.max(64, n)),
      mothCell: new Int32Array(Math.max(64, n)),
    };
    swarm.grid = grid;
  }
  if (grid.items.length < n) {
    const cap = Math.max(n, grid.items.length * 2);
    grid.items = new Int32Array(cap);
    grid.mothCell = new Int32Array(cap);
  }

  grid.cellStart.fill(0);
  for (let i = 0; i < n; i += 1) {
    const moth = swarm.moths[i];
    if (!isAlive(moth)) { grid.mothCell[i] = -1; continue; }
    const gx = clamp(Math.floor(moth.x / cellSize), 0, cols - 1);
    const gy = clamp(Math.floor(moth.y / cellSize), 0, rows - 1);
    const c = gy * cols + gx;
    grid.mothCell[i] = c;
    grid.cellStart[c + 1] += 1;
  }
  for (let c = 0; c < cols * rows; c += 1) {
    grid.cellStart[c + 1] += grid.cellStart[c];
    grid.cellFill[c] = grid.cellStart[c];
  }
  for (let i = 0; i < n; i += 1) {
    const c = grid.mothCell[i];
    if (c < 0) continue;
    grid.items[grid.cellFill[c]] = i;
    grid.cellFill[c] += 1;
  }
}

function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value;
}
