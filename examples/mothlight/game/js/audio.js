// @ts-check
/**
 * audio.js [DOM]: fully synthesized WebAudio (StyleGuide "Audio mood" + 8 SFX).
 * Reacts to sim events (playEvents) and continuous state (updateAudio).
 * Owner: audio (au-1). No samples, no files: every sound is built from oscillators and one
 * shared white-noise buffer.
 * Contract: every function is a safe no-op before unlock or without WebAudio (Node smoke test).
 *
 * Graph:
 *   pad voices ─► padFilter (cutoff follows lantern brightness) ─► musicBus ─┐
 *   crickets / birds ─────────────────────────────────────────────► musicBus ─┤
 *   glow hum / heat whine / one-shot SFX ─────────────────────────► sfxBus ───┼─► master ─► comp ─► limiter ─► out
 *   chimes + pad also send to a damped feedback delay ("space") ─► space ────┘
 */

import { EVENT } from './events.js';
import { STATE } from './state.js';
import { hottestHeat } from './moths.js';

// ---- Mix (linear gains; kept low on purpose: this is a hushed game) --------------------------
const MASTER_GAIN = 0.55;
const MUSIC_GAIN = 0.32;
const SFX_GAIN = 0.6;
const SPACE_WET = 0.28;
const MAX_SFX_VOICES = 28;          // hard cap on overlapping one-shots (large combos / swarm deaths)
const GATHER_MIN_GAP_S = 0.035;     // moth-joined ticks are rate limited so a swarm grab stays a patter
const SINGE_MIN_GAP_S = 0.09;

// ---- Music ----------------------------------------------------------------------------------
const A2 = 45;                                       // midi root of the night key (A minor pentatonic)
const C3 = 48;                                       // dawn root (C major pentatonic, relative key)
const MINOR_PENTA = [0, 3, 5, 7, 10];
const MAJOR_PENTA = [0, 2, 4, 7, 9];
const NIGHT_CHORDS = [[0, 7, 15, 19], [5, 12, 15, 22], [3, 10, 15, 19], [-2, 7, 14, 17], [0, 10, 15, 24]];
const DAWN_CHORDS = [[0, 7, 16, 19], [5, 12, 16, 21], [-3, 7, 12, 16], [0, 7, 14, 19]];
const CHORD_GAP_S = [5.5, 8.5];                      // generous space between chords
const PAD_ATTACK_S = 2.4;
const PAD_RELEASE_S = 4.5;
const MELODY_CHANCE = 0.55;
const PAD_CUTOFF_MIN = 320;
const PAD_CUTOFF_RANGE = 2900;
const HUM_BASE_HZ = 110;
const HUM_DETUNE_HZ = 0.8;
const PARAM_SMOOTH_S = 0.08;

/**
 * @typedef {{
 *   master: GainNode, music: GainNode, sfx: GainNode, space: DelayNode, spaceIn: GainNode,
 *   padFilter: BiquadFilterNode, padGain: GainNode,
 *   humGain: GainNode, humFilter: BiquadFilterNode,
 *   whineOsc: OscillatorNode, whineGain: GainNode,
 *   noise: AudioBuffer
 * }} AudioNodes
 * @typedef {{
 *   context: AudioContext | null, unlocked: boolean, muted: boolean,
 *   nodes: AudioNodes | null, voices: number, mode: 'night' | 'dawn',
 *   nextChordAt: number, chordIndex: number, nextCricketAt: number, nextBirdAt: number,
 *   lastGatherAt: number, lastSingeAt: number, played: Record<string, number>
 * }} Audio
 */

/**
 * Creates the audio handle. No AudioContext yet because of browser autoplay policy.
 * @returns {Audio}
 */
export function createAudio() {
  return {
    context: null, unlocked: false, muted: false, nodes: null, voices: 0, mode: 'night',
    nextChordAt: 0, chordIndex: 0, nextCricketAt: 0, nextBirdAt: 0,
    lastGatherAt: -1, lastSingeAt: -1, played: {},
  };
}

/**
 * Call from a user gesture (first pointerdown/keydown). Creates/resumes the context and
 * builds the graph. Silently stays mute-only when WebAudio is unavailable.
 * @param {Audio} audio
 * @returns {void}
 */
export function unlockAudio(audio) {
  audio.unlocked = true;
  if (audio.context) {
    if (audio.context.state === 'suspended') audio.context.resume().catch(() => {});
    return;
  }
  const g = /** @type {any} */ (globalThis);
  const Ctor = g.AudioContext || g.webkitAudioContext;
  if (!Ctor) return;
  try {
    const ctx = /** @type {AudioContext} */ (new Ctor());
    audio.context = ctx;
    audio.nodes = buildGraph(ctx);
    audio.nodes.master.gain.value = audio.muted ? 0 : MASTER_GAIN;
    audio.nextChordAt = ctx.currentTime + 0.3;
    audio.nextCricketAt = ctx.currentTime + 1.5;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    watchVisibility(audio);
  } catch (err) {
    console.warn('[audio] WebAudio unavailable:', err);
    audio.context = null;
    audio.nodes = null;
  }
}

/**
 * One-shot SFX for this tick's events (EVENT.* in events.js).
 * Deliveries in the same tick are staggered so a group release plays as an arpeggio.
 * @param {Audio} audio
 * @param {import('./events.js').GameEvent[]} events
 * @returns {void}
 */
export function playEvents(audio, events) {
  const ctx = audio.context;
  if (!ctx || !audio.nodes || audio.muted || events.length === 0) return;
  const now = ctx.currentTime;
  let deliveredThisTick = 0;
  for (const e of events) {
    switch (e.type) {
      case EVENT.MOTH_JOINED:
        if (now - audio.lastGatherAt < GATHER_MIN_GAP_S) continue;
        audio.lastGatherAt = now;
        sfxGather(audio, now);
        break;
      case EVENT.MOTH_SINGED:
        if (now - audio.lastSingeAt < SINGE_MIN_GAP_S) continue;
        audio.lastSingeAt = now;
        sfxSinge(audio, now);
        break;
      case EVENT.MOTH_DELIVERED:
        sfxChime(audio, now + deliveredThisTick * 0.075, e.comboIndex ?? deliveredThisTick);
        deliveredThisTick += 1;
        break;
      case EVENT.MOTH_ZAPPED: sfxZap(audio, now); break;
      case EVENT.MOTH_CANDLED: sfxCandle(audio, now); break;
      case EVENT.LIGHT_ON: sfxLightOn(audio, now, e.kind); break;
      case EVENT.NIGHT_START: sfxNightStart(audio, now); break;
      case EVENT.NIGHT_END: sfxDawn(audio, now); break;
      default: continue;
    }
    audio.played[e.type] = (audio.played[e.type] || 0) + 1;
  }
}

/**
 * Continuous parameters once per frame: glow hum + pad low-pass follow
 * lantern brightness, heat whine follows hottestHeat(), generative pad/crickets/birds.
 * @param {Audio} audio
 * @param {any} game
 * @returns {void}
 */
export function updateAudio(audio, game) {
  const ctx = audio.context;
  const n = audio.nodes;
  if (!ctx || !n || ctx.state !== 'running') return;
  const now = ctx.currentTime;
  const b = clamp01(game?.lantern?.brightness ?? 0);
  const dawn = game?.state === STATE.DAWN;
  audio.mode = dawn ? 'dawn' : 'night';

  // Brightness is audible: brighter = warmer, fuller pad and a louder, more open hum.
  n.padFilter.frequency.setTargetAtTime(PAD_CUTOFF_MIN + PAD_CUTOFF_RANGE * Math.pow(b, 1.3), now, 0.25);
  n.padGain.gain.setTargetAtTime(0.55 + 0.45 * b, now, 0.3);
  n.humGain.gain.setTargetAtTime(game?.lantern?.held || b > 0.02 ? 0.1 * b : 0, now, PARAM_SMOOTH_S);
  n.humFilter.frequency.setTargetAtTime(180 + 1600 * b, now, PARAM_SMOOTH_S);

  const heat = game?.swarm && !dawn ? clamp01(hottestHeat(game.swarm)) : 0;
  const whine = heat > 0.2 ? (heat - 0.2) / 0.8 : 0;
  n.whineOsc.frequency.setTargetAtTime(800 + 600 * heat, now, PARAM_SMOOTH_S);
  n.whineGain.gain.setTargetAtTime(0.035 * whine * whine, now, PARAM_SMOOTH_S);

  if (now >= audio.nextChordAt) schedulePadChord(audio, now);
  if (!dawn && now >= audio.nextCricketAt) {
    scheduleCrickets(audio, now);
    audio.nextCricketAt = now + rand(0.7, 3.2);
  }
  if (dawn && now >= audio.nextBirdAt) {
    birdChirp(audio, now);
    audio.nextBirdAt = now + rand(0.4, 1.6);
  }
}

/**
 * @param {Audio} audio
 * @param {boolean} muted
 * @returns {void}
 */
export function setMuted(audio, muted) {
  audio.muted = muted;
  const ctx = audio.context;
  if (!ctx || !audio.nodes) return;
  const gain = audio.nodes.master.gain;
  gain.cancelScheduledValues(ctx.currentTime);
  gain.setTargetAtTime(muted ? 0 : MASTER_GAIN, ctx.currentTime, 0.05);
}

/**
 * Flips mute (key M). Returns the new muted state.
 * @param {Audio} audio
 * @returns {boolean}
 */
export function toggleMute(audio) {
  setMuted(audio, !audio.muted);
  return audio.muted;
}

// ================================================================================================
// Graph
// ================================================================================================

/**
 * @param {AudioContext} ctx
 * @returns {AudioNodes}
 */
function buildGraph(ctx) {
  // Glue compressor, then a fast brick-wall-ish limiter so stacked SFX never clip.
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -20; comp.knee.value = 10; comp.ratio.value = 4;
  comp.attack.value = 0.01; comp.release.value = 0.3;
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -4; limiter.knee.value = 0; limiter.ratio.value = 20;
  limiter.attack.value = 0.002; limiter.release.value = 0.12;
  comp.connect(limiter).connect(ctx.destination);

  const master = gainNode(ctx, MASTER_GAIN, comp);
  const music = gainNode(ctx, MUSIC_GAIN, master);
  const sfx = gainNode(ctx, SFX_GAIN, master);

  // "Space": a damped feedback delay stands in for reverb (cheap, no impulse response needed).
  const spaceIn = gainNode(ctx, 1, null);
  const space = ctx.createDelay(1);
  space.delayTime.value = 0.31;
  const damp = biquad(ctx, 'lowpass', 2400, 0.5);
  const feedback = gainNode(ctx, 0.38, null);
  spaceIn.connect(space).connect(damp).connect(feedback).connect(space);
  damp.connect(gainNode(ctx, SPACE_WET, master));

  const padGain = gainNode(ctx, 0.6, music);
  const padFilter = biquad(ctx, 'lowpass', PAD_CUTOFF_MIN, 0.7);
  padFilter.connect(padGain);
  padGain.connect(spaceIn);

  // Glow hum: 110 Hz sine plus a slightly detuned partner (slow beating), continuous.
  const humGain = gainNode(ctx, 0, sfx);
  const humFilter = biquad(ctx, 'lowpass', 200, 0.9);
  humFilter.connect(humGain);
  for (const f of [HUM_BASE_HZ, HUM_BASE_HZ + HUM_DETUNE_HZ, HUM_BASE_HZ * 2 + 0.3]) {
    const o = ctx.createOscillator();
    o.type = f > 200 ? 'triangle' : 'sine';
    o.frequency.value = f;
    o.connect(f > 200 ? gainNode(ctx, 0.25, humFilter) : humFilter);
    o.start();
  }

  // Heat whine: thin sine, volume follows the hottest moth.
  const whineGain = gainNode(ctx, 0, sfx);
  const whineOsc = ctx.createOscillator();
  whineOsc.type = 'sine';
  whineOsc.frequency.value = 800;
  whineOsc.connect(whineGain);
  whineOsc.start();

  return { master, music, sfx, space, spaceIn, padFilter, padGain, humGain, humFilter, whineOsc, whineGain,
    noise: makeNoise(ctx) };
}

/**
 * @param {AudioContext} ctx @param {number} value @param {AudioNode | null} dest
 * @returns {GainNode}
 */
function gainNode(ctx, value, dest) {
  const g = ctx.createGain();
  g.gain.value = value;
  if (dest) g.connect(dest);
  return g;
}

/**
 * @param {AudioContext} ctx @param {BiquadFilterType} type @param {number} freq @param {number} q
 * @returns {BiquadFilterNode}
 */
function biquad(ctx, type, freq, q) {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  return f;
}

/** @param {AudioContext} ctx @returns {AudioBuffer} one second of white noise, shared by all noise SFX */
function makeNoise(ctx) {
  const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

/** Suspends the context while the tab is hidden (main.js pauses the sim then too). @param {Audio} audio */
function watchVisibility(audio) {
  if (typeof document === 'undefined') return;
  document.addEventListener('visibilitychange', () => {
    const ctx = audio.context;
    if (!ctx) return;
    if (document.hidden) ctx.suspend().catch(() => {});
    else if (audio.unlocked) ctx.resume().catch(() => {});
  });
}

// ================================================================================================
// Voice helpers
// ================================================================================================

/**
 * Reserves an SFX voice slot. Returns false when the cap is hit (the sound is dropped).
 * @param {Audio} audio @param {AudioScheduledSourceNode} src
 * @returns {boolean}
 */
function claimVoice(audio, src) {
  if (audio.voices >= MAX_SFX_VOICES) return false;
  audio.voices += 1;
  src.onended = () => { audio.voices = Math.max(0, audio.voices - 1); };
  return true;
}

/**
 * Attack/exponential-decay envelope on a fresh gain node.
 * @param {AudioContext} ctx @param {number} t @param {number} attack @param {number} peak
 * @param {number} decay @param {AudioNode} dest
 * @returns {GainNode}
 */
function envGain(ctx, t, attack, peak, decay, dest) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  g.connect(dest);
  return g;
}

/**
 * @param {Audio} audio @param {number} t @param {number} dur
 * @returns {AudioBufferSourceNode}
 */
function noiseSource(audio, t, dur) {
  const ctx = /** @type {AudioContext} */ (audio.context);
  const src = ctx.createBufferSource();
  src.buffer = /** @type {AudioNodes} */ (audio.nodes).noise;
  src.start(t, Math.random() * 0.8, dur);
  src.stop(t + dur + 0.02);
  return src;
}

/**
 * @param {AudioContext} ctx @param {OscillatorType} type @param {number} freq
 * @param {number} t @param {number} dur
 * @returns {OscillatorNode}
 */
function osc(ctx, type, freq, t, dur) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  o.start(t);
  o.stop(t + dur + 0.05);
  return o;
}

// ================================================================================================
// SFX (StyleGuide "Key SFX")
// ================================================================================================

/** 2. Moth gather: a 4 ms high-passed noise tick, randomly pitched. @param {Audio} audio @param {number} t */
function sfxGather(audio, t) {
  const ctx = /** @type {AudioContext} */ (audio.context);
  const src = noiseSource(audio, t, 0.006);
  if (!claimVoice(audio, src)) return;
  const hp = biquad(ctx, 'bandpass', rand(3500, 7500), 2.5);
  src.connect(hp).connect(envGain(ctx, t, 0.0008, 0.18, 0.004, /** @type {AudioNodes} */ (audio.nodes).sfx));
}

/** 4. Singe: soft bandpassed crackle, then a falling "fff" puff. Sad, not violent. @param {Audio} audio @param {number} t */
function sfxSinge(audio, t) {
  const ctx = /** @type {AudioContext} */ (audio.context);
  const n = /** @type {AudioNodes} */ (audio.nodes);
  const crackle = noiseSource(audio, t, 0.14);
  if (!claimVoice(audio, crackle)) return;
  const bp = biquad(ctx, 'bandpass', rand(1500, 2400), 1.8);
  const cg = ctx.createGain();
  cg.gain.setValueAtTime(0.0001, t);
  // Irregular pops: a handful of instant spikes that decay fast.
  for (let i = 0, pt = t; i < 5; i++, pt += rand(0.012, 0.03)) {
    cg.gain.setValueAtTime(rand(0.12, 0.22), pt);
    cg.gain.setTargetAtTime(0.0001, pt + 0.002, 0.006);
  }
  crackle.connect(bp).connect(cg).connect(n.sfx);

  const puffT = t + 0.1;
  const puff = noiseSource(audio, puffT, 0.4);
  const lp = biquad(ctx, 'lowpass', 2200, 0.6);
  lp.frequency.setValueAtTime(2200, puffT);
  lp.frequency.exponentialRampToValueAtTime(260, puffT + 0.38);
  puff.connect(lp).connect(envGain(ctx, puffT, 0.04, 0.07, 0.34, n.sfx));
}

/**
 * 5. Moon delivery: glassy triangle chime with delay echo. Each combo step climbs the
 * pentatonic scale, so a big group release becomes an arpeggio.
 * @param {Audio} audio @param {number} t @param {number} step
 */
function sfxChime(audio, t, step) {
  const ctx = /** @type {AudioContext} */ (audio.context);
  const n = /** @type {AudioNodes} */ (audio.nodes);
  const s = Math.min(Math.max(0, step | 0), 12);   // cap ~2.5 octaves above A4 so it stays glassy, not shrill
  const scale = audio.mode === 'dawn' ? MAJOR_PENTA : MINOR_PENTA;
  const midi = A2 + 24 + scale[s % 5] + 12 * Math.floor(s / 5);
  const f = midiHz(midi);
  const o = osc(ctx, 'triangle', f, t, 1.4);
  if (!claimVoice(audio, o)) return;
  const shimmer = osc(ctx, 'sine', f * 2.01, t, 0.6);
  const g = envGain(ctx, t, 0.004, 0.16, 1.3, n.sfx);
  g.connect(n.spaceIn);
  o.connect(g);
  shimmer.connect(envGain(ctx, t, 0.002, 0.04, 0.5, g));
}

/** 6. Zapper kill: 60 ms square buzz with a pitch drop. The only harsh sound. @param {Audio} audio @param {number} t */
function sfxZap(audio, t) {
  const ctx = /** @type {AudioContext} */ (audio.context);
  const o = osc(ctx, 'square', 240, t, 0.07);
  if (!claimVoice(audio, o)) return;
  o.frequency.exponentialRampToValueAtTime(70, t + 0.06);
  const lp = biquad(ctx, 'lowpass', 3200, 1);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.13, t);
  g.gain.setValueAtTime(0.13, t + 0.05);
  g.gain.linearRampToValueAtTime(0.0001, t + 0.065);
  o.connect(lp).connect(g).connect(/** @type {AudioNodes} */ (audio.nodes).sfx);
}

/** 7. Candle catch: a low muffled sine thump at 80 Hz. @param {Audio} audio @param {number} t */
function sfxCandle(audio, t) {
  const ctx = /** @type {AudioContext} */ (audio.context);
  const n = /** @type {AudioNodes} */ (audio.nodes);
  const o = osc(ctx, 'sine', 80, t, 0.25);
  if (!claimVoice(audio, o)) return;
  o.frequency.exponentialRampToValueAtTime(48, t + 0.2);
  o.connect(envGain(ctx, t, 0.006, 0.32, 0.2, n.sfx));
  const puff = noiseSource(audio, t, 0.08);
  puff.connect(biquad(ctx, 'lowpass', 500, 0.7)).connect(envGain(ctx, t, 0.003, 0.08, 0.07, n.sfx));
}

/**
 * LIGHT_ON: a zapper flickers up with a mains hum-on (the danger cue); a new candle breathes
 * alight; a decoy flower blooms with a faint glint.
 * @param {Audio} audio @param {number} t @param {string} kind
 */
function sfxLightOn(audio, t, kind) {
  if (kind === 'zapper') zapperHumOn(audio, t);
  else if (kind === 'candle') candleLight(audio, t);
  else flowerBloom(audio, t);
}

/** @param {Audio} audio @param {number} t */
function zapperHumOn(audio, t) {
  const ctx = /** @type {AudioContext} */ (audio.context);
  const dur = 1.5;
  const o = osc(ctx, 'sawtooth', 60, t, dur);
  if (!claimVoice(audio, o)) return;
  const o2 = osc(ctx, 'square', 120.6, t, dur);
  const lp = biquad(ctx, 'lowpass', 200, 4);
  lp.frequency.setValueAtTime(200, t);
  lp.frequency.exponentialRampToValueAtTime(1800, t + 0.5);
  lp.frequency.exponentialRampToValueAtTime(500, t + dur);
  const g = ctx.createGain();
  // Fluorescent-tube stutter: two flickers, then it catches, holds, fades under the mix.
  g.gain.setValueAtTime(0.0001, t);
  g.gain.setValueAtTime(0.05, t + 0.02);
  g.gain.setValueAtTime(0.0001, t + 0.07);
  g.gain.setValueAtTime(0.06, t + 0.14);
  g.gain.setValueAtTime(0.0001, t + 0.18);
  g.gain.linearRampToValueAtTime(0.07, t + 0.35);
  g.gain.setValueAtTime(0.07, t + 0.8);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(lp);
  o2.connect(gainNode(ctx, 0.4, lp));
  lp.connect(g).connect(/** @type {AudioNodes} */ (audio.nodes).sfx);
}

/** @param {Audio} audio @param {number} t */
function candleLight(audio, t) {
  const ctx = /** @type {AudioContext} */ (audio.context);
  const src = noiseSource(audio, t, 0.6);
  if (!claimVoice(audio, src)) return;
  const bp = biquad(ctx, 'bandpass', 700, 0.8);
  bp.frequency.setValueAtTime(400, t);
  bp.frequency.exponentialRampToValueAtTime(1400, t + 0.3);
  src.connect(bp).connect(envGain(ctx, t, 0.15, 0.06, 0.4, /** @type {AudioNodes} */ (audio.nodes).sfx));
}

/** @param {Audio} audio @param {number} t */
function flowerBloom(audio, t) {
  const ctx = /** @type {AudioContext} */ (audio.context);
  const n = /** @type {AudioNodes} */ (audio.nodes);
  const f = midiHz(A2 + 48 + MINOR_PENTA[(Math.random() * 5) | 0]);
  const o = osc(ctx, 'sine', f, t, 1.2);
  if (!claimVoice(audio, o)) return;
  o.frequency.exponentialRampToValueAtTime(f * 1.003, t + 1.1);
  const g = envGain(ctx, t, 0.08, 0.035, 1.0, n.sfx);
  g.connect(n.spaceIn);
  o.connect(g);
}

/** NIGHT_START: soft low bloom and the pad returns to the night key. @param {Audio} audio @param {number} t */
function sfxNightStart(audio, t) {
  audio.mode = 'night';
  audio.nextChordAt = t;               // start a chord right away so the night opens on the pad
  audio.chordIndex = 0;
  const ctx = /** @type {AudioContext} */ (audio.context);
  const o = osc(ctx, 'sine', midiHz(A2), t, 3);
  if (!claimVoice(audio, o)) return;
  o.connect(envGain(ctx, t, 0.8, 0.12, 2.0, /** @type {AudioNodes} */ (audio.nodes).music));
}

/**
 * 8. Dawn: slow major-key swell with a filter opening over 3 s, and FM birdsong.
 * @param {Audio} audio @param {number} t
 */
function sfxDawn(audio, t) {
  audio.mode = 'dawn';
  const ctx = /** @type {AudioContext} */ (audio.context);
  const n = /** @type {AudioNodes} */ (audio.nodes);
  const lp = biquad(ctx, 'lowpass', 250, 0.8);
  lp.frequency.setValueAtTime(250, t);
  lp.frequency.exponentialRampToValueAtTime(4200, t + 3);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(0.16, t + 3);
  g.gain.setValueAtTime(0.16, t + 4);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 9);
  lp.connect(g).connect(n.music);
  g.connect(n.spaceIn);
  for (const semi of [0, 7, 12, 16, 19, 24]) {
    for (const det of [-4, 4]) {
      const o = osc(ctx, semi < 12 ? 'triangle' : 'sine', midiHz(C3 + semi), t, 9);
      o.detune.value = det;
      o.connect(lp);
    }
  }
  audio.nextChordAt = t + 8;           // let the swell breathe before the pad resumes (in major)
  audio.chordIndex = 0;
  for (let i = 0; i < 7; i++) birdChirp(audio, t + 1.2 + i * rand(0.35, 0.8));
  audio.nextBirdAt = t + 6;
}

/** FM sine blip, a little upward flick like a small bird. @param {Audio} audio @param {number} t */
function birdChirp(audio, t) {
  const ctx = /** @type {AudioContext} */ (audio.context);
  const dur = rand(0.07, 0.16);
  const base = rand(2600, 4200);
  const carrier = osc(ctx, 'sine', base, t, dur);
  if (!claimVoice(audio, carrier)) return;
  carrier.frequency.exponentialRampToValueAtTime(base * rand(1.15, 1.5), t + dur);
  const mod = osc(ctx, 'sine', rand(28, 60), t, dur);
  const depth = gainNode(ctx, rand(250, 600), carrier.frequency);
  mod.connect(depth);
  const g = envGain(ctx, t, 0.01, 0.035, dur, /** @type {AudioNodes} */ (audio.nodes).music);
  g.connect(/** @type {AudioNodes} */ (audio.nodes).spaceIn);
  carrier.connect(g);
}

// ================================================================================================
// Generative nocturne
// ================================================================================================

/**
 * Schedules the next slow pad chord (sine+triangle pairs through the brightness filter) and,
 * sometimes, a sparse melody note above it. Chords wander through the pentatonic set instead
 * of looping, so the bed never repeats exactly.
 * @param {Audio} audio @param {number} now
 */
function schedulePadChord(audio, now) {
  const ctx = /** @type {AudioContext} */ (audio.context);
  const n = /** @type {AudioNodes} */ (audio.nodes);
  const dawn = audio.mode === 'dawn';
  const chords = dawn ? DAWN_CHORDS : NIGHT_CHORDS;
  const root = dawn ? C3 : A2;
  // Random walk of -1/0/+1/+2 steps keeps harmonic motion gentle.
  audio.chordIndex = (audio.chordIndex + [1, 1, 2, chords.length - 1][(Math.random() * 4) | 0]) % chords.length;
  const chord = chords[audio.chordIndex];
  const hold = rand(CHORD_GAP_S[0], CHORD_GAP_S[1]);
  const t = now + 0.05;
  for (const semi of chord) {
    const f = midiHz(root + semi);
    for (const [type, det, level] of /** @type {[OscillatorType, number, number][]} */ ([['sine', -5, 0.06], ['triangle', 6, 0.035]])) {
      const o = osc(ctx, type, f, t, hold + PAD_RELEASE_S);
      o.detune.value = det;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(level, t + PAD_ATTACK_S);
      g.gain.setValueAtTime(level, t + hold);
      g.gain.exponentialRampToValueAtTime(0.0001, t + hold + PAD_RELEASE_S);
      o.connect(g).connect(n.padFilter);
    }
  }
  if (Math.random() < MELODY_CHANCE) {
    const scale = dawn ? MAJOR_PENTA : MINOR_PENTA;
    const mt = t + rand(1.5, hold - 0.5);
    const f = midiHz(root + 24 + scale[(Math.random() * 5) | 0] + (Math.random() < 0.3 ? 12 : 0));
    const o = osc(ctx, 'sine', f, mt, 3.2);
    const g = envGain(ctx, mt, 0.25, 0.05, 2.8, n.padFilter);
    o.connect(g);
  }
  audio.nextChordAt = now + hold;
}

/** Cricket: 2–4 pulses of narrow-band noise near 4.5 kHz, quiet, panned slightly. @param {Audio} audio @param {number} now */
function scheduleCrickets(audio, now) {
  const ctx = /** @type {AudioContext} */ (audio.context);
  const n = /** @type {AudioNodes} */ (audio.nodes);
  const pulses = 2 + ((Math.random() * 3) | 0);
  const freq = rand(4200, 5200);
  const level = rand(0.02, 0.05);
  const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
  const bp = biquad(ctx, 'bandpass', freq, 12);
  if (pan) { pan.pan.value = rand(-0.7, 0.7); bp.connect(pan).connect(n.music); } else bp.connect(n.music);
  for (let i = 0; i < pulses; i++) {
    const t = now + i * 0.055;
    const src = noiseSource(audio, t, 0.03);
    src.connect(envGain(ctx, t, 0.004, level, 0.022, bp));
  }
}

// ================================================================================================
// Math
// ================================================================================================

/** @param {number} m @returns {number} */
function midiHz(m) { return 440 * Math.pow(2, (m - 69) / 12); }
/** @param {number} a @param {number} b @returns {number} */
function rand(a, b) { return a + Math.random() * (b - a); }
/** @param {number} v @returns {number} */
function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
