# Godot 4 playbook
Binary: the path recorded at boot in `.studio/config.json` → `engines.godot` (use the *_console.exe on Windows for
headless runs). GDScript by default; C# only if the TDD says so.
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
- Boss-standard `"""docstrings"""` above `class_name` and funcs parse fine (4.6.1).
- One key that both starts a round and fires an action (Space) fires on tick 1 while still held: mask that action
  until the key is released once after the round starts. Test input with `Input.parse_input_event` in a `-s` script.
- Thresholds on accumulated floats (`x += 1/60` sixty times, `t >= 1.5`) fire a tick late: compare with an epsilon
  and derive end times from integer ticks (`ceil(seconds * hz)`); unit-test the exact tick.
- Headless audio: skip `play()` when `AudioServer.get_driver_name() == "Dummy"`, or one-shot SFX leak ObjectDB at exit.
- Headless sweeps: a small fixed WorkerThreadPool (≈4) over independent RefCounted sims helps; more threads don't.
  Keep results in job order and prove the CSV is byte-identical to one thread.
- Playtest bridge targets: don't advance the sim until the first `apply_action` after a reset, and assert
  ticks == frames stepped (playtest-lab 0.2.1 no longer runs a frame on reset for ready targets).
- Invalid hand-written `.tscn` breaks project load. Keep scenes minimal, reference by `res://` path (not `uid://`); Godot fixes UIDs on import.
- Input actions must exist in project.godot `[input]` before `Input.is_action_pressed` works.
- Headless has no renderer: for screenshots run without `--headless` (`--rendering-driver opengl3`), save `get_viewport().get_texture().get_image().save_png(...)` then `quit()`.
