# Mothlight — Game Design Document (v1)

Owner: gd-1 (Game Designer) · Ticket: JAM-2 · Sources: `Pitch.md`, `StyleGuide.md`
**All numbers live in `Game/data/tuning.json`** (keys shown as `section.key`). Code must read them from there, never hardcode.
Units: px = logical canvas px (960×540), s = seconds, heat = % (0–100), intensity = unitless.

## 1. Overview
- **Elevator pitch:** You are a lantern in a night garden; hold to glow and gather moths, let go under the moon to set them free — before they singe or fly into a zapper.
- **Genre / platform / session:** one-verb arcade toy / web (Canvas 2D, mouse + touch) / one night = 180 s, ~3–4 min per session incl. end screen.
- **Player fantasy:** a gentle, nervous light-keeper guiding fragile moths home.
- **Pillars (each rules something out):**
  1. *One dial, many consequences* — only move + brightness. No extra buttons, power-ups, inventory.
  2. *Tenderness under pressure* — losses sting quietly. No combat, no destroying hazards, no gore, no gratuitous shake.
  3. *One short readable breath* — 4-min night, no text tutorial beyond two hints. No deep menus, meta grind, unlocks, cutscenes.

## 2. Core loop
- **Moment-to-moment (1–5 s):** glow to pull nearby moths → watch heat rings → ease off before they singe → steer the cloud around rival lights.
- **Session loop (~60 s cycle, repeated ~3× per night):** gather a cluster → carry it past candles/zappers → park within 240 px of the moon → go dark → moths spiral up → chime arpeggio + combo.
- **Meta loop:** best score in localStorage (`scoring.best_key`); procedural garden each night. (Daily seed = M2 stretch.)

## 3. Mechanics (testable rules)

### 3.1 Lantern (player)
| ID | Rule (numbers) | Input | Feedback |
|---|---|---|---|
| L1 | Lantern moves toward pointer, exponential follow (`lantern.follow_lerp_per_s`=12), speed capped at `lantern.max_speed`=420 px/s. Clamped inside canvas. | Mouse move / touch drag | Lantern glow sprite moves |
| L2 | Touch only: target point is finger + (0, `touch_offset_y`=−60) px so the finger doesn't cover the lantern. | Touch | — |
| L3 | Brightness `b` ∈ [0,1]. While held: `b += 0.9/s` (0→1 in 1.11 s). Released: `b −= 2.5/s` (1→0 in 0.4 s). | Hold LMB / touch / Space | Glow radius+alpha scale with b; glow-hum gain & low-pass cutoff follow b |
| L4 | Lantern is **dark** when `b < dark_threshold`=0.05: emits no light, attracts nothing, heats nothing. | Release | Glow fully off, hum silent |
| L5 | Lantern intensity `I_L = b × 1.0`. Lantern range `R(b) = 40 + 220·b` px (b=0.5→150, b=1→260). | — | Faint range ring (M2 optional) |

### 3.2 Moth steering (every frame, per moth)
| ID | Rule | Feedback |
|---|---|---|
| M1 | **Target selection:** among all *active* lights whose range contains the moth (distance d ≤ light.range), pick the max score `S = I × attract_mult / max(d, 20)²`. Lantern counts only if not dark. Ties → nearest. Re-evaluated every frame. | — |
| M2 | Steering = seek(target)·1.0 + separation(radius 14 px)·1.4 + wander·0.3, accel capped 300 px/s², speed capped by species `max_speed`. | Wing flap rate scales with speed |
| M3 | Within `orbit_radius`=36 px of a *lantern or flower* target, add tangential force ·0.8 → moths circle rather than stack. | Cloud swirls |
| M4 | No light in range → hover/drift at 12 % max speed with wander only (they visibly wait near the edge they entered from). After 20 s cumulative unattracted time the moth flies to the nearest edge and despawns (**lost**, no penalty, not counted). | Moth fades at edge |
| M5 | A moth "joins the cloud" the first time it targets the lantern and is within 60 px. | Gather tick SFX (once per moth per carry) |

### 3.3 Heat / singe
| ID | Rule | Feedback |
|---|---|---|
| H1 | Heat gain only while the moth's *current target is the lantern* and `b > 0.6`: `gain = 60 %/s × ((b−0.6)/0.4) × (1 − d/R(b)) × heat_mult`. | — |
| H2 | Cooling is always applied: `heat −= 20 %/s`, floor 0. Net = gain − 20. | — |
| H3 | Heat ≥ 100 % → moth burns out immediately (removed, counted as **singed**). | Ash puff (grey particles drift up 1.5 s), crackle + "fff" SFX |
| H4 | Heat ≥ 40 % shows a warning ring (`#FF5A3C`), alpha = (heat−40)/60. | Heat whine volume follows hottest moth |
| H5 | **Reference checks for QA** (moth at orbit 36 px, from 0 %): b ≤ 0.75 → never burns (net ≤ 0 for dusty). b = 1.0: dusty ≈ 3.2 s, silkwing ≈ 1.6 s, atlas ≈ 17 s. | — |

### 3.4 Species
| Species | Spawn weight | Max speed | Attract mult | Heat mult | Value | Size |
|---|---|---|---|---|---|---|
| dusty | 70 % | 110 | 1.0 | 1.0 | 1 | 7 px |
| silkwing | 20 % | 170 | 1.0 | 1.6 | 3 | 6 px |
| atlas | 10 % | 80 | 0.6 | 0.5 | 5 | 10 px |

Note: moth max speed (≤170) < lantern max speed (420) → moving fast leaves the cloud behind. Intended tension.

### 3.5 Spawning
| ID | Rule |
|---|---|
| S1 | t = 1.0 s: first cluster = 3 dusties spawned 180 px from the lantern start (480, 400) toward the nearest side edge — teaches glow within 10 s. |
| S2 | Then a cluster every 6.0 ± 1.5 s (uniform), size 3–6 (uniform int), species rolled per moth by weight, spawned just off a random edge ∈ {left, right, bottom} within a 30 px spread. |
| S3 | No spawns if alive moths ≥ 80, or t ≥ 169 s. Expected total ≈ 28 clusters ≈ 126 moths/night. |

### 3.6 World lights & hazards
All lights use the same interface: `{pos, intensity, range, active, kill_radius | capture_radius | hover_radius}`.
| ID | Light | Rule | Feedback |
|---|---|---|---|
| W1 | **Moon** (×1) | Intensity 0.6, range 240 px. Placed x ∈ [15 %, 85 %], y ∈ [12 %, 30 %] of canvas. Moth within **40 px** → **delivered** (scored, removed). From t=135 s it sinks linearly 120 px and intensity lerps 0.6→0.45 by t=180. | Steady cool glow, moth spirals up + glassy chime |
| W2 | **Candle** (2 at start, +1 at t=90 s) | Intensity 0.35 ± 0.08 flicker (value noise, 8 Hz), range 90 px. Moth within 14 px → **dies** (candle catch). | Flicker, 80 Hz thump, small ash |
| W3 | **Zapper** (2) | Inactive until t=60 s and t=115 s respectively; 2.0 s warm-up (intensity ramps 0→0.55, cannot kill during warm-up). Range 120 px, kill radius 18 px. | Buzz + arcs; harsh 60 ms zap SFX on kill |
| W4 | **Decoy flower** (4) | Each blooms once at a random t ∈ [15, 150] s for 23 s. Intensity 0.12, range 90 px. Moths orbit it harmlessly (hover radius 12); when it closes they re-target. | Dim pink bloom opening/closing |
| W5 | **Placement** (procedural per night, seeded RNG) | Hazards/flowers at y ∈ [26 %, 80 %], x margin 130 px (keeps hazard reach off the spawn edges); ≥ 220 px from moon, ≥ 120 px from each other, ≥ 160 px from lantern start. **Start candles** (lit at t=0) additionally keep their range + 42 px (cluster spread) off the S1 spawn→lantern-start path (JAM-11) and **≥ range + 110 px (200 px) from the lantern start** so S1 moths orbiting/overshooting the lantern are never stolen (JAM-19); this keep-out is hard (up to 4× attempts, keep-out-satisfying candidates always win). Up to 50 rejection attempts, then accept best. Future-spawn hazards (3rd candle, zappers) are placed at night start, shown unlit. | Unlit zapper cage visible from t=0 (fair warning) |

### 3.7 Scoring
| ID | Rule |
|---|---|
| C1 | Each delivery awards `value × mult`, where `mult = min(1 + 0.1 × (n − 1), 3.0)` and n = the delivery's index in the current group. |
| C2 | A group continues while each delivery happens ≤ 1.5 s after the previous one; otherwise n resets to 1. (Check: a 10-dusty release = 10 + 0.1×45 = 14.5 points.) |
| C3 | HUD "saved" = count of delivered moths (not points). End screen shows saved, score, singed, lost-to-lights, best. |
| C4 | Best score saved to `localStorage["mothlight.best"]` (wrapped in try/catch; game works without it). |

### 3.8 Night & dawn
| ID | Rule |
|---|---|
| N1 | Night = 180 s of play time (pauses when tab hidden). |
| N2 | t = 165–180 s: sky lerps `#0B1026 → #3A2E5C → #F2A07B` (spawns stop at 169 s). |
| N3 | t = 180 s: input ignored, all lights fade over 2 s, remaining moths fly off. Moths still in flight do not score. After 3 s → end screen. |
| N4 | End screen: *"{saved} found the moon."* (Cormorant italic), then score / best; "hold to begin again" — holding 0.6 s restarts with a new garden. |

## 4. Progression & economy
- No currency. Single resource = moths (≈165 arrive per night). Sources: spawns. Sinks: singe (player), candles, zappers, lost-to-wander, dawn.
- Difficulty ramps inside one night only: zappers at 60 s / 115 s, 3rd candle at 90 s, moon sets from 135 s.
- **Target balance (M2 to verify in playtests):** novice saves 30–50 moths, good player 90+, best ≈ 130. Tuning table = `Game/data/tuning.json`.

| Lever | Value | Rationale |
|---|---|---|
| Safe brightness | ≤ 0.75 | Full range needs b=1 — reward for pulsing, punish holding |
| Lantern vs zapper | lantern at b=1, 36 px wins unless the moth is within ≈ 27 px of the zapper | Near a zapper the outer edge of the cloud leaks — dim = lose moths |
| Combo window 1.5 s | A released cloud (36 px orbit) lands within ~1 s | Big releases chain, trickles don't |
| Hazard reach small (candle 90, zapper 120) | Lantern at b≈0.7 reaches ~194 px | Hazards punish carrying the cloud *past* them, not moths far from the player |
| Unattracted moths hover (12 % speed, leave after 20 s) | ~20 s window to collect a new cluster | Ignored moths fly home (neutral) instead of drifting into hazards |
| Gentle opening (2 candles, first zapper at 60 s) | First minute ≈ 6 hazard losses with no input | First night teaches glow + moon before punishing |

### 4.1 Balance pass JAM-14 (headless harness, mean of 60 seeds, per night)
Bots: *none* = no input; *competent* = gather → carry to moon at b≈0.7 avoiding hazard ranges → go dark; *sloppy* = full glow, fast moves, no avoidance, releases ~110 px off the moon.

| Metric | none before → after | competent before → after | sloppy before → after |
|---|---|---|---|
| Delivered | 23.3 → 23.3 | 38.6 → 46.9 | 40.4 → 38.5 |
| Lost to candles+zappers | 98.2 (77 %) → 49.6 (39 %) | 82.0 (64 %) → 48.1 (38 %) | 62.5 (50 %) → 51.0 (40 %) |
| Hazard losses in first 60 s | 25.9 → 6.6 | 18.7 → 7.2 | 14.7 → 8.1 |
| Hazard deaths > 200 px from lantern | 88.6 → 43.8 | 58.8 → 22.9 | 27.3 → 20.9 |
| Singed | 0 → 0 | 0 → 0 | 15.7 → 15.2 |
| Flew home (M4, neutral) | 3.3 → 49.1 | 3.9 → 26.3 | 3.4 → 18.7 |

Singe is unchanged (lantern/heat untouched, H5 still holds). The bots are a floor: the competent bot lands in the novice band (30–50). The 90+ "good player" target still needs a human playtest to confirm.

## 5. Content (M1)
- 1 garden generator; lights: `moon`, `candle`, `zapper`, `flower`; species: `dusty`, `silkwing`, `atlas`; screens: `title`, `play`, `end`.

## 6. UI / UX
- **Flow:** Title ("Mothlight" + "hold to glow") → hold 0.6 s → Play → Dawn → End → hold 0.6 s → Play.
- **HUD:** saved count top-left; night-progress arc top-right (sun creeping up). Nothing else.
- **Hints (only text in play):** "hold to glow" until b first exceeds 0.5; "let go under the moon" when ≥ 3 moths target the lantern within 240 px of the moon and no delivery has happened yet; hides after the first delivery.
- **Controls:** Desktop: mouse moves, LMB or Space holds. Touch: drag to move, any touch = hold (whole screen is target). Tab hidden → pause.

## 7. Art & audio direction
See `StyleGuide.md` (palette, shape language, 8 synthesized SFX). Brightness must be audible (hum low-pass follows b).

## 8. Narrative
None beyond the end-screen line. No cutscenes.

## 9. Scope per milestone
| Milestone | In | Out |
|---|---|---|
| **M1 Playable** | Full loop title → night → dawn → end → restart; all rules L1–L5, M1–M5, H1–H5, S1–S3, W1–W5, C1–C4, N1–N4; tuning loaded from JSON; placeholder visuals (circles/gradients), heat ring, HUD, 2 hints; mouse + basic touch via pointer events; localStorage best | Audio, particles beyond simple ash, wing-flap animation, dawn birds, balance pass, mobile polish |
| **M2 Polish** | Juice (wing flaps, ash drift, additive glow, moon spiral, zapper arcs, candle flicker visuals, combo float text), all 8 WebAudio SFX + pad, balance pass vs §4 targets, mobile touch (offset, fullscreen, DPR, letterbox), daily seed (stretch) | Moon phases across nights, new verbs, levels/unlocks, leaderboards |

## 10. Open questions (for Boss)
1. Should moths that fly off-screen after 20 s unattracted (M4) count against the player on the end screen, or stay silent?
2. Daily seed in M2 — keep as stretch, or cut for jam?
3. Show a faint lantern-range ring (helps readability) or keep the screen purer?
4. ~~Is a 240 s night right, or go shorter (180 s) for jam judges?~~ Resolved: Boss/producer set night length to 180 s (JAM-8).
