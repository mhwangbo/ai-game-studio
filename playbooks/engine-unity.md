# Unity playbook
Hub: `C:/Program Files/Unity Hub/Unity Hub.exe`. Editors: `C:/Program Files/Unity/Hub/Editor/<version>/Editor/Unity.exe` (list folder; use the LTS recorded in TDD).
Create project: `"$UNITY" -batchmode -quit -createProject <path> -logFile -`, packages via `Packages/manifest.json`.

## Headless
- Compile check: `"$UNITY" -batchmode -nographics -quit -projectPath <proj> -logFile -` → fail on `error CS`.
- Editor method: `-executeMethod Studio.Build.Windows` (static build/verify methods in `Assets/Editor/`).
- Tests: `"$UNITY" -batchmode -nographics -projectPath <proj> -runTests -testPlatform EditMode -testResults Builds/tests.xml -logFile -` (no `-quit` with -runTests).
- Build: `BuildPipeline.BuildPlayer` inside executeMethod → `Builds/<platform>/`.

## Gotchas
- One Unity instance per project: if Boss has the editor open, batchmode fails. Ask Boss to close it or use editor-side scripts.
- Scene/prefab YAML is fragile to hand-edit; generate via editor scripts.
- License activation = Boss logs in via Hub (never enter credentials).
- PascalCase folders; script file = class name; ScriptableObjects for data.
