# Issue: OpenClaw / Hermes Agent 比較を踏まえた CopHarness 改良ロードマップ

## 背景

CopHarness はすでに CLI、Discord Bot、LINE Bot、HTTP/SSE API、ダッシュボード、スケジューラー、スキル、MCP、マルチエージェント、OpenTelemetry、Human-in-the-Loop を備えている。一方で、OpenClaw のような「日常チャットから実際の行動を代行する常駐エージェント」や、Hermes Agent のような「経験から学習し、スキルや記憶を改善し続けるエージェント」と比較すると、以下の方向に伸ばす余地がある。

## 目的

CopHarness を、単なる LLM ハーネスから以下を満たす実用エージェント基盤へ進化させる。

- 複数チャネルをまたいで同一ユーザー・同一タスクとして継続できる。
- 利用履歴から長期記憶と再利用可能なスキルを育てられる。
- 複数サブエージェントが安全に並列実行できる。
- 外部ツール実行や自動化をポリシーと承認で制御できる。
- 実行結果、失敗、承認、コスト、スキル品質を観測・評価できる。

## 提案内容

### 1. Unified Messaging Gateway

LINE、Discord、API などのチャネル別セッションを、同一人物・同一タスクとして扱えるようにする。

- `IdentityStore` を追加し、`line:<userId>`、`discord:<userId>`、`api:<subject>` を `personId` に紐付ける。
- 会話履歴を `channelKey` と `personId` に分離する。
- LINE で依頼したタスクを Discord や API から確認・停止・再開できるようにする。
- ダッシュボードに人物、チャネル、進行中タスク、最近の記憶を表示する。

### 2. Memory 2.0

現在の key-value 型メモリを、検索可能で出典・信頼度・鮮度を持つ長期記憶に拡張する。

- SQLite + FTS5 ベースの `MemoryStore` を追加する。
- 記憶種別を `fact`、`preference`、`project`、`task`、`episodic` などに分類する。
- `importance`、`confidence`、`sourceSessionId`、`lastVerifiedAt`、`stale` を管理する。
- `memorySearch`、`memoryUpsert`、`memoryForget`、`memoryExplain` スキルを追加する。
- 会話中に「これは覚えますか？」という memory nudging を行う。

### 3. Self-Improving Skills

繰り返し発生する作業を検出し、再利用可能なスキル候補として提案・生成・テスト・承認・登録できるようにする。

- `SkillProposal` ストアを追加する。
- 提案には `name`、`problem`、`proposedCode`、`testPlan`、`riskLevel`、`approvalStatus` を含める。
- 生成されたスキルは即時有効化せず、サンドボックス生成、Jest テスト、Human-in-the-Loop 承認を経て登録する。
- `lib/skills/generated/` のような生成スキル用ディレクトリを用意する。
- ダッシュボードに提案中、テスト失敗、承認待ちのスキルを表示する。

### 4. Agent DAG / Parallel Runner

現在の逐次的なエージェント実行を、依存関係付き DAG と並列実行へ拡張する。

- `AgentPlan` を `id`、`role`、`prompt`、`dependsOn`、`skills`、`timeoutMs`、`budget` で表現する。
- 依存関係のないノードを `Promise.allSettled` で並列実行する。
- サブエージェントごとに `workspace/<runId>/<agentId>/` を割り当てる。
- planner / reviewer / summarizer ロールで成果を統合する。
- ダッシュボードに DAG、進捗、失敗ノード、リトライ操作を表示する。

### 5. Tool Policy Engine

`ENABLED_SKILLS` と risk level だけでなく、ユーザー、チャネル、引数、時間帯、承認モードを含む細粒度ポリシーでツール実行を制御する。

- `policy.json` または DB に user / role / channel / skill / argument pattern / schedule / approval mode を定義する。
- リスク属性を filesystem write、network access、shell execution、credential access、external message send などに分解する。
- 承認モードとして `alwaysAllow`、`allowWithDryRun`、`requireApproval`、`deny`、`allowForSession` を追加する。
- 承認画面に実行予定の差分、外部送信先、ファイル変更予定を表示する。

### 6. Remote Runtime / Isolated Workspace

危険なコマンドや外部ツール実行を、ローカルプロセスから隔離された実行環境へ移す。

- `ExecutionBackend` 抽象を追加する。
- backend として `local`、`docker`、`ssh`、`kubernetes-job` などを想定する。
- `runCommand`、`writeFile` などのスキルは backend 経由で実行する。
- backend ごとに working directory、allowed paths、env allowlist、network policy、timeout、artifact directory を制御する。

### 7. Skill Hub / MCP Hub

スキルと MCP ツールを単に登録するだけでなく、運用・監査・権限制御できるハブにする。

- スキルごとにリスク、最終実行日時、成功率、平均実行時間、直近エラー、必要 env、承認ポリシーを表示する。
- MCP サーバーごとに tool filter を設定可能にする。
- `research`、`coding`、`office`、`personal`、`dangerous` などの toolset を導入する。
- プロンプト、スケジュール、サブエージェントごとに toolset を指定できるようにする。

### 8. Proactive Agent

cron スケジューラーを、イベント駆動の常駐エージェント機能へ拡張する。

- `Watcher` 抽象を追加する。
- webhook、file changed、GitHub issue opened、RSS updated、calendar approaching、log error detected などを trigger として扱う。
- 低リスク処理は自動実行し、高リスク処理は承認待ちにする。
- 実行結果を LINE、Discord、ダッシュボードに通知する。

### 9. Task Ledger / Context Continuity

context compaction を会話要約だけで終わらせず、構造化されたタスク台帳に接続する。

- `TaskLedger` を追加し、goal、current plan、completed steps、blocked steps、artifacts、decisions、next action を保存する。
- Ralph Loop の compaction 時に TaskLedger を更新する。
- サブエージェントやスケジュール結果も同じ TaskLedger に統合する。
- Markdown と JSON の両方で progress artifact を保存する。

### 10. Observability / Eval 強化

運用可能なエージェント基盤として、スキル品質、承認、失敗、コスト、評価を可視化する。

- スキル単位の成功率、失敗率、承認率、平均時間、トークン量を収集する。
- サブエージェント単位のコスト、成果、失敗理由を表示する。
- eval を CI gate として強化し、スキル追加時に自動評価する。
- OpenTelemetry span に `agent.role`、`skill.name`、`policy.decision`、`approval.id`、`memory.hit_count`、`task.id` を追加する。

## 推奨ロードマップ

### Phase 1: 基盤強化

- [x] IdentityStore によるチャネル横断ユーザー統合（初期実装完了。LINE / Discord / API の通常チャット履歴を `personId` ベースの会話キーへ接続し、ダッシュボードで人物・チャネル・最近のタスクを表示）
- [x] SQLite / FTS ベースの MemoryStore（`memory.sqlite` に typed memory と FTS5 index を保持し、`memorySearch` / `memoryUpsert` / `memoryForget` / `memoryExplain` を追加）
- [x] スキル実行ログと成功率の可視化（初期実装完了。`skill_executions.json` に実行ログを保持し、ダッシュボードのスキル一覧で実行回数・成功率・平均時間・直近エラーを表示）
- [x] スキル承認ポリシーの JSON 化（`policy.json` / `TOOL_POLICY_FILE` による skill / risk / user / channel / argument / schedule 条件と approval mode 評価を追加）
- [x] AgentPlan DAG 型の定義（`AgentPlan` / `AgentPlanProgress` の型定義を追加。Runner 実装は Phase 3 の「並列 Agent DAG runner」で継続）

### Phase 2: 学習・改善ループ

- [x] SkillProposal ストア（`skill_proposals.json` に name / problem / proposedCode / testPlan / riskLevel / status を保持し、ダッシュボード API / UI で提案中・テスト失敗・承認待ちを表示）
- [x] スキル生成 → テスト → 承認 → 登録フロー（`node:vm` サンドボックスで testPlan を実行し、HIL 承認後に riskLevel 最低 medium の generated スキルとして動的登録。`proposeSkill` でエージェント自身が提案可能）
- [x] memory nudging（LINE / Discord の通常チャットで「これは覚えますか？」を提示し、はい / いいえで MemoryStore に保存。`MEMORY_NUDGE_ENABLED` で有効化）
- [x] 会話・タスクの semantic search（SQLite FTS5 + JSON フォールバックの SearchIndex を会話履歴と TaskLedger に接続し、`searchHistory` スキルとダッシュボード検索を追加。現状は lexical FTS で embedding は将来課題）
- [x] TaskLedger と Ralph Loop の統合（compaction 時に TaskLedger metadata を更新し、progress.md / progress.json を保存。LINE / Discord / API のチャットを Ralph Loop 経由に変更）

### Phase 3: 常駐・自律実行

- [ ] event trigger / watcher
- [ ] Docker / SSH backend
- [ ] 並列 Agent DAG runner
- [ ] toolset / MCP hub
- [ ] モバイルチャットからの進捗確認・停止・承認

## 実装進捗

### 2026-06-10: Phase 2 完了（学習・改善ループ）

#### 完了

- `SkillProposal` ストアを追加し、提案の `draft` → `testing` → `tests_failed` / `awaiting_approval` → `approved` / `rejected` → `registered` のライフサイクルを `skill_proposals.json` に永続化した。ダッシュボードに提案一覧（状態フィルタ付き）と Test / Approve / Reject 操作を追加した。
- 生成スキルのサンドボックスを `node:vm` で実装した。`module.exports = async (args) => SkillResult` 契約のコードを最小グローバル（require / process / fetch / timer なし、文字列からのコード生成無効、同期タイムアウト + 非同期期限付き、呼び出しごとにコンテキスト分離）で実行する。
- 提案の testPlan（args + contains / equals / isError 期待値）をサンドボックスで実行し、全件通過した提案のみ承認待ちへ遷移、監査用に Human-in-the-Loop 承認リクエストも発行するようにした。空の testPlan は必ず失敗する。
- 承認時に生成スキルを実行時登録するフローを追加した。生成スキルは category `generated`、riskLevel は最低 `medium` を強制（`ENABLED_SKILLS` に明示しない限り不活性）、HIL / policy gate 経由で実行される。起動時ローダーが承認済み提案を再登録する。
- `proposeSkill` スキルを追加し、エージェント自身が繰り返しタスクからスキル候補を提案 → 即時テストできるようにした（自動登録はせず、人間の承認が必須）。
- memory nudging を追加した。LINE / Discord の通常チャットでユーザー発話から記憶候補（明示的な「覚えて」、自己紹介、好み、誕生日など日英ヒューリスティック）を検出し、「これは覚えますか？」を返信に付加。次の「はい / いいえ」の短い返信で MemoryStore へ保存または破棄する。`MEMORY_NUDGE_ENABLED` で有効化、保留中 nudge は TTL 付きで `memory_nudges.json` に保持。
- 会話・タスクの全文検索を追加した。`SearchIndex`（SQLite FTS5 + bm25、`node:sqlite` がない環境では JSON フォールバック）を会話履歴保存と TaskLedger の開始 / 終了 / 更新にフックし、`searchHistory` スキル（low risk）、`GET /api/dashboard/search`、ダッシュボード検索パネルを追加した。
- Ralph Loop と TaskLedger を統合した。compaction 発生時に該当タスクの metadata へ `ralphLoop`（compaction 回数、最終実行時刻、goal / summary プレビュー）を記録し、progress artifact を Markdown と JSON の両方で保存するようにした。LINE / Discord / API の通常チャット補完を `runWithRalphLoop` 経由に切り替え、compaction が本番経路で動作するようにした。

#### 未完了 / Phase 3 以降で継続

- semantic search は現状 lexical FTS（bm25）であり、embedding ベースの類似検索・rerank は将来課題。
- 生成スキルのサンドボックスは `node:vm` ベースで完全なセキュリティ境界ではない。Remote Runtime / Isolated Workspace（Phase 3 の Docker / SSH backend）導入時に生成スキル実行を backend 側へ移すことを検討する。
- memory nudging はヒューリスティック検出のみで、LLM による候補抽出・要約は未実装。誤検出時はユーザーが「いいえ」で破棄する運用。
- TaskLedger の compaction metadata はチャット 1 リクエスト単位のタスクに紐づく。長期的な「依頼」単位の親子タスクと再開可能セッションは引き続き未実装。

#### テスト / 検証

- `npm test` で Jest 全体（31 スイート / 574 件）の通過を確認した。
- `npx tsc --noEmit` で TypeScript 型チェック通過を確認した。
- 主要スイート: `skillProposalStore` / `skillProposalSandbox` / `skillProposalLifecycle` / `dashboardSkillProposals` / `dashboardSkillProposalActions` / `memoryNudge` / `searchIndex` / `searchIndexHooks` / `dashboardSearch` / `ralphLoopLedger`。

#### リスク / 注意点

- 生成スキルはテスト通過 + 人間承認 + riskLevel 最低 medium + HIL / policy gate という多段の安全装置を持つが、`node:vm` は理論上の脱出経路が知られているため、信頼できない第三者からの提案コードをそのまま流し込む運用は想定しない。
- 提案がプロセスクラッシュで `testing` のまま残った場合は再テストまたは却下が可能（復旧経路を用意済み）。
- 会話検索インデックスは履歴トリミングで先頭メッセージが落ちるとメッセージ index ベースの文書 ID がずれて古い内容を上書きする。検索用途では実害は小さいが、厳密な監査用途には会話メッセージへの安定 ID 付与が必要。
- memory nudging の返信判定は短文（12 文字以下）の定型句に限定しているが、保留中に無関係な返信をすると nudge は破棄される仕様のため、後から保存したい場合は再度発話が必要。

### 2026-06-09: Phase 1 完了（MemoryStore / JSON Tool Policy）

#### 完了

- SQLite + FTS5 ベースの `MemoryStore` を追加し、`fact`、`preference`、`project`、`task`、`episodic` の種別、`importance`、`confidence`、`sourceSessionId`、`lastVerifiedAt`、`stale`、metadata を管理できるようにした。
- 既存の `memorySet` / `memoryGet` / `memoryList` を SQLite store の互換 wrapper に切り替え、追加で `memoryUpsert`、`memorySearch`、`memoryForget`、`memoryExplain` スキルを登録した。
- `policy.json` または `TOOL_POLICY_FILE` からスキル承認ポリシーを読み込み、skill、risk level、person、channel、argument pattern、UTC schedule 条件に応じて `alwaysAllow`、`allowWithDryRun`、`requireApproval`、`deny`、`allowForSession` を評価できるようにした。
- Human-in-the-Loop gate を JSON policy 評価に接続し、HIL が未有効でも policy の `deny` を即時拒否、`requireApproval` を承認待ちとして扱えるようにした。
- ダッシュボードのスキル一覧 API / UI に承認ポリシーの mode / rule を表示し、スキルごとのリスク、メトリクス、承認制御を同じカードで確認できるようにした。
- Phase 1 の未完了チェック項目（MemoryStore とスキル承認ポリシー JSON 化）を完了に更新した。

#### 未完了 / Phase 2 以降で継続

- Memory nudging、semantic search、SkillProposal は Phase 2 の学習・改善ループとして継続する。
- Tool Policy Engine の dry-run 差分表示、組織固有 redaction rule、セッション単位 allowForSession の期限管理は Phase 2 / 3 の運用 UX として拡張する。
- MemoryStore は Node.js `node:sqlite` / FTS5 を優先利用する。`node:sqlite` がない runtime では互換 JSON backend にフォールバックするため CI は通るが、長期運用では SQLite 対応 Node または正式 DB backend を使う必要がある。

#### テスト / 検証

- `npm test -- --runTestsByPath __tests__/unit/memoryStore.test.ts __tests__/unit/toolPolicy.test.ts` で MemoryStore と JSON policy の単体テスト通過を確認する。
- `npx tsc --noEmit` で TypeScript 型チェック通過を確認する。

#### リスク / 注意点

- `allowWithDryRun` は現時点で decision と表示の土台であり、実際の dry-run 差分生成は各スキル / backend 側の対応が必要。
- `allowForSession` は現時点では許可 decision として扱う。セッション単位の期限・取り消し管理は正式なセッション policy store が必要。

### 2026-06-09: Phase 1 継続（Identity ダッシュボード）

#### 完了

- `IdentityStore` にチャネル ID 一覧取得 API を追加し、ダッシュボード側で `personId` と `channelKey` を結合できるようにした。
- `/api/dashboard/identities` を追加し、人物、紐付いたチャネル、実行中タスク数、最近のタスクを返すようにした。
- ダッシュボードに人物 / チャネル / タスクのカード表示を追加し、LINE / Discord / API の同一人物に紐付いた状態と直近作業を確認できるようにした。
- Identity ダッシュボード API と `IdentityStore` のチャネル一覧取得の単体テストを追加した。

#### 未完了 / 次に小さく切る issue

- Identity linking の UX / API: LINE と Discord を同一人物として手動または認証コードで紐付ける操作を追加する。現状は同一チャネル ID の安定解決と `linkIdentity` API / 表示 API の土台まで。
- Dashboard の人物詳細: 最近の記憶、承認履歴、スキル実行履歴へのドリルダウンリンクを追加する。
- 既存履歴移行: 旧 `line:<userId>` / `discord:<channelId>` 履歴を `person:<personId>` に移行または参照する互換レイヤーを検討する。

#### テスト / 検証

- `npm test -- --runTestsByPath __tests__/unit/identityStore.test.ts __tests__/api/dashboardIdentities.test.ts` で IdentityStore とダッシュボード identities API のテスト通過を確認した。
- `npx tsc --noEmit` で TypeScript 型チェック通過を確認した。

#### リスク / 注意点

- ダッシュボード表示はローカル JSON ストアの最新タスクを簡易集計している。長期運用ではページング、DB 化、人物詳細 API が必要。
- 自動リンクはまだ実装していないため、複数チャネルを同一人物としてまとめるには現状 `linkIdentity` を呼び出す管理操作が必要。


### 2026-06-09: Phase 1 継続（TaskLedger ダッシュボード UI）

#### 完了

- TaskLedger の一覧 API を状態、種別、人物、チャネル、更新期間で絞り込めるように拡張した。
- ダッシュボードに TaskLedger テーブルを追加し、タスクの状態、種別、タイトル / ID、人物 / チャネル、開始 / 終了時刻、メタデータ、エラー概要を確認できるようにした。
- TaskLedger の各行から該当 `taskId` でスキル実行履歴を絞り込める導線を追加し、TaskLedger と `skill_executions.json` の相互参照を UI から行えるようにした。
- スキル実行履歴フィルタにも `taskQuery` を追加し、特定タスクに紐づくスキル実行だけを直接検索できるようにした。
- TaskLedger のフィルタリング単体テストと `/api/dashboard/tasks` の API テストを追加した。

#### 未完了 / 次に小さく切る issue

- 停止 / 再開 API を TaskLedger と接続し、実行中タスクの cancellation / retry を状態遷移として扱う。
- Agent DAG / Parallel Runner 実装時に、DAG ノードごとの TaskLedger 親子関係、workspace、budget、retry 情報を正式な構造として保存する。
- TaskLedger とスキル実行履歴のリンクを URL クエリやアンカーにも反映し、共有可能な監査ビューにする。

#### テスト / 検証

- `npm test -- --runTestsByPath __tests__/unit/taskLedger.test.ts __tests__/api/dashboardTasks.test.ts` で TaskLedger と dashboard tasks API のテスト通過を確認する。
- `npx tsc --noEmit` で TypeScript 型チェック通過を確認する。

#### リスク / 注意点

- TaskLedger の一覧はローカル JSON の最新 1000 件に対する簡易検索であり、長期監査や複数プロセス統合には永続 DB / ページングが必要。
- スキル実行履歴へのリンクは現時点では画面内フィルタの更新であり、URL に状態は保存していない。

### 2026-06-09: Phase 1 継続（スキル実行プレビューの秘匿）

#### 完了

- スキル実行ログの引数 / 結果 / エラープレビューに共通の redaction helper を適用し、`password`、`apiKey`、`Authorization`、`token` などのキー配下の値を保存前に `[REDACTED]` へ置換するようにした。
- Bearer token、GitHub token、OpenAI-style `sk-...`、Slack `xox...`、`token=value` 形式など、文字列中に埋め込まれた代表的なシークレットもプレビュー保存前に秘匿するようにした。
- マスキング処理を `lib/toolPolicy/redaction.ts` に切り出し、今後の Tool Policy Engine の dry-run / 承認画面でも同じルールを再利用できる形にした。
- スキル実行ログの単体テストに、通常フィールドは残しつつ機密値が `argsPreview` / `resultPreview` に残らないことの検証を追加した。

#### 未完了 / 次に小さく切る issue

- redaction rule を `policy.json` または DB から拡張できるようにし、組織固有のキー名や送信先別の秘匿レベルを設定可能にする。
- 承認画面 / dry-run 表示にも同じ redaction helper を適用し、外部送信先・ファイル変更予定のプレビューとルールを統一する。
- 長期監査向けに、マスク済みプレビューと raw 実行データを保存しない設計を明文化し、必要ならば暗号化された別ストアを検討する。

#### テスト / 検証

- `npm test -- --runTestsByPath __tests__/unit/skillExecutionLog.test.ts` でスキル実行ログの単体テスト通過を確認する。
- `npx tsc --noEmit` で TypeScript 型チェック通過を確認する。

#### リスク / 注意点

- 現在の redaction はヒューリスティックであり、未知の秘密情報形式やドメイン固有キーを完全に検出するものではない。高リスクスキルの承認前には、ポリシー設定でキー名・引数スキーマ単位の明示マスクを追加する必要がある。
- プレビューは保存前にマスクされるため、デバッグ用途では値の形状のみ確認できる。実値が必要な監査フローは別途、権限制御された安全な保管設計が必要。

### 2026-06-08: Phase 1 継続（スキル実行履歴フィルタ）

#### 完了

- スキル実行ログの一覧取得に状態、人物、チャネル、タスク、承認、期間で絞り込めるクエリ API を追加した。
- ダッシュボードの `/api/dashboard/skill-executions` でスキルのリスクレベルを付与し、`riskLevel`、`status`、`personQuery`、`channelQuery`、`from`、`to` クエリを受け付けるようにした。
- ダッシュボードのスキル実行履歴に状態、リスク、人物、チャネル、期間フィルタとリスク列を追加した。
- スキル実行ログの単体テストにコンテキスト、状態、期間フィルタの検証を追加した。

#### 未完了 / 次に小さく切る issue

- OpenTelemetry span に `skill.name`、`policy.decision`、`approval.id`、`task.id` を付与し、JSON ログと外部テレメトリを相互参照できるようにする。
- `taskId` の正式な発行元として TaskLedger を実装し、会話 / スケジュール / サブエージェント単位で自動採番する。

#### テスト / 検証

- `npm test -- --runTestsByPath __tests__/unit/skillExecutionLog.test.ts` でスキル実行ログの単体テスト通過を確認する。
- `npx tsc --noEmit` で TypeScript 型チェック通過を確認する。

#### リスク / 注意点

- リスクフィルタは現在のスキル定義から実行時に付与しているため、過去実行時点のリスクレベル変更履歴は保持していない。
- ダッシュボードのフィルタはローカル JSON の最新 500 件に対する簡易検索であり、長期監査用には永続 DB / ページングが必要。

### 2026-06-08: Phase 1 継続（スキル実行ログ）

#### 完了

- スキル登録時に handler を計装し、成功・`isError`・例外・所要時間・引数/結果プレビューを `skill_executions.json` に記録する初期実装を追加した。
- ダッシュボードの `/api/dashboard/skills` レスポンスへスキル別メトリクスを追加し、未実行スキルにもゼロ値メトリクスを返すようにした。
- ダッシュボードのスキル一覧に実行回数、成功率、平均実行時間、最終実行時刻、直近エラーを表示するようにした。
- `SkillResult.isError` と throw された例外の両方を失敗として集計する単体テストを追加した。
- 実行時データ `skill_executions.json` を `.gitignore` に追加した。

#### 未完了 / 次に小さく切る issue

- スキル実行ログに `personId`、`channelKey`、`taskId`、`approvalId` を渡す呼び出しコンテキストを追加し、IdentityStore / TaskLedger / Human-in-the-Loop と接続する。
- 引数プレビューの秘匿・マスキングルールを Tool Policy Engine と共有する。
- OpenTelemetry span に `skill.name`、`policy.decision`、`approval.id`、`task.id` を付与し、JSON ログと外部テレメトリを相互参照できるようにする。
- ダッシュボードにスキル実行履歴の詳細テーブル、期間フィルタ、リスク別フィルタを追加する。

#### テスト / 検証

- `npm test -- --runTestsByPath __tests__/unit/skillExecutionLog.test.ts` でスキル実行ログの単体テスト通過を確認する。
- `npx tsc --noEmit` で TypeScript 型チェック通過を確認する。

#### リスク / 注意点

- 現時点では引数と結果は短いプレビューに切り詰めるだけで、機密値のキー単位マスキングは未実装。高リスクスキルや外部送信を扱う前にポリシー連動の秘匿処理が必要。
- メトリクスはローカル JSON の最新 500 件から算出する簡易実装であり、長期集計や複数プロセス統合は未対応。

### 2026-06-08: Phase 1 着手

#### 完了

- `IdentityStore` の初期実装を追加した。`line:<userId>`、`discord:<userId>`、`api:<subject>` のようなチャネル別 ID を `personId` に紐付け、`person:<personId>` 形式の会話キーを返せるようにした。
- LINE Bot の通常チャット履歴を `IdentityStore` 経由の person-scoped conversation key で保存するように変更した。Wizard などのチャネル別 UX は従来どおり `channelKey` を使う。
- Discord Bot の通常チャット履歴を `IdentityStore` 経由の person-scoped conversation key で保存するように変更した。Discord username は `displayName` として保存する。
- `AgentPlan`、`AgentPlanStatus`、`AgentPlanProgress` の型を追加し、DAG / 並列 Runner のデータモデルに着手した。
- `IdentityStore` の単体テストを追加し、同一チャネル ID の安定解決、複数チャネルの同一人物リンク、person-scoped conversation key、入力正規化を検証した。
- 実行時データ `identities.json` を `.gitignore` に追加した。

#### 未完了 / 次に小さく切る issue

- Identity linking の UX / API: LINE と Discord を同一人物として手動または認証コードで紐付ける操作を追加する。現状は同一チャネル ID の安定解決と `linkIdentity` API の土台まで。
- API チャネル統合: HTTP / SSE API から `api:<subject>` を解決し、同じ `personId` / TaskLedger / memory に接続する。
- Dashboard 表示: 人物、紐付いたチャネル、進行中タスク、最近の記憶を表示する。
- 既存履歴移行: 旧 `line:<userId>` / `discord:<channelId>` 履歴を `person:<personId>` に移行または参照する互換レイヤーを検討する。
- Agent DAG runner: 今回は型定義のみ。依存解決、`Promise.allSettled` 並列実行、workspace 割り当て、失敗ノードのリトライは未実装。

#### テスト / 検証

- `npm test` で Jest 全体を実行し、全テスト通過を確認した。
- `npx tsc --noEmit` で TypeScript 型チェック通過を確認した。

#### リスク / 注意点

- person-scoped conversation key へ切り替えたため、旧 channel-scoped 履歴との連続性は移行処理を追加するまで限定的になる。
- Discord は従来 channel 単位の履歴だったが、今回の初期実装では user 単位の identity を使う。複数チャンネルでの会話分離が必要な場合は `personId` と `channelKey` を併用した task/session ledger が必要。
- 高リスクな自律実行は今回実装していない。今後の DAG runner / watcher / remote runtime 実装時は Tool Policy Engine または Human-in-the-Loop を経由する。


### 2026-06-08: Phase 1 継続（スキル実行コンテキスト / 履歴詳細）

#### 完了

- `AsyncLocalStorage` ベースのスキル実行コンテキストを追加し、`personId`、`channelKey`、`taskId`、`approvalId` をスキル実行ログへ記録できるようにした。
- HTTP / SSE API チャネルで `api:<subject>` を `IdentityStore` に解決し、スキル実行時に person-scoped なコンテキストを渡すようにした。
- LINE / Discord の通常チャットおよびウィザード実行で、既存の `IdentityStore` 解決結果をスキル実行コンテキストへ接続した。
- Human-in-the-Loop 承認リクエスト作成時に現在の人物 / チャネル情報を `requestedBy` として渡し、生成された承認 ID をスキル実行ログへ紐付けるようにした。
- ダッシュボード API に `/api/dashboard/skill-executions` を追加し、ダッシュボードのスキル一覧に直近の実行履歴詳細テーブルを表示するようにした。
- スキル実行ログの単体テストにコンテキスト項目の記録検証を追加した。

#### 未完了 / 次に小さく切る issue

- `taskId` の正式な発行元として TaskLedger を実装し、API から任意に渡すだけでなく会話 / スケジュール / サブエージェント単位で自動採番する。
- ダッシュボードのスキル実行履歴に期間フィルタ、リスク別フィルタ、人物 / チャネル検索を追加する。
- 引数 / 結果プレビューの秘匿・マスキングルールを Tool Policy Engine と共有する。
- OpenTelemetry span に `skill.name`、`policy.decision`、`approval.id`、`task.id` を付与し、JSON ログと外部テレメトリを相互参照できるようにする。

#### テスト / 検証

- `npm test -- --runTestsByPath __tests__/unit/skillExecutionLog.test.ts` でスキル実行ログの単体テスト通過を確認する。
- `npx tsc --noEmit` で TypeScript 型チェック通過を確認する。

#### リスク / 注意点

- API チャネルの `subject` は現時点ではリクエスト本文または `x-copharness-subject` ヘッダーの自己申告値であり、認証主体との厳密なバインドは未実装。
- `taskId` はまだ TaskLedger に裏付けられていないため、監査や停止 / 再開の単位として使うには追加実装が必要。
- 引数と結果の秘匿は従来どおり短いプレビューへの切り詰めのみであり、キー単位マスキングは未実装。

## 受け入れ条件

- [ ] 上記提案から Phase 1 の実装対象を小さな issue に分割できる。
- [ ] 各 issue に目的、実装方針、テスト方針、リスクが記載されている。
- [ ] 高リスクな自律実行機能は Tool Policy Engine または Human-in-the-Loop を経由する。
- [ ] ダッシュボードまたはログで実行履歴を追跡できる。

## 補足

この issue は、OpenClaw の常駐実行・日常チャット操作の方向性と、Hermes Agent の学習ループ・長期記憶・並列サブエージェントの方向性を参考に、CopHarness の既存構成へ段階的に取り込むための親 issue として扱う。

### 2026-06-08: Phase 1 継続（TaskLedger による自動 taskId 発行）

#### 完了

- `TaskLedger` を追加し、会話 / API / ウィザード実行ごとの `taskId`、人物、チャネル、会話キー、状態、開始 / 終了時刻、エラープレビューを `task_ledger.json` に保存できるようにした。
- HTTP / SSE API で `taskId` が未指定の場合もサーバー側で自動発行し、スキル実行コンテキストとレスポンス / SSE エラーに紐付けるようにした。既存クライアントが `taskId` を渡した場合は、その ID を TaskLedger に採用する。
- LINE / Discord の通常チャットとウィザード実行で TaskLedger タスクを開始 / 成功 / 失敗として記録し、スキル実行ログの `taskId` と相互参照できるようにした。
- ダッシュボード API に `/api/dashboard/tasks` を追加し、直近タスクの状態を取得できるようにした。
- `task_ledger.json` を `.gitignore` に追加し、実行時データをリポジトリへ混入させないようにした。
- TaskLedger の単体テストを追加し、自動 ID 発行、外部 ID 採用、成功 / 失敗状態の記録を検証した。

#### 未完了 / 次に小さく切る issue

- ダッシュボード UI に TaskLedger の一覧、状態フィルタ、人物 / チャネル検索、関連スキル実行ログへのリンクを追加する。
- スケジューラーとサブエージェント実行にも TaskLedger を接続し、`schedule` / `agent` kind のタスクを自動発行する。
- 停止 / 再開 API を TaskLedger と接続し、実行中タスクの cancellation / retry を状態遷移として扱う。
- OpenTelemetry span と JSON ログへ `task.id` を付与し、TaskLedger、スキル実行ログ、外部テレメトリを横断参照できるようにする。

#### テスト / 検証

- `npm test -- --runTestsByPath __tests__/unit/taskLedger.test.ts __tests__/unit/skillExecutionLog.test.ts` で TaskLedger と既存スキル実行ログの単体テスト通過を確認した。
- `npm test` で Jest 全体を実行し、全テスト通過を確認した。
- `npx tsc --noEmit` で TypeScript 型チェック通過を確認した。

#### リスク / 注意点

- タスクの粒度は現時点では LLM への 1 リクエスト単位であり、長期的な「依頼」単位の親子タスクや再開可能セッションは未実装。
- SSE はストリーム開始前に TaskLedger へ記録するため、クライアント切断時の状態は adapter / stream 側の例外伝播に依存する。
- `taskId` は監査相関用に発行されるが、停止 / 再開 / 認可判定の正式な制御単位として使うには追加実装が必要。

### 2026-06-08: Phase 1 継続（OpenTelemetry スキル相関）

#### 完了

- スキル実行ごとに `skill.execute` span を発行し、`skill.name`、`skill.risk_level`、`skill.execution.id`、`skill.status` を付与するようにした。
- スキル実行コンテキストの `personId` / `channelKey` / `taskId` / `approvalId` を `person.id`、`channel.key`、`task.id`、`approval.id` として span に反映し、JSON のスキル実行ログとテレメトリを相互参照できるようにした。
- Human-in-the-Loop の承認待ち / 承認 / 拒否 / タイムアウト結果を `policy.decision` と `approval.status` に反映できるようにした。
- スキル実行ログの単体テストに、span 属性と実行ログ ID の相関検証を追加した。

#### 未完了 / 次に小さく切る issue

- 引数 / 結果プレビューの秘匿・マスキングルールを Tool Policy Engine と共有する。
- OpenTelemetry の親子 span（LLM completion → skill.execute → backend execution）を維持するため、trace context を `AsyncLocalStorage` に拡張する。
- Tool Policy Engine の正式導入後、`policy.decision` を provisional な文字列ではなくポリシー評価結果オブジェクト由来に切り替える。

### 2026-06-08: Phase 1 継続（スケジューラー / サブエージェント TaskLedger 接続）

#### 完了

- スケジューラー実行時に `schedule` kind の TaskLedger タスクを自動発行し、スケジュール ID、スケジュール名、発火理由、通知先チャネルキーを記録するようにした。
- スケジュール実行中のスキル / adapter 呼び出しへ `taskId` と `channelKey` を AsyncLocalStorage コンテキストとして渡し、スキル実行ログと TaskLedger を相互参照できるようにした。
- スケジュールの AbortError は `cancelled`、その他の例外は `failed` として TaskLedger に記録するようにした。
- サブエージェント実行時に `agent` kind の TaskLedger タスクを自動発行し、親スキル実行コンテキストの `personId`、`channelKey`、親 `taskId` を継承するようにした。
- A2A エンドポイントから渡された task ID を Agent TaskLedger の ID として採用し、レスポンス ID と TaskLedger ID を一致させるようにした。
- スケジューラー / サブエージェント TaskLedger 接続の単体テストを追加した。

#### 未完了 / 次に小さく切る issue

- ダッシュボード UI に TaskLedger の一覧、状態フィルタ、人物 / チャネル検索、関連スキル実行ログへのリンクを追加する。
- 停止 / 再開 API を TaskLedger と接続し、実行中タスクの cancellation / retry を状態遷移として扱う。
- Agent DAG / Parallel Runner 実装時に、DAG ノードごとの TaskLedger 親子関係、workspace、budget、retry 情報を正式な構造として保存する。

#### テスト / 検証

- `npm test -- --runTestsByPath __tests__/unit/taskLedger.test.ts __tests__/unit/skillExecutionLog.test.ts __tests__/unit/taskLedgerIntegration.test.ts` で TaskLedger、スキル実行ログ、スケジューラー / サブエージェント統合テストの通過を確認した。
- `npx tsc --noEmit` で TypeScript 型チェック通過を確認した。

#### リスク / 注意点

- スケジュールの `discordChannelId` はユーザー ID ではなく通知先チャンネルであるため、現時点では `personId` ではなく `discord-channel:<id>` の `channelKey` として記録する。
- サブエージェントの親子関係は `metadata.parentTaskId` に保存しており、TaskLedger の正式な親子インデックスや DAG 可視化は未実装。
