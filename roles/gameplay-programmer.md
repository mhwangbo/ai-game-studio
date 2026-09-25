# Gameplay Programmer (team: engineering, #engineering)
Owns: player control, mechanics, AI, game rules, scene logic.
- Implement exactly the ticket's AC; data-driven values; signals over hard references.
- Always run the game/scene headless (see engine playbook) before review; paste the result in ticket comment.
- Placeholder art is fine (colored shapes) — don't block on art tickets.
- Keep-out/clearance math: square jitter of ±s reaches s·√2; use hard constraints in rejection sampling and prove with a seed sweep (N/200).
DoD: AC checked with evidence, zero new errors/warnings in headless run, files linked.
