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

### 2026-09-25 [tooling] Dashboard unread badges and @Boss highlights came back after refresh
- cause: Read state lived only in browser localStorage (lost across browsers/panes/cleared storage) and mention highlight ignored read state
- fix: Server-side read markers in .studio/boss-read.json via POST /api/read; highlight only mentions newer than the read marker captured when entering the channel
- by: producer (project: Mothlight)
- status: FIXED in server/studio-server.js + server/ui/index.html

### 2026-09-26 [tooling] Dashboard for a new game failed: port 4747 busy (an older game's studio server from another session still running)
- cause: every project defaults to port 4747; old servers keep running across sessions
- fix: Set a free port per project (config --set port=4748) and start the server again; don't kill another session's server
- by: producer (project: GodotJam01)
- status: FOLDED into server/studio-server.js (auto free port) + SKILL.md §1 (fold into playbook at next retro)

### 2026-09-26 [process] Design spec: ships with a random inward heading jitter can miss a small central target (closest approach R*sin(jitter) > target radius), which breaks 'every ship reaches the reef' and radius invariants
- cause: Straight-line heading fixed at spawn instead of re-aiming each tick
- fix: Specify spiral motion: recompute heading each tick as inward radial rotated by a fixed drift, so radius strictly decreases; check R*sin(jitter) vs target radius when writing specs
- by: gd-1 (project: GodotJam01)
- status: FOLDED into roles/game-designer.md (fold into playbook at next retro)

### 2026-09-26 [godot] Unsure whether Boss-standard triple-quoted """docstrings""" are legal at class level in Godot 4 GDScript
- cause: Godot 4 native doc comments are ##; standalone strings at class scope looked risky
- fix: Verified on 4.6.1: """...""" above class_name and above funcs parses with no errors or warnings; use it per Boss standard
- by: tl-1 (project: GodotJam01)
- status: FOLDED into playbooks/engine-godot.md (fold into playbook at next retro)

### 2026-09-26 [godot] Space both starts the night from the title and fires a flare; the held key burned the first flare charge on tick 1
- cause: Title start is an input event, but the sim action polls Input.is_action_pressed every tick, so the same press is seen twice
- fix: GameFlow masks flare in the action until the key is released once after a night starts (_flare_armed); test with InputEventAction via Input.parse_input_event in a -s SceneTree script with --fixed-fps 60
- by: ui-1 (project: GodotJam01)
- status: FOLDED into playbooks/engine-godot.md (fold into playbook at next retro)

### 2026-09-26 [godot] Threshold rules on accumulated floats (guidance += 1/60 sixty times, spawn at tick*dt >= 1.5) fired one tick late on some values
- cause: Summing 1/60 or tick*(1/60) lands a hair under the exact threshold in float64
- fix: Compare with a tiny epsilon (x >= 1.0 - 1e-9) and derive end times from integer ticks (dawn_tick = ceil(dawn_time*hz)); unit-test the exact tick count
- by: gp-1 (project: GodotJam01)
- status: FOLDED into playbooks/engine-godot.md (fold into playbook at next retro)

### 2026-09-26 [godot] Playtest bridge: sim would advance one extra tick on reset, making lab tick count != frames stepped
- cause: PlaytestBridge unpauses the tree for one frame after reset to poll is_ready(); a target stepping in _physics_process advances during that frame
- fix: Target stays unarmed after reset_game and only steps after the first apply_action; self-check invariant compares physics ticks vs _process frames vs sim.get_tick() (NIGHTBEAM PlaytestTarget.gd)
- by: eng-1 (project: GodotJam01)
- status: FOLDED into playbooks/engine-godot.md + playtest-lab 0.2.1 (fold into playbook at next retro)

### 2026-09-26 [design] Skill gradient (survival-time ratio) stuck at ~1.1x; the weak bot still survived ~150 s even as its win rate fell
- cause: Linear ramp from 0 + 5 hull: the weak bot's deaths pile up late, and survival time is capped at dawn, so the time ratio saturates. Tuning lethality alone moves the win rate, not the time
- fix: Front-load the threat that separates skills (offset the ramp, e.g. negative start time) and give the skilled play a counter-lever (shorter hazard lifetime so waiting it out works). Check a holdout seed range before calling it done
- by: gd-1 (project: GodotJam01)
- status: FOLDED into roles/game-designer.md (fold into playbook at next retro)

### 2026-09-26 [qa] lab check reported careful.won 0.60->0.77 and careful.lost DOWN as 'regressed' (0 improved): every improvement shows up as a regression
- cause: .playtest/config.json has no check block, so no metric has a 'better' direction; with the default tolerance, any move in either direction is a regression
- fix: When the lab baseline is set (GJ-6-type ticket), also write check.metrics better-directions (won/score/saved higher; lost lower). Add this to the playbook Regression gate 'Run' step
- by: qa-1 (project: GodotJam01)
- status: FOLDED into playbooks/qa-automation.md + roles/tech-lead.md (fold into playbook at next retro)

### 2026-09-26 [qa] random.saved 1.83->1.53 (about 9 saves over 30 runs) failed the gate; with a relative 10% tolerance, near-zero means on idle/random flag noise
- cause: the default tolerance is relative (0.1 x mean) with abs 0, which is tiny for metrics whose mean is near 0 and gives false-positive 'unintended' rows
- fix: Set check.abs (e.g. 0.5 saves / 5 score) or per-metric tolerance for idle/random in .playtest/config.json at baseline time; the playbook should say to
- by: qa-1 (project: GodotJam01)
- status: FOLDED into playbooks/qa-automation.md (fold into playbook at next retro)

### 2026-09-26 [qa] the intended-change path is hard to apply strictly: the designer's intent was prose on the ticket, and some failing metrics were not mentioned (greedy.hull, careful.flares_used) or moved past the declared range (careful.won)
- cause: no structured format for declaring intended moves, so QA has to guess whether a side effect (hull when lost goes up) counts as intended
- fix: Playbook: the designer declares intent as a metric list 'policy.metric: up|down|flat [range]' covering EVERY metric of the affected policies; QA diffs check.json against it mechanically
- by: qa-1 (project: GodotJam01)
- status: FOLDED into playbooks/qa-automation.md + roles/game-designer.md (fold into playbook at next retro)

### 2026-09-26 [godot] GJ-5 screenshot helper fed fake observations, and a fixed-time real-sim shot showed no Shade (the only Shade spawned that tick on the rim at age 0)
- cause: the view was verified before the sim existed; a real-sim shot at a fixed time depends on spawn luck
- fix: Real-sim visual check: .studio/qa/GJ-8-Play.gd.txt (windowed opengl3 --fixed-fps 60 --disable-vsync, input-driven) shoots at the first frame after --shot_time with 2 settled ships (1 mid-guidance) and a Shade aged 1.5 s or more, then dumps entities for cross-checking
- by: qa-1 (project: GodotJam01)
- status: FOLDED into playbooks/qa-automation.md (fold into playbook at next retro)

### 2026-09-26 [qa] The confirm check after a re-baseline passed trivially (R4 identical to R3, 27 ok): with deterministic bots on the same seeds, it proves nothing about the new config rules
- cause: check reruns the baseline seeds, and the sim is deterministic, so a rerun matches exactly unless the build changed
- fix: Treat the confirm check as a wiring check only. To test config.check rules, use the designer's offline compare (baseline vs an old run, e.g. R1 vs R3 must fail) or a --seed offset / holdout run; the playbook could add a 'lab check --run <old>' dry-compare
- by: qa-1 (project: GodotJam01)
- status: FOLDED into playbooks/qa-automation.md + playtest-lab 0.2.1 (check --seed) (fold into playbook at next retro)

### 2026-09-26 [tooling] lab.js host: second host session in the same run overwrote shots/001.png from the first
- cause: host.js restarts its screenshot counter at 1 on every launch and writes into runs/<RUN>/shots/
- fix: Copy evidence screenshots out (e.g. .studio/qa/) before restarting the host, or run 'lab.js run new' per session; lab fix: continue numbering from existing files
- by: eng-1 (project: GodotJam01)
- status: FOLDED into playtest-lab 0.2.1 (fold into playbook at next retro)

### 2026-09-26 [godot] Headless GDScript bot sweep on WorkerThreadPool got no faster with 16 threads (22 s, same as 1 thread)
- cause: Engine-side contention when many threads run GDScript at once; 4 threads gave 2.4x, 6-8 got slower again
- fix: Use a small fixed pool (4) for independent RefCounted sims, keep results in job order behind a Mutex, and prove the CSV is byte-identical to --threads=1
- by: gp-1 (project: GodotJam01)
- status: FOLDED into playbooks/engine-godot.md (fold into playbook at next retro)

### 2026-09-26 [godot] Headless Main.tscn run printed 'ObjectDB instances leaked at exit' (AudioStreamWAV/AudioStreamPlaybackWAV) after adding one-shot SFX
- cause: The Dummy audio driver used by --headless never releases playbacks that were started; stop() in _exit_tree does not help
- fix: Skip play() when AudioServer.get_driver_name() == 'Dummy' (no audio in headless anyway); windowed builds unaffected
- by: ui-1 (project: GodotJam01)
- status: FOLDED into playbooks/engine-godot.md (fold into playbook at next retro)

### 2026-09-26 [tooling] Files edited via a Python script on Windows silently switched from LF to CRLF (TDD diff showed 579 changed lines instead of 61; .gd files became CRLF)
- cause: Python text-mode write() translates \n to os.linesep (\r\n) on Windows
- fix: Use open(p, 'w', encoding='utf-8', newline='') in edit scripts (or the Edit tool); check with 'file <path>' and normalize with sed -i 's/\r$//'
- by: eng-1 (project: GodotJam01)
- status: FOLDED into SKILL.md §4 worker rules (fold into playbook at next retro)

### 2026-09-26 [qa] haiku first-timer persona (R11) recorded 0 of the 6-12 required notes and 2 of 4-6 screenshots, and its chat reply claimed a rule model the files contradict
- cause: the persona prompt asks for notes but nothing enforces them; only play done validates (unsure + scores), so a cheap model narrates in chat instead
- fix: Ask playtest-lab to have play done refuse (or flag) a verdict with fewer than N notes / shots, and add to the persona prompt 'a note only counts if play note printed noted'; QA always judges from sessions.jsonl since_last_look + notes.jsonl, never the reply
- by: qa-1 (project: GodotJam01)
- status: FOLDED into playbooks/playtest.md + playtest-lab 0.2.1 (done needs notes) (fold into playbook at next retro)

### 2026-09-26 [qa] a 'did the persona learn rule X' check came out inconclusive: the persona died at about 23 s both nights, so it met the rule once
- cause: the first-timer played at idle-bot level with 120-240-frame full-turn chunks; one haiku session is n=1
- fix: For rule-learning checks, run 2 personas or one stronger-model persona, and require at least 1 full minute per night before judging; otherwise mark the verdict low-confidence and hand it to a Boss playtest
- by: qa-1 (project: GodotJam01)
- status: FOLDED into playbooks/playtest.md (fold into playbook at next retro)

### 2026-09-26 [process] Producer re-armed wait-boss 5+ times while every ticket waited on a Boss playtest; each timeout woke the session with nothing to do
- cause: SKILL.md says keep one listener armed at all times, even when the whole studio is blocked on Boss
- fix: When no worker is running and the next step is Boss's, stop re-arming and tell Boss to reply in chat (or re-arm once with the longest timeout)
- by: producer (project: GodotJam01)
- status: FOLDED into SKILL.md §1 (fold into playbook at next retro)

### 2026-09-26 [tooling] Usage tab billed eng-1's GJ-10/GJ-14/GJ-19 and gp-1's GJ-12/GJ-15 to their first tickets (GJ-6, GJ-4); M2/M3 look almost free
- cause: Producer resumed finished workers with SendMessage for new tickets; usage attribution reads the ticket from the spawn prompt only
- fix: Spawn a fresh worker per ticket when cost per ticket matters, or teach server/usage.js to re-attribute on later 'ticket GJ-N' lines in the transcript
- by: producer (project: GodotJam01)
- status: NEW (fold into playbook at next retro)
