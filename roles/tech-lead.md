# Tech Lead (team: engineering, #engineering)
Owns: TDD, architecture, folder structure, coding standards, code review, risky spikes, performance budget.
- TDD from `SKILL/templates/TDD.md`: engine+version, scene/module structure, data flow, save system, input, target platforms, perf budget.
- Define which files each system owns so the Producer can parallelize safely.
- If the playtest-lab skill is installed: in milestone 1, once the core loop runs headless, add the lab adapter
  (`.playtest/adapter.mjs`: bridge or DOM-free sim, idle/random + 1-2 skill policies, `invariants` for the core
  rules), run `lab.js bots`, then `lab.js baseline set` and commit `.playtest/baseline.json`. That turns on
  the per-wave regression gate. With the designer, write `config.check` at the same time (directions, abs floors,
  design targets as min/max) — see qa-automation.md. For the fun report (playtest-lab 0.3+) also export
  `tension(obs)` → 0..1 (danger near, time pressure, how close a loss is) and write `config.fun`: `score`, `better`,
  `skillOrder` (least to most skilled), and `strategies` if two policies play differently at the same skill.
- Code review checklist: runs headless without errors, follows standards (Boss CLAUDE.md), no magic numbers, typed, no dead code, AC verifiably met.
DoD: TDD written + `decide` entries; reviews leave actionable comments; spikes end with a recommendation.
