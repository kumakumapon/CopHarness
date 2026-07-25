# 実装レビュー記録（2026-07-25）

`main`（`817c22c`）時点のリポジトリ全体を対象に、「実装が README に書かれた目的を満たしているか」「看過できない問題がないか」を観点にレビューを実施した。
新規 issue 10 件（#117〜#126）を起票し、既存 issue 2 件（#92 / #98）の実装状況を更新した。

## 実行した検証

| 検証 | コマンド | 結果 |
|---|---|---|
| 型チェック | `npx tsc --noEmit` | pass（エラーなし） |
| Lint | `npm run lint` | pass（警告なし） |
| テスト | `npm test` | pass（69 suites / 1173 tests） |
| ビルド | `npm run build` | pass |
| 依存脆弱性 | `npm audit --production` | **13 件（high 7 / moderate 6）** |

型・lint・テスト・ビルドはすべて通っており、コードベースの基礎的な健全性は保たれている。以下の指摘は静的解析やテストでは検出できない層のもの。

## 目的達成度の評価

README が掲げる機能は、おおむね実装されている。

| 機能 | 状態 |
|---|---|
| CLI / Discord Bot / LINE Bot | 実装済み |
| HTTP API / ストリーミング API | 実装済み |
| ダッシュボード | 実装済み |
| スケジューラー | 実装済み（cron 検証に難あり → #122） |
| スキル（ツール呼び出し） | 実装済み（53 スキル登録） |
| MCP クライアント | 実装済み |
| マルチエージェント / A2A | 実装済み（認証なし → #117） |
| OpenTelemetry | 実装済み |
| Human-in-the-Loop / Tool Policy | 実装済み |
| **Slack チャネル** | **payload 正規化ヘルパーのみ。Bot は未実装（#98 / #123）** |

「マルチプロバイダ LLM ハーネス」としての目的は満たしている。一方で、README が「実験的プロジェクト・本番利用非推奨」と断っていることを踏まえてもなお、**外部公開時の防御が機能の広がりに追いついていない**のが全体を通じた所見である。認証の掛け忘れ（#117 / #118）、SSRF ガードの不在（#119）、サンドボックス境界の不整合（#120）は、いずれも個別の実装ミスというより「新しい入口を足すたびに防御の適用を人手で思い出す」構造に起因している。CI で網羅性を検査する仕組み（#117 / #121 / #123 の再発防止項目）を入れるのが根本対応になる。

## 新規 issue

### セキュリティ

| Issue | 内容 | 優先度 |
|---|---|---|
| #117 | `POST /api/a2a` に認証もレート制限もない。`COPHARNESS_API_KEY` 設定下でも素通りし、任意 systemPrompt / skills でエージェントを起動できる | high |
| #118 | `/api/dashboard/events` が未認証。SSE で `skill:start` のスキル引数を**マスクせず**配信し、POST で履歴も返す | high |
| #119 | `fetchUrl` 他の外向き HTTP にプライベート IP / リンクローカル宛のガードがない。クラウドメタデータ（169.254.169.254）に到達可能 | high |
| #120 | `runCommand` がファイルサンドボックス外の任意パスを読める（`cat .env.local` が通る）。あわせて `getEnvVariable` の riskLevel 分類の不整合 | high |
| #125 | 生成スキルの `node:vm` サンドボックスにホスト realm の intrinsics を注入しており、既知のエスケープ経路が残っている | medium |
| #126 | レート制限のキーが偽装可能な `X-Forwarded-For` のみ | medium |

### バグ

| Issue | 内容 | 優先度 |
|---|---|---|
| #121 | 組み込み toolset が未登録スキル名を参照。`coding` の `markdownToHtmlSkill`（正しくは `markdownToHtml`）、`personal` の `memorySet` / `memoryGet` / `memoryList`（未登録）。無言で欠落する | medium |
| #122 | `isValidCronInput` が 5 トークンあれば何でも通す。`"0 25 * * *"` が登録でき、永久に発火しないスケジュールになる | medium |

### ドキュメント / CI

| Issue | 内容 | 優先度 |
|---|---|---|
| #123 | README と実装の乖離。`ENABLED_SKILLS` 未設定時の挙動が逆（実際は低リスクのみ有効）、存在しない memory スキルの掲載、未実装の Slack Bot の案内 | medium |
| #124 | CI に型チェック・ビルド・依存脆弱性スキャンがない。high 7 件（`next` の Middleware bypass を含む）が未対応、Dependabot も未設定 | high |

## 既存 issue の更新

| Issue | 更新内容 |
|---|---|
| #92 | #114 のマージで JSON / JUnit 出力と README 記載が完了したため AC をチェック済みに更新。あわせて「eval が CI ワークフローに組み込まれていない」を新たな AC として追加（deterministic / LLM eval の分離が前提となる旨も明記） |
| #98 | `lib/channels/slack.ts` の `normalizeSlackEvent` が実装済みである一方、呼び出し元が存在しないデッドコードであること、署名検証と webhook エンドポイントが未実装であることを追記。`status:partially-implemented` を付与 |

`#94`（provider health panel）と `#96`（stale memory workflow）は 2026-07-02 のトリアージ記載から状況が変わっていないため、更新なし。

## 重複確認

新規 issue と既存 open issue の間に完全な重複はない。近接領域は以下のとおり。

- #117 / #118（既存エンドポイントの認証欠落） ↔ #102（ユーザー別 API キーとスコープ設計）— 前者は「今ある穴を塞ぐ」、後者は「認証基盤を作り直す」。前者が先行すべき。
- #126（レート制限キーの偽装） ↔ #102（キー単位 rate limit）— 実装時に統合するのが自然。
- #125（生成スキルのサンドボックス） ↔ #97（generated skill の manifest / permission model）— 権限モデルと実行境界は別レイヤー。
- #121（toolset のスキル名不整合） ↔ #123（README のスキル記載）— `memorySet` / `memoryGet` / `memoryList` の扱いは両者で同じ判断が必要。
- #124（CI 整備） ↔ #92（eval の CI gate）— どちらも `.github/workflows/ci.yml` を触る。
