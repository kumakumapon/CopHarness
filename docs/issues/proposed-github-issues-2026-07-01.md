# CopHarness GitHub Issue 投稿候補（2026-07-01）

このドキュメントは、`proposed-github-issues-2026-06-29.md` の 10 件（Issue #88〜#97 として投稿済み）と重複しない、新しい改善・拡張案をまとめる。

> **投稿済み（2026-07-01）**: 本ドキュメントの Issue 1〜8 は GitHub Issue **#98〜#105** として投稿済み。
> トリアージ状況は `issue-triage-2026-07-02.md` を参照。

## 前提

コードベースを調査した結果、以下が未実装であることを確認した。

- チャットチャネルは Discord / LINE のみ（Slack はwebhook 通知スキルのみ）
- Discord / LINE Bot は応答のストリーミング表示に未対応（SSE は HTTP API のみ）
- メモリ・検索は SQLite FTS5 ベースで、embedding によるセマンティック検索は未実装
- Dockerfile / docker-compose が存在しない
- HTTP API 認証は単一の共有 `COPHARNESS_API_KEY` のみ
- DATA_DIR 配下のストア（ログ、履歴、テレメトリ等）に retention / backup の仕組みがない
- アダプタに structured output（JSON schema 指定）のサポートがない
- トークン使用量の記録はあるが、コスト・トークンの上限強制（budget enforcement）はない

## Issue 1: Slack Bot チャネルを追加する

### Title

Add Slack bot channel with unified identity mapping

### Background

現在のチャットチャネルは Discord と LINE のみで、Slack は `sendNotification` スキルによる一方向の Incoming Webhook 通知しかない。業務利用では Slack が主要チャネルであることが多く、双方向の Bot 対応が求められる。IdentityStore による Unified Messaging Gateway は導入済みのため、Slack を追加すればチャネル横断のタスク継続がさらに活きる。

### Proposal

- Slack Bolt SDK（または Events API 直接）を使った Bot チャネルを追加する。
- DM とメンションに応答し、スレッド単位で会話履歴を保持する。
- `slack:<userId>` を IdentityStore の `personId` に紐付け、LINE / Discord / API と同一人物として扱う。
- 画像添付に対応する（既存の Discord Bot と同等）。
- `lib/channels/agentCommands.ts` の共通コマンド（タスク確認・停止など）を Slack でも使えるようにする。

### Acceptance Criteria

- Slack の DM / メンションで LLM と会話できる。
- スレッドごとに会話履歴が分離される。
- IdentityStore 経由で他チャネルとタスク・記憶を共有できる。
- ユニットテスト（webhook payload 処理）が追加されている。
- README にセットアップ手順が追加されている。

### Priority

High

## Issue 2: Discord / LINE Bot の応答をストリーミング表示する

### Title

Stream LLM responses progressively in chat channels

### Background

SSE ストリーミングは `POST /api/copilot/stream` で対応済みだが、Discord / LINE Bot は応答が完成するまで無反応になる。長い応答やスキル実行を伴う場合、ユーザーは進行状況が分からない。

### Proposal

- Discord Bot でアダプタの `stream()` を使い、メッセージ編集（throttle 付き、例: 1〜2 秒間隔）で応答を逐次更新する。
- スキル実行中は「🔧 webSearch 実行中…」のようなステータス表示を行う。
- LINE はメッセージ編集 API がないため、長時間処理時に途中経過を push message で送る、または処理開始の即時応答を返すフォールバックとする。
- Discord の 2000 文字制限・rate limit を考慮した編集間隔制御を実装する。

### Acceptance Criteria

- Discord で応答が逐次更新される。
- Discord API の rate limit を超えない編集間隔になっている。
- スキル実行時に進行状況が表示される。
- stream 非対応プロバイダでは従来どおり一括応答になる。
- 関連テストが追加されている。

### Priority

Medium

## Issue 3: Embedding ベースのセマンティック検索（RAG）を追加する

### Title

Add embedding-based semantic search for memory and documents (RAG)

### Background

MemoryStore と検索インデックスは SQLite FTS5 ベースのキーワード検索であり、言い換えや多言語の揺らぎに弱い。ドキュメントを取り込んで知識ベースとして参照する RAG 的な使い方もできない。

### Proposal

- embedding プロバイダ抽象（OpenAI / Gemini embeddings、ローカル LM Studio）を追加する。
- MemoryStore と検索インデックスに embedding カラムを追加し、FTS5 とベクトル類似度のハイブリッド検索を実装する（sqlite-vec または JS 実装のコサイン類似度フォールバック）。
- `ingestDocument` スキルを追加し、URL / ファイルをチャンク分割して知識ベースに登録できるようにする。
- `memorySearch` / dashboard 検索でセマンティック検索を選択できるようにする。
- embedding キーがない環境では従来の FTS5 検索に自動フォールバックする。

### Acceptance Criteria

- embedding キー設定時にセマンティック検索が動作する。
- キー未設定時は FTS5 検索にフォールバックする。
- ドキュメント取り込み → 検索の E2E テスト（モック embedding）がある。
- 既存の memory / search API と後方互換性がある。

### Priority

Medium to High

## Issue 4: Dockerfile と docker-compose によるデプロイ手段を追加する

### Title

Add Dockerfile and docker-compose for production deployment

### Background

現在デプロイ手段が整備されておらず、Node.js 環境を手動構築する必要がある。DATA_DIR 永続化、環境変数、ヘルスチェックを含むコンテナ構成があれば、VPS や自宅サーバーでの常駐運用が容易になる。

### Proposal

- multi-stage build の Dockerfile を追加する（`next build` → 実行イメージ）。
- docker-compose.yml で Next.js + Discord Bot を起動し、DATA_DIR を volume として永続化する。
- `/api/health` を利用した HEALTHCHECK を定義する。
- `.env.local` の代わりに compose の env_file を使う手順を docs に追加する。
- 任意で OTLP コレクタ（例: Jaeger）を含む観測用 compose profile を用意する。

### Acceptance Criteria

- `docker compose up` で Web UI と Bot が起動する。
- コンテナ再起動後も会話履歴・タスク・メモリが保持される。
- ヘルスチェックが機能する。
- README または docs にデプロイ手順が追加される。

### Priority

Medium

## Issue 5: ユーザー別 API キーとスコープ制御を追加する

### Title

Support per-user API keys with scopes and per-key rate limits

### Background

HTTP API 認証は単一の共有 `COPHARNESS_API_KEY` のみで、複数クライアント・複数ユーザーへの展開時に、失効管理・権限分離・利用量の帰属ができない。

### Proposal

- API キーストアを追加し、キーごとに `name`、`personId`、`scopes`、`createdAt`、`lastUsedAt`、`revoked` を管理する。
- スコープ例: `chat`（/api/copilot 系）、`dashboard:read`、`dashboard:admin`、`a2a`。
- キーは hash 化して保存し、平文は発行時のみ表示する。
- キーごとの rate limit を既存の `lib/rateLimit.ts` と統合する。
- キーの `personId` を IdentityStore に紐付け、API 経由の会話・トークン使用量を人物単位で追跡する。
- 既存の `COPHARNESS_API_KEY`（単一キー）は後方互換として残す。
- Dashboard からキーの発行・失効・利用状況確認をできるようにする。

### Acceptance Criteria

- キー発行・失効 API と Dashboard UI がある。
- スコープ外のエンドポイントへのアクセスは 403 になる。
- キーごとの rate limit が機能する。
- 既存の単一キー運用が壊れない。
- 関連テストが追加されている。

### Priority

High

## Issue 6: DATA_DIR ストアの retention と backup を整備する

### Title

Add data retention policies and backup tooling for DATA_DIR stores

### Background

会話履歴、スキル実行ログ、テレメトリ、トークン使用量、検索インデックスなどが DATA_DIR に蓄積され続けるが、保持期間の管理や backup / restore の仕組みがない。長期運用ではディスク肥大化とデータ喪失リスクがある。

### Proposal

- ストア種別ごとの retention 設定（例: `LOG_RETENTION_DAYS`、`TELEMETRY_RETENTION_DAYS`）を追加する。
- スケジューラーで定期 prune を実行できるようにする（デフォルトは無効）。
- `npm run backup` / `npm run restore` の CLI を追加し、DATA_DIR 全体を tar.gz にエクスポート / インポートできるようにする。
- SQLite ファイルは整合性を保った backup（`VACUUM INTO` 等）を使う。
- Dashboard にストアごとのサイズ・件数と、prune 実行状況を表示する。

### Acceptance Criteria

- retention 設定に従い古いレコードが削除される。
- backup → restore で会話履歴・タスク・メモリが復元できる。
- prune はデフォルト無効で、既存挙動を変えない。
- 関連テストが追加されている。

### Priority

Medium

## Issue 7: アダプタ共通の structured output（JSON schema）対応

### Title

Add structured output (JSON schema) support across provider adapters

### Background

アダプタ層に JSON schema による出力形式指定の仕組みがなく、エージェントの planner 出力やスキル生成、eval の判定などで JSON パースの失敗リスクを個別に処理している。プロバイダ横断で structured output を統一的に扱えると、マルチエージェントや eval の信頼性が上がる。

### Proposal

- `LLMRequest` に `responseFormat: { type: 'json_schema', schema, name }` を追加する。
- プロバイダごとにマッピングする: OpenAI は `response_format`、Anthropic は tool 強制呼び出し、Gemini は `responseSchema`、非対応プロバイダはプロンプト注入 + 検証にフォールバックする。
- 応答の schema validation とリトライ（最大 N 回）を共通実装する。
- Agent orchestrator / DAG planner の出力パースを本機能へ移行する。

### Acceptance Criteria

- 主要プロバイダで schema 準拠の JSON が返る。
- 非対応プロバイダでもフォールバックで動作する。
- validation 失敗時のリトライがテストされている。
- 既存の `LLMRequest` 利用箇所に後方互換性がある。

### Priority

Medium

## Issue 8: コスト・トークンの budget enforcement を追加する

### Title

Enforce cost and token budgets per task, user, and day

### Background

トークン使用量の記録（TokenTracker）と可視化はあるが、上限の強制がない。スケジューラーやマルチエージェントの自動実行では、暴走時にコストが際限なく増えるリスクがある。Issue #91（時系列可視化）は「見る」機能であり、本 Issue は「止める」機能として補完する。

### Proposal

- budget 設定を追加する: グローバル / personId 単位 / taskId 単位の日次・月次上限（トークン数または推定コスト）。
- 上限接近時（例: 80%）に warning を発し、超過時は LLM 呼び出しを拒否またはタスクを一時停止する。
- Human-in-the-Loop と接続し、超過時に承認があれば継続できるようにする。
- Agent DAG の各ノードに budget を伝搬し、サブエージェントの消費を親タスクに合算する。
- Dashboard で budget 使用率を表示する。

### Acceptance Criteria

- budget 超過時に LLM 呼び出しがブロックされる。
- 80% 到達時に warning イベントが記録される。
- HIL 承認で超過後も継続できる。
- budget 未設定時は既存挙動と同一である。
- 関連テストが追加されている。

### Priority

Medium to High

## 投稿運用メモ

このファイルは Issue 投稿前の下書きとして使う。投稿時は各セクションの Title を issue title に、Background / Proposal / Acceptance Criteria / Priority を本文に転記し、`enhancement` ラベルを付与する。
