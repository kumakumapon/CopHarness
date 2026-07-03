# GitHub Issue トリアージ記録（2026-07-02）

open issue 18 件（#88〜#105）を対象に、コードベースの実装状況と照合してトリアージを実施した。
実施内容: 実装済み issue のクローズ、部分実装の Acceptance Criteria への反映、優先度ラベルの付与、関連 issue の相互リンク。

## ラベル体系

- `priority:high` / `priority:medium` — 本文の Priority 記載をラベル化（Medium to High は `priority:high` に寄せた）
- `status:partially-implemented` — 一部がすでに実装済みで、本文に現状メモを追記した issue

## 結果一覧

| Issue | タイトル（要約） | 状態 | 優先度 | 備考 |
|---|---|---|---|---|
| #88 | searchInFiles の remote backend 対応 | **クローズ（completed）** | - | PR #106 で実装済み（backend 経由 + timeout / サイズ上限 + Jest テスト） |
| #89 | Tool policy の dry-run / diff preview | open（部分実装） | high | PR #107 で大半実装済み。残: 外部送信系スキルの preview |
| #90 | GitHub watcher の実運用強化 | open（部分実装） | high | webhook 受信 + 署名検証は実装済み。残: payload 正規化・条件指定・TaskLedger 連携・Dashboard 表示 |
| #91 | cost / token / success rate の時系列ビュー | open | medium | データソース API（costs / token-usage / telemetry / skill-executions）は既存。#94・#105 とスコープ境界を明記 |
| #92 | Eval の CI gate 強化 | open（部分実装） | medium | 閾値判定 + exit code は実装済み（`lib/eval/ciGate.ts`）。残: JSON / JUnit 出力・smoke eval・deterministic 分離・flaky 対策 |
| #93 | HTTP API の OpenAPI 整備 | open | medium | 未実装。#102 とスコープ分離（schema / docs は本 issue、認証は #102） |
| #94 | Provider fallback / health check 操作 | open（部分実装） | medium | health check API は実装済み（`/api/dashboard/health-check`）。残: Dashboard panel・fallback 設定・disable |
| #95 | TaskLedger の artifact 管理 | open | medium | 未実装 |
| #96 | Stale memory 検証 workflow | open（部分実装） | medium | `lastVerifiedAt` / `stale` カラムとフィルタは実装済み。残: warning・再検証 UI / API・定期再検証 |
| #97 | Generated skill の依存・権限モデル | open | high | 未実装。承認 UI 表示は #89（PR #107）の preview 基盤を再利用可能 |
| #98 | Slack Bot チャネル | open | high | 未実装 |
| #99 | チャットチャネルのストリーミング表示 | open | medium | 未実装 |
| #100 | Embedding セマンティック検索（RAG） | open | high | 未実装 |
| #101 | Dockerfile / docker-compose | open | medium | 未実装 |
| #102 | ユーザー別 API キーとスコープ | open | high | 未実装。置き換えポイントは `lib/apiAuth.ts`。#93 と関連 |
| #103 | DATA_DIR の retention / backup | open | medium | 未実装 |
| #104 | アダプタ共通 structured output | open | medium | 未実装 |
| #105 | コスト・トークンの budget enforcement | open | high | `AgentPlan.budget` は既存。残: 設定・ブロック・warning・HIL 連携・Dashboard 表示。#91 と補完関係 |

## 重複について

open issue 間に完全な重複はなかった。近接領域は以下のとおりスコープ境界をコメントで明記した。

- #91（可視化 = 見る） ↔ #105（budget enforcement = 止める）
- #91（provider latency の時系列） ↔ #94（現在時点の health / 操作系）
- #89（dry-run preview 基盤） ↔ #97（manifest の承認 UI 表示は preview 基盤を再利用）
- #93（schema / docs） ↔ #102（認証・認可。エラー形式統一は #93 側）

一方で「issue 本文と実装状況の乖離」が実質的な重複（実装済み提案の残留）になっていたため、#88 をクローズし、#89 / #90 / #92 / #94 / #96 に現状メモを反映した。

## 今後の issue 投稿運用メモ

- 下書き（`proposed-github-issues-*.md`）から投稿したら、下書き側に issue 番号を追記して二重投稿を防ぐ。
- PR で issue に対応した場合は、PR 本文に `Closes #NN` を書いて自動クローズさせる（#88 / #89 は PR #106 / #107 で対応済みだったが issue が open のまま残っていた）。
- Priority は本文ではなくラベル（`priority:high` / `priority:medium`）で管理する。
