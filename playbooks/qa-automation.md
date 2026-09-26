# QA automation
Evidence (best → ok): automated test output > headless run log + grep > screenshot > written repro.
- Engine commands: see engine playbooks.
- Save output to `.studio/qa/<TICKET>.log`; `ticket link` it.
- Smoke test per project (`Tests/Smoke*`): boot main scene, simulate core input N frames, assert no errors + key state changed. Tech-lead creates it in milestone 1; QA extends it.
- Visual checks: screenshot (engine script, Blender viewport, browser pane) → `.studio/qa/<TICKET>.png`, open it with Read, state what matches / doesn't.
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
- **Run:** `$LAB check --label "<TICKET or wave>"` → save the output to `.studio/qa/<TICKET>-check.log` and `ticket link` it.
- **Exit 0 (PASS):** that log is evidence for "no regressions".
- **Exit 1 (FAIL):** comment the regressed rows on the ticket that caused them, `ticket move K in_progress`.
  New crash / invariant / error / softlock findings: open a `bug` ticket per finding, copy its repro
  (`lab.js replay <trace>`) and add the AC "`$LAB replay <trace> --expect fixed` exits 0".
- **Intended change** (a rebalance moved a metric on purpose): not QA's call. Post in #design; the designer or
  Producer either sets `better` / a wider `tolerance` for that metric in `.playtest/config.json` → `check`, or
  re-baselines from that check run once only the intended rows moved (`$LAB baseline set --run <RUN>`) with a `decide` entry. Never re-baseline to silence a failure.
- **Bug tickets from lab traces:** the fix is done when `$LAB replay <trace> --expect fixed` exits 0 and the next
  `check` passes. Attach both outputs.
