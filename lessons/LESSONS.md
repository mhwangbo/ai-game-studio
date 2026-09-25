# Studio Lessons (append-only; the studio's memory of blockers & fixes)

Read before each session. Producer folds `NEW` entries into playbooks/roles/SKILL.md at retro and marks them `FOLDED into <file>`.
Format (written by `studio.js lesson add`): date, [area], symptom, cause, fix, by, status.

### 2026-09-25 [tooling] Multi-file bash heredocs with backticks/tables failed to write files
- cause: the shell wrapper choked on one large heredoc script (unexpected EOF), nothing got written
- fix: write docs with the Write tool one file at a time; keep shell heredocs small
- by: producer (skill build)
- status: FOLDED into SKILL.md §4 guidance (use Write/Edit tools for files)

### 2026-09-25 [web] Inline onclick="close()" called document.close() instead of the page function
- cause: inline handlers resolve names against `document` first
- fix: never name global UI functions close/open/write; used closeModal()
- by: producer (skill build)
- status: FOLDED into server/ui/index.html

### 2026-09-25 [process] bash eval of the CLI command failed with a syntax error when a --note or free-text arg contained parentheses
- cause: wrapping the CLI call in a shell variable and invoking via eval re-parses the argument text as shell syntax, so parens/special punctuation in note/message strings break it
- fix: call the CLI binary directly instead of eval $CLI ...; reserve eval-wrapping for args with no special shell characters
- by: gp-1 (project: Demo Clicker)
- status: FOLDED into SKILL.md (CLI note + §4 worker prompt)

### 2026-09-25 [web] Game loop frozen during agent browser QA (game.tick stops advancing, input appears to do nothing) although document.visibilityState is 'visible'
- cause: requestAnimationFrame does not fire while the Claude browser pane is hidden
- fix: Show the pane, or drive the live ES modules from the console: import state.js/input.js, call stepGame(game, sampleInput(input, 1/60), 1/60) in a loop, then drawFrame/drawUi and screenshot. Keep sim logic DOM-free so node smoke tests cover the rest.
- by: tl-1 (project: Mothlight)
- status: FOLDED into playbooks/engine-web.md

### 2026-09-25 [process] Boss changed night length 240s->180s but only the single value got a ticket; dependent schedule timings stayed sized for 240s
- cause: Producer turned a decision into one edit instead of tracing everything derived from it
- fix: When a decision changes a core number, create one ripple ticket for the owner of the data (designer) to rescale every dependent value, and make QA depend on it
- by: producer (project: Mothlight)
- status: FOLDED into SKILL.md §5

### 2026-09-25 [qa] Browser pane screenshots can't be saved to .studio/qa as files; synthetic touch PointerEvents throw in setPointerCapture
- cause: computer screenshot returns image only; setPointerCapture needs an active pointerId (only id 1 = mouse is active for synthetic events)
- fix: Run a tiny node POST receiver (localhost:8091) and fetch(canvas.toDataURL()) to it with mode:'no-cors' to write PNGs; for synthetic touch use pointerId:1 with pointerType:'touch'. Also: resize_window made the hidden pane render and rAF resumed, so real-loop checks became possible
- by: qa-1 (project: Mothlight)
- status: FOLDED into playbooks/engine-web.md

### 2026-09-25 [web] Built-in browser pane hidden/backgrounded: rAF never fires, game.time frozen, so audio verification sees no events
- cause: Pane hidden => requestAnimationFrame throttled to 0 even though document.visibilityState=visible
- fix: Drive the sim from javascript_tool: import state.js/audio.js, setInterval loop calling stepGame+playEvents+updateAudio on window.__mothlight.game. Also pass tabId explicitly: the shared pane may front another agent's tab.
- by: au-1 (project: Mothlight)
- status: FOLDED into playbooks/engine-web.md

### 2026-09-25 [web] Spawn keep-out margin of range+spread still let 2/200 seeds put a moth inside a hazard range
- cause: spawnCluster jitters +/-spread on each axis (square), so offsets reach spread*sqrt2, not spread
- fix: Use range + spread*Math.SQRT2 as clearance and make the keep-out a hard tier in rejection sampling (compliant candidates always win; bounded extra attempts)
- by: gp-3 (project: Mothlight)
- status: FOLDED into roles/gameplay-programmer.md

### 2026-09-25 [web] Browser pane: after resize_window preset desktop, innerWidth stays 375 and 'desktop' captures come out portrait; also location.reload() in javascript_tool sometimes lands the tab on another localhost port (e.g. the POST receiver)
- cause: Pane's own responsive width can itself be narrow; tab URL/port mapping is flaky across reload
- fix: Check innerWidth before labelling screenshots; navigate explicitly to http://127.0.0.1:<port>/index.html instead of location.reload(); drive the whole scene + save in ONE synchronous javascript_exec so the live rAF loop can't advance state between calls
- by: gp-3 (project: Mothlight)
- status: FOLDED into playbooks/engine-web.md + SKILL.md §4

### 2026-09-25 [process] Balance pass: cutting hazard range (candle 150 to 110, zapper 200 to 150) barely lowered passive hazard deaths (77% to 69%)
- cause: Unattracted moths drifted at 40% speed for 30 s and crossed the whole canvas, so they eventually hit some hazard whatever its range. The sink was drift time, not reach.
- fix: Measure with a headless seeded harness (no-input, competent and sloppy bots, 30+ seeds) before tuning. Find what kills moths (time since last lantern pull, distance from lantern) and tune exposure time (drift speed and leave timer) together with reach. Also check placement fit whenever you narrow the spawn bands.
- by: gd-1 (project: Mothlight)
- status: FOLDED into roles/game-designer.md

### 2026-09-25 [web] End-screen/UI-overlay AC checks pass at a glance, and dev verifies them with a forced state
- cause: A translucent scrim (alpha<1) still shows dark props through it. It only shows up in a crop or pixel sample, and only for gardens where props sit behind the text
- fix: QA: save a canvas shot via the POST receiver, crop the text block with PIL, and pixel-sample props vs bare scrim; test 2+ seeds and the mobile preset
- by: qa-1 (project: Mothlight)
- status: FOLDED into playbooks/qa-automation.md
