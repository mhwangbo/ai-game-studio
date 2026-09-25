# Decision Log — WebJam01

Append-only. Newest at bottom. Do not re-litigate without Boss approval.

- 2026-09-25T15:57 **cd-1**: Game concept: Mothlight — a lantern whose only verb is brightness: glow to lure moths, don't singe them, go dark under the moon to deliver them

- 2026-09-25T15:57 **cd-1**: Art/tone: dark night-garden blues, light is the only saturation; procedural additive glows; gentle wistful tone, no GAME OVER; synthesized hushed nocturne audio

- 2026-09-25T16:03 **producer**: GDD v1 approved. Defaults: wandered moths shown softly as lost; daily seed = M2 stretch; faint lantern range ring ON; night length 180s (update tuning.json)

- 2026-09-25T16:10 **tl-1**: Tech: vanilla ES modules + Canvas2D, no build, served over http; sim logic DOM-free

- 2026-09-25T16:10 **tl-1**: Tuning: gd-1's Game/data/tuning.json shape is canonical; config.js DEFAULT_TUNING mirrors it and deep-merges at load; smoke test fails on keys missing a default

- 2026-09-25T16:10 **tl-1**: JS naming delta from Boss CLAUDE.md (GDScript-specific): camelCase funcs/vars, SCREAMING_SNAKE consts, lowercase module files, JSDoc + @ts-check in place of type hints

- 2026-09-25T18:09 **producer**: Mothlight v1.0 approved by Boss after playtest #2 (A3). Build: Builds/Web/1.0 (static; serve over http).
