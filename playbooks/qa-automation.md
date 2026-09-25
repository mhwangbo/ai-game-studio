# QA automation
Evidence (best → ok): automated test output > headless run log + grep > screenshot > written repro.
- Engine commands: see engine playbooks.
- Save output to `.studio/qa/<TICKET>.log`; `ticket link` it.
- Smoke test per project (`Tests/Smoke*`): boot main scene, simulate core input N frames, assert no errors + key state changed. Tech-lead creates it in milestone 1; QA extends it.
- Visual checks: screenshot (engine script, Blender viewport, browser pane) → `.studio/qa/<TICKET>.png`, open it with Read, state what matches / doesn't.
- UI overlays / contrast ACs: don't pass at a glance or with a forced state only. Crop the region and pixel-sample it (props vs bare panel), on 2+ seeds and the mobile preset — translucent panels (alpha < 1) leak background.
- Seed sweeps: for "sometimes" bugs, run 200 seeds headless and report N/200 before and after the fix.
- Before each playtest build: run full suite; any failure = P0 bug.
