# Mothlight: Style Guide

## Visual direction
A night garden in gouache-dark blues where **light is the only saturated thing on screen**. Everything that isn't a light source stays low-value and cool. Lights are warm, soft and additive (`globalCompositeOperation = 'lighter'`).

## Palette
| Role | Hex | Notes |
|---|---|---|
| Night sky / background | `#0B1026` | base fill |
| Garden silhouettes (far) | `#141B3A` | hedges, trees |
| Garden silhouettes (near) | `#1E2750` | flower stems, fence |
| Lantern core | `#FFF4D6` | center of the player glow |
| Lantern glow | `#FFB547` | radial gradient to transparent |
| Moth (dusty) | `#D8C8A8` | pale tan wings |
| Moth (silkwing) | `#A8E6E0` | pale cyan |
| Moth (atlas) | `#E89A6B` | rust orange |
| Heat warning | `#FF5A3C` | ring around an overheating moth |
| Moon | `#E6ECFF` | cool white with a `#9FB2FF` halo |
| Candle hazard | `#FF8A2A` | flickering warm orange |
| Zapper hazard | `#7CF7FF` / `#B04BFF` | cold electric cyan with a violet arc |
| Decoy flower | `#FF7AC8` | dim pink bloom |
| Ash | `#6B6A75` | drifting grey particles |
| UI text | `#E6ECFF` at 85% alpha | |
| Dawn gradient | `#0B1026` → `#3A2E5C` → `#F2A07B` | sky lerp at end of night |

Contrast rule: hazards must be told apart from the moon by **hue and motion**: candles flicker and zappers buzz and arc, while the moon is steady. Never tell them apart by hue alone, so the game stays colorblind-friendly.

## Shape language
- **Lights**: perfect circles and soft radial gradients. Round means attractive.
- **Moths**: two teardrop wings (a quadratic curve pair) and a 1-px body, with wings flapping via scaleX oscillation. 6–10 px on screen.
- **Hazards**: candles are a thin rectangle plus a teardrop flame. Zappers are a **square grid cage** with jagged polyline arcs. Hard angles mean danger.
- **Garden**: layered, organic silhouette blobs (noise-offset curves) with no outlines.
- No sprites, strokes only where needed, and everything drawn in code.

## Resolution / density
- Logical canvas 960×540 (16:9), scaled to fit the window with letterboxing, and `devicePixelRatio`-aware for crisp glows.
- The touch target is the whole screen. Hold anywhere to glow and drag to move.

## Typography
- **Google Font: "Cormorant Garamond"** (italic 500) for the title and end-of-night text, which gives it a gentle and slightly storybook feel.
- The fallback and HUD numbers use the system font `ui-rounded, system-ui, sans-serif`.
- The HUD is minimal: moths saved (top-left), a night-progress arc (top-right, a sun creeping up) and nothing else.

## UI tone
Quiet, kind, a little wistful. Keep the words to a minimum: "hold to glow", then "let go under the moon". The end screen reads like a line of poetry followed by the number, e.g. *"37 found the moon."* No exclamation marks and no "GAME OVER".

## Audio mood
Hushed nocturne: a soft sine/triangle pad in a pentatonic minor key, crickets made from filtered noise bursts, and plenty of space. The lantern's brightness drives a low-pass filter on the pad, so **brightness is audible**: brighter means warmer and fuller. Everything is synthesized with WebAudio and there are no samples.

## Key SFX (all WebAudio synthesized)
1. **Glow hum**: a sine at 110 Hz plus a detuned partner, with gain and low-pass cutoff following brightness. It is continuous while held.
2. **Moth gather**: a tiny soft tick (a 4 ms noise burst, high-passed) when a moth joins the cloud, randomly pitched.
3. **Heat warning**: a rising thin sine whine (800→1400 Hz) whose volume follows the hottest moth's heat.
4. **Singe / burn-out**: a short crackle (noise through a bandpass with a fast decay) followed by a soft falling "fff" puff. Keep it sad, not violent.
5. **Moon delivery**: a glassy pentatonic chime (a triangle wave with a short delay echo). Each moth in a group release steps up the scale, so big releases make an arpeggio.
6. **Zapper kill**: a sharp square-wave buzz of 60 ms with a pitch drop. It is the only harsh sound in the game.
7. **Candle catch**: a low muffled pop, a sine thump at 80 Hz.
8. **Dawn**: a slow major-key swell with a filter opening over 3 s, and birdsong chirps made from FM sine blips.
