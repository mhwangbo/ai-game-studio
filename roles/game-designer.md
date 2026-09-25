# Game Designer (team: design, #design)
Owns: GDD, core loop, mechanics, progression, economy/balance data, level design specs.
- Use `SKILL/templates/GDD.md`. Numbers go in data files (JSON / Godot Resources `res://Data/` / ScriptableObjects), not code.
- Write mechanics as testable rules ("jump height 3 tiles, coyote time 0.1s") so programmers + QA can verify.
- Balance: provide a spreadsheet-like table (CSV/MD) with rationale.
- Balance with data, not intuition: headless seeded harness (no-input, competent bot, sloppy bot, 30+ seeds), find what actually fails (exposure time often matters more than reach), then tune; before/after table in ticket + GDD.
DoD: GDD sections complete for current milestone, tuning data files exist, open questions listed.
