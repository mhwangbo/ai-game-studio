# QA automation
Evidence (best → ok): automated test output > headless run log + grep > screenshot > written repro.
- Engine commands: see engine playbooks.
- Save output to `.studio/qa/<TICKET>.log`; `ticket link` it.
- Smoke test per project (`Tests/Smoke*`): boot main scene, simulate core input N frames, assert no errors + key state changed. Tech-lead creates it in milestone 1; QA extends it.
- Visual checks: screenshot (engine script, Blender viewport, browser pane) → `.studio/qa/<TICKET>.png`, open it with Read, state what matches / doesn't.
  Shoot the REAL sim, not fake observations, and wait for a frame that shows what the AC is about (e.g. a settled ship
  and a Shade older than 1.5 s) instead of a fixed time; dump the entity list next to the PNG to cross-check.
- UI overlays / contrast ACs: don't pass at a glance or with a forced state only. Crop the region and pixel-sample it (props vs bare panel), on 2+ seeds and the mobile preset — translucent panels (alpha < 1) leak background.
- Seed sweeps: for "sometimes" bugs, run 200 seeds headless and report N/200 before and after the fix.
- Before each playtest build: run full suite; any failure = P0 bug.

## Regression gate (playtest-lab)
Applies when the playtest-lab skill is installed (`~/.claude/skills/playtest-lab/lab/lab.js`) and the game has
`<GAME_DIR>/.playtest/baseline.json`. Free: bots only, no tokens. `LAB` = `node "$HOME/.claude/skills/playtest-lab/lab/lab.js" --game "<GAME_DIR>"`
(type it in full every time).
- **When:** once per sprint wave, on the integrated build, before any gameplay/engine ticket of that wave moves
  `review → done`. Web/in-process adapters take seconds, so also run it per ticket. Engine games need a fresh
  build first (engine playbook). Only one worker runs `check` at a time: each call starts a new lab run.
- **Rules first:** when the first baseline is set, write `.playtest/config.json` → `check` too: `better` for metrics with a
  clear direction (won/saved/score higher, lost lower), an `abs` floor for near-zero counts (idle/random), and the design
  targets as `min`/`max`. Without it every improvement and every bit of noise fails the gate.
- **Run:** `$LAB check --label "<TICKET or wave>"` → save the output to `.studio/qa/<TICKET>-check.log` and `ticket link` it.
- **Exit 0 (PASS):** that log is evidence for "no regressions".
- **Exit 1 (FAIL):** comment the regressed rows on the ticket that caused them, `ticket move K in_progress`.
  New crash / invariant / error / softlock findings: open a `bug` ticket per finding, copy its repro
  (`lab.js replay <trace>`) and add the AC "`$LAB replay <trace> --expect fixed` exits 0".
- **Intent is a list:** a ticket that changes balance declares `policy.metric: up|down|flat [range]` for EVERY metric of the
  policies it touches. QA diffs check.json against that list mechanically; an undeclared move is a regression.
- **Intended change** (a rebalance moved a metric on purpose): not QA's call. Post in #design; the designer or
  Producer either sets `better` / a wider `tolerance` for that metric in `.playtest/config.json` → `check`, or
  re-baselines from that check run once only the intended rows moved (`$LAB baseline set --run <RUN>`) with a `decide` entry. Never re-baseline to silence a failure.
- **After a re-baseline**, the same-seed confirm check only proves wiring. Also run `$LAB check --seed 101` (holdout seeds)
  and, on a clean build, `$LAB determinism` for the "same seed replays identically" AC.
- **Bug tickets from lab traces:** the fix is done when `$LAB replay <trace> --expect fixed` exits 0 and the next
  `check` passes. Attach both outputs.
