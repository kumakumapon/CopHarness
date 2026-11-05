# v1 から v2 への移行

v2 は「機能を足し続けた結果、入口と仕組みがばらばらになった」v1 を、現代的なエージェントハーネスの考え方で作り直したものです。
本体のコード量はおよそ 4 分の 1（約 31,000 行 → 約 7,400 行）になり、どの入口（CLI・Web・API・チャット・定期実行）も同じエージェントループと同じ権限の仕組みを通ります。

## 何が変わったか

| 観点 | v1 | v2 |
|---|---|---|
| 実行モデル | 「チャット」（アダプタ内部でツールループ）と「エージェント」（`markComplete` などの制御ツール）が別系統 | 1つのエージェントループ。ツール呼び出しがなくなった時点でターン終了 |
| プロバイダ | アダプタごとに `complete` / `stream` × ツールループを重複実装。メッセージは文字列のみ | プロバイダは「1回のモデル呼び出し」だけを担当。ツール呼び出し・結果・推論を型付きで保持し、同じプロバイダには応答をそのまま返送（キャッシュ・推論署名を維持） |
| ツール | 50 以上の個別スキル（base64、UUID、天気、ニュース、スライド生成…） | 汎用ツール 10 個（ファイル・grep・bash・web_fetch・作業リスト・サブエージェント・メモ）＋ MCP ＋ Agent Skills |
| 安全性 | HIL ゲート、`policy.json`（時間帯・引数条件など）、toolset、dry-run、実行バックエンド（local/docker/ssh） | 権限モード（4種）＋ allow / ask / deny ルール＋コマンドフック。承認はどの入口からでも可能 |
| 設定 | 約 70 個の環境変数、`minimal` / `full` プロファイル | `copharness.json`（構造化設定）＋ `.env.local`（秘密情報）。機能は設定したものだけ有効 |
| CLI | `cli` と `agent-cli` の2本 | `npm run cli` の1本（対話・`-p` ヘッドレス・管理コマンド） |
| Web | ランディング、プレイグラウンド、チュートリアル、16 パネルのダッシュボード | 1画面のチャット UI（承認・状態・スケジュールを含む） |
| 起動 | Next.js、Discord、スケジューラーを別プロセス（`concurrently`） | `npm run dev` / `npm start` の1プロセス |
| 永続化 | 会話・タスク台帳・監査ログ・スキル実行ログ・違反ログ・検索索引などが個別ファイル | 会話ごとの追記型 JSONL（`data/sessions/`）にすべて記録 |
| 認証 | `COPHARNESS_API_KEY` 未設定時は無認証 | 常にトークン認証（未設定なら自動生成） |

## 削除した機能と代わりの手段

| v1 の機能 | v2 での扱い |
|---|---|
| 個別スキル（`calculator` `uuidGenerate` `hashText` `csvParse` `getWeather` `techNews` `arXivSearch` `createPresentation` `translateText` ほか） | モデル自身または `bash`（`python3 -c` など）で実行。外部サービスは MCP サーバーを追加。手順の定型化は Agent Skills |
| `webSearch`（DuckDuckGo Instant Answer） | 検索 MCP サーバー（Brave Search など）を `mcpServers` に追加 |
| `runCommand`（許可リスト型） | `bash` ＋権限ルール（例: `allow: ["bash(git status*)"]`、`deny: ["bash(rm *)"]`） |
| `readFile` / `writeFile` / `listDirectory` / `searchInFiles` | `read_file` / `write_file` `edit_file` / `list_files` / `grep` |
| スキル提案・自動生成スキル（`node:vm` サンドボックス） | Agent Skills（`skills/<名前>/SKILL.md`）。エージェントにスキルを書かせる場合も通常のファイル編集として承認を経る |
| プロンプトウィザード | 削除（Web UI の例文、Agent Skills で代替） |
| マルチエージェント（固定ロール、パイプライン、DAG、A2A `/api/a2a`） | `task` ツールによるサブエージェント。外部連携は `/api/sessions` |
| Ralph Loop、トリマー、コンテキスト再試行 | 自動圧縮（会話全体を要約に置き換え）と `/compact` |
| 長期メモリ（SQLite FTS5）、memory nudge、会話検索索引 | `memory` ツール（Markdown ファイル、利用者ごとに分離） |
| IdentityStore（チャネル横断の人物統合） | 削除。会話はチャネルの会話単位、メモは利用者単位 |
| TaskLedger、監査ログ、スキル実行ログ、スキーマ違反ログ、イベントバス、自前 OTel トレーサー | 会話の JSONL にメッセージ・ツール結果・使用量を記録。日次の使用量は `data/usage.json` |
| ウォッチャー（RSS / ファイル / GitHub Webhook） | 定期実行、または外部から `/api/sessions` を呼ぶ |
| 応答キャッシュ、フォールバックアダプタ | 削除（ツールを使う対話ではキャッシュは不正確。Anthropic はサーバー側フォールバックを使用） |
| 実行バックエンド（docker / ssh） | ハーネス全体をコンテナ等で動かす |
| `minimal` / `full` プロファイル | 削除。使う機能だけ設定する |
| LLM 評価スクリプト（`npm run eval`） | 削除。`npm run cli -- -p ... --output json` で任意の評価を組めます |
| プロバイダ `antigravity` | `gemini`（`antigravity/...` も別名として受け付けます） |

## 環境変数の対応

旧変数の多くはそのまま読み込まれ、起動時に非推奨の警告が出ます。

| v1 | v2 |
|---|---|
| `COPILOT_PROVIDER` + `COPILOT_MODEL`（`OPENAI_MODEL` 等） | `COPHARNESS_MODEL=provider/model`（旧変数も解釈） |
| `COPILOT_SYSTEM_PROMPT` | `COPHARNESS_SYSTEM_PROMPT` または `systemPrompt` |
| `COPILOT_TIMEOUT_MS` | `COPHARNESS_TIMEOUT_MS` |
| `AGENT_MAX_ITERATIONS` | `maxTurns` |
| `SKILL_FILE_SANDBOX_DIR` | `COPHARNESS_WORKSPACE` または `workspace` |
| `DATA_DIR` | `COPHARNESS_DATA_DIR`（`DATA_DIR` も可）。**既定が `./data` に変わりました** |
| `MCP_SERVERS` | `mcpServers`（旧形式の URL 一覧も解釈） |
| `HIL_ENABLED` / `HIL_APPROVAL_TIMEOUT_MS` / `TOOL_POLICY_FILE` | 権限モードとルール（`default` モードで編集・実行は常に確認）/ `permissions.approvalTimeoutMs` |
| `ENABLED_SKILLS` | `tools.disabled`（使わないツールを指定） |
| `AGENT_COMMAND_APPROVERS` | `channels.approvers` |
| `BUDGET_MAX_COST_USD` / `BUDGET_MAX_TOKENS` | `limits.dailyCostUsd` / `limits.dailyTokens` |
| `ANTIGRAVITY_API_KEY` | `GEMINI_API_KEY`（旧名も可） |
| `DISCORD_MAX_HISTORY` `LINE_MAX_HISTORY` `HISTORY_TOKEN_BUDGET` など | 不要（自動圧縮） |
| `EXECUTION_*` `GENERATED_SKILL_*` `DASHBOARD_EVENTS_*` `MEMORY_NUDGE_ENABLED` `TRANSCRIPT_LOGGING` など | 廃止 |

## API の対応

| v1 | v2 |
|---|---|
| `POST /api/copilot` `POST /api/copilot/stream` | **互換のまま利用可能**（各呼び出しは非対話の会話として記録され、確認が必要なツールは実行されません） |
| `POST /api/copilot/agent` | `POST /api/sessions`（新規）/ `POST /api/sessions/:id/messages`（継続） |
| `POST /api/a2a` | `POST /api/sessions` |
| `/api/dashboard/approvals*` | `/api/approvals`、`/api/approvals/:id` |
| `/api/dashboard/schedules*` | `/api/schedules*` |
| `/api/dashboard/status` | `/api/status` |
| その他の `/api/dashboard/*`、`/api/watchers/*` | 廃止 |

v1 では `COPHARNESS_API_KEY` 未設定時に API が無認証でしたが、v2 では常に認証が必要です。CopChat など既存の連携は `COPHARNESS_API_KEY` を設定していれば変更不要です。

## データ

- **スケジュール**: v1 の `schedules.json`（プロジェクト直下）は自動で読み込まれ、次に保存したときに `data/schedules.json` へ移ります。`discordChannelId` / `lineUserId` は配信先として引き継がれます。
- **会話履歴・メモ・タスク台帳など**: v2 では読み込みません。ファイルは削除しないので、必要なら手元に残してください（`.gitignore` 済み）。メモを引き継ぐ場合は `data/memory/<利用者>/MEMORY.md` に書き写します。
- Discord / LINE の会話は v2 で新しい会話として始まります。

## 動作確認の手順

```bash
npm ci
npm run doctor        # 非推奨設定・不足しているキーを表示
npm run cli -- -p "こんにちは"
npm run dev           # 表示された URL を開く
```
