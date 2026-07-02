# CopHarness GitHub Issue 投稿候補

このドキュメントは、CopHarness の現状機能と既存ロードマップを踏まえ、GitHub Issues に個別投稿しやすい粒度へ分割した改善・拡張案をまとめる。

> **投稿済み（2026-06-29）**: 本ドキュメントの Issue 1〜10 は GitHub Issue **#88〜#97** として投稿済み。
> トリアージ状況は `issue-triage-2026-07-02.md` を参照（#88 は実装済みでクローズ、#89 / #92 / #94 / #96 は部分実装）。

## 前提

CopHarness は既に CLI、Discord Bot、LINE Bot、HTTP API、SSE ストリーミング、ダッシュボード、スケジューラー、スキル、MCP クライアント、マルチエージェント、OpenTelemetry、Human-in-the-Loop を備えている。

既存の `docs/issues/openclaw-hermes-agent-improvement-ideas.md` では大きなロードマップが整理されており、Phase 1 から Phase 3 の多くは完了済みである。そのため、今後の GitHub Issue は、巨大な構想ではなく、実装・レビュー・テストしやすい小〜中サイズの改善に分割する。

## Issue 1: `searchInFiles` を remote backend / isolated workspace に対応させる

### Title

Support remote backend execution for `searchInFiles`

### Background

Remote Runtime / Isolated Workspace の流れで `readFile` や `listDirectory` は backend 経由へ統合済みだが、`searchInFiles` は local 直接アクセスの既知制限として残っている。remote backend を利用する運用では、検索だけが local workspace を参照すると、安全性・一貫性・監査性が崩れる。

### Proposal

- `searchInFiles` を `ExecutionBackend` 経由で実行できるようにする。
- local / docker / ssh backend で同等の検索結果形式を返す。
- `EXECUTION_ALLOWED_PATHS` を検索対象にも適用する。
- remote backend では `rg` または `grep` 相当の検索コマンドを安全に組み立てる。
- 検索結果の最大件数、最大バイト数、タイムアウトを制限する。

### Acceptance Criteria

- local backend の既存挙動が壊れない。
- docker backend で許可パス内のファイル検索ができる。
- ssh backend で許可パス内のファイル検索ができる。
- 許可パス外を検索しようとすると拒否される。
- 検索結果の上限とタイムアウトがテストされている。
- Jest テストが追加されている。

### Priority

High

## Issue 2: Tool Policy Engine に dry-run / diff preview を追加する

### Title

Add dry-run and diff preview support to tool policy approvals

### Background

Human-in-the-Loop 承認は導入済みだが、承認者が「何を承認するのか」を判断しやすくするには、実行予定の差分、外部送信先、ファイル変更予定などの preview が必要である。

### Proposal

- `writeFile`、`runCommand`、外部送信系スキルなどに dry-run メタデータを追加する。
- approval request に対象ファイル、変更予定 diff、実行予定コマンド、外部送信先、risk attribute を含める。
- Dashboard の承認 UI で preview を表示する。
- `allowWithDryRun` のような approval mode を policy evaluation に接続する。
- preview を生成できない操作では、その理由を明示する。

### Acceptance Criteria

- 危険スキルの承認前に実行内容を確認できる。
- ファイル書き込み系スキルでは diff preview が表示される。
- 外部送信系スキルでは送信先 preview が表示される。
- preview が approval log に保存される。
- 既存の `requireApproval` の挙動を壊さない。

### Priority

High

## Issue 3: GitHub Issue / PR watcher を実運用向けに強化する

### Title

Improve GitHub watcher workflows for issues and pull requests

### Background

Watcher / event trigger の初期実装は完了しているが、GitHub issue や pull request を実運用で扱うには、payload 正規化、条件指定、TaskLedger 連携、Dashboard 表示が必要である。

### Proposal

- GitHub issue / PR webhook payload を正規化する。
- `issue opened`、`issue labeled`、`issue assigned`、`issue comment created`、`pull_request opened`、`pull_request review requested` に対応する。
- Watcher から TaskLedger に repository、issue / PR number、author、labels、linked taskId を保存する。
- ラベル、author、branch、event type などで watcher 条件を指定できるようにする。
- Dashboard から GitHub watcher の最近のイベントと実行結果を確認できるようにする。

### Acceptance Criteria

- GitHub webhook payload のユニットテストがある。
- issue opened でタスクが作成される。
- PR opened でレビュー用タスクが作成される。
- ラベル条件で watcher を絞り込める。
- TaskLedger から元 issue / PR へ戻れる。

### Priority

Medium to High

## Issue 4: Observability に cost / token / skill success rate の時系列ビューを追加する

### Title

Add time-series observability for cost, token usage, and skill success rates

### Background

OpenTelemetry、token usage、skill execution log などの基盤があるため、運用時に重要な指標を Dashboard で時系列表示できると、コスト管理、障害調査、品質改善に役立つ。

### Proposal

- Dashboard に token usage、estimated cost、skill execution count、skill success / failure rate、approval requested / approved / rejected count、provider latency の時系列グラフを追加する。
- 期間フィルタとして 1h、24h、7d、30d を用意する。
- taskId、personId、skillName、provider でフィルタ可能にする。
- データがない場合の empty state を用意する。

### Acceptance Criteria

- 既存の telemetry / logs / token usage API を再利用する。
- Dashboard で 24h / 7d の切り替えができる。
- データがない場合に分かりやすい empty state が表示される。
- 既存 API の互換性を壊さない。

### Priority

Medium

## Issue 5: Eval を CI gate として強化する

### Title

Strengthen eval runner as a CI quality gate

### Background

`npm run eval` は存在しているが、CI gate として運用するには、構造化出力、閾値判定、deterministic eval と LLM eval の分離、flaky eval 対策が必要である。

### Proposal

- eval の結果を JSON / JUnit 形式で出力する。
- CI で fail させる閾値を設定可能にする。
- 変更されたスキルだけを対象にした smoke eval を追加する。
- LLM API key が必要な eval と不要な deterministic eval を分離する。
- flaky eval の retry / quarantine を導入する。

### Acceptance Criteria

- `npm run eval -- --json` のような形式で構造化出力できる。
- CI で pass / fail 判定できる。
- LLM API key がない環境でも deterministic eval は実行できる。
- README または docs に CI での使い方が追加される。

### Priority

Medium

## Issue 6: HTTP API の request / response schema と OpenAPI を整備する

### Title

Document and validate HTTP API schemas with OpenAPI

### Background

`POST /api/copilot` は `messages`、`attachments`、`timeoutMs`、`skills`、`subject`、`displayName`、`taskId` などを受け取る。外部アプリから安定して利用するには、OpenAPI 定義と runtime validation が必要である。

### Proposal

- HTTP API の request / response schema を OpenAPI として定義する。
- `messages`、`attachments`、`skills`、`subject` などを runtime validation する。
- エラー形式を統一する。
- `/api/health`、`/api/copilot`、`/api/copilot/stream`、主要 dashboard API の一部を docs に掲載する。
- API client 生成を可能にする。

### Acceptance Criteria

- OpenAPI JSON または YAML が追加される。
- `POST /api/copilot` の schema validation が追加される。
- invalid request のテストがある。
- README または docs から API 仕様にリンクされる。

### Priority

Medium

## Issue 7: Provider fallback / health check の状態を Dashboard から操作可能にする

### Title

Add provider fallback and health-check controls to dashboard

### Background

CopHarness は複数 LLM provider に対応している。運用時には、provider ごとの health、fallback order、直近エラー、一時 disable を Dashboard から確認・操作できると便利である。

### Proposal

- Dashboard で provider の health status を表示する。
- provider ごとの model、timeout、rate-limit 状態を表示する。
- fallback order を設定可能にする。
- provider ごとの直近エラーを確認できるようにする。
- 一時的に provider を disable できるようにする。

### Acceptance Criteria

- health check API が provider 別の状態を返す。
- Dashboard に provider status panel が追加される。
- provider disable 設定が fallback に反映される。
- 既存の環境変数ベースの provider 解決と互換性がある。

### Priority

Medium

## Issue 8: TaskLedger の artifact 管理を強化する

### Title

Improve TaskLedger artifact tracking and browsing

### Background

TaskLedger は task の継続性を支える重要な基盤である。長時間タスクやマルチエージェント実行では、progress.md / progress.json 以外の成果物も task と紐付けて参照できる必要がある。

### Proposal

- TaskLedger artifact に type、path、mimeType、createdBy、checksum、preview を追加する。
- Dashboard から artifacts を一覧・プレビューできるようにする。
- Agent DAG ノードごとの artifacts を親 task に集約する。
- artifact の保存場所と参照権限を整理する。

### Acceptance Criteria

- TaskLedger metadata に artifact schema が追加される。
- Dashboard の task detail で artifact が見える。
- artifact が存在しない場合の empty state がある。
- 既存 task metadata と後方互換性がある。

### Priority

Medium

## Issue 9: Memory の stale / verification workflow を実装する

### Title

Add stale memory verification workflow

### Background

長期記憶は便利だが、古くなった情報や信頼度が低い情報をそのまま使うと誤回答につながる。`lastVerifiedAt` や `stale` を使った検証 workflow が必要である。

### Proposal

- 古くなった memory を stale としてマークする。
- stale memory を回答に使う際、LLM に未検証情報として扱わせる。
- Dashboard で stale memory を確認・再検証・削除できるようにする。
- watcher / scheduler で定期再検証できるようにする。

### Acceptance Criteria

- memory に `lastVerifiedAt` / `stale` の扱いがある。
- stale memory search の結果に warning が含まれる。
- Dashboard または API から再検証済みにできる。
- 関連テストが追加されている。

### Priority

Medium

## Issue 10: Generated skill の安全な依存管理を追加する

### Title

Add dependency and permission model for generated skills

### Background

Self-Improving Skills により generated skill を作れるようになると、依存 package、権限、環境変数、network access を安全に管理する必要がある。

### Proposal

- generated skill ごとに manifest を持たせる。
- manifest に name、version、riskLevel、required permissions、allowed env、allowed network destinations、required npm dependencies を含める。
- dependency install を禁止 / allowlist / isolated install から選べるようにする。
- approval UI に dependency と permission を表示する。
- 生成スキルの更新履歴を保存する。

### Acceptance Criteria

- generated skill manifest schema が追加される。
- manifest validation がある。
- 未承認 dependency を使う generated skill は登録されない。
- 既存 generated skill の互換 migration がある。

### Priority

Medium to High

## 投稿運用メモ

このファイルは Issue 投稿前の下書きとして使う。実際に GitHub Issues へ投稿するときは、各 Issue セクションを個別にコピーし、Title と本文を分けて登録する。

GitHub CLI が利用できる環境では、例えば次のように投稿できる。

```bash
gh issue create \
  --title "Support remote backend execution for searchInFiles" \
  --body-file issue-search-in-files-remote-backend.md
```
