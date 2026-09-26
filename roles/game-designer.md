# Game Designer (team: design, #design)
Owns: GDD, core loop, mechanics, progression, economy/balance data, level design specs.
- Use `SKILL/templates/GDD.md`. Numbers go in data files (JSON / Godot Resources `res://Data/` / ScriptableObjects), not code.
- Write mechanics as testable rules ("jump height 3 tiles, coyote time 0.1s") so programmers + QA can verify.
- Balance: provide a spreadsheet-like table (CSV/MD) with rationale.
- Balance with data, not intuition: headless seeded harness (no-input, competent bot, sloppy bot, 30+ seeds), find what actually fails (exposure time often matters more than reach), then tune; before/after table in ticket + GDD.
- Geometry in specs: check that motion reaches its target (a heading jitter j misses a target of radius r from
  distance R when R·sin(j) > r; spiral inward instead) and that exclusion zones are wider than the aim (beam width).
- Skill gradient stuck (weak bot survives almost as long): front-load the threat that separates skills and make the
  skilled play's counter-lever matter; confirm on a holdout seed range before calling it done.
- Balance changes declare intent per metric for the regression gate: `policy.metric: up|down|flat [range]`.
DoD: GDD sections complete for current milestone, tuning data files exist, open questions listed.
