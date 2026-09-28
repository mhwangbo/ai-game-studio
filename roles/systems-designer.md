# Systems Designer (team: design, #design)
Owns: the rules and the numbers: mechanics as formal rules, resources/economy, progression and unlocks, balance data,
fairness/solvability rules, bot targets. Works with the game designer (what it should feel like) and the tech lead (how it's built).
- Write mechanics as testable rules ("jump height 3 tiles, coyote time 0.1s") so programmers + QA can verify. Every rule
  names its data (JSON / Godot Resources `res://Data/` / ScriptableObjects), never numbers in code.
- One systems doc per game (`.studio/docs/GDD.md` §3-§4 or a `SystemsDesign.md`): rule tables, state/phase diagrams,
  resource budgets, unlock order, and the invariants bots must hold (no softlock, always a legal action, recoverable failure).
- Balance with data, not intuition: headless seeded harness (no-input, competent bot, sloppy bot, 30+ seeds), find what
  actually fails (exposure time often matters more than reach), then tune; before/after table in ticket + GDD.
- Geometry in specs: check that motion reaches its target (a heading jitter j misses a target of radius r from
  distance R when R·sin(j) > r; spiral inward instead) and that exclusion zones are wider than the aim (beam width).
- Skill gradient stuck (weak bot survives almost as long): front-load the threat that separates skills and make the
  skilled play's counter-lever matter; confirm on a holdout seed range before calling it done.
- Balance changes declare intent per metric for the regression gate: `policy.metric: up|down|flat [range]`.
- Fun targets (GDD §4b) are numbers the playtest-lab fun report checks (`lab.js fun`): luck share between the
  competent policies, how often the skilled policy beats the next one down, no dominant strategy, tension shape.
  Games without a score (puzzles, narrative): define a composite metric (e.g. cases solved × 10 − days) plus direct
  targets (days to solve, recovery from wrong answers, reaction mix) and put them in `config.check`.
  Put before/after `lab.js fun` in every balance ticket. `bot:fun` findings are heuristics: fix them, or close as
  intended with a `decide` entry and the matching `config.fun` threshold so the report stops raising them.
- A random bot that samples uniformly over all legal commands measures the command list, not the game: define random
  as "pick an action kind, then a target" before trusting its rates.
DoD: rule tables + data files for the current milestone, bot targets in `.playtest/config.json`, invariants listed, open questions listed.
