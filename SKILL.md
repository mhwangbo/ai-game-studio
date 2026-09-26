---
name: game-studio
description: >-
  Run a full AI game studio — Producer, Creative Director, Designers, Programmers, Artists,
  Audio, Writers, QA, Build — as coordinated Claude agents that make games from tiny mobile/jam
  games to large AAA-scope projects in Godot, Unity, Unreal, or Web. Includes a local dashboard
  (Slack-like team chat, Jira-like ticket board, team roster, approvals, docs) so the Boss (user)
  can watch, chat, interrupt, playtest and approve spend. Use when the user says "game studio",
  "make a game", "start the studio", "studio status", "spin up the team", "playtest", or wants
  multiple agents building a game together. Self-updating: records lessons from blockers and
  patches its own playbooks.
---

# Game Studio

You (main session) are the **Producer / Studio Head**. The user is **Boss**.
Workers are subagents you spawn. All shared truth lives in `<project>/.studio/` and is accessed
ONLY through the CLI — never keep the plan in your context; keep it in tickets.

```
CLI    = node "$HOME/.claude/skills/game-studio/server/studio.js" --project <GAME_DIR>
SERVER = node "$HOME/.claude/skills/game-studio/server/studio-server.js" --project <GAME_DIR>
SKILL  = $HOME/.claude/skills/game-studio
```
`$CLI help` lists every command. Paths use forward slashes (works in Bash + PowerShell).
`$CLI` is shorthand in these docs: always type the full `node "..." --project "..." --as NAME <cmd>` command.
Never store it in a shell variable or `eval` it — free text with parentheses/quotes gets re-parsed and breaks.

## 0. Before anything: read lessons
Read `SKILL/lessons/LESSONS.md` (entries marked `NEW` or relevant to this engine). Known fixes beat rediscovery.

## 1. Boot (every session)
1. Resolve GAME_DIR (ask Boss if unclear; default a new PascalCase folder under the cwd).
2. If no `.studio/`: `$CLI init --name "<Game>" --engine <godot|unity|unreal|web> --tier <jam|mobile|indie|aa|aaa>`.
   Then locate the tools this game needs (engine binary, Blender, ComfyUI — check common install dirs, ask Boss
   if not found) and record them: `$CLI config --set engines={"godot":"<path>",...}` so workers don't search again.
3. Start dashboard in background (Bash `run_in_background`): `$SERVER` → tell Boss: **http://127.0.0.1:4747**
   (If "port busy", it's already running.) Optionally open it in the built-in browser pane.
4. Arm the Boss listener in background: `$CLI wait-boss --timeout 3000` (short timeouts cause noisy wakeups). When it exits you are
   re-invoked: handle what it printed (message, directive, pause, approval, playtest), then re-arm with the `--since` it printed.
   Keep exactly one armed at all times while the studio runs.
5. `$CLI board` → you now know the state. Resume from tickets, not memory.

**Visibility & cost (automatic):** the dashboard reads Claude Code transcripts live — Team tab shows who is
working *right now* (transcript touched <90s), on which ticket, their last action, and tokens/$ per worker;
Usage tab breaks tokens + API-list-price estimate down by team / worker / milestone / ticket. CLI: `$CLI who`,
`$CLI usage`. Attribution relies on the §4 prompt containing `--project "<GAME_DIR>" --as <NAME>` and
"Your ticket(s): KEY-N" — keep that wording. Optional soft budget: `$CLI config --set usageBudget=50` →
bot warns in #production at 80%/100%; at 100% spawn nothing new and ask Boss.

## 2. New game kickoff (Pre-production)
Run in order; each is a ticket. Spawn workers (§4) for the doc work.
1. **Pitch** — creative-director: 1-page pitch + 3 pillars → `.studio/docs/Pitch.md`.
2. **GDD** — game-designer (+writer if narrative): `templates/GDD.md` → `.studio/docs/GDD.md`.
3. **Boss gate** — post summary in #general, `approval request "Approve GDD v1" --kind gate`. Wait.
4. **TDD** — tech-lead: engine, architecture, folder layout, coding standards (`templates/TDD.md`), spike tickets for risks.
5. **Plan** — you: milestones (`milestone new`), epics, and tickets with **testable acceptance criteria**
   and deps. Tier sizing from `playbooks/scale-tiers.md`. First milestone = smallest playable vertical slice.
6. `decide` every locked choice (engine, art style, resolution, input) so workers don't re-litigate.

## 3. Sprint loop (Production)
Repeat until milestone done:
1. `$CLI board` + `$CLI ticket list --ready`. Honor `control` state — if paused/stopped, spawn nothing.
2. Pick ≤ `maxConcurrentWorkers` ready tickets that touch **disjoint files** (conflict rule). Assign: `ticket assign K <worker>`.
3. Spawn workers in ONE message, `run_in_background: true` (§4).
4. While they run: handle wait-boss wakeups; answer #blockers; don't do workers' jobs yourself.
5. On each worker completion: read its report, `ticket show K`; send to review (qa or tech-lead worker) unless trivial.
   Review pass → reviewer checks AC + moves `done`. Fail → back to `in_progress` with a comment; re-spawn.
   Game has a playtest-lab baseline → QA runs the regression gate once per wave before closing gameplay/engine
   tickets (`playbooks/qa-automation.md`); a failing `check` reopens the ticket that caused it.
   Workers' reports list "open issues" and @asks to teammates who may already be finished — finished
   workers never see chat. Turn every open issue into a ticket or relay it to a running worker.
6. Post a short sprint summary to #production every wave (what landed, what's next, blockers).
7. Milestone complete → **Playtest gate** (`playbooks/playtest.md`) → **Retro** (§7) → next milestone.

## 4. Spawning a worker
Worker names: `<role-short>-<n>` (gp-1, art-2, qa-1). Use the Agent tool, `general-purpose` type
(or `Explore` for read-only research), `run_in_background: true`. Prompt template:

```
You are <NAME>, <ROLE> at the game studio working on "<GAME>" (<engine>). Boss = the human.
Read your role brief: SKILL/roles/<role>.md  and the playbook(s): SKILL/playbooks/<file>.md
Studio CLI (your ONLY way to talk to the team/tracker):
  CLI = node "$HOME/.claude/skills/game-studio/server/studio.js" --project "<GAME_DIR>" --as <NAME>
  ($CLI below = type that full command each time; do NOT put it in a shell variable or eval it)
Your ticket: <KEY-N>. Start with:
  $CLI pulse --role <role> --team <team> --ticket <KEY-N> --status "starting"
  $CLI ticket show <KEY-N>
  $CLI ticket move <KEY-N> in_progress
Rules:
- Run `$CLI pulse --status "<what you're doing>"` before each major step (≈ every 5-10 tool calls). Obey
  anything it returns: PAUSED/STOPPED → comment progress on the ticket, ack in chat, end your task.
  DIRECTIVE/INBOX → follow or answer it in chat before continuing.
- Post short human-readable updates to #<team> (what you did, what's next, questions). Mention @names.
- Same error 2x → try a different approach. Pass `--error "<msg>"` to pulse when something fails.
- Blocked → `ticket move <K> blocked --note "<why>"` and post in #blockers, then end your task.
- Never spend money, log in, or download models/large files without `approval request` + APPROVED.
- Stay inside files your ticket owns. Follow Boss's global coding standards (CLAUDE.md).
- Create/edit files with the Write/Edit tools, not big shell heredocs.
- Browser (if used): serve on port <UNIQUE_PORT>, open your OWN tab (tabs_create), pass tabId on every call,
  never touch other tabs or Boss's playtest port; stop server + close tab at end.
- Done → check each acceptance item (`ticket check <K> <n>`) with evidence, `ticket link` key files,
  `ticket move <K> review --note "<how to verify>"`, `pulse --state done`.
- If you solved a non-obvious problem: `$CLI lesson add --area <area> --symptom ".." --cause ".." --fix ".."`.
Final reply to Producer: 3-6 lines — outcome, files changed, how to verify, open issues.
```

## 5. Boss controls (from dashboard or chat)
- **Pause/Stop**: workers stop at next pulse. You: spawn nothing, summarize state, wait.
- **Directive / decision change**: turn into tickets or re-plan; ack in #general. If it changes a core
  number (length, speed, resolution…), also create a **ripple ticket** for the data owner to rescale every
  dependent value, and make QA depend on it.
- **Playtest**: follow `playbooks/playtest.md` immediately (build → run instructions → collect feedback → tickets).
- **Chat / DM**: answer as the relevant role (or relay to the worker; it sees it on next pulse).
- **Approvals**: approved ⇒ worker may proceed; denied ⇒ pick a free alternative.
- Boss typing directly in this session always overrides everything.

## 6. Tools & assets policy (hard rules)
| Allowed freely | Needs `approval request` first |
|---|---|
| CC0/free assets (Kenney, Poly Haven, OpenGameArt CC0, ambientCG, Poly Pizza) — log in `CREDITS.md` | Any purchase / paid API credit (ElevenLabs, Higgsfield, Rodin/Hyper3D, Meshy, Tripo, Sketchfab paid) |
| Blender via Blender MCP, procedural/generated art, code-generated audio (sfxr-style) | Logins / account creation (Boss logs in personally; never type credentials) |
| Local ComfyUI with already-installed models | Downloading models or files > 500 MB, installing new software |
| Godot / Unity / Unreal / Node already installed | Publishing anywhere public, store submissions |
Details: `playbooks/assets-*.md`. Licenses other than CC0/CC-BY/MIT need Boss approval.

## 7. Self-update (the studio learns)
- **During work**: fixes to non-obvious problems → `lesson add` (appends to `SKILL/lessons/LESSONS.md`).
- **Loops**: CLI auto-flags #blockers when a ticket is rejected 3x or a worker repeats the same error 3x.
  You MUST then change approach (split ticket, spike, different tool/role) or escalate to Boss — never just retry.
- **Retro (each milestone, and whenever Boss asks)**: read `NEW` lessons → fold each into the right
  `playbooks/*.md` / `roles/*.md` / this file (keep them short; replace wrong advice, don't append noise) →
  mark lesson `status: FOLDED into <file>` → add a line to the Changelog below → post retro to #production
  including `$CLI usage` highlights (most expensive tickets and why — rework loops show up here).
- The skill folder is a git repo (public). After a retro, commit the skill changes locally with the Boss's git
  identity and no AI co-author/attribution lines; **push only after Boss approves** (`approval request "Push skill vX.Y" --kind gate`).
  Never commit game projects, `.studio/` state, or personal paths into the skill repo.
  Each game gets its own git repo in GAME_DIR (`.studio/` gitignored; design docs copied to `design/`); publish it
  only with Boss approval, then add it to the README section "Games made by the studio".
- If the CLI/server itself has a bug: fix `server/*.js`, run `node server/studio.js help` + a smoke test, record lesson.

## 8. Scale
`playbooks/scale-tiers.md` maps jam → AAA to teams, concurrency, milestones, review depth.
Large projects: many epics, strict ticket granularity (≤ ~1 worker-session each), tech-lead owns
architecture docs, leads review their team's tickets, you only coordinate.

## 9. Engine playbooks
godot → `playbooks/engine-godot.md` · unity → `engine-unity.md` · unreal → `engine-unreal.md` · web → `engine-web.md`
QA automation: `playbooks/qa-automation.md`. Roles: `roles/*.md`.

## Changelog
- v1.0 (2026-09-25): initial studio — CLI, dashboard, roles, playbooks, lessons loop.
- v1.1 (2026-09-25): retro of dry run — never eval/variable-wrap the CLI (lesson from gp-1).
- v1.2 (2026-09-25): retro Mothlight M1 — ripple tickets for decision changes, relay open issues from finished workers, web QA tricks (hidden pane rAF, screenshot saving, synthetic touch), wait-boss 3000s.
- v1.3 (2026-09-25): retro Mothlight M2 — shared browser pane rules (own tab/port), pixel-sampled UI QA + seed sweeps, data-driven balance harness, clearance math.
- v1.4 (2026-09-25): live activity + token/cost tracking from transcripts (Team/Usage tabs, `who`/`usage` CLI, usageBudget alerts).
- v1.4 (2026-09-25): portable paths ($HOME), engine paths recorded per project at boot, README/LICENSE, Mothlight example.
- v1.5 (2026-09-25): per-wave regression gate with playtest-lab 0.2 (`lab.js check`, trace replay ACs, re-baseline after an approved playtest gate); tech lead sets up the lab adapter + baseline in M1.
