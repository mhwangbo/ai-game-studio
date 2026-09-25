# Godot 4 playbook
Binary: `C:/Program Files/Godot/Godot_console.exe` (4.6.x mono — GDScript default; C# only if TDD says so).
Boss standards (global CLAUDE.md) apply: PascalCase files/folders/nodes, snake_case vars/funcs, typed GDScript, `@export`, signals over hard refs, Resources in `res://Data/<Type>/`, docstrings on public funcs.

## Layout
```
project.godot  Scenes/  Scripts/  Data/  Assets/{Art,Audio,Fonts}/  Tests/  Builds/ (gitignored)
```

## Headless commands (run before every review)
- Import/refresh assets: `"$GODOT" --headless --path <proj> --import` (first run after adding assets; if flag unknown: `--editor --quit`).
- Boot check: `"$GODOT" --headless --path <proj> --quit` → no `SCRIPT ERROR` / `ERROR` / `Parse Error`.
- Run a scene N frames: `"$GODOT" --headless --path <proj> res://Scenes/Main.tscn --quit-after 300`.
- Tests: `"$GODOT" --headless --path <proj> -s res://Tests/TestRunner.gd` (SceneTree script: runs asserts, `quit(exit_code)`), or GUT if installed.
- Export: `"$GODOT" --headless --path <proj> --export-release "Windows Desktop" Builds/Windows/Game.exe` (needs export_presets.cfg + export templates; templates missing → `approval request --kind download`).
- Grep output for `ERROR|SCRIPT ERROR|Parse Error` — any hit = failure.

## Gotchas
- Invalid hand-written `.tscn` breaks project load. Keep scenes minimal, reference by `res://` path (not `uid://`); Godot fixes UIDs on import.
- Input actions must exist in project.godot `[input]` before `Input.is_action_pressed` works.
- Headless has no renderer: for screenshots run without `--headless` (`--rendering-driver opengl3`), save `get_viewport().get_texture().get_image().save_png(...)` then `quit()`.
