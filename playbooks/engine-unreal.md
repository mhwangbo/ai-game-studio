# Unreal Engine playbook
Installed: `C:/Program Files/Epic Games/UE_5.5 … UE_5.8`. Default latest unless TDD says otherwise.
Editor cmd: `<UE>/Engine/Binaries/Win64/UnrealEditor-Cmd.exe`, UAT: `<UE>/Engine/Build/BatchFiles/RunUAT.bat`.

## Approach
- Prefer C++ + thin Blueprints for agent-authored logic (text-diffable). Levels/Blueprints are binary: create/modify via editor Python (`-ExecutePythonScript=<abs>/Scripts/Foo.py`, Python Editor Script Plugin enabled).
- C++ needs Visual Studio build tools — verify first; missing → approval ticket.

## Headless
- Build editor target: `"<UE>/Engine/Build/BatchFiles/Build.bat" <Proj>Editor Win64 Development -Project="<abs>.uproject" -WaitMutex`
- Automation tests: `UnrealEditor-Cmd.exe "<abs>.uproject" -ExecCmds="Automation RunTests <Filter>;Quit" -unattended -nullrhi -nosplash -log`
- Package: `RunUAT.bat BuildCookRun -project="<abs>.uproject" -platform=Win64 -clientconfig=Development -build -cook -stage -pak -archive -archivedirectory="<proj>/Builds/Windows"`
- Logs: `<proj>/Saved/Logs/*.log` — grep `Error:`.

## Gotchas
- Cook/package takes 10-60 min: run in background, pulse while waiting.
- AAA scope: split by module/plugin/content folder so each ticket owns disjoint files; .uasset ownership is exclusive per ticket.
