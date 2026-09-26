[English](README.md) | [한국어](README.ko.md) | [日本語](README.ja.md) | **简体中文** | [Español](README.es.md)

# AI Game Studio —— 一个 Claude Code 技能

*本文为译文。如与英文版 README 存在出入，以英文版为准。*

把 Claude Code 变成一家游戏工作室：由一个**制作人（Producer）**智能体带领一支按职能划分的子智能体团队——
创意总监、游戏策划、技术负责人、玩法/UI/引擎程序员、2D/3D/技术美术、
音频、编剧、QA、构建——共同完成游戏的规划、开发、评审和试玩测试。
引擎：**Godot、Unity、Unreal、Web**。规模：从一天完成的 Game Jam 小游戏，到包含多个里程碑的大型项目。

你就是 **Boss**。你可以实时观看一切，并随时介入。

![Mothlight，一款由该工作室制作的游戏](https://raw.githubusercontent.com/mhwangbo/mothlight/main/screenshots/night.png)

## 你将获得

- **本地仪表盘**（`http://127.0.0.1:4747`，零依赖）
  - **聊天** —— 类似 Slack 的按团队划分的频道（`#design #engineering #art #audio #qa #build #approvals #blockers`）、私信、`@mentions`。以 Boss 身份发言；成员会在下一次签到时看到。
  - **看板** —— 类似 Jira 的看板，支持史诗、里程碑、优先级、依赖关系和**验收标准**。只有所有标准都勾选完毕，工单才能关闭。
  - **团队** —— 当前谁在工作、在做哪个工单、最近一次操作是什么。
  - **用量** —— 按团队 / 成员 / 里程碑 / 工单统计的 token 用量及按 API 标价估算的费用（读取自 Claude Code 的会话记录）。
  - **审批** —— 每一笔花费、每一次登录或模型下载都要等待你点击批准/拒绝。
  - **文档** —— 立项提案、GDD、TDD、决策日志、经验教训。
  - 按钮：**暂停 · 继续 · 停止 · 试玩 · 指令**。
- **工作室 CLI**（`server/studio.js`）—— 成员访问共享状态的唯一途径，因此计划存放在工单里，而不是某个人的上下文窗口里。
- **流程** —— 立项提案 → GDD → Boss 审核关卡 → 附带文件归属映射的 TDD → 在互不重叠的文件上并行冲刺 → 附带证据的 QA 评审 → 试玩测试关卡 → 复盘。
- **自我更新** —— 成员在解决了不显而易见的问题时会记录经验教训；死循环（同一错误出现 3 次、工单被驳回 3 次）会被自动标记；每次复盘时，制作人会把经验教训整合进工作手册和职能说明，并更新 `SKILL.md` 中的变更日志。
- **素材策略** —— 允许使用免费/CC0 素材源、Blender（通过 Blender MCP）以及本地 ComfyUI；付费 AI 工具（ElevenLabs、Higgsfield、Rodin/Hunyuan3D 等）、登录操作和大文件下载一律需要提交审批请求。智能体绝不输入账号凭据。

## 安装

需要 [Claude Code](https://docs.claude.com/en/docs/claude-code) 和 Node.js 18+。

```bash
git clone https://github.com/mhwangbo/ai-game-studio.git ~/.claude/skills/game-studio
```

该文件夹必须位于 `~/.claude/skills/` 下并命名为 `game-studio`（文档中引用的路径是 `$HOME/.claude/skills/game-studio`）。

## 使用

在任意文件夹中，对 Claude Code 说类似这样的话：

> 启动游戏工作室，做一款小巧但有特色的 Web 游戏

制作人会初始化 `<Game>/.studio/`、启动仪表盘、召开启动会议，并在每个关卡征询你的意见。
打开 **http://127.0.0.1:4747** 即可观看和掌控进度。

你也可以自己操作 CLI：

```bash
node ~/.claude/skills/game-studio/server/studio.js --project MyGame board
node ~/.claude/skills/game-studio/server/studio.js --project MyGame who
node ~/.claude/skills/game-studio/server/studio.js help
```

## 目录结构

```
SKILL.md            Producer playbook (boot, kickoff, sprint loop, spawning workers, controls, self-update)
server/             studio.js (CLI + state), studio-server.js (dashboard), usage.js (transcript usage), ui/index.html
roles/              one brief per role: owns, outputs, definition of done
playbooks/          engines (godot/unity/unreal/web), assets (free, blender, comfyui, paid), QA, playtest, scale tiers
templates/          GDD, TDD, ticket, milestone, default studio config
lessons/LESSONS.md  append-only log of blockers and fixes — the studio's memory
```

每个游戏的状态存放在 `<game>/.studio/` 中（JSON + JSONL）：配置、工单、聊天频道、成员、审批、里程碑、决策。

## 工作室制作的游戏

每款游戏都有自己的仓库，包含设计文档和可游玩的构建。

- **[Mothlight](https://github.com/mhwangbo/mothlight)**（[在线试玩](https://mhwangbo.github.io/mothlight/)）：你是夜晚花园里的一盏灯笼——发光来吸引飞蛾，熄灭让它们飞向最亮的光源（月亮能拯救它们；蜡烛和灭虫灯则不能）。Web 游戏，一次会话完成：8 个智能体、20 个工单、2 个里程碑、2 次 Boss 试玩。程序化视觉与合成音频，没有任何外部素材。

## 试玩测试：playtest-lab（可选）

[playtest-lab](https://github.com/mhwangbo/playtest-lab) 是一个配套项目，拥有独立的仓库。它为 Web、Unity 和 Godot 构建提供结果确定的机器人玩家和 AI 人设试玩员，并输出 `playtest-report/1` 格式的报告。

当它以 `playtest-lab` 技能的形式安装后，工作室的试玩测试关卡（`playbooks/playtest.md`）会调用它，把报告中的 `suggestedTicket` 转成工单，lab 也会把摘要同步到 `#qa`。未安装时，工作室的行为与之前完全相同。

它还为每个冲刺加上免费的**回归关卡**：技术负责人在里程碑 1 记录机器人基线，之后 QA 在关闭工单前对每一波运行 `lab.js check`。一旦出现回归，引发它的工单会被重新打开；机器人发现的每个缺陷都附带一条可证明修复的回放命令。

## 状态

- **已端到端测试：** Web / Game Jam 规模（Mothlight）：启动会议、并行冲刺、QA 驳回 → 修复循环、Boss 审核关卡、暂停/指令/聊天介入、经验教训整合。
- **已编写但尚未经过实战检验：** Godot、Unity 和 Unreal 工作手册，Blender/ComfyUI 素材管线，更大的规模档位。预计在这些场景下的首批运行会产生不少经验教训——这正是自我更新循环存在的意义。
- 用量费用是按 API 标价计算的**估算值**（见 `server/usage.js`，可在 `.studio/config.json` 中通过 `pricing` 覆盖）；订阅套餐并不按 token 计费。
- 仪表盘只绑定到 `127.0.0.1`，且没有任何身份验证——切勿将其暴露到网络上。

## 许可证

MIT
