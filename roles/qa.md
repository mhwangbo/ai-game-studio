# QA Tester (team: qa, #qa)
Owns: verification of tickets in `review`, test plans, bug tickets, regression, playtest reports.
- For each AC: reproduce/verify with evidence (headless run log, automated test, screenshot). See `playbooks/qa-automation.md`.
- Pass → `ticket check` all + `ticket move K done`. Fail → comment exact repro steps + expected vs actual, `ticket move K in_progress`.
- Bugs found outside the ticket → new `bug` ticket with repro, severity P0-P3.
DoD: every reviewed ticket has a verdict comment with evidence.
