// @ts-check
/**
 * render.js [DOM]: canvas setup (letterbox + DPR) and drawing of sky (N2 dawn lerp),
 * garden silhouettes, lights (additive; unlit hazards shown as fair warning),
 * moths (+ H4 heat ring/tint, hazard-bound tint/tether) and the lantern, plus
 * every light's influence-range ring and lantern-vs-hazard contest zones (JAM-16).
 * Owner: gameplay-3. Reads Game and never mutates it.
 *
 * Perf: every glow is a pre-baked radial-gradient sprite (one per colour, built
 * once in createRenderer) blitted with drawImage + 'lighter'. Silhouettes are
 * baked once per world/resize. Moths use setTransform (no save/restore, no
 * per-moth allocations or gradients).
 */

import { SIM } from './config.js';
import { lanternRange } from './state.js';
import { timelineScale } from './world.js';
import { heatWarning, isAlive } from './moths.js';

const MAX_DPR = 2;
const TAU = Math.PI * 2;
const STEP_S = 1 / SIM.TICK_RATE;

/** StyleGuide palette. */
const COLOR = Object.freeze({
  LETTERBOX: '#000000',
  SILHOUETTE_FAR: '#141B3A',
  SILHOUETTE_NEAR: '#1E2750',
  LANTERN_CORE: '#FFF4D6',
  LANTERN_GLOW: '#FFB547',
  MOON: '#E6ECFF',
  MOON_HALO: '#9FB2FF',
  CANDLE: '#FF8A2A',
  CANDLE_WAX: '#3A3A5C',
  ZAPPER: '#7CF7FF',
  ZAPPER_ARC: '#B04BFF',
  ZAPPER_UNLIT: '#2E3868',
  FLOWER: '#FF7AC8',
  HEAT: '#FF5A3C',
  ASH: '#6B6A75',
});
const MOTH_COLOR = Object.freeze({ dusty: '#D8C8A8', silkwing: '#A8E6E0', atlas: '#E89A6B' });
const MOTH_DEFAULT_COLOR = MOTH_COLOR.dusty;
/** N2 sky stops: night → violet → peach. */
const SKY_STOPS = Object.freeze([[0x0b, 0x10, 0x26], [0x3a, 0x2e, 0x5c], [0xf2, 0xa0, 0x7b]]);

/** Pure-visual sizes (logical px) and alphas. Gameplay radii come from tuning. */
const GLOW_SPRITE_PX = 128;
const LANTERN = Object.freeze({ CORE_R: 5, CORE_GLOW_R: 16, GLOW_ALPHA: 0.55, UNLIT_ALPHA: 0.35 });
const MOON_VIS = Object.freeze({ DISC_R: 14, HALO_RANGE_FRAC: 0.6, HALO_ALPHA: 0.55, INNER_GLOW_R: 30 });
const CANDLE_VIS = Object.freeze({ WAX_W: 4, WAX_H: 16, FLAME_H: 9, FLAME_W: 3, SWAY_RAD_PER_S: 11, SWAY_PX: 0.8, GLOW_RANGE_FRAC: 0.55, GLOW_ALPHA: 0.8 });
const ZAPPER_VIS = Object.freeze({ SIZE: 22, CELLS: 3, POST_H: 20, GLOW_RANGE_FRAC: 0.4, GLOW_ALPHA: 0.6, ARC_SEGMENTS: 5, ARC_JITTER: 5, ARCS: 2 });
const FLOWER_VIS = Object.freeze({ STEM_H: 18, PETALS: 5, PETAL_R: 3, PETAL_SPREAD: 5, BUD_R: 2, GLOW_RANGE_FRAC: 0.6, GLOW_ALPHA: 0.9 });
const MOTH_VIS = Object.freeze({ WING_SPAN: 0.9, FLAP_MIN: 0.3, FADE_FALLBACK_S: 1.5, ASH_RISE_PX: 18, RING_PAD: 4, HEAT_TINT: 0.65,
  /** JAM-15: moths never shrink below this many CSS px (375 px portrait scales 960 → 0.39). */
  MIN_CSS_PX: 4,
  /** JAM-16: wing tint + short tether toward the hazard a moth is heading into. */
  DANGER_TINT: 0.6, TETHER_PX: 16, TETHER_ALPHA: 0.8 });
const ASHEN = Object.freeze(new Set(['singed', 'captured']));

/**
 * JAM-16 influence-range rings (each light's gameplay `range`, i.e. where it can pull a moth).
 * Shape tells kinds apart, not only hue (StyleGuide colourblind rule): moon/lantern = solid,
 * candle = long dashes, zapper = short hard dashes, flower = dots. Alphas are pure visual.
 */
const RANGE_VIS = Object.freeze({
  /** Lines never get thinner than this in CSS px, so rings survive the mobile down-scale. */
  MIN_LINE_CSS_PX: 1.2,
  LANTERN_ALPHA: 0.5, LANTERN_ALPHA_PER_B: 0.3, LANTERN_W: 1.5, LANTERN_BAND_W: 7, LANTERN_BAND_ALPHA: 0.1,
  /** JAM-20: the safe zone must read at least as strongly as any hazard ring (crisp edge + soft band, like the lantern). */
  MOON_ALPHA: 0.6, MOON_PULSE: 0.08, MOON_PULSE_RAD_PER_S: 1.3, MOON_W: 2, MOON_BAND_W: 8, MOON_BAND_ALPHA: 0.14,
  CANDLE_ALPHA: 0.4, CANDLE_W: 1.5, CANDLE_DASH_SPEED: 8,
  ZAPPER_ALPHA: 0.45, ZAPPER_PULSE: 0.2, ZAPPER_PULSE_RAD_PER_S: 9, ZAPPER_W: 1.5, ZAPPER_DASH_SPEED: 30,
  FLOWER_ALPHA: 0.3, FLOWER_W: 1.5,
  /**
   * JAM-20: hazard/flower rings that can't touch the lantern's range recede to FAR_DIM of their alpha,
   * easing back to full over FAR_FADE_PX of gap, so after 115 s only the threats that matter stand out.
   */
  FAR_DIM: 0.3, FAR_FADE_PX: 60,
  /** Contest lens (hazard range ∩ lantern range): where the hazard can steal your moths. */
  CONTEST_FILL_ALPHA: 0.08, CONTEST_EDGE_ALPHA: 0.75, CONTEST_W: 2,
  /** Moon ∩ lantern: "let go here" zone. */
  MOON_ZONE_FILL_ALPHA: 0.08,
});
const DASH = Object.freeze({
  NONE: Object.freeze([]),
  CANDLE: Object.freeze([10, 7]),
  ZAPPER: Object.freeze([4, 4]),
  FLOWER: Object.freeze([1.5, 5]),
});
/** Hazard kind → colour for moth danger cues (tint + tether match the flame/cage). */
const HAZARD_COLOR = Object.freeze({ candle: COLOR.CANDLE, zapper: COLOR.ZAPPER });
/**
 * JAM-20: hazard kind → range-ring / contest-edge colour. Candle rings shift from flame orange
 * (#FF8A2A, ~27° hue, too close to the lantern's amber #FFB547 ~38°) to the StyleGuide heat
 * red-orange (#FF5A3C, ~8°), so candle vs lantern reads by hue and value, not only the dash.
 */
const HAZARD_RING_COLOR = Object.freeze({ candle: COLOR.HEAT, zapper: COLOR.ZAPPER });
/** Scratch for the lantern's interpolated reach this frame (no per-frame allocation). */
const reach = { x: 0, y: 0, r: 0 };
/** JAM-15: dark lantern keeps a faint breathing ember so the player can find it. */
const EMBER = Object.freeze({ R: 16, MIN_CSS_R: 10, ALPHA: 0.42, PULSE: 0.12, PULSE_RAD_PER_S: 2.4 });

/**
 * @typedef {{ canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D, width: number, height: number,
 *             scale: number, offsetX: number, offsetY: number, dpr: number,
 *             sprites: Record<string, HTMLCanvasElement>,
 *             garden: { canvas: HTMLCanvasElement | null, world: any, pixelScale: number },
 *             lights: { world: any, map: Map<string, any> } }} Renderer
 */

/**
 * @param {HTMLCanvasElement} canvas
 * @param {number} width   logical width
 * @param {number} height  logical height
 * @returns {Renderer}
 */
export function createRenderer(canvas, width, height) {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D not supported');
  /** @type {Renderer} */
  const renderer = {
    canvas, ctx, width, height, scale: 1, offsetX: 0, offsetY: 0, dpr: 1,
    sprites: bakeGlowSprites(),
    garden: { canvas: null, world: null, pixelScale: 0 },
    lights: { world: null, map: new Map() },
  };
  resizeRenderer(renderer);
  return renderer;
}

/**
 * Fits the logical area into the window (letterboxed) at device pixel density.
 * @param {Renderer} renderer
 * @returns {void}
 */
export function resizeRenderer(renderer) {
  const { canvas, width, height } = renderer;
  const cssW = window.innerWidth;
  const cssH = window.innerHeight;
  const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  renderer.dpr = dpr;
  renderer.scale = Math.min(cssW / width, cssH / height);
  renderer.offsetX = (cssW - width * renderer.scale) / 2;
  renderer.offsetY = (cssH - height * renderer.scale) / 2;
}

/**
 * Converts client (CSS px) coordinates to logical game coordinates.
 * @param {Renderer} renderer
 * @param {number} clientX
 * @param {number} clientY
 * @returns {{ x: number, y: number }}
 */
export function screenToLogical(renderer, clientX, clientY) {
  const rect = renderer.canvas.getBoundingClientRect();
  return {
    x: (clientX - rect.left - renderer.offsetX) / renderer.scale,
    y: (clientY - rect.top - renderer.offsetY) / renderer.scale,
  };
}

/**
 * Draws one frame. Leaves ctx in logical-space transform (clipped, source-over, alpha 1) for ui.js.
 * @param {Renderer} renderer
 * @param {any} game
 * @param {number} alpha  0..1 interpolation between sim steps (moths + lantern are extrapolated by it)
 * @returns {void}
 */
export function drawFrame(renderer, game, alpha) {
  const { ctx, canvas, width, height, dpr, scale } = renderer;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.fillStyle = COLOR.LETTERBOX;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const k = dpr * scale;
  setLogical(renderer);
  ctx.beginPath();
  ctx.rect(0, 0, width, height);
  ctx.clip();

  ctx.fillStyle = skyColor(game);
  ctx.fillRect(0, 0, width, height);
  drawGarden(renderer, game.world, k);

  const lerpT = alpha * STEP_S;
  drawLightBodies(ctx, game.world, game.time);
  drawLightGlows(renderer, game.world, game.tuning);
  drawRangeRings(renderer, game, lerpT);
  drawContestZones(renderer, game, lerpT);
  drawMoths(renderer, game, lerpT);
  drawLantern(renderer, game, lerpT);

  setLogical(renderer);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
}

// ---------------------------------------------------------------- setup

/** One soft radial sprite per glow colour, built once (TDD perf risk: no per-frame gradients). */
function bakeGlowSprites() {
  /** @type {Record<string, HTMLCanvasElement>} */
  const sprites = {};
  for (const color of [COLOR.LANTERN_GLOW, COLOR.LANTERN_CORE, COLOR.MOON_HALO, COLOR.MOON, COLOR.CANDLE, COLOR.ZAPPER, COLOR.FLOWER]) {
    const sprite = document.createElement('canvas');
    sprite.width = GLOW_SPRITE_PX;
    sprite.height = GLOW_SPRITE_PX;
    const sctx = /** @type {CanvasRenderingContext2D} */ (sprite.getContext('2d'));
    const r = GLOW_SPRITE_PX / 2;
    const [cr, cg, cb] = hexToRgb(color);
    const grad = sctx.createRadialGradient(r, r, 0, r, r, r);
    // Quadratic-ish falloff reads as soft light rather than a flat disc.
    grad.addColorStop(0, `rgba(${cr},${cg},${cb},1)`);
    grad.addColorStop(0.25, `rgba(${cr},${cg},${cb},0.55)`);
    grad.addColorStop(0.6, `rgba(${cr},${cg},${cb},0.15)`);
    grad.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
    sctx.fillStyle = grad;
    sctx.fillRect(0, 0, GLOW_SPRITE_PX, GLOW_SPRITE_PX);
    sprites[color] = sprite;
  }
  return sprites;
}

/** Sets ctx to the logical-space transform. */
function setLogical(renderer) {
  const { ctx, dpr, scale, offsetX, offsetY } = renderer;
  ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * offsetX, dpr * offsetY);
}

// ---------------------------------------------------------------- sky + garden

/** N2: sky lerps night → violet → peach from dawn_fade_start_s (timeline-scaled) to night end; dawn stays peach. */
function skyColor(game) {
  const { tuning } = game;
  let p = 0;
  if (game.state === 'dawn') {
    p = 1;
  } else if (game.state === 'night') {
    const start = tuning.night.dawn_fade_start_s * timelineScale(tuning);
    const end = game.night.length;
    p = end > start ? clamp01((game.night.elapsed - start) / (end - start)) : 0;
  }
  const seg = p < 0.5 ? 0 : 1;
  const t = p < 0.5 ? p * 2 : (p - 0.5) * 2;
  const a = SKY_STOPS[seg];
  const b = SKY_STOPS[seg + 1];
  return `rgb(${Math.round(lerp(a[0], b[0], t))},${Math.round(lerp(a[1], b[1], t))},${Math.round(lerp(a[2], b[2], t))})`;
}

/** Silhouettes are static per night: bake once per world/resize, then blit. */
function drawGarden(renderer, world, k) {
  const cache = renderer.garden;
  if (cache.world !== world || cache.pixelScale !== k || !cache.canvas) {
    cache.canvas = cache.canvas ?? document.createElement('canvas');
    cache.canvas.width = Math.max(1, Math.round(renderer.width * k));
    cache.canvas.height = Math.max(1, Math.round(renderer.height * k));
    const gctx = /** @type {CanvasRenderingContext2D} */ (cache.canvas.getContext('2d'));
    gctx.setTransform(k, 0, 0, k, 0, 0);
    gctx.clearRect(0, 0, renderer.width, renderer.height);
    for (const layer of ['far', 'near']) {
      gctx.fillStyle = layer === 'far' ? COLOR.SILHOUETTE_FAR : COLOR.SILHOUETTE_NEAR;
      for (const shape of world.silhouettes ?? []) {
        if (shape.layer === layer) fillSmooth(gctx, shape.points);
      }
    }
    cache.world = world;
    cache.pixelScale = k;
  }
  renderer.ctx.drawImage(cache.canvas, 0, 0, renderer.width, renderer.height);
}

/** Closed polygon through midpoints with quadratic control points = organic, outline-free blob. */
function fillSmooth(ctx, points) {
  const n = points.length;
  if (n < 3) return;
  ctx.beginPath();
  ctx.moveTo((points[n - 1].x + points[0].x) / 2, (points[n - 1].y + points[0].y) / 2);
  for (let i = 0; i < n; i += 1) {
    const p = points[i];
    const q = points[(i + 1) % n];
    ctx.quadraticCurveTo(p.x, p.y, (p.x + q.x) / 2, (p.y + q.y) / 2);
  }
  ctx.closePath();
  ctx.fill();
}

// ---------------------------------------------------------------- lights

/** Solid shapes (source-over): candle wax/flame, zapper cages (unlit = fair warning), flower stems/petals, moon disc. */
function drawLightBodies(ctx, world, time) {
  ctx.globalCompositeOperation = 'source-over';
  for (const candle of world.candles) drawCandleBody(ctx, candle, time);
  for (const zapper of world.zappers) drawZapperBody(ctx, zapper);
  for (const flower of world.flowers) drawFlowerBody(ctx, flower);
  const moon = world.moon;
  ctx.globalAlpha = clamp01(moon.intensity / moon.baseIntensity);
  ctx.fillStyle = COLOR.MOON;
  ctx.beginPath();
  ctx.arc(moon.x, moon.y, MOON_VIS.DISC_R, 0, TAU);
  ctx.fill();
}

function drawCandleBody(ctx, candle, time) {
  const v = CANDLE_VIS;
  ctx.globalAlpha = 1;
  ctx.fillStyle = COLOR.CANDLE_WAX;
  ctx.fillRect(candle.x - v.WAX_W / 2, candle.y + 1, v.WAX_W, v.WAX_H);
  if (!candle.lit || candle.intensity <= 0) return;
  // Flame height follows the flicker (motion tells candles from the steady moon).
  const flick = candle.intensity / candle.baseIntensity;
  const h = v.FLAME_H * flick;
  const sway = Math.sin(time * v.SWAY_RAD_PER_S + candle.noiseSeed) * v.SWAY_PX;
  ctx.fillStyle = COLOR.CANDLE;
  ctx.beginPath();
  ctx.moveTo(candle.x + sway, candle.y - h);
  ctx.quadraticCurveTo(candle.x + v.FLAME_W, candle.y, candle.x, candle.y + 1);
  ctx.quadraticCurveTo(candle.x - v.FLAME_W, candle.y, candle.x + sway, candle.y - h);
  ctx.fill();
}

function drawZapperBody(ctx, zapper) {
  const v = ZAPPER_VIS;
  const half = v.SIZE / 2;
  const x0 = zapper.x - half;
  const y0 = zapper.y - half;
  const lit = zapper.lit && zapper.intensity > 0;
  ctx.globalAlpha = lit ? 0.45 + 0.55 * zapper.warmup : 1;
  ctx.strokeStyle = lit ? COLOR.ZAPPER : COLOR.ZAPPER_UNLIT;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  // Post, then a square grid cage: hard angles = danger.
  ctx.moveTo(zapper.x, zapper.y + half);
  ctx.lineTo(zapper.x, zapper.y + half + v.POST_H);
  ctx.rect(x0, y0, v.SIZE, v.SIZE);
  for (let i = 1; i < v.CELLS; i += 1) {
    const o = (v.SIZE * i) / v.CELLS;
    ctx.moveTo(x0 + o, y0);
    ctx.lineTo(x0 + o, y0 + v.SIZE);
    ctx.moveTo(x0, y0 + o);
    ctx.lineTo(x0 + v.SIZE, y0 + o);
  }
  ctx.stroke();
  if (!lit) return;
  // Jagged arcs buzz every frame (visual-only randomness; the sim rng is never touched).
  ctx.strokeStyle = COLOR.ZAPPER_ARC;
  ctx.globalAlpha = zapper.warmup;
  ctx.beginPath();
  for (let a = 0; a < v.ARCS; a += 1) {
    if (Math.random() > 0.35 + 0.65 * zapper.warmup) continue;
    let px = x0 + Math.random() * v.SIZE;
    let py = y0;
    ctx.moveTo(px, py);
    for (let s = 1; s <= v.ARC_SEGMENTS; s += 1) {
      px += (Math.random() - 0.5) * v.ARC_JITTER * 2;
      py = y0 + (v.SIZE * s) / v.ARC_SEGMENTS;
      ctx.lineTo(px, py);
    }
  }
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function drawFlowerBody(ctx, flower) {
  const v = FLOWER_VIS;
  ctx.globalAlpha = 1;
  ctx.strokeStyle = COLOR.SILHOUETTE_NEAR;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(flower.x, flower.y);
  ctx.lineTo(flower.x, flower.y + v.STEM_H);
  ctx.stroke();
  const open = flower.openness;
  ctx.fillStyle = COLOR.FLOWER;
  ctx.globalAlpha = 0.35 + 0.65 * open;
  ctx.beginPath();
  if (open <= 0) {
    ctx.arc(flower.x, flower.y, v.BUD_R, 0, TAU);
  } else {
    for (let i = 0; i < v.PETALS; i += 1) {
      const a = (i / v.PETALS) * TAU - Math.PI / 2;
      const px = flower.x + Math.cos(a) * v.PETAL_SPREAD * open;
      const py = flower.y + Math.sin(a) * v.PETAL_SPREAD * open;
      ctx.moveTo(px + v.PETAL_R, py);
      ctx.arc(px, py, v.PETAL_R * (0.5 + 0.5 * open), 0, TAU);
    }
  }
  ctx.fill();
  ctx.globalAlpha = 1;
}

/** Additive glows scaled by each light's current intensity relative to its base. */
function drawLightGlows(renderer, world, tuning) {
  const { ctx, sprites } = renderer;
  ctx.globalCompositeOperation = 'lighter';
  const moon = world.moon;
  const moonRatio = tuning.moon.intensity > 0 ? moon.intensity / tuning.moon.intensity : 0;
  blit(ctx, sprites[COLOR.MOON_HALO], moon.x, moon.y, moon.range * MOON_VIS.HALO_RANGE_FRAC, MOON_VIS.HALO_ALPHA * moonRatio);
  blit(ctx, sprites[COLOR.MOON], moon.x, moon.y, MOON_VIS.INNER_GLOW_R, moonRatio);
  for (const c of world.candles) {
    if (c.intensity > 0) blit(ctx, sprites[COLOR.CANDLE], c.x, c.y, c.range * CANDLE_VIS.GLOW_RANGE_FRAC, CANDLE_VIS.GLOW_ALPHA * c.intensity / c.baseIntensity);
  }
  for (const z of world.zappers) {
    if (z.intensity > 0) blit(ctx, sprites[COLOR.ZAPPER], z.x, z.y, z.range * ZAPPER_VIS.GLOW_RANGE_FRAC, ZAPPER_VIS.GLOW_ALPHA * z.intensity / z.baseIntensity);
  }
  for (const f of world.flowers) {
    if (f.intensity > 0) blit(ctx, sprites[COLOR.FLOWER], f.x, f.y, f.range * FLOWER_VIS.GLOW_RANGE_FRAC * f.openness, FLOWER_VIS.GLOW_ALPHA * f.openness);
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

/**
 * JAM-16: every active light's pull radius as a ring. Hazards use dashes (hard = danger) that crawl
 * with their motion cue (candle flicker drives alpha, zapper dashes race + buzz); the moon breathes slowly.
 * JAM-20: the moon ring is a crisp moon-white edge over a soft halo band (never dimmed); hazard and
 * flower rings whose range can't reach the lantern's are dimmed (see RANGE_VIS.FAR_DIM).
 */
function drawRangeRings(renderer, game, lerpT) {
  const { ctx } = renderer;
  const { world, time } = game;
  const v = RANGE_VIS;
  lanternReach(game, lerpT);
  ctx.globalCompositeOperation = 'source-over';
  const moon = world.moon;
  if (moon.active) {
    const strength = clamp01(moon.intensity / moon.baseIntensity);
    const a = (v.MOON_ALPHA + v.MOON_PULSE * Math.sin(time * v.MOON_PULSE_RAD_PER_S)) * strength;
    strokeRing(renderer, moon.x, moon.y, moon.range - v.MOON_BAND_W / 2, COLOR.MOON_HALO, v.MOON_BAND_ALPHA * strength, v.MOON_BAND_W, DASH.NONE, 0);
    strokeRing(renderer, moon.x, moon.y, moon.range, COLOR.MOON, a, v.MOON_W, DASH.NONE, 0);
  }
  for (const c of world.candles) {
    if (!c.active) continue;
    strokeRing(renderer, c.x, c.y, c.range, HAZARD_RING_COLOR.candle, v.CANDLE_ALPHA * clamp01(c.intensity / c.baseIntensity) * farDim(c),
      v.CANDLE_W, DASH.CANDLE, -time * v.CANDLE_DASH_SPEED);
  }
  for (const z of world.zappers) {
    if (!z.active) continue;
    // Warming zappers fade their ring in; once lethal the ring buzzes.
    const buzz = z.lethal ? v.ZAPPER_PULSE * Math.sin(time * v.ZAPPER_PULSE_RAD_PER_S) : 0;
    strokeRing(renderer, z.x, z.y, z.range, HAZARD_RING_COLOR.zapper, (v.ZAPPER_ALPHA + buzz) * z.warmup * farDim(z),
      v.ZAPPER_W, DASH.ZAPPER, -time * v.ZAPPER_DASH_SPEED);
  }
  for (const f of world.flowers) {
    if (!f.active) continue;
    strokeRing(renderer, f.x, f.y, f.range, COLOR.FLOWER, v.FLOWER_ALPHA * f.openness * farDim(f), v.FLOWER_W, DASH.FLOWER, 0);
  }
  ctx.setLineDash(DASH.NONE);
  ctx.globalAlpha = 1;
}

/**
 * JAM-16 contest readability: inside the lantern's range, tint the lens where a hazard's range
 * overlaps it (moths there may be stolen) and outline that hazard arc brightly; tint the moon lens
 * as the safe "let go here" zone. Clipping cost is per overlapping light (≤ ~9), never per moth.
 */
function drawContestZones(renderer, game, lerpT) {
  const { ctx } = renderer;
  const lantern = game.lantern;
  if (lantern.dark || game.state === 'title') return;
  const lx = lantern.x + lantern.vx * lerpT;
  const ly = lantern.y + lantern.vy * lerpT;
  const lr = lanternRange(lantern.brightness, game.tuning);
  const world = game.world;
  const v = RANGE_VIS;
  ctx.save();
  ctx.beginPath();
  ctx.arc(lx, ly, lr, 0, TAU);
  ctx.clip();
  const moon = world.moon;
  if (moon.active && overlaps(lx, ly, lr, moon)) {
    ctx.globalAlpha = v.MOON_ZONE_FILL_ALPHA;
    ctx.fillStyle = COLOR.MOON_HALO;
    ctx.beginPath();
    ctx.arc(moon.x, moon.y, moon.range, 0, TAU);
    ctx.fill();
  }
  contestGroup(renderer, world.candles, lx, ly, lr);
  contestGroup(renderer, world.zappers, lx, ly, lr);
  ctx.restore();
  ctx.globalAlpha = 1;
}

function contestGroup(renderer, group, lx, ly, lr) {
  const { ctx } = renderer;
  const v = RANGE_VIS;
  for (const h of group) {
    if (!h.active || !overlaps(lx, ly, lr, h)) continue;
    const strength = h.kind === 'zapper' ? h.warmup : clamp01(h.intensity / h.baseIntensity);
    const color = HAZARD_RING_COLOR[h.kind] ?? COLOR.HEAT;
    ctx.beginPath();
    ctx.arc(h.x, h.y, h.range, 0, TAU);
    ctx.globalAlpha = v.CONTEST_FILL_ALPHA * strength;
    ctx.fillStyle = COLOR.HEAT;
    ctx.fill();
    ctx.globalAlpha = v.CONTEST_EDGE_ALPHA * strength;
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth(renderer, v.CONTEST_W);
    // Keep the hazard's own dash so the lens edge never reads as a second (solid) lantern ring.
    ctx.setLineDash(/** @type {number[]} */ (h.kind === 'zapper' ? DASH.ZAPPER : DASH.CANDLE));
    ctx.stroke();
  }
  ctx.setLineDash(DASH.NONE);
}

/**
 * JAM-20: fills `reach` with the lantern's interpolated position and pull radius (0 when dark or
 * on the title, so every hazard ring recedes until the player glows).
 */
function lanternReach(game, lerpT) {
  const lantern = game.lantern;
  reach.x = lantern.x + lantern.vx * lerpT;
  reach.y = lantern.y + lantern.vy * lerpT;
  reach.r = lantern.dark || game.state === 'title' ? 0 : lanternRange(lantern.brightness, game.tuning);
}

/** JAM-20: 1 when the light's range touches the lantern's `reach`, easing to FAR_DIM over FAR_FADE_PX of gap. */
function farDim(light) {
  const v = RANGE_VIS;
  const gap = Math.hypot(light.x - reach.x, light.y - reach.y) - reach.r - light.range;
  if (gap <= 0) return 1;
  return lerp(1, v.FAR_DIM, clamp01(gap / v.FAR_FADE_PX));
}

function overlaps(x, y, r, light) {
  const reach = r + light.range;
  const dx = light.x - x;
  const dy = light.y - y;
  return dx * dx + dy * dy < reach * reach;
}

/** Logical line width, floored so it stays ≥ MIN_LINE_CSS_PX on screen (mobile readability). */
function lineWidth(renderer, logicalW) {
  const floor = RANGE_VIS.MIN_LINE_CSS_PX / renderer.scale;
  return logicalW > floor ? logicalW : floor;
}

function strokeRing(renderer, x, y, r, color, alpha, width, dash, dashOffset) {
  if (alpha <= 0 || r <= 0) return;
  const { ctx } = renderer;
  ctx.globalAlpha = alpha > 1 ? 1 : alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth(renderer, width);
  ctx.setLineDash(/** @type {number[]} */ (dash));
  ctx.lineDashOffset = dashOffset;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.stroke();
}

function blit(ctx, sprite, x, y, radius, alpha) {
  if (radius <= 0 || alpha <= 0) return;
  ctx.globalAlpha = alpha > 1 ? 1 : alpha;
  ctx.drawImage(sprite, x - radius, y - radius, radius * 2, radius * 2);
}

// ---------------------------------------------------------------- moths

/**
 * Two teardrop wings + 1 px body, oriented along velocity, flapping via wing-axis scale.
 * Heat ≥ warn_ring_at tints the wings and adds an H4 ring (alpha = (heat-warn)/(burn-warn)).
 */
function drawMoths(renderer, game, lerpT) {
  const { ctx, dpr, scale, offsetX, offsetY } = renderer;
  const moths = game.swarm.moths;
  const { tuning } = game;
  const species = tuning.species;
  const lights = lightIndex(renderer, game.world);
  // Mirrors moths.js' exit-animation length (tuning.moth.fade_s, 1.5 s default there).
  const fadeTotal = tuning.moth.fade_s ?? MOTH_VIS.FADE_FALLBACK_S;
  const minSize = MOTH_VIS.MIN_CSS_PX / scale;
  const k = dpr * scale;
  const ex = dpr * offsetX;
  const ey = dpr * offsetY;
  ctx.globalCompositeOperation = 'source-over';
  ctx.lineWidth = 1;

  for (let i = 0; i < moths.length; i += 1) {
    const m = moths[i];
    const terminal = !isAlive(m);
    const alpha = terminal ? clamp01(m.fade / fadeTotal) : 1;
    if (alpha <= 0) continue;
    const ashen = ASHEN.has(m.status);
    const rise = terminal ? (1 - alpha) * MOTH_VIS.ASH_RISE_PX : 0;
    const x = m.x + m.vx * lerpT;
    const y = m.y + m.vy * lerpT - rise;
    const size = mothSize(species, m, minSize);
    const speed = Math.hypot(m.vx, m.vy);
    const cos = speed > 1e-3 ? m.vx / speed : 1;
    const sin = speed > 1e-3 ? m.vy / speed : 0;
    const flap = ashen ? MOTH_VIS.FLAP_MIN : MOTH_VIS.FLAP_MIN + (1 - MOTH_VIS.FLAP_MIN) * Math.abs(Math.cos(m.flap));
    // local frame: +x = heading, ±y = wing span (scaled by flap); size in logical px.
    ctx.setTransform(k * cos * size, k * sin * size, -k * sin * size * flap, k * cos * size * flap, ex + k * x, ey + k * y);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = ashen ? COLOR.ASH : (MOTH_COLOR[m.species] ?? MOTH_DEFAULT_COLOR);
    wingPath(ctx);
    ctx.fill();
    // JAM-16: a moth being pulled into a hazard takes on that hazard's hue.
    const hazard = terminal ? null : hazardTarget(lights, m);
    if (hazard) {
      ctx.globalAlpha = MOTH_VIS.DANGER_TINT;
      ctx.fillStyle = HAZARD_COLOR[hazard.kind];
      ctx.fill();
    }
    const heatA = heatWarning(m, tuning);
    if (heatA > 0) {
      ctx.globalAlpha = heatA * MOTH_VIS.HEAT_TINT;
      ctx.fillStyle = COLOR.HEAT;
      ctx.fill();
    }
  }

  // Logical-space overlays (second passes keep the transform churn out of the main loop).
  ctx.setTransform(k, 0, 0, k, ex, ey);
  drawDangerTethers(renderer, moths, lights, lerpT, 'candle');
  drawDangerTethers(renderer, moths, lights, lerpT, 'zapper');
  // H4 rings.
  ctx.strokeStyle = COLOR.HEAT;
  ctx.lineWidth = lineWidth(renderer, 1.5);
  for (let i = 0; i < moths.length; i += 1) {
    const m = moths[i];
    const heatA = heatWarning(m, tuning);
    if (heatA <= 0) continue;
    ctx.globalAlpha = heatA;
    ctx.beginPath();
    ctx.arc(m.x + m.vx * lerpT, m.y + m.vy * lerpT, mothSize(species, m, minSize) + MOTH_VIS.RING_PAD, 0, TAU);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

/** Species size, floored so moths stay legible on small screens (JAM-15). */
function mothSize(species, m, minSize) {
  const size = species[m.species]?.size_px ?? species.dusty.size_px;
  return size > minSize ? size : minSize;
}

/**
 * JAM-16 shape cue (not hue alone): a short line from each hazard-bound moth pointing at the
 * hazard pulling it. One batched path per hazard kind, no per-moth allocation.
 */
function drawDangerTethers(renderer, moths, lights, lerpT, kind) {
  const { ctx } = renderer;
  let any = false;
  ctx.beginPath();
  for (let i = 0; i < moths.length; i += 1) {
    const m = moths[i];
    if (!isAlive(m)) continue;
    const h = hazardTarget(lights, m);
    if (!h || h.kind !== kind) continue;
    const x = m.x + m.vx * lerpT;
    const y = m.y + m.vy * lerpT;
    const dx = h.x - x;
    const dy = h.y - y;
    const d = Math.hypot(dx, dy);
    if (d < 1e-3) continue;
    const len = d < MOTH_VIS.TETHER_PX ? d : MOTH_VIS.TETHER_PX;
    ctx.moveTo(x, y);
    ctx.lineTo(x + (dx / d) * len, y + (dy / d) * len);
    any = true;
  }
  if (!any) return;
  ctx.globalAlpha = MOTH_VIS.TETHER_ALPHA;
  ctx.strokeStyle = HAZARD_COLOR[kind];
  ctx.lineWidth = lineWidth(renderer, 1.5);
  ctx.setLineDash(DASH.NONE);
  ctx.stroke();
}

/** The candle/zapper this moth is currently steering toward, or null. */
function hazardTarget(lights, m) {
  if (m.targetId === null) return null;
  const light = lights.get(m.targetId);
  return light && HAZARD_COLOR[light.kind] ? light : null;
}

/** id → world light, rebuilt only when the world object changes (new night). */
function lightIndex(renderer, world) {
  const cache = renderer.lights;
  if (cache.world !== world) {
    cache.map.clear();
    for (const group of [world.candles, world.zappers, world.flowers]) {
      for (const light of group) cache.map.set(light.id, light);
    }
    cache.map.set(world.moon.id, world.moon);
    cache.world = world;
  }
  return cache.map;
}

/** Unit-size moth: wings as quadratic teardrops either side of the body, plus a thin body. */
function wingPath(ctx) {
  const s = MOTH_VIS.WING_SPAN;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(s * 0.9, -s, -0.1, -s);
  ctx.quadraticCurveTo(-s * 0.7, -s * 0.5, 0, 0);
  ctx.quadraticCurveTo(-s * 0.7, s * 0.5, -0.1, s);
  ctx.quadraticCurveTo(s * 0.9, s, 0, 0);
  ctx.rect(-0.5, -0.07, 1, 0.14);
}

// ---------------------------------------------------------------- lantern

/**
 * Glow sprite sized to R(b), a clearly visible range ring at exactly R(b) = range_base + per_b·b
 * (JAM-16; soft inner band + crisp edge), bright core; when dark, a faint breathing ember (JAM-15).
 */
function drawLantern(renderer, game, lerpT) {
  const { ctx, sprites } = renderer;
  const { lantern, tuning } = game;
  const v = RANGE_VIS;
  setLogical(renderer);
  const x = lantern.x + lantern.vx * lerpT;
  const y = lantern.y + lantern.vy * lerpT;
  const b = lantern.brightness;
  const range = lanternRange(b, tuning);

  ctx.globalCompositeOperation = 'lighter';
  if (!lantern.dark) {
    blit(ctx, sprites[COLOR.LANTERN_GLOW], x, y, range, LANTERN.GLOW_ALPHA * b);
    blit(ctx, sprites[COLOR.LANTERN_CORE], x, y, LANTERN.CORE_GLOW_R, b);
  } else {
    const emberR = Math.max(EMBER.R, EMBER.MIN_CSS_R / renderer.scale);
    blit(ctx, sprites[COLOR.LANTERN_GLOW], x, y, emberR, EMBER.ALPHA + EMBER.PULSE * Math.sin(game.time * EMBER.PULSE_RAD_PER_S));
  }
  ctx.globalCompositeOperation = 'source-over';

  if (!lantern.dark) {
    // Soft band just inside the edge, then the crisp edge itself (the exact pull radius).
    strokeRing(renderer, x, y, range - v.LANTERN_BAND_W / 2, COLOR.LANTERN_GLOW, v.LANTERN_BAND_ALPHA, v.LANTERN_BAND_W, DASH.NONE, 0);
    strokeRing(renderer, x, y, range, COLOR.LANTERN_GLOW, v.LANTERN_ALPHA + v.LANTERN_ALPHA_PER_B * b, v.LANTERN_W, DASH.NONE, 0);
  }

  ctx.globalAlpha = lantern.dark ? LANTERN.UNLIT_ALPHA : 1;
  ctx.fillStyle = COLOR.LANTERN_CORE;
  ctx.beginPath();
  ctx.arc(x, y, LANTERN.CORE_R, 0, TAU);
  ctx.fill();
  ctx.globalAlpha = 1;
}

// ---------------------------------------------------------------- utils

function hexToRgb(hex) {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
