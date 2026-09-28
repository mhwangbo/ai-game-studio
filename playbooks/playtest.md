# Playtest gate
Trigger: milestone end, or Boss hits 🕹 Playtest.
1. Stop spawning new feature work. Build worker makes a runnable build (engine playbook) → `Builds/<platform>/<version>/`.
2. QA smoke-tests it (launches, core loop works, no errors). P0s fixed first.
3. Post in #build + #general: version, exact run command/path (web: URL, and open it in the browser pane for Boss), 3-5 focus questions, known issues.
3b. If the **playtest-lab** skill is installed (`~/.claude/skills/playtest-lab/SKILL.md`,
   https://github.com/mhwangbo/playtest-lab): run it on the build
   (bots free; personas cost tokens — ask Boss how many). It writes `<game>/.playtest/runs/<RUN>/playtest-report.json`
   (contract `playtest-report/1`) and posts a summary to #qa. Turn each `issues[].suggestedTicket` into a ticket
   (dedupe against open ones; bot findings bring a `lab.js replay <trace> --expect fixed` AC) and attach the
   report path to the playtest post. Never let the lab edit game files.
   **Fun numbers** (playtest-lab 0.3+, free, from the same bot run): `$LAB fun` → add a short "Fun" block to the
   playtest post: skill gradient, luck vs skill share, upsets ("careful beats greedy on N% of seeds"), dominant
   strategy, tension shape. Put last gate's numbers beside them (its report's `fun`) and mark each GDD §4b fun target
   met / missed. Boss judges feel; these tell Boss whether the balance claims hold.
   `bot:fun` issues are heuristics, not bugs: ticket them to the game designer, who fixes them or closes them as
   intended (a `decide` entry plus the matching `config.fun` threshold, e.g. flat tension in a cozy game).
   Persona results: judge from sessions.jsonl + notes only, never the persona's reply (cheap models narrate instead of
   logging; the lab now refuses `done` without 3 notes). For "does a new player learn rule X", run 2 personas (or a
   stronger model) with at least a minute per session; a single persona that dies at 20 s is low confidence, so the
   Boss playtest decides. Check the perception gives aiming cues finer than the thing being aimed.
4. `approval request "Playtest <version>" --kind gate` → wait. Feedback arrives via chat / wait-boss.
5. Each feedback point → ticket with priority; reply in chat with ticket ids.
6. Gate approved and the lab has a baseline → re-baseline from this build's bot run (`lab.js baseline set`,
   `decide "Baseline = <version>"`) so the next milestone's regression gate compares against what Boss approved.
7. Resume sprint loop.
