# Agent の終了判定・診断・再開

Issue #132 の P0 と P1 を中心に、CLI と HTTP Agent API の運用を揃えています。

## 最初の応答まで

1. `.env.example` を参考に `.env.local` へ provider とキーを設定します。キーの値をコマンドやログへ貼り付けないでください。
2. `npm run doctor` で実効 provider/model、保存先、スキル、承認、HTTP 認証、実行 backend を確認します。既定ではネットワーク接続を試しません。
3. 接続を確認する場合は `npm run doctor -- --connect`。ツールなしの短い LLM リクエストを送り、利用料が発生する場合があります。機械可読出力は `--json` です。
4. `npm run agent-cli` を起動して通常会話、または `/agent <目標>` を実行します。`npm run cli` は簡易的な非ストリーミング会話用です。

設定解決は CLI、Agent CLI、通常/stream/agent HTTP API、評価 CLI で共通です。選択した provider のキーだけを使います。複数のキーがある場合は `COPILOT_PROVIDER` で明示できます。Gemini の provider 名は `antigravity`、キーは `ANTIGRAVITY_API_KEY` または `GEMINI_API_KEY`、モデルは `ANTIGRAVITY_MODEL`（別名 `GEMINI_MODEL`）です。`COPILOT_MODEL` はモデル設定に優先します。Copilot SDK・LM Studio・Lemonade はクラウドキーの事前チェック対象外ですが、各サービスへのログインや接続は別途必要です。

`ENABLED_SKILLS` 未設定なら low のみが公開されます。`EXECUTION_BACKEND` の不明な値は設定エラーで停止します。doctor の backend チェックは構築時の設定検証であり、Docker/SSH の接続成功を保証しません。

## 終了状態

| stopReason / 台帳状態 | 意味 | 次の操作 |
| --- | --- | --- |
| succeeded | markComplete による目標達成申告 | 結果を確認 |
| failed | provider エラー、または markFailed による達成不能 | 原因を修正して再開 |
| cancelled | Ctrl+C、HTTP 切断、停止要求 | 必要なら再開 |
| iteration_limit | 1 回の実行の反復上限 | 指示や設定を見直して再開 |
| stalled | ツール呼び出しなしの短い応答が 2 回連続 | provider/目標を見直す |
| waiting_input | 追加情報を待っている | 回答を添えて再開 |

`completed` は `succeeded` の場合だけ true です。`iterations` は実際の adapter 呼び出し試行数で、初回で完了すると 1、呼び出し前の取消は 0 です。各再開で反復数の上限はリセットされます。達成申告は成果物の品質保証ではありません。

管理画面のタスク一覧で行を開くと、同じ task/session ID に紐づく入力、ツール引数と結果、承認、最終出力、終了理由、質問を確認できます。結果内の保存先から成果物を確認してください。表示は機密値の除去と長さ制限を施したプレビューで、raw checkpoint や任意ファイルのダウンロードは公開しません。承認待ちは同一プロセス内のものが対象です。解決済み承認は新しい実行ログに状態を保存するため、再起動後も保持されたログから確認できます。ログの保持上限や旧形式で記録が欠ける場合は、承認がなかったと断定しません。

## CLI の保存と再開

```text
/agent 調査結果をまとめて保存する
/sessions
/resume agent_<表示されたID> 保存先は reports/result.md
```

追加質問がある場合はいったん `waiting_input` で止まります。`/resume <id> <回答>` で同じセッションへ戻ります。質問がなければ回答部分は任意で、追加指示として利用できます。現在選択中の provider/model で再開し、新しい設定を記録します。

`/agent` は通常会話を引き継ぎ、終了概要を通常会話へ追加します。`/save`・`/load` は会話保存、`/sessions`・`/resume` はツール記録を含む実行の保存・再開です。Tab でコマンドを補完でき、行末に `\` を付けると複数行入力を続けられます。Ctrl+C は実行中のエージェントを中断します。

## HTTP の継続

`POST /api/copilot/agent` へ次の JSON を送信します。認証有効時は既存の API キーヘッダーも指定してください。

```json
{ "goal": "調査結果を保存する", "subject": "my-user", "maxIterations": 25 }
```

SSE の `started` と応答ヘッダー `X-Task-Id` で ID を取得できます。`input_required` に質問、`done.result.stopReason` に終了状態を返します。

```json
{ "sessionId": "agent_<ID>", "subject": "my-user", "answer": "reports/result.md に保存" }
```

新規作成時と同じ subject を指定します。成功済みセッション、回答不足、同時実行、別 subject は拒否します。接続が切れると中断し、台帳に cancelled を記録します。subject は利用者指定の関連付け情報であり、独立したユーザー認証ではありません。HTTP の保護には既存の `COPHARNESS_API_KEY` とアクセス制御を使ってください。

## 副作用とクラッシュ時の扱い

セッションは `DATA_DIR/agent-sessions/<id>.json` に保存します（DATA_DIR 未設定なら作業ディレクトリ）。会話・ツール引数・結果を含むので、保存先は利用者データとして管理してください。Git の既定除外に追加しています。

- medium/high またはリスク未指定のツールは、実行前に intent、終了後に結果を保存します。同じ名前・同じ引数（キー順を正規化）の操作は保存済み結果を再利用します。
- low のツールは再実行可能として扱います。スキルのリスク分類が正しいことが前提です。
- 実行中の記録やエラー結果が残る副作用は、結果不明として自動再開を拒否します。送信先や成果物を確認し、実施済みの操作を除いた新しい目標で別タスクを開始してください。
- 引数を変えた操作や別セッションまで重複を判定するものではありません。外部サービスの exactly-once やトランザクション復旧を保証しません。
- 保存エラーが起きたら以降のツールを止めます。副作用の intent を保存できない場合、その操作を実行しません。
- 同じ保存先では `.lock` ファイルにより同一セッションの同時実行を拒否します。正常終了・中断時は解除します。強制終了後に残った場合は、記載の PID を確認し、以前のプロセスが確実に停止してから当該 `.lock` だけを削除して再開してください。稼働中のロックを削除しないでください。

保存はローカルファイルの置換方式です。単一ホスト向けで、分散ワーカー、電源断での永続性、外部処理のロールバックは対象外です。

## 品質ゲートと残る評価

CI は lint → 全 Jest テスト → typecheck → `eval:mock` → production build を実行します。mock eval は成功、達成不能、provider 例外、空応答停止、上限、質問待ち、取消を決定的に検証します。実 LLM の `npm run eval` は別経路です。

P2 の3つのシナリオは [通しチュートリアル](WORKFLOW_TUTORIALS.md)、コード編集を重点用途とした場合の対象選択・差分・取り消しの契約は [コード編集設計](CODING_WORKFLOW_DESIGN.md) に記載しています。編集専用 undo 自体は未実装です。実 LLM・Bot を通した性能比較は別途測定が必要です。固定応答のテストを実測完了として扱わないでください。
