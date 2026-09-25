# AI Game Studio — a Claude Code skill

Turn Claude Code into a game studio: a **Producer** agent runs a team of role-based subagents —
Creative Director, Game Designer, Tech Lead, Gameplay/UI/Engine Programmers, 2D/3D/Tech Artists,
Audio, Writer, QA, Build — that plan, build, review and playtest a game together.
Engines: **Godot, Unity, Unreal, Web**. Scope: from a one-day jam game up to large, multi-milestone projects.

You are the **Boss**. You watch everything live and can interrupt at any time.

![Mothlight, a game made by the studio](examples/mothlight/qa-evidence/JAM-20_reverify_desktop_t130.png)

## What you get

- **Local dashboard** (`http://127.0.0.1:4747`, zero dependencies)
  - **Chat** — Slack-style channels per team (`#design #engineering #art #audio #qa #build #approvals #blockers`), DMs, `@mentions`. Post as Boss; workers see it on their next check-in.
  - **Board** — Jira-style kanban with epics, milestones, priorities, dependencies and **acceptance criteria**. A ticket cannot close until every criterion is checked.
  - **Team** — who is working right now, on which ticket, their last action.
  - **Usage** — tokens and API-list-price estimate by team / worker / milestone / ticket (read from Claude Code transcripts).
  - **Approvals** — every spend, login, or model download waits for your Approve/Deny.
  - **Docs** — pitch, GDD, TDD, decision log, lessons.
  - Buttons: **Pause · Resume · Stop · Playtest · Directive**.
- **Studio CLI** (`server/studio.js`) — the only way workers touch shared state, so the plan lives in tickets, not in anyone's context window.
- **Process** — pitch → GDD → Boss gate → TDD with a file-ownership map → parallel sprints on disjoint files → QA review with evidence → playtest gate → retro.
- **Self-updating** — workers record lessons when they solve something non-obvious; loops (same error 3×, ticket rejected 3×) are auto-flagged; at each retro the Producer folds lessons into the playbooks and role briefs and bumps the changelog in `SKILL.md`.
- **Asset policy** — free/CC0 sources, Blender (via Blender MCP) and local ComfyUI are allowed; paid AI tools (ElevenLabs, Higgsfield, Rodin/Hunyuan3D, …), logins, and large downloads always go through an approval request. Agents never type credentials.

## Install

Requires [Claude Code](https://docs.claude.com/en/docs/claude-code) and Node.js 18+.

```bash
git clone https://github.com/mhwangbo/ai-game-studio.git ~/.claude/skills/game-studio
```

The folder must be named `game-studio` inside `~/.claude/skills/` (the docs reference `$HOME/.claude/skills/game-studio`).

## Use

In any folder, ask Claude Code something like:

> start the game studio and make a small but unique web game

The Producer initializes `<Game>/.studio/`, starts the dashboard, runs kickoff, and asks you at each gate.
Open **http://127.0.0.1:4747** to watch and steer.

You can also drive the CLI yourself:

```bash
node ~/.claude/skills/game-studio/server/studio.js --project MyGame board
node ~/.claude/skills/game-studio/server/studio.js --project MyGame who
node ~/.claude/skills/game-studio/server/studio.js help
```

## Layout

```
SKILL.md            Producer playbook (boot, kickoff, sprint loop, spawning workers, controls, self-update)
server/             studio.js (CLI + state), studio-server.js (dashboard), usage.js (transcript usage), ui/index.html
roles/              one brief per role: owns, outputs, definition of done
playbooks/          engines (godot/unity/unreal/web), assets (free, blender, comfyui, paid), QA, playtest, scale tiers
templates/          GDD, TDD, ticket, milestone, default studio config
lessons/LESSONS.md  append-only log of blockers and fixes — the studio's memory
examples/mothlight  a game made end-to-end by the studio (see below)
```

Per-game state lives in `<game>/.studio/` (JSON + JSONL): config, tickets, chat channels, workers, approvals, milestones, decisions.

## Example: Mothlight

A small web game built by the studio in one session: you are a lantern in a night garden — glow to lure moths, go dark to let them fly to the brightest light (the moon saves them; candles and zappers don't).
8 agents, 20 tickets, 2 milestones, 2 Boss playtests. Procedural visuals and synthesized audio, no external assets.

```bash
python -m http.server 8080 --directory examples/mothlight/game
```

Then open http://localhost:8080 (ES modules need http, not `file://`). Design docs are in `examples/mothlight/docs/`.

## Playtesting: playtest-lab (optional)

[playtest-lab](https://github.com/mhwangbo/playtest-lab) is a companion project with its own repo. It adds deterministic bot players and AI persona playtesters for web, Unity and Godot builds, plus a `playtest-report/1` report.

When it's installed as the `playtest-lab` skill, the studio's playtest gate (`playbooks/playtest.md`) runs it, turns the report's `suggestedTicket`s into tickets, and the lab mirrors summaries into `#qa`. Without it, the studio works exactly as before.

## Status

- **Tested end to end:** web / jam tier (Mothlight): kickoff, parallel sprints, QA reject → fix loop, Boss gates, pause/directive/chat interrupts, lesson folding.
- **Written but not yet battle-tested:** Godot, Unity and Unreal playbooks, Blender/ComfyUI asset pipelines, larger tiers. Expect the first runs there to generate lessons — that is what the self-update loop is for.
- Usage costs are **estimates** at API list prices (see `server/usage.js`, override with `pricing` in `.studio/config.json`); subscription plans are not billed per token.
- The dashboard binds to `127.0.0.1` only and has no auth — do not expose it to a network.

## License

MIT
