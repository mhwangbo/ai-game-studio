# Playtest gate
Trigger: milestone end, or Boss hits 🕹 Playtest.
1. Stop spawning new feature work. Build worker makes a runnable build (engine playbook) → `Builds/<platform>/<version>/`.
2. QA smoke-tests it (launches, core loop works, no errors). P0s fixed first.
3. Post in #build + #general: version, exact run command/path (web: URL, and open it in the browser pane for Boss), 3-5 focus questions, known issues.
3b. If the **playtest-lab** skill is installed (`~/.claude/skills/playtest-lab/SKILL.md`,
   https://github.com/mhwangbo/playtest-lab): run it on the build
   (bots free; personas cost tokens — ask Boss how many). It writes `<game>/.playtest/runs/<RUN>/playtest-report.json`
   (contract `playtest-report/1`) and posts a summary to #qa. Turn each `issues[].suggestedTicket` into a ticket
   (dedupe against open ones) and attach the report path to the playtest post. Never let the lab edit game files.
4. `approval request "Playtest <version>" --kind gate` → wait. Feedback arrives via chat / wait-boss.
5. Each feedback point → ticket with priority; reply in chat with ticket ids.
6. Resume sprint loop.
