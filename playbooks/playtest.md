# Playtest gate
Trigger: milestone end, or Boss hits 🕹 Playtest.
1. Stop spawning new feature work. Build worker makes a runnable build (engine playbook) → `Builds/<platform>/<version>/`.
2. QA smoke-tests it (launches, core loop works, no errors). P0s fixed first.
3. Post in #build + #general: version, exact run command/path (web: URL, and open it in the browser pane for Boss), 3-5 focus questions, known issues.
4. `approval request "Playtest <version>" --kind gate` → wait. Feedback arrives via chat / wait-boss.
5. Each feedback point → ticket with priority; reply in chat with ticket ids.
6. Resume sprint loop.
