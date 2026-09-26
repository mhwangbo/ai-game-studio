[English](README.md) | [한국어](README.ko.md) | **日本語** | [简体中文](README.zh-CN.md) | [Español](README.es.md)

# AI Game Studio — Claude Code スキル

*この文書は翻訳です。英語版 README と内容が異なる場合は、英語版が優先されます。*

Claude Code をゲームスタジオに変えます。**Producer（プロデューサー）** エージェントが、役割ごとのサブエージェントからなるチーム ——
クリエイティブディレクター、ゲームデザイナー、テックリード、ゲームプレイ/UI/エンジンプログラマー、2D/3D/テクニカルアーティスト、
オーディオ、ライター、QA、ビルド —— を率い、チームで協力してゲームの計画、開発、レビュー、プレイテストを行います。
対応エンジン：**Godot、Unity、Unreal、Web**。規模：1 日で作るゲームジャム作品から、複数マイルストーンにわたる大規模プロジェクトまで。

あなたは **Boss** です。すべてをリアルタイムで見守り、いつでも介入できます。

![スタジオが制作したゲーム Mothlight](examples/mothlight/qa-evidence/JAM-20_reverify_desktop_t130.png)

## 主な機能

- **ローカルダッシュボード**（`http://127.0.0.1:4747`、依存関係ゼロ）
  - **Chat** — チームごとの Slack 風チャンネル（`#design #engineering #art #audio #qa #build #approvals #blockers`）、DM、`@mentions`。Boss として投稿でき、ワーカーは次のチェックイン時にそれを確認します。
  - **Board** — エピック、マイルストーン、優先度、依存関係、**受け入れ基準** を備えた Jira 風のカンバン。すべての基準にチェックが入るまで、チケットはクローズできません。
  - **Team** — 今誰が作業中か、どのチケットに取り組んでいるか、最後に何をしたか。
  - **Usage** — チーム / ワーカー / マイルストーン / チケット別のトークン数と、API 定価ベースの推定コスト（Claude Code のトランスクリプトから読み取り）。
  - **Approvals** — あらゆる支出、ログイン、モデルのダウンロードは、あなたの Approve/Deny を待ちます。
  - **Docs** — ピッチ、GDD、TDD、意思決定ログ、教訓。
  - ボタン：**Pause · Resume · Stop · Playtest · Directive**。
- **Studio CLI**（`server/studio.js`）— ワーカーが共有状態に触れる唯一の手段です。そのため計画は誰かのコンテキストウィンドウではなく、チケットの中に存在します。
- **プロセス** — ピッチ → GDD → Boss ゲート → ファイル所有権マップ付きの TDD → 互いに重ならないファイルでの並行スプリント → エビデンス付きの QA レビュー → プレイテストゲート → 振り返り（レトロ）。
- **自己更新** — ワーカーは自明でない問題を解決したときに教訓を記録します。ループ（同じエラーが 3 回、チケットの差し戻しが 3 回）は自動的にフラグが立てられます。各レトロで Producer が教訓をプレイブックと役割ブリーフに反映し、`SKILL.md` の変更履歴を更新します。
- **アセットポリシー** — 無料/CC0 の素材、Blender（Blender MCP 経由）、ローカルの ComfyUI は利用可能です。有料の AI ツール（ElevenLabs、Higgsfield、Rodin/Hunyuan3D など）、ログイン、大容量のダウンロードは、必ず承認リクエストを経由します。エージェントが認証情報を入力することはありません。

## インストール

[Claude Code](https://docs.claude.com/en/docs/claude-code) と Node.js 18 以上が必要です。

```bash
git clone https://github.com/mhwangbo/ai-game-studio.git ~/.claude/skills/game-studio
```

フォルダは `~/.claude/skills/` の中に `game-studio` という名前で配置する必要があります（ドキュメントが `$HOME/.claude/skills/game-studio` を参照しているため）。

## 使い方

任意のフォルダで、Claude Code に次のように依頼します。

> ゲームスタジオを起動して、小さくてもユニークな Web ゲームを作って

Producer が `<Game>/.studio/` を初期化し、ダッシュボードを起動してキックオフを実行し、各ゲートであなたに確認を求めます。
**http://127.0.0.1:4747** を開けば、進行を見守り、舵取りができます。

CLI を自分で操作することもできます。

```bash
node ~/.claude/skills/game-studio/server/studio.js --project MyGame board
node ~/.claude/skills/game-studio/server/studio.js --project MyGame who
node ~/.claude/skills/game-studio/server/studio.js help
```

## 構成

```
SKILL.md            Producer playbook (boot, kickoff, sprint loop, spawning workers, controls, self-update)
server/             studio.js (CLI + state), studio-server.js (dashboard), usage.js (transcript usage), ui/index.html
roles/              one brief per role: owns, outputs, definition of done
playbooks/          engines (godot/unity/unreal/web), assets (free, blender, comfyui, paid), QA, playtest, scale tiers
templates/          GDD, TDD, ticket, milestone, default studio config
lessons/LESSONS.md  append-only log of blockers and fixes — the studio's memory
examples/mothlight  a game made end-to-end by the studio (see below)
```

ゲームごとの状態は `<game>/.studio/`（JSON + JSONL）に保存されます：設定、チケット、チャットチャンネル、ワーカー、承認、マイルストーン、意思決定。

## 事例：Mothlight

スタジオが 1 セッションで制作した小さな Web ゲームです。プレイヤーは夜の庭にあるランタンになり、光って蛾をおびき寄せ、暗くなって蛾を最も明るい光へ飛ばします（月は蛾を救いますが、ろうそくや殺虫灯は救いません）。
エージェント 8 体、チケット 20 件、マイルストーン 2 つ、Boss によるプレイテスト 2 回。ビジュアルはプロシージャル生成、オーディオはシンセサイズで、外部アセットは使っていません。

```bash
python -m http.server 8080 --directory examples/mothlight/game
```

その後 http://localhost:8080 を開いてください（ES モジュールは `file://` ではなく http が必要です）。設計ドキュメントは `examples/mothlight/docs/` にあります。

## プレイテスト：playtest-lab（オプション）

[playtest-lab](https://github.com/mhwangbo/playtest-lab) は、独自のリポジトリを持つ関連プロジェクトです。Web、Unity、Godot のビルド向けに、決定論的なボットプレイヤーと AI ペルソナのプレイテスターを追加し、`playtest-report/1` レポートを出力します。

`playtest-lab` スキルとしてインストールされている場合、スタジオのプレイテストゲート（`playbooks/playtest.md`）がそれを実行し、レポートの `suggestedTicket` をチケットに変換します。また、ラボはサマリーを `#qa` にミラーリングします。インストールされていなくても、スタジオはこれまでどおり動作します。

## ステータス

- **エンドツーエンドでテスト済み：** Web / ジャム規模（Mothlight）：キックオフ、並行スプリント、QA 差し戻し → 修正のループ、Boss ゲート、一時停止/ディレクティブ/チャットによる介入、教訓の反映。
- **作成済みだが実戦投入はまだ：** Godot、Unity、Unreal のプレイブック、Blender/ComfyUI のアセットパイプライン、より大きな規模。これらの初回実行では教訓が生まれるはずです —— 自己更新ループはそのためにあります。
- 使用コストは API 定価に基づく **推定値** です（`server/usage.js` を参照。`.studio/config.json` の `pricing` で上書き可能）。サブスクリプションプランはトークン単位では課金されません。
- ダッシュボードは `127.0.0.1` にのみバインドされ、認証はありません —— ネットワークに公開しないでください。

## ライセンス

MIT
