# Good ticket checklist (Producer)
- Title: verb + object ("Add double jump to Player")
- One team, one owner, fits in one worker-session
- Desc: context + links to GDD/TDD sections + files it owns
- Acceptance criteria: observable & verifiable, e.g.
  - "Pressing jump twice in air performs second jump (GDD 3.2 numbers)"
  - "Headless boot shows 0 errors"
  - "Screenshot of feature linked"
- Deps: tickets that must be done first
- Priority: P0 broken/blocker · P1 milestone-critical · P2 normal · P3 nice-to-have

CLI:
`ticket new --title "..." --team engineering --type feature --epic E1 --milestone M1 --priority P1 --accept "a|b|c" --deps KEY-3 --desc "..."`
