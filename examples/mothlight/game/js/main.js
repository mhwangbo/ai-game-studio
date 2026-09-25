// @ts-check
/**
 * main.js [DOM]: bootstrap and fixed-timestep loop. Wires input → sim →
 * audio/render/ui, pauses while the tab is hidden (N1) and persists the best score (C4).
 * Owner: gameplay-1 (scaffolded by tl-1). No exports.
 */

import { SIM, loadTuning } from './config.js';
import { randomSeed } from './rng.js';
import { EVENT } from './events.js';
import { STATE, createGame, stepGame } from './state.js';
import { createInput, sampleInput } from './input.js';
import { createRenderer, resizeRenderer, screenToLogical, drawFrame } from './render.js';
import { drawUi } from './ui.js';
import { createAudio, unlockAudio, playEvents, updateAudio } from './audio.js';
// JAM-13 (au-1): namespace import so a missing `toggleMute` during au-1's
// in-progress work can't break module linking for everyone else (a named
// import of an export that doesn't exist yet fails to load at all).
import * as audioModule from './audio.js';

const STEP = 1 / SIM.TICK_RATE;
const MS_PER_S = 1000;
// JAM-17: "narrow" phone portrait, not just any resized/portrait desktop window.
const ROTATE_HINT_QUERY = '(orientation: portrait) and (max-width: 820px)';

// index.html shows a "serve over http" notice if this flag is not set soon after load.
/** @type {any} */ (window).__mothlightBooted = true;

boot().catch((err) => console.error('[mothlight] boot failed', err));

async function boot() {
  const { tuning, source, error } = await loadTuning('data/tuning.json');
  if (error) console.warn(`[mothlight] tuning.json not loaded (${error}), using defaults`);
  console.info(`[mothlight] tuning: ${source}`);

  const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('game'));
  const { width, height } = tuning.canvas;
  const renderer = createRenderer(canvas, width, height);
  const input = createInput(canvas, (cx, cy) => screenToLogical(renderer, cx, cy), {
    touchOffsetY: tuning.lantern.touch_offset_y,
    keySpeed: tuning.lantern.max_speed,
    width,
    height,
  });
  const audio = createAudio();
  const game = createGame(tuning, readSeedFromUrl() ?? randomSeed());
  game.best = loadBest(tuning.scoring.best_key);

  const unlock = () => unlockAudio(audio);
  window.addEventListener('pointerdown', unlock, { once: true });
  window.addEventListener('keydown', unlock, { once: true });
  window.addEventListener('resize', () => resizeRenderer(renderer));
  // JAM-13 (au-1): key M toggles mute via audio.js#toggleMute.
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'KeyM') return;
    const muted = audioModule.toggleMute?.(audio);
    if (muted !== undefined) console.info(`[mothlight] audio ${muted ? 'muted' : 'unmuted'}`);
  });

  /** @type {any} */ (window).__mothlight = { game, renderer, audio, input };

  // JAM-17: rotate-phone hint, title screen only, narrow portrait only.
  const rotateHint = document.getElementById('rotate-hint');
  const portraitQuery = window.matchMedia(ROTATE_HINT_QUERY);
  const updateRotateHint = () => {
    const show = game.state === STATE.TITLE && portraitQuery.matches;
    if (rotateHint) rotateHint.hidden = !show;
  };
  portraitQuery.addEventListener('change', updateRotateHint);

  // scale = CSS px per logical px; ui.js uses it to keep text readable on phones.
  const view = { width, height, time: 0, scale: renderer.scale };
  let accumulator = 0;
  let lastMs = performance.now();
  let paused = document.hidden;
  document.addEventListener('visibilitychange', () => {
    paused = document.hidden;
    accumulator = 0;
    lastMs = performance.now();
  });

  const frame = (/** @type {number} */ nowMs) => {
    const realDt = Math.min((nowMs - lastMs) / MS_PER_S, SIM.MAX_FRAME_DT);
    lastMs = nowMs;
    if (!paused) {
      accumulator += realDt;
      let steps = 0;
      while (accumulator >= STEP && steps < SIM.MAX_STEPS_PER_FRAME) {
        stepGame(game, sampleInput(input, STEP), STEP);
        playEvents(audio, game.events);
        if (game.events.some((e) => e.type === EVENT.NIGHT_END)) saveBest(tuning.scoring.best_key, game.best);
        accumulator -= STEP;
        steps += 1;
      }
      // Drop the leftover time rather than spiral when the device can't keep up.
      if (steps === SIM.MAX_STEPS_PER_FRAME) accumulator = 0;
    }

    view.time = game.time;
    view.scale = renderer.scale;
    updateRotateHint();
    updateAudio(audio, game);
    renderer.ctx.save();
    drawFrame(renderer, game, accumulator / STEP);
    drawUi(renderer.ctx, game, view);
    renderer.ctx.restore();
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

/** `?seed=123` fixes the first night's garden (reproducible QA / daily seed). */
function readSeedFromUrl() {
  const raw = new URLSearchParams(window.location.search).get('seed');
  const seed = raw === null ? NaN : Number.parseInt(raw, 10);
  return Number.isFinite(seed) ? seed : null;
}

/** localStorage can throw (private mode, blocked storage), so the game must work without it. */
function loadBest(key) {
  try {
    const value = Number(window.localStorage.getItem(key));
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}

function saveBest(key, best) {
  try {
    window.localStorage.setItem(key, String(best));
  } catch {
    // Storage unavailable: the best score just isn't persisted.
  }
}
