[English](README.md) | **한국어** | [日本語](README.ja.md) | [简体中文](README.zh-CN.md) | [Español](README.es.md)

# AI Game Studio — Claude Code 스킬

*이 문서는 번역본입니다. 영어 README와 내용이 다를 경우 영어 버전이 우선합니다.*

Claude Code를 게임 스튜디오로 바꿔 줍니다. **Producer** 에이전트가 역할별 서브에이전트로 이루어진 팀을 이끌고,
Creative Director, Game Designer, Tech Lead, Gameplay/UI/Engine Programmer, 2D/3D/Tech Artist,
Audio, Writer, QA, Build가 함께 게임을 기획하고, 만들고, 리뷰하고, 플레이테스트합니다.
엔진: **Godot, Unity, Unreal, Web**. 규모: 하루짜리 잼 게임부터 여러 마일스톤에 걸친 대형 프로젝트까지.

여러분은 **Boss**입니다. 모든 것을 실시간으로 지켜보고 언제든 개입할 수 있습니다.

![Mothlight, 스튜디오가 만든 게임](examples/mothlight/qa-evidence/JAM-20_reverify_desktop_t130.png)

## 제공 기능

- **로컬 대시보드** (`http://127.0.0.1:4747`, 의존성 없음)
  - **Chat** — 팀별 Slack 스타일 채널(`#design #engineering #art #audio #qa #build #approvals #blockers`), DM, `@mentions`. Boss로 글을 올리면 워커들이 다음 체크인 때 확인합니다.
  - **Board** — 에픽, 마일스톤, 우선순위, 의존성, **인수 조건**(acceptance criteria)을 갖춘 Jira 스타일 칸반. 모든 조건이 체크되기 전에는 티켓을 닫을 수 없습니다.
  - **Team** — 지금 누가 어떤 티켓을 작업 중인지, 마지막 행동은 무엇인지.
  - **Usage** — 팀 / 워커 / 마일스톤 / 티켓별 토큰 사용량과 API 정가 기준 추정 비용(Claude Code 트랜스크립트에서 읽어 옴).
  - **Approvals** — 모든 지출, 로그인, 모델 다운로드는 여러분의 Approve/Deny를 기다립니다.
  - **Docs** — 피치, GDD, TDD, 의사결정 로그, 교훈.
  - 버튼: **Pause · Resume · Stop · Playtest · Directive**.
- **Studio CLI** (`server/studio.js`) — 워커가 공유 상태에 접근하는 유일한 통로입니다. 그래서 계획은 누군가의 컨텍스트 윈도우가 아니라 티켓 안에 존재합니다.
- **프로세스** — 피치 → GDD → Boss 게이트 → 파일 소유권 맵을 포함한 TDD → 서로 겹치지 않는 파일에 대한 병렬 스프린트 → 증거 기반 QA 리뷰 → 플레이테스트 게이트 → 회고.
- **자가 업데이트** — 워커는 쉽지 않은 문제를 해결하면 교훈을 기록합니다. 반복 루프(같은 에러 3회, 티켓 반려 3회)는 자동으로 표시되며, 매 회고마다 Producer가 교훈을 플레이북과 역할 브리프에 반영하고 `SKILL.md`의 변경 로그를 갱신합니다.
- **에셋 정책** — 무료/CC0 소스, Blender(Blender MCP 경유), 로컬 ComfyUI는 허용됩니다. 유료 AI 도구(ElevenLabs, Higgsfield, Rodin/Hunyuan3D, …), 로그인, 대용량 다운로드는 항상 승인 요청을 거칩니다. 에이전트는 절대 자격 증명을 입력하지 않습니다.

## 설치

[Claude Code](https://docs.claude.com/en/docs/claude-code)와 Node.js 18+가 필요합니다.

```bash
git clone https://github.com/mhwangbo/ai-game-studio.git ~/.claude/skills/game-studio
```

폴더는 `~/.claude/skills/` 안에 `game-studio`라는 이름으로 있어야 합니다(문서들이 `$HOME/.claude/skills/game-studio`를 참조합니다).

## 사용법

아무 폴더에서나 Claude Code에게 이런 식으로 요청하세요.

> start the game studio and make a small but unique web game

Producer가 `<Game>/.studio/`를 초기화하고, 대시보드를 띄우고, 킥오프를 진행하며, 각 게이트마다 여러분에게 확인을 요청합니다.
**http://127.0.0.1:4747**을 열어 진행 상황을 지켜보고 방향을 조정하세요.

CLI를 직접 사용할 수도 있습니다.

```bash
node ~/.claude/skills/game-studio/server/studio.js --project MyGame board
node ~/.claude/skills/game-studio/server/studio.js --project MyGame who
node ~/.claude/skills/game-studio/server/studio.js help
```

## 구조

```
SKILL.md            Producer playbook (boot, kickoff, sprint loop, spawning workers, controls, self-update)
server/             studio.js (CLI + state), studio-server.js (dashboard), usage.js (transcript usage), ui/index.html
roles/              one brief per role: owns, outputs, definition of done
playbooks/          engines (godot/unity/unreal/web), assets (free, blender, comfyui, paid), QA, playtest, scale tiers
templates/          GDD, TDD, ticket, milestone, default studio config
lessons/LESSONS.md  append-only log of blockers and fixes — the studio's memory
examples/mothlight  a game made end-to-end by the studio (see below)
```

게임별 상태는 `<game>/.studio/`(JSON + JSONL)에 저장됩니다: 설정, 티켓, 채팅 채널, 워커, 승인, 마일스톤, 의사결정.

## 예시: Mothlight

스튜디오가 한 세션 만에 만든 작은 웹 게임입니다. 여러분은 밤의 정원에 놓인 랜턴이 되어, 빛을 내 나방을 유인하고, 불을 꺼서 나방이 가장 밝은 빛으로 날아가게 합니다(달은 나방을 구하지만, 촛불과 전기 포충기는 그렇지 않습니다).
에이전트 8명, 티켓 20개, 마일스톤 2개, Boss 플레이테스트 2회. 절차적으로 생성한 비주얼과 합성 오디오를 사용했으며 외부 에셋은 없습니다.

```bash
python -m http.server 8080 --directory examples/mothlight/game
```

그런 다음 http://localhost:8080 을 여세요(ES 모듈은 `file://`이 아닌 http로 열어야 합니다). 설계 문서는 `examples/mothlight/docs/`에 있습니다.

## 플레이테스트: playtest-lab (선택 사항)

[playtest-lab](https://github.com/mhwangbo/playtest-lab)은 별도 저장소를 가진 자매 프로젝트입니다. 웹, Unity, Godot 빌드를 위한 결정론적 봇 플레이어와 AI 페르소나 플레이테스터, 그리고 `playtest-report/1` 리포트를 제공합니다.

`playtest-lab` 스킬로 설치되어 있으면 스튜디오의 플레이테스트 게이트(`playbooks/playtest.md`)가 이를 실행하고, 리포트의 `suggestedTicket`을 티켓으로 변환하며, 랩은 요약을 `#qa`에 미러링합니다. 설치되어 있지 않아도 스튜디오는 이전과 똑같이 동작합니다.

또한 모든 스프린트에 무료 **회귀 게이트**를 추가합니다. 테크 리드가 마일스톤 1에서 봇 기준선을 기록하고, 이후 QA는 티켓을 닫기 전에 웨이브마다 `lab.js check`를 실행합니다. 회귀가 발견되면 원인이 된 티켓이 다시 열리고, 봇이 찾은 모든 버그에는 수정을 증명하는 재생 명령이 함께 제공됩니다.

## 현황

- **엔드 투 엔드 테스트 완료:** 웹 / 잼 티어(Mothlight): 킥오프, 병렬 스프린트, QA 반려 → 수정 루프, Boss 게이트, 일시정지/지시/채팅 개입, 교훈 반영.
- **작성은 되었으나 아직 실전 검증 전:** Godot, Unity, Unreal 플레이북, Blender/ComfyUI 에셋 파이프라인, 더 큰 규모의 티어. 이 영역의 첫 실행에서는 교훈이 쌓일 것으로 예상되며, 자가 업데이트 루프가 바로 그것을 위해 존재합니다.
- 사용 비용은 API 정가 기준 **추정치**입니다(`server/usage.js` 참고, `.studio/config.json`의 `pricing`으로 재정의 가능). 구독 플랜은 토큰 단위로 과금되지 않습니다.
- 대시보드는 `127.0.0.1`에만 바인딩되며 인증이 없습니다. 네트워크에 노출하지 마세요.

## 라이선스

MIT
