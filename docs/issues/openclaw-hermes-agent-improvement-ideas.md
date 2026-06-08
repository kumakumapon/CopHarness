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

- [x] IdentityStore によるチャネル横断ユーザー統合（初期実装完了。LINE / Discord の通常チャット履歴を `personId` ベースの会話キーへ接続）
- [ ] SQLite / FTS ベースの MemoryStore
- [x] スキル実行ログと成功率の可視化（初期実装完了。`skill_executions.json` に実行ログを保持し、ダッシュボードのスキル一覧で実行回数・成功率・平均時間・直近エラーを表示）
- [ ] スキル承認ポリシーの JSON 化
- [x] AgentPlan DAG 型の定義（`AgentPlan` / `AgentPlanProgress` の型定義を追加。Runner 実装は Phase 3 の「並列 Agent DAG runner」で継続）

### Phase 2: 学習・改善ループ

- [ ] SkillProposal ストア
- [ ] スキル生成 → テスト → 承認 → 登録フロー
- [ ] memory nudging
- [ ] 会話・タスクの semantic search
- [ ] TaskLedger と Ralph Loop の統合

### Phase 3: 常駐・自律実行

- [ ] event trigger / watcher
- [ ] Docker / SSH backend
- [ ] 並列 Agent DAG runner
- [ ] toolset / MCP hub
- [ ] モバイルチャットからの進捗確認・停止・承認

## 実装進捗

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

## 受け入れ条件

- [ ] 上記提案から Phase 1 の実装対象を小さな issue に分割できる。
- [ ] 各 issue に目的、実装方針、テスト方針、リスクが記載されている。
- [ ] 高リスクな自律実行機能は Tool Policy Engine または Human-in-the-Loop を経由する。
- [ ] ダッシュボードまたはログで実行履歴を追跡できる。

## 補足

この issue は、OpenClaw の常駐実行・日常チャット操作の方向性と、Hermes Agent の学習ループ・長期記憶・並列サブエージェントの方向性を参考に、CopHarness の既存構成へ段階的に取り込むための親 issue として扱う。
