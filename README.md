# CopHarness

> 🚧 **実験的プロジェクトです。** 動作は無保証で、予告なく仕様が変わることがあります。本番環境での利用は推奨しません。

複数の LLM（Anthropic / OpenAI / Gemini / GitHub Copilot / ローカル LLM）で動く、エージェント型のハーネスです。
**1つのエージェントループ**に**少数の汎用ツール**を持たせ、拡張は **MCP** と **Agent Skills**、安全性は**権限モード・ルール・フック**で制御します。
同じエージェントを **CLI・Web UI・HTTP API・Discord / LINE / Slack・定期実行**から使えます。

v1 から大きく作り直しました。変更点と移行方法は [docs/MIGRATION.md](docs/MIGRATION.md)、設計の考え方は [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) を参照してください。

---

## はじめかた

Node.js 22.23.4 以上（推奨は `.nvmrc` の 24.22.1）が必要です。

```bash
npm install
cp .env.example .env.local     # API キーを1つ設定（例: ANTHROPIC_API_KEY=...）
npm run doctor                 # 設定を確認
npm run cli                    # ターミナルで対話
npm run dev                    # Web UI・API・Bot・定期実行を起動
```

`npm run dev`（本番は `npm run build && npm start`）を実行すると、アクセス用の URL が表示されます。

```
  CopHarness Web UI: http://localhost:3000/#token=xxxxxxxx
```

API キーを置いたプロバイダが自動で選ばれます（Anthropic → OpenAI → Gemini → Copilot の順）。明示する場合は `COPHARNESS_MODEL=provider/model` を設定します。

| 書き方 | 意味 |
|---|---|
| `anthropic/claude-opus-5-5` | Anthropic（既定。`claude-sonnet-5-5` / `claude-haiku-5-5` なども可） |
| `openai/gpt-5-mini` | OpenAI（`OPENAI_BASE_URL` で互換 API にも接続可） |
| `gemini/gemini-2.5-flash` | Google Gemini |
| `copilot/gpt-5-mini` | GitHub Copilot（`copilot login` 済み、または `COPILOT_GITHUB_TOKEN`） |
| `lmstudio/<model>` `ollama/<model>` `lemonade/<model>` | ローカル LLM（キー不要） |
| `openrouter/<model>` `github/<model>` | OpenRouter / GitHub Models |

---

## 使い方

### CLI

```bash
npm run cli                          # 対話モード
npm run cli -- "README を要約して"    # 最初のメッセージ付きで開始
npm run cli -- -c                    # 前回の会話を続ける
npm run cli -- -r <id>               # 指定した会話を再開
npm run cli -- -p "質問"              # 1回だけ実行して結果を出力（スクリプト・CI 向け）
npm run cli -- -p "要約して" < log.txt --output json   # 標準入力を渡す・JSON で受け取る
npm run cli -- sessions | doctor | token | schedule ...
```

ツール実行の確認はその場で `[y] 許可 / [a] この会話では常に許可 / [n] 拒否` を選びます。実行中の `Ctrl+C` で中断します。
対話中のコマンド: `/new` `/sessions` `/resume` `/model` `/mode` `/tools` `/mcp` `/skills` `/todos` `/cost` `/compact` `/status` `/help`。

`-p` は非対話なので、確認が必要なツール呼び出しは実行されません（必要なら `--mode acceptEdits` や権限ルールで許可します）。

### Web UI

ブラウザで表示された URL を開きます。会話一覧・ストリーミング表示・ツール実行の詳細・**承認ボタン**・作業リスト・画像添付・モデルと権限モードの切り替え・状態と診断・スケジュール管理が1画面にまとまっています。
Discord などチャット経由や定期実行の会話で承認待ちが発生した場合も、ヘッダーの「承認待ち」から開いて承認できます。

### HTTP API

すべての API は `Authorization: Bearer <トークン>` が必要です（トークンは `COPHARNESS_API_KEY`、未設定なら自動生成。`npm run cli -- token` で表示）。

| メソッド | パス | 説明 |
|---|---|---|
| `POST` | `/api/sessions` | `{ message, images?, model?, mode?, stream? }` 新しい会話を開始。既定は SSE でイベントを返す（`stream: false` で JSON） |
| `POST` | `/api/sessions/:id/messages` | `{ message, images?, stream? }` 会話を続ける |
| `GET` | `/api/sessions` / `/api/sessions/:id` | 一覧 / 詳細（履歴・作業リスト・使用量・承認待ち） |
| `PATCH` `DELETE` | `/api/sessions/:id` | `{ model?, mode? }` の変更 / 削除 |
| `GET` | `/api/sessions/:id/events` | 実行中のターンに接続し直す（SSE） |
| `POST` | `/api/sessions/:id/cancel` `/compact` | 中断 / 会話の圧縮 |
| `GET` `POST` | `/api/approvals` `/api/approvals/:id` | 承認待ち一覧 / `{ decision: "allow" \| "allow_always" \| "deny" }` |
| `GET` `POST` `PATCH` `DELETE` | `/api/schedules` `/api/schedules/:id` `/api/schedules/:id/run` | 定期実行の管理と即時実行 |
| `GET` | `/api/status` `/api/health` | 状態と診断 / 死活監視（認証不要） |
| `POST` | `/api/copilot` `/api/copilot/stream` | v1 互換（`{ messages }` → `{ reply }`） |

```bash
curl -N http://localhost:3000/api/sessions \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"message":"workspace のファイル一覧を教えて"}'
```

SSE のイベントは `turn_start` `text_delta` `tool_call` `tool_result` `permission_request` `todos` `usage` `turn_end` などです（[lib/types.ts](lib/types.ts) の `AgentEvent`）。

### チャット（Discord / LINE / Slack）

`.env.local` に設定してサーバーを起動するだけで有効になります。

| チャネル | 設定 | 受け口 |
|---|---|---|
| Discord | `DISCORD_BOT_TOKEN`（Message Content Intent を有効化） | DM と @メンション |
| LINE | `LINE_CHANNEL_SECRET` `LINE_CHANNEL_ACCESS_TOKEN` | Webhook `https://<host>/api/line` |
| Slack | `SLACK_SIGNING_SECRET` `SLACK_BOT_TOKEN` | Events API `https://<host>/api/slack`（スレッドで返信） |

チャット内コマンド: `/new`（新しい会話）・`/stop`（中断）・`/status`・`/approve <ID>`・`/deny <ID>`・`/help`。
`channels.allowedUsers` で利用者を制限し、`channels.approvers` に登録した人だけがチャットから承認できます（登録がなくても Web UI から承認できます）。

### 定期実行

```bash
npm run cli -- schedule add "0 9 * * 1-5" "今日の予定とニュースを要約して" --name 朝のまとめ --deliver discord:<チャンネルID>
npm run cli -- schedule list | run <id> | disable <id> | rm <id>
```

Web UI の「スケジュール」タブからも追加・実行できます。サーバー起動中に実行され、結果は Discord / LINE / Slack / Webhook に配信できます。cron はサーバーのローカル時刻で、`09:00` のような書き方もできます。

---

## ツールと権限

| ツール | 内容 | 種別 |
|---|---|---|
| `read_file` `list_files` `grep` | ワークスペースの読み取り・検索 | 読み取り |
| `write_file` `edit_file` | ファイルの作成・部分編集 | 編集 |
| `bash` | シェルコマンド（ワークスペースで実行、API キー等の環境変数は渡さない） | 実行 |
| `web_fetch` | URL の取得（社内ネットワーク・ループバック宛ては拒否） | 読み取り |
| `todo_write` | 作業リスト（UI に表示） | 内部状態 |
| `task` | サブエージェントに調査・作業を任せる | 読み取り |
| `memory` | 会話をまたぐメモ（利用者ごとに分離） | 内部状態 |
| `skill` | Agent Skills の手順書を読む（スキルがあるとき） | 読み取り |
| `mcp__<server>__<tool>` | MCP サーバーのツール | 実行（読み取り専用ヒントがあれば読み取り） |

**権限モード**（`permissions.mode`、会話ごとに変更可）

| モード | 読み取り | 編集 | 実行 |
|---|---|---|---|
| `default` | 自動 | 確認 | 確認 |
| `acceptEdits` | 自動 | 自動 | 確認 |
| `readonly` | 自動 | 拒否 | 拒否 |
| `bypass` | 自動 | 自動 | 自動 |

**ルール**は `deny` → `ask` → `allow` → モードの順に評価されます。`tool` または `tool(パターン)` で書き、パターンは bash ならコマンド、ファイル系ならパス、`web_fetch` ならホスト名に対する `*` ワイルドカードです。`bash` の `allow` ルールは `;` `&&` `|` `$(…)` などを含む連結コマンドには適用されません（`deny` は連結の各部分にも適用）。

確認待ちは CLI・Web UI・API・チャットの承認者のどこからでも応答でき、`permissions.approvalTimeoutMs`（既定10分）を過ぎると拒否されます。

---

## 設定（copharness.json）

構造化した設定はプロジェクト直下の `copharness.json`、秘密情報は `.env.local` に置きます。[copharness.example.json](copharness.example.json) に全項目の例があります。

```json
{
  "model": "anthropic/claude-opus-5-5",
  "permissions": { "mode": "default", "allow": ["bash(git status*)"], "deny": ["bash(rm -rf*)"] },
  "mcpServers": {
    "filesystem": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "./workspace"] },
    "remote": { "url": "https://example.com/mcp", "headers": { "Authorization": "Bearer ${MY_TOKEN}" } }
  },
  "hooks": { "PreToolUse": [{ "matcher": "bash", "command": "node hooks/check.js" }] },
  "channels": { "allowedUsers": ["discord:1234"], "approvers": ["discord:1234"] },
  "limits": { "dailyCostUsd": 5 }
}
```

| 項目 | 内容 | 既定 |
|---|---|---|
| `model` | `provider/model` | 検出したプロバイダの既定モデル |
| `workspace` / `dataDir` | ツールの作業場所 / 会話・メモ・設定データ | `./workspace` / `./data` |
| `systemPrompt` | 追加の指示 | なし |
| `permissions` | `mode` `allow` `ask` `deny` `approvalTimeoutMs` | `default` |
| `mcpServers` | MCP サーバー（stdio は `command`、HTTP は `url`。`${ENV}` を展開） | なし |
| `hooks` | `UserPromptSubmit` `PreToolUse` `PostToolUse` `Stop` | なし |
| `channels` | `allowedUsers` `approvers` | 全員が利用可・承認者なし |
| `limits` | `dailyCostUsd` `dailyTokens` | 無制限 |
| `maxTurns` | 1回の依頼でのモデル呼び出し上限 | 50 |
| `compaction.thresholdTokens` | これを超えると会話を要約して圧縮 | 120000 |
| `effort` | Anthropic の推論量（low〜max） | high |
| `providers` | 独自の OpenAI 互換エンドポイントなど | — |
| `tools.disabled` | 使わないツール（glob 可） | なし |
| `pricing` | 料金表の追加・上書き（USD / 100万トークン） | 主要モデルは内蔵 |

環境変数（`COPHARNESS_MODEL` `COPHARNESS_PERMISSION_MODE` `COPHARNESS_WORKSPACE` `COPHARNESS_DATA_DIR` `COPHARNESS_SYSTEM_PROMPT` `COPHARNESS_DAILY_COST_USD` など）は設定ファイルより優先されます。一覧は [.env.example](.env.example) を参照してください。設定を変えたらサーバー / CLI を再起動します。MCP やツールの変更は新しい会話から反映されます。

### スキル（Agent Skills）

`skills/<名前>/SKILL.md`（または `data/skills/`）を置くと、名前と説明がシステムプロンプトに入り、必要なときにエージェントが `skill` ツールで手順書と付属ファイルを読みます。例: [docs/examples/skills/daily-report](docs/examples/skills/daily-report/SKILL.md)。

```markdown
---
name: daily-report
description: 作業内容から日報を作成する。日報を頼まれたときに使う。
---
# 手順
1. ...
```

### フック

フックはシェルコマンドで、JSON を標準入力で受け取ります。終了コード 2 で操作を止め（標準エラーが理由としてモデルに渡ります）、終了コード 0 で `{"decision":"allow"|"deny"|"ask","reason":"...","additionalContext":"..."}` を出力できます。`matcher` はツール名の正規表現です。例: [docs/examples/hooks/block-secrets.js](docs/examples/hooks/block-secrets.js)。

### プロジェクトの指示とメモ

ワークスペースの `AGENTS.md`（または `CLAUDE.md`）は毎回の会話の冒頭で読み込まれます。`memory` ツールのメモは `data/memory/<利用者>/` の Markdown で、`MEMORY.md` が索引として読み込まれます。

---

## セキュリティ

- API は常にトークン認証です。トークンが外部に出ないようにしてください（`data/access-token`、または `COPHARNESS_API_KEY`）。
- `bash` はワークスペースで実行されますが、OS レベルの隔離はしていません。強い隔離が必要ならハーネス全体をコンテナや VM で動かしてください。
- チャットボットを公開する場合は `channels.allowedUsers` で利用者を制限し、`limits.dailyCostUsd` を設定することを推奨します。
- `data/` には会話・メモが平文で保存されます。リポジトリにコミットしないでください（`.gitignore` 済み）。
- GitHub Copilot プロバイダは公式の `@github/copilot-sdk` を使います。利用条件は GitHub の規約を確認してください。

## 開発

```bash
npm run lint && npm run typecheck && npm test
npm run build && npm run smoke     # 本番ビルドをローカルの疑似 LLM で通し確認（外部通信なし）
```

主なディレクトリ: `lib/`（エージェント本体）、`app/`（Web UI と API）、`scripts/cli.ts`（CLI）、`__tests__/`。

## ライセンス

MIT
