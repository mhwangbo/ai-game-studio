# Mothlight: Technical Design Document (v1)

Owner: tl-1 (Tech Lead) · Ticket: JAM-3 · Milestone: M1 (Playable) · Tier: jam
Sources: `Pitch.md`, `StyleGuide.md`, `GDD.md` (rule IDs such as L3, M1 and H1 refer to GDD §3). All numbers live in `Game/data/tuning.json` (gd-1).

## Engine & versions
- **No engine.** Vanilla JavaScript (ES2022) as native **ES modules** and the **Canvas 2D** API. Audio is **WebAudio** and is fully synthesized.
- **No build step, no npm dependencies, no bundler, no external assets.** The only remote resource is the Google Font "Cormorant Garamond" (SIL OFL). It is optional, and the game falls back to `Georgia, serif` when it is offline.
- Tooling: Node >= 18 (tested on 22.14) runs the headless smoke test. Python 3 (tested 3.12) serves the game locally.
- ES modules **do not load over `file://`** (CORS). The game must be served over http (see Test & build).

## Target platforms & budgets
| Item | Budget |
|---|---|
| Browsers | Latest Chrome, Edge, Firefox, Safari (desktop and mobile) |
| Logical resolution | 960×540 (`canvas.width/height`), letterboxed to the window, `devicePixelRatio`-aware backing store (DPR capped at 2) |
| Frame rate | 60 fps render. Simulation runs at a **fixed 60 Hz** (`SIM.TICK_RATE` in config.js; engine constant, not design tuning) |
| Moth count | Design cap is 80 alive (`spawn.max_alive`). Perf target is still **200 at 60 fps** (Pitch) for headroom: ≤ 4 ms sim + ≤ 8 ms render per frame on a mid laptop |
| Payload | < 200 KB total (code only, no assets) |
| Allocation | No closures or new objects inside per-moth inner loops. Events are the only per-tick allocations |
| Input | Mouse, touch (whole screen is the target), keyboard |

## Architecture

### Folder layout (`Game/` is the web root)
```
Game/
  index.html          page shell, <canvas id="game">, loads js/main.js as type="module"
  css/style.css       full-bleed page, canvas centred, touch-action: none
  data/tuning.json    ALL gameplay numbers (owned by gd-1). Optional at runtime: defaults in config.js
  js/
    main.js      [DOM]  bootstrap, fixed-timestep loop, wires modules, pause on hidden, best-score persistence
    state.js     [PURE] state machine (title → night → dawn), lantern, scoring/combo, hints, stepGame
    input.js     [DOM]  pointer/touch/keyboard → InputFrame
    ui.js        [DOM]  canvas-drawn title, HUD, hints, end screen
    moths.js     [PURE] swarm: spawning, steering, heat, capture/death/delivery/lost
    world.js     [PURE] procedural garden: moon, candles, zappers, flowers, silhouettes; light list
    render.js    [DOM]  canvas setup/letterbox/DPR, draws sky, garden, lights, moths, lantern
    audio.js     [DOM]  WebAudio synth: pad, glow hum, SFX driven by sim events (M2)
    config.js    [PURE] SIM constants, DEFAULT_TUNING, mergeTuning, loadTuning (fetch with fallback)
    rng.js       [PURE] seeded PRNG (mulberry32)
    events.js    [PURE] event type constants + emit helper
  tests/smoke.mjs     headless Node smoke test (imports PURE modules only)
```

**PURE rule (the smoke test enforces it):** `state.js`, `moths.js`, `world.js`, `config.js`, `rng.js` and `events.js` must never reference `window`, `document`, `localStorage`, `AudioContext`, `requestAnimationFrame`, `performance` or `Math.random`. They may import only other PURE modules. The rule exists so that the whole simulation runs unchanged under Node for headless QA. (`config.js#loadTuning` gets `fetch` injected. `rng.js#randomSeed` is the only function allowed to use time/`Math.random`, and the smoke test whitelists it.)

### Dependency graph (imports only point downward)
```
main.js ─┬─► state.js ─┬─► moths.js ─► events.js
         │             ├─► world.js ─► events.js
         │             └─► config.js, rng.js, events.js
         ├─► input.js
         ├─► render.js   (reads Game, never mutates)
         ├─► ui.js       (reads Game, never mutates)
         ├─► audio.js    (reads Game + events, never mutates)
         └─► config.js   (loadTuning)
```
- `moths.js` and `world.js` **do not import each other.** They meet only through the `SimContext` that `state.js` builds each tick, so gameplay-2 and gameplay-3 never block on each other. Lights are plain data objects with the shared `Light` shape.
- render/ui/audio are **read-only observers** of `Game`.

### Game loop (fixed timestep, `main.js`)
```
STEP = 1 / SIM.TICK_RATE                     // 1/60 s
acc += min(realDt, SIM.MAX_FRAME_DT)         // 0.25 s clamp (tab switch / breakpoint)
steps = 0
while acc >= STEP and steps < SIM.MAX_STEPS_PER_FRAME:   // 5
    frame = sampleInput(input, STEP)         // edges consumed on the first step; dt drives the keyboard cursor
    stepGame(game, frame, STEP)              // resets game.events, then fills it
    playEvents(audio, game.events)
    if an EVENT.NIGHT_END event → saveBest(game.best)
    acc -= STEP; steps++
if steps == cap: acc = 0                     // drop time rather than spiral
updateAudio(audio, game)                     // continuous params
ctx.save()                                   // drawFrame clips; restore so clip/transform never accumulate
drawFrame(renderer, game, acc / STEP)
drawUi(renderer.ctx, game, view)
ctx.restore()
```
- **Pause (N1):** on `visibilitychange` → hidden, main.js stops stepping and clears `acc`. The night clock is sim time, so it pauses automatically.
- **Determinism:** the same seed and the same InputFrame sequence give identical results. All sim randomness goes through `game.rng`.

### State machine (`state.js`, GDD §3.8 / §6)
| State | Update | Transition |
|---|---|---|
| `title` | lantern moves and glows (the verb is felt at once). No moths, no clock. | glow held for `onboarding.start_hold_s` (0.6 s) → `startNight()` |
| `night` | lantern → world → swarm → scoring → hints → clock `night.elapsed += dt`. Sky lerp is render-side from `night.elapsed` (N2). | `elapsed >= night.length_s` → emit `NIGHT_END`, go to `dawn` |
| `dawn` | N3: input ignored, lantern forced dark, `endFade` 0→1 over `night.end_lights_fade_s`, moths flee to edges (no scoring). | `stateTime >= night.end_screen_delay_s` → ui shows the end screen. Then hold `start_hold_s` → `startNight()` with a new seed |

`game.holdTime` accumulates while held (and resets on release) for the hold-to-start gesture. A new night draws its seed from `game.rng`, so each garden differs. `?seed=N` in the URL fixes the first seed (daily seed is M2 stretch).

### Per-tick data flow (night)
1. `updateLantern(lantern, input, dt, tuning)`: L1 exponential follow capped at `max_speed`, clamped to canvas. L3 brightness ramp. (The L2 touch offset is applied in input.js, which knows the pointer type.)
2. `updateWorld(world, worldCtx, dt)`: W2 flicker, W3 zapper activation/warm-up at `on_at_s`, extra candle at `extra_at_s`, W1 moon setting, W4 flower bloom windows, `endFade`.
3. `lights = [lanternToLight(lantern, tuning)?, ...getLights(world)]`: the lantern light is omitted when dark (L4).
4. `updateSwarm(swarm, simCtx, dt)`: S1–S3 spawning, M1–M5 steering, H1–H3 heat, captures. Emits events.
5. `state.js` scores `MOTH_DELIVERED` events (C1/C2, annotating `comboIndex` and `points`), counts losses and updates hints.

### Shared data shapes (the contract; positions in logical px, time in s)
```js
/** InputFrame: input.js (browser) or hand-built (tests, createInputFrame) */
{ x, y,          // number: target point, logical px (touch offset already applied)
  held,          // boolean: LMB / touch / Space held
  pressed,       // boolean: edge false→true since the last sample
  released,      // boolean: edge true→false since the last sample
  hasPointer }   // boolean: false until the first input of any kind

/** Lantern: state.js */
{ x, y, vx, vy, brightness /*0..1*/, held, dark /*b < dark_threshold*/ }

/** Light: world.js creates world lights; state.js builds the lantern light */
{ id,            // string, unique per night: 'lantern', 'moon', 'candle-0', 'zapper-1', 'flower-3'
  kind,          // LIGHT_KIND: 'lantern' | 'moon' | 'candle' | 'zapper' | 'flower'
  x, y,
  intensity,     // current effective intensity (flicker, warm-up, setting and endFade applied)
  range,         // px: moths farther than this ignore it (M1)
  radius,        // px: capture radius. moon = capture_radius, candle/zapper = kill_radius, flower = hover_radius, lantern = 0
  lethal,        // boolean: true for candle, and for zapper once warm-up is complete
  scoring,       // boolean: moon only
  orbit,         // boolean: lantern and flower (M3 tangential force)
  active }       // boolean: getLights() returns only active lights; render also draws inactive ones (unlit cage, W5)

/** Moth: moths.js */
{ id, species /*'dusty'|'silkwing'|'atlas'*/, x, y, vx, vy,
  heat,          // % 0..100 (H1-H3)
  status,        // MOTH_STATUS: 'free'|'drawn'|'fleeing'|'singed'|'captured'|'delivered'|'lost'
  targetId,      // id of the light currently targeted, or null
  joined,        // boolean: has joined the lantern cloud this carry (M5; reset when it targets something else)
  unattracted,   // s of cumulative time with no light in range (M4)
  flap,          // radians: wing phase for render
  fade }         // s left for the death/delivery animation. Removed from swarm.moths when it reaches 0

/** Swarm: moths.js */
{ moths: Moth[], nextId, spawnTimer, firstSpawnDone }

/** World: world.js */
{ width, height, moon: Light, candles: Light[], zappers: Light[], flowers: Light[],
  silhouettes: [{ layer: 'far'|'near', points: [{x, y}, ...] }] }

/** SimContext: state.js → updateSwarm */
{ tuning, rng, width, height,
  lantern,       // Lantern (read-only to moths)
  lights,        // Light[]: active lights, lantern first when lit
  nightTime,     // s since night start (S1-S3 timing)
  spawning,      // boolean: night state and nightTime < spawn.spawn_stop_s
  fleeing,       // boolean: dawn N3, so all moths head to the nearest edge and no scoring happens
  events }       // Event[] to push into via emit()

/** WorldContext: state.js → updateWorld */
{ tuning, rng, nightTime, endFade /*0..1, 1 = every light off*/ }

/** Game: state.js */
{ tuning, state /*STATE*/, stateTime, time, tick, seed, rng, holdTime,
  night: { elapsed, length },
  lantern, world, swarm,
  score: { points, delivered, singed, lostToLights, lost,
           combo: { count, timer, points } },           // C1/C2
  hints: { hold, release, brightReached, firstDelivery }, // §6 hints. ui draws `hold`/`release` when true
  best, isNewBest,                                     // best is set by main.js from storage, raised by state at NIGHT_END
  endFade,
  events }       // Event[] for this tick only
```

### Events (`events.js`)
Every event is `{ type, ...payload }`, pushed through `emit(events, type, payload)`.
| `EVENT.*` | Emitter | Payload | Consumers |
|---|---|---|---|
| `NIGHT_START` | state | `{ seed }` | audio (pad) |
| `NIGHT_END` | state | `{ points, delivered, singed, lostToLights, lost, best, isNewBest }` | main (save best), audio (dawn swell) |
| `MOTH_SPAWNED` | moths | `{ mothId, species, x, y }` | – |
| `MOTH_JOINED` | moths | `{ mothId, species, x, y }` (M5) | audio (gather tick) |
| `MOTH_SINGED` | moths | `{ mothId, species, x, y }` (H3) | audio (crackle) |
| `MOTH_DELIVERED` | moths, then state adds `comboIndex`, `points` | `{ mothId, species, x, y, value, comboIndex, points }` | audio (chime step = comboIndex), ui (float text, M2) |
| `MOTH_ZAPPED` | moths | `{ mothId, species, x, y, lightId }` | audio (zap) |
| `MOTH_CANDLED` | moths | `{ mothId, species, x, y, lightId }` | audio (thump) |
| `MOTH_LOST` | moths | `{ mothId, species, x, y }` (M4 edge despawn) | – |
| `COMBO_END` | state | `{ count, points }`: group closed (C2) | ui (M2) |
| `LIGHT_ON` | world | `{ lightId, kind }`: zapper warm-up start, extra candle, flower bloom | audio (zapper buzz start) |

### Module APIs (stubs already export every symbol with these signatures)

**config.js** (tl-1)
- `SIM = { TICK_RATE: 60, MAX_STEPS_PER_FRAME: 5, MAX_FRAME_DT: 0.25 }`: engine constants.
- `DEFAULT_TUNING`: deep-frozen mirror of gd-1's `tuning.json` (same keys, same values).
- `mergeTuning(base, override) → object`: deep merge. Plain objects recurse, while arrays and scalars replace. Keys starting with `_` are dropped. It returns a new object and mutates neither argument.
- `async loadTuning(url = 'data/tuning.json', fetchFn = globalThis.fetch) → { tuning, source: 'file'|'default', error: string|null }`: **never throws**.

**rng.js** (tl-1)
- `createRng(seed) → Rng { seed, next()→[0,1), range(min,max), int(min,maxIncl), pick(arr), chance(p), between([min,max]) }`
- `randomSeed() → uint32` (the only non-deterministic function in the PURE set)

**events.js** (tl-1)
- `EVENT` (frozen, table above) · `emit(events, type, payload = {}) → void`

**state.js** (gameplay-1)
- `STATE = { TITLE: 'title', NIGHT: 'night', DAWN: 'dawn' }`
- `createGame(tuning, seed) → Game` (in `title`)
- `stepGame(game, input: InputFrame, dt) → void`: the only entry point used by the loop and tests
- `startNight(game, seed?) → void` · `nightProgress(game) → 0..1`
- `createInputFrame(overrides = {}) → InputFrame`
- `createLantern(tuning) → Lantern` · `updateLantern(lantern, input, dt, tuning) → void` · `lanternToLight(lantern, tuning) → Light | null` (null when dark)
- `lanternRange(brightness, tuning) → px` (L5: `range_base + range_per_brightness × b`)

**moths.js** (gameplay-2)
- `SPECIES = { DUSTY, SILKWING, ATLAS }` · `MOTH_STATUS = { FREE, DRAWN, FLEEING, SINGED, CAPTURED, DELIVERED, LOST }`
- `createSwarm(tuning) → Swarm`
- `updateSwarm(swarm, ctx: SimContext, dt) → void`: S1–S3, M1–M5, H1–H4, W1–W4 captures. Emits the moth events. Removes moths once their `fade` reaches 0.
- `spawnCluster(swarm, ctx, x, y, count, species = null) → Moth[]` (`null` rolls species by weight)
- `countAlive(swarm) → number` (statuses free/drawn/fleeing) · `hottestHeat(swarm) → 0..100`
- `countTargeting(swarm, lightId) → number` (for the "let go under the moon" hint)

**world.js** (gameplay-3)
- `LIGHT_KIND = { LANTERN, MOON, CANDLE, ZAPPER, FLOWER }`
- `createWorld(tuning, rng) → World`: W1/W5 placement, including future hazards (shown unlit), plus silhouettes.
- `updateWorld(world, ctx: WorldContext, dt) → void` · `getLights(world) → Light[]` (active only, never the lantern)

**render.js** (gameplay-3)
- `createRenderer(canvas, width, height) → Renderer { canvas, ctx, width, height, scale, offsetX, offsetY, dpr }`
- `resizeRenderer(renderer) → void` (main calls it on `resize`) · `screenToLogical(renderer, clientX, clientY) → {x, y}`
- `drawFrame(renderer, game, alpha) → void`: sky (N2 lerp), silhouettes, lights (additive; inactive hazards drawn unlit), moths (+ H4 heat ring), lantern. It leaves `ctx` in logical-space transform for ui.js.

**ui.js** (gameplay-1)
- `drawUi(ctx, game, view: { width, height, time }) → void`: title ("Mothlight" / "hold to glow"), night HUD (saved top-left, sun arc top-right), hints, and the end screen (*"{saved} found the moon."*, score, best, "hold to begin again") once `state === 'dawn' && stateTime >= end_screen_delay_s`.

**input.js** (gameplay-1)
- `createInput(element, toLogical, options = { touchOffsetY, keySpeed, width, height }) → Input`: pointer events (mouse and touch unified, `setPointerCapture`) with the L2 touch offset. Arrows/WASD move a virtual cursor at `keySpeed` and Space holds. Calls `preventDefault` on touch scrolling.
- `sampleInput(input, dt = 0) → InputFrame`: consumes the edges. `dt` advances the keyboard cursor.
- `destroyInput(input) → void`

**audio.js** (audio, M2)
- `createAudio() → Audio` (no AudioContext yet, because of the autoplay policy) · `unlockAudio(audio)` (main.js calls it on the first pointerdown/keydown)
- `playEvents(audio, events) → void` · `updateAudio(audio, game) → void` (hum/pad low-pass follow `lantern.brightness`, whine follows `hottestHeat`) · `setMuted(audio, muted) → void`
- Every call is a safe no-op before unlock or without WebAudio.

**main.js** (gameplay-1): no exports. Boots, runs the loop, pauses when the tab is hidden, and handles `localStorage[tuning.scoring.best_key]` inside try/catch (C4). Exposes `window.__mothlight = { game, renderer, audio, input }` for QA.

### Data: `Game/data/tuning.json` (owned by gd-1; the format is defined in GDD)
- One JSON object with top-level sections `canvas, night, lantern, heat, moth, species, spawn, moon, candle, zapper, flower, placement, scoring, onboarding` (plus `version`).
- Units: px (960×540 logical), seconds, heat in % (0–100), intensity unitless. `[a, b]` pairs are ranges or lists as the GDD states per key. Keys starting with `_` are comments and are dropped on load.
- **Every key is optional at runtime.** `mergeTuning(DEFAULT_TUNING, file)` fills the gaps, so a partial or missing file still runs. A malformed file logs a warning and falls back to defaults.
- Code reads **only** `game.tuning.*` and never hardcodes a gameplay number. To add a knob, gd-1 adds it to tuning.json and posts it in #engineering. The owning programmer reads it with a `??` fallback, and tl-1 folds it into `DEFAULT_TUNING` at review.
- `tests/smoke.mjs` asserts that every key in `tuning.json` exists in `DEFAULT_TUNING` (drift check), so a new knob can't silently lack a default.

### Save / settings
- Only `localStorage[scoring.best_key]` (number) is saved, from main.js inside try/catch, and the game works without it. No other persistence (jam scope).
- `setMuted` exists for a later mute toggle. Not bound in M1 (Pillar 1: no extra buttons).

## Ownership map (for safe parallel work)
Each file has exactly one owner. Anyone may **import and read** any file. Only the owner edits it. Contract changes (a shape, a signature, an event) go through #engineering, and tl-1 updates this doc first.
| File | Owner role | Shared? |
|---|---|---|
| `Game/js/config.js`, `Game/js/rng.js`, `Game/js/events.js` | tech-lead (tl-1) | Contracts: read by all, changes via #engineering |
| `Game/tests/smoke.mjs` | tech-lead (tl-1) | Programmers post requested assertions in #engineering |
| `Game/js/main.js`, `Game/js/state.js`, `Game/js/input.js`, `Game/js/ui.js`, `Game/index.html`, `Game/css/style.css` | gameplay-1 (scaffolded by tl-1) | No |
| `Game/js/moths.js` | gameplay-2 | No |
| `Game/js/world.js`, `Game/js/render.js` | gameplay-3 | No |
| `Game/js/audio.js` | audio (M2) | No |
| `Game/data/tuning.json` | game designer (gd-1) | Read by all via `game.tuning` |
| `.studio/docs/TDD.md` | tech-lead | No |

Parallel-work notes:
- **gameplay-2** builds `moths.js` against the smoke test alone: fabricate a `SimContext` with hand-made `Light` objects. No world or render is needed.
- **gameplay-3** builds `world.js` + `render.js`. Moths are drawn in render.js from the `Moth` shape. Until moths.js lands, the swarm stub is empty. Use the console (`__mothlight.game.swarm.moths.push({...})`) to eyeball moth drawing and don't commit debug spawners.
- **gameplay-1** builds state/input/ui/main. Scoring can be tested by pushing fake `MOTH_DELIVERED` events in a local test.
- **audio** only consumes events plus `game` fields. It can start now against the event table.

## Coding standards
- The Boss global CLAUDE.md applies in principle: readability, consistency, DRY, small single-purpose functions, no magic numbers, comment the *why*, docstrings on public functions, commits `TYPE: Subject` (≤ 50 chars) + `Co-Authored-By`.
- **Web/JS project deltas** (the CLAUDE.md examples are GDScript/Godot-specific):
  - JS idiom for naming: `camelCase` functions and variables, `SCREAMING_SNAKE_CASE` constants and frozen enum objects, lowercase module file names as listed in the Pitch scope. Tuning JSON keys stay `snake_case` as gd-1 authored them.
  - "Type hints" means **JSDoc** on every export (`@param {Type} name`, `@returns {Type}`) plus `@typedef`s for the shared shapes (in the owning module). Each file starts with `// @ts-check`, so editors type-check without a build.
  - Docstrings are `/** ... */` blocks above exports and above each module (module purpose + owner).
  - **No magic numbers.** Gameplay numbers come from `tuning`. Palette hex values and pure-visual constants are named `const`s at the top of render.js/ui.js (from StyleGuide).
  - Named exports only. No default exports and no module-level mutable state in PURE modules (all state lives in the objects passed in). Only `window.__mothlight` is global.
  - Hot loops: no closures, spread or `Array.map/filter` per moth per tick. Reuse scratch vectors.

## Test & build
- **Serve** from `Game/` with one of these:
  - `python -m http.server 8080 --directory Game` → http://localhost:8080/ (default, nothing to install)
  - `npx http-server Game -p 8080 -c-1` (fetches http-server on first use, so it counts as a download and needs Boss approval if it is not cached)
- **Syntax check:** `for f in Game/js/*.js Game/tests/*.mjs; do node --check "$f" || exit 1; done`
- **Headless smoke test:** `node Game/tests/smoke.mjs` exits 0 on pass and 1 on fail. It:
  1. scans the PURE modules for forbidden browser identifiers,
  2. reads `data/tuning.json` (it must parse), checks every key has a `DEFAULT_TUNING` counterpart, and merges,
  3. creates a game with seed 1234 and drives a scripted input bot: hold to start, then sweep the pointer with alternating hold/release pulses, through the full 240 s night + dawn (~15k ticks at 60 Hz),
  4. asserts no throw, `title → night → dawn` reached, positions/brightness/heat/score finite and in range, alive moths ≤ `spawn.max_alive`, and the score counters are non-negative and monotonic,
  5. re-runs with the same seed and asserts an identical final snapshot (determinism),
  6. also runs with `DEFAULT_TUNING` alone (the missing-file path).
  Programmers must keep it green. It is the review gate for every PURE-module ticket.
- **Browser QA** (every ticket touching DOM modules):
  1. Start the server and open `http://localhost:8080/` (agents use the browser pane: `preview_start` with the url).
  2. The console must be **free of errors and warnings**. Expected info line: `[mothlight] tuning: file` (or `default`).
  3. Check: title renders, holding for 0.6 s (mouse, touch or Space) starts the night, the lantern follows the pointer and glows while held, window resize letterboxes without stretching, `?seed=42` gives the same garden on reload, and the mobile preset (375×812) plays with touch.
  4. In the console, `__mothlight.game` is live state (`__mothlight.game.night.elapsed = 238` jumps to dawn).
  5. Opening `index.html` via `file://` shows the "serve over http" notice instead of a blank page.
  6. **Agent gotcha:** when the browser pane is *hidden*, `requestAnimationFrame` never fires, so the loop freezes (`game.tick` stops) even though `document.visibilityState` reports `visible`. Show the pane, or drive the live modules from the console: `const {stepGame}=await import('/js/state.js'); const {sampleInput}=await import('/js/input.js'); stepGame(__mothlight.game, sampleInput(__mothlight.input, 1/60), 1/60)` in a loop, then call `drawFrame`/`drawUi` and take a screenshot.
- **Build:** none. Release = copy `Game/` to `Builds/Web/<version>/` and zip with `index.html` at the root (itch.io HTML5).

## Risks & spikes
| Risk | Mitigation / spike | Decision deadline |
|---|---|---|
| O(n²) separation with 200 moths too slow | gameplay-2 uses a uniform grid (cell = `moth.separation_radius`) if a naive pass costs > 2 ms at 200. Profile in M1 | End of M1 |
| Per-moth `createRadialGradient` glow is too slow (mobile) | render pre-renders glow sprites to offscreen canvases once and uses `drawImage` with `'lighter'` | End of M1 |
| Tuning drift between tuning.json and code defaults | runtime deep-merge + smoke-test drift check. tl-1 syncs `DEFAULT_TUNING` at review | Ongoing |
| WebAudio autoplay block / iOS silent switch | unlock on first gesture. All audio calls are no-ops until then | M2 |
| `file://` double-click → blank page | index.html shows a notice if `main.js` hasn't booted within 1.5 s | Done (scaffold) |
| Google Font offline/blocked | serif fallback, text still readable | Done |
| Fixed-timestep spiral on slow devices | realDt clamp + step cap, drop leftover time | Done (scaffold) |
| Hidden-tab time jump | pause on `visibilitychange` (N1) | Done (scaffold) |
