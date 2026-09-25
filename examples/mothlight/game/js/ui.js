// @ts-check
/**
 * ui.js [DOM]: canvas-drawn text UI. Title, night HUD (saved count, score,
 * combo, sun arc + time to dawn), the two onboarding hints and the end screen.
 * Reads Game only, never mutates it.
 * Owner: gameplay-1. Rules: GDD §6, N4, C1-C3. Tone: StyleGuide "UI tone".
 */

import { STATE, nightProgress, secondsToDawn, comboMultiplier } from './state.js';

// Palette (StyleGuide).
const COLOR_TEXT = 'rgba(230, 236, 255, 0.85)';
const COLOR_TEXT_SOFT = 'rgba(230, 236, 255, 0.5)';
const COLOR_TEXT_FAINT = 'rgba(230, 236, 255, 0.25)';
const COLOR_WARM = '#FFB547';      // lantern glow: combo + sun
const COLOR_SUN_CORE = '#FFF4D6';

// JAM-10: end screen sits on the peach dawn sky, where the HUD's soft alphas
// fall under 4.5:1 contrast and garden silhouettes show through the text.
// A scrim (night-sky ink) behind the text block fixes both: it raises
// contrast for every line above it and hides scene props underneath.
// QA (review rejection): 0.82 alpha still let dark props (stems, hazard
// stubs, zapper cage, hills) bleed through the panel. Opaque ink (alpha 1)
// is required so nothing drawn earlier in the frame shows through AC1.
const COLOR_SCRIM = 'rgba(11, 16, 38, 1)';          // COLOR_TEXT is night-sky ink (StyleGuide), fully opaque
const COLOR_TEXT_END_SOFT = 'rgba(230, 236, 255, 0.7)'; // loss line: dimmer than COLOR_TEXT, still >=4.5:1 on the scrim
const SCRIM_PAD_X = 40;
const SCRIM_RADIUS = 16;
const SCRIM_TOP_GAP_MULT = 2.0;   // above cy, in `gap` units
const SCRIM_HEIGHT_GAP_MULT = 4.5; // total height, in `gap` units
const SCRIM_MARGIN = 40;          // keep clear of the canvas edge on narrow/portrait screens

const SERIF = '"Cormorant Garamond", Georgia, serif';
const SANS = 'ui-rounded, system-ui, sans-serif';

// Base sizes in logical px (960×540 canvas).
const SIZE_TITLE = 56;
const SIZE_LINE = 28;
const SIZE_HUD_BIG = 26;
const SIZE_HUD = 16;
const HUD_MARGIN = 20;
const LINE_GAP = 40;

// Phone readability: text never renders below these CSS px, whatever the letterbox scale.
const MIN_CSS_PX_TEXT = 13;
const MAX_FONT_BOOST = 2.6;        // stop growth so portrait phones don't overflow the canvas

const SUN_ARC_RADIUS = 26;
const SUN_ARC_WIDTH = 2;
const SUN_DOT_RADIUS = 5;
const HOLD_BAR_WIDTH = 120;
const HOLD_BAR_HEIGHT = 2;
const END_FADE_IN_S = 1.0;
const SECONDS_PER_MINUTE = 60;

/**
 * @typedef {{ width: number, height: number, time: number, scale?: number }} UiView
 * `scale` = CSS px per logical px (renderer.scale). Used to keep text readable on phones.
 */

/**
 * Draws the UI layer for the current state. Expects ctx in logical space (after drawFrame).
 * @param {CanvasRenderingContext2D} ctx
 * @param {any} game
 * @param {UiView} view
 * @returns {void}
 */
export function drawUi(ctx, game, view) {
  const boost = fontBoost(view.scale ?? 1);
  ctx.save();
  switch (game.state) {
    case STATE.TITLE: drawTitle(ctx, game, view, boost); break;
    case STATE.NIGHT: drawHud(ctx, game, view, boost); break;
    case STATE.DAWN:
      if (game.stateTime >= game.tuning.night.end_screen_delay_s) drawEndScreen(ctx, game, view, boost);
      break;
    default: break;
  }
  ctx.restore();
}

// ---------------------------------------------------------------- private

/** Scale factor that keeps the smallest text at MIN_CSS_PX_TEXT on screen. */
function fontBoost(scale) {
  const smallestCssPx = SIZE_HUD * scale;
  if (smallestCssPx >= MIN_CSS_PX_TEXT) return 1;
  return Math.min(MIN_CSS_PX_TEXT / smallestCssPx, MAX_FONT_BOOST);
}

function serif(size, boost) { return `italic 500 ${Math.round(size * boost)}px ${SERIF}`; }
function sans(size, boost, weight = 400) { return `${weight} ${Math.round(size * boost)}px ${SANS}`; }

function drawTitle(ctx, game, view, boost) {
  const cx = view.width / 2;
  const cy = view.height / 2;
  ctx.fillStyle = COLOR_TEXT;
  text(ctx, 'Mothlight', cx, cy - LINE_GAP * boost, serif(SIZE_TITLE, boost));
  text(ctx, 'hold to glow', cx, cy + LINE_GAP * boost, serif(SIZE_LINE, boost));
  drawHoldBar(ctx, game, cx, cy + LINE_GAP * 2 * boost);
}

function drawHud(ctx, game, view, boost) {
  drawScoreBlock(ctx, game, boost);
  drawSunArc(ctx, game, view, boost);
  drawHints(ctx, game, view, boost);
}

/** Top-left: saved count (C3), points, and the live combo multiplier while a group runs. */
function drawScoreBlock(ctx, game, boost) {
  const { score } = game;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = COLOR_TEXT;
  ctx.font = sans(SIZE_HUD_BIG, boost, 600);
  ctx.fillText(`${score.delivered} saved`, HUD_MARGIN, HUD_MARGIN);

  const lineY = HUD_MARGIN + SIZE_HUD_BIG * boost * 1.25;
  ctx.font = sans(SIZE_HUD, boost);
  ctx.fillStyle = COLOR_TEXT_SOFT;
  const pointsLabel = `${formatPoints(score.points)} pts`;
  ctx.fillText(pointsLabel, HUD_MARGIN, lineY);

  if (score.combo.count > 1) {
    const x = HUD_MARGIN + ctx.measureText(pointsLabel).width + SIZE_HUD * boost;
    ctx.fillStyle = COLOR_WARM;
    ctx.font = sans(SIZE_HUD, boost, 600);
    ctx.fillText(`×${comboMultiplier(score.combo.count, game.tuning).toFixed(1)}`, x, lineY);
  }
}

/** Top-right: a sun climbing a half arc toward dawn, with m:ss left underneath. */
function drawSunArc(ctx, game, view, boost) {
  const r = SUN_ARC_RADIUS * boost;
  const cx = view.width - HUD_MARGIN - r;
  const cy = HUD_MARGIN + r;
  const progress = nightProgress(game);

  ctx.lineWidth = SUN_ARC_WIDTH;
  ctx.strokeStyle = COLOR_TEXT_FAINT;
  ctx.beginPath();
  ctx.arc(cx, cy, r, Math.PI, 0);
  ctx.stroke();

  ctx.strokeStyle = COLOR_WARM;
  ctx.beginPath();
  ctx.arc(cx, cy, r, Math.PI, Math.PI + Math.PI * progress);
  ctx.stroke();

  const angle = Math.PI + Math.PI * progress;
  ctx.fillStyle = COLOR_SUN_CORE;
  ctx.beginPath();
  ctx.arc(cx + Math.cos(angle) * r, cy + Math.sin(angle) * r, SUN_DOT_RADIUS * boost, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = COLOR_TEXT_SOFT;
  text(ctx, formatClock(secondsToDawn(game)), cx, cy + SIZE_HUD * boost * 0.6, sans(SIZE_HUD, boost));
}

function drawHints(ctx, game, view, boost) {
  const y = view.height - LINE_GAP * 2;
  ctx.fillStyle = COLOR_TEXT;
  if (game.hints.hold) text(ctx, 'hold to glow', view.width / 2, y, serif(SIZE_LINE, boost));
  else if (game.hints.release) text(ctx, 'let go under the moon', view.width / 2, y, serif(SIZE_LINE, boost));
}

/** N4 + C3: poetic line, score / best, soft tally of losses, then restart prompt. */
function drawEndScreen(ctx, game, view, boost) {
  const shownFor = game.stateTime - game.tuning.night.end_screen_delay_s;
  ctx.globalAlpha = Math.min(1, shownFor / END_FADE_IN_S);
  const cx = view.width / 2;
  const cy = view.height / 2;
  const gap = LINE_GAP * boost;
  const { score } = game;

  const titleLine = `${score.delivered} found the moon.`;
  const bestLabel = game.isNewBest ? 'a new best' : `best ${formatPoints(game.best)}`;
  const statsLine = `${formatPoints(score.points)} · ${bestLabel}`;
  const lossText = lossLine(score);
  const restartLine = 'hold to begin again';

  // JAM-10: scrim first so it sits under every line and behind whatever
  // render.js already drew this frame (garden silhouettes, unlit hazards).
  drawEndScreenScrim(ctx, view, cx, cy, gap, boost, [
    { value: titleLine, font: serif(SIZE_LINE * 1.3, boost) },
    { value: statsLine, font: sans(SIZE_HUD * 1.2, boost) },
    { value: lossText, font: sans(SIZE_HUD, boost) },
    { value: restartLine, font: serif(SIZE_LINE, boost) },
  ]);

  ctx.fillStyle = COLOR_TEXT;
  text(ctx, titleLine, cx, cy - gap * 1.5, serif(SIZE_LINE * 1.3, boost));
  text(ctx, statsLine, cx, cy - gap * 0.4, sans(SIZE_HUD * 1.2, boost));

  // Losses stay quiet (Pillar 2): smaller and dimmer than the saved line,
  // but still readable (>=4.5:1) against the scrim, unlike COLOR_TEXT_SOFT.
  ctx.fillStyle = COLOR_TEXT_END_SOFT;
  text(ctx, lossText, cx, cy + gap * 0.4, sans(SIZE_HUD, boost));

  ctx.fillStyle = COLOR_TEXT;
  text(ctx, restartLine, cx, cy + gap * 1.6, serif(SIZE_LINE, boost));
  drawHoldBar(ctx, game, cx, cy + gap * 2.2);
}

/**
 * Soft dark scrim behind the end-screen text block (JAM-10): lifts every
 * line above 4.5:1 contrast on the dawn sky and hides scene props beneath it.
 * Sized to the widest line so it works at both 960x540 and phone portraits.
 */
function drawEndScreenScrim(ctx, view, cx, cy, gap, boost, lines) {
  let maxWidth = 0;
  for (const { value, font } of lines) {
    ctx.font = font;
    maxWidth = Math.max(maxWidth, ctx.measureText(value).width);
  }
  const width = Math.min(maxWidth + SCRIM_PAD_X * 2 * boost, view.width - SCRIM_MARGIN);
  const top = cy - gap * SCRIM_TOP_GAP_MULT;
  const height = gap * SCRIM_HEIGHT_GAP_MULT;

  ctx.fillStyle = COLOR_SCRIM;
  roundRectPath(ctx, cx - width / 2, top, width, height, SCRIM_RADIUS * boost);
  ctx.fill();
}

/** Canvas has no cross-browser `roundRect` guarantee for this target list; draw it by hand. */
function roundRectPath(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function lossLine(score) {
  const parts = [`${score.singed} singed`];
  if (score.lostToLights > 0) parts.push(`${score.lostToLights} lost to other lights`);
  parts.push(`${score.lost} drifted away`);
  return parts.join(' · ');
}

/** Feedback for the hold-to-start gesture: a thin warm bar that fills over start_hold_s. */
function drawHoldBar(ctx, game, cx, y) {
  const fill = Math.min(1, game.holdTime / game.tuning.onboarding.start_hold_s);
  if (fill <= 0) return;
  ctx.fillStyle = COLOR_WARM;
  ctx.fillRect(cx - (HOLD_BAR_WIDTH * fill) / 2, y, HOLD_BAR_WIDTH * fill, HOLD_BAR_HEIGHT);
}

function text(ctx, value, x, y, font) {
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(value, x, y);
}

/** Combo multipliers give fractional points (C2 example: 14.5), so show at most one decimal. */
function formatPoints(points) {
  return String(Math.round(points * 10) / 10);
}

function formatClock(seconds) {
  const whole = Math.ceil(seconds);
  const m = Math.floor(whole / SECONDS_PER_MINUTE);
  const s = whole % SECONDS_PER_MINUTE;
  return `${m}:${String(s).padStart(2, '0')}`;
}
