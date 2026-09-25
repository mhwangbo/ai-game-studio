# Mothlight: Pitch

## Hook
You are a lantern in a night garden. **Hold** to glow brighter: moths flock to you. Glow too bright and they singe. **Let go** and they fly off to whatever light is brightest. You want that to be the moon, not the bug zapper.

## Fantasy
You are a gentle, nervous light-keeper guiding a cloud of fragile moths home through one short night. Your brightness pulls them in, and too much of it hurts them.

## Core verb (the novel part)
**Brightness is the only verb.** The mouse or touch moves the lantern and holding the button raises its glow. That one value controls three things:
1. **Attraction**: pull strength and range grow with brightness.
2. **Heat**: moths close to a bright lantern build up heat. Past 100% they burn out in a puff of ash.
3. **Release**: when you go dark, each moth heads for the brightest light it can see. That could be the moon (score), a candle (it dies) or a zapper (it dies). You compete with those lights, and delivering moths means giving up control of them.

### Reference games and how Mothlight differs
- **Flock! / sheepdog-herding games**: there the herder *pushes* the flock by repelling it. In Mothlight you only *attract*, and the attraction does damage, so there is no safe amount of pull.
- **Lemmings**: there you shape the terrain for autonomous walkers. In Mothlight you shape the *light field* the moths read. The hazards are rival light sources, not pits.
- (Also unlike Snake, Agar.io and other "swarm follows you" games: the swarm leaves you on purpose when you turn yourself off.)

## 1-minute core loop
1. Moths drift in from the garden edges in small clusters (0–10 s).
2. Glow softly to gather a cluster. Watch the heat rings on each moth and pulse your glow in and out so they don't singe (10–30 s).
3. Carry the cloud past the flickering candles and zappers. Dim near a hazard and you lose moths to it. Glow too hard and you burn them (30–50 s).
4. Park under the moon and go fully dark. Every moth that sees the moon as the brightest light spirals up and scores, with a chime per moth and a combo for group releases (50–60 s).
5. Repeat until dawn. A night lasts about 4 minutes and the rising sun ends the run.

## 3 Pillars (each one rules something out)
1. **One dial, many consequences.** The player only moves and changes brightness. *Rules out:* extra buttons, power-ups that add verbs, weapons and inventory.
2. **Tenderness under pressure.** Moths are fragile and losing one should sting a little. *Rules out:* combat, killing hazards, gore, and screen-shake for its own sake. Ash floats away quietly.
3. **The night is one short, readable breath.** Sessions are 3–5 minutes with no text tutorial. The first moth teaches the rule within 10 s. *Rules out:* menus deeper than one screen, meta-progression grind, story cutscenes and levels you have to unlock.

## Replayability
- The garden is procedural each night: moon position, candle and zapper placement, and when flowers bloom (flowers are dim decoy lights).
- Moth species: **dusties** (common and slow), **silkwings** (fast and heat-fragile, worth 3), and **atlas** (big and heat-tolerant, weakly attracted, worth 5).
- Score = moths delivered × group-release combo. The best score is saved in localStorage. An optional daily seed.
- Rising pressure: zappers switch on as the night goes on, and the moon sets toward the horizon before dawn.

## Target player
Browser jam players and casual players who want a calm but tense 4-minute toy. It works with mouse or touch, and one hand is enough.

## Scope (jam tier)
- `index.html`, `main.js` (loop/state), `moths.js` (boids + heat), `world.js` (lights, hazards, procedural garden), `audio.js` (WebAudio synth).
- Canvas 2D, all visuals procedural (radial gradients, additive glow, simple wing-flap shapes). **No external assets.** All audio is synthesized with WebAudio.
- Moth AI is a steering blend: seek the brightest visible light weighted by intensity/distance², plus separation, plus a small wander. Perf target: 200 moths at 60 fps.

## Open questions
- Should the moon wax and wane across nights, changing how bright it is (and so the difficulty)? This is a post-jam stretch goal.
