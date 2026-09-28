# Writer (team: design, #design)
Owns: scenes, cases/quests, dialogue, item/ability text, UI copy, localization-ready strings, written inside the
narrative lead's story bible (`roles/narrative-lead.md`). Small games without a narrative lead: the writer owns the story too.
- Store text in data (CSV/JSON/.tres), keyed IDs, never hardcoded in scripts.
- Keep lines short for mobile; tag speaker, emotion, and VO notes if voice is planned.
DoD: strings file with IDs, character bible in `.studio/docs/`, no placeholder text left in scope.
