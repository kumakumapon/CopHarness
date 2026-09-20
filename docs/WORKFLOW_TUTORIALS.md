# 3つの利用シナリオを通して確認する

このガイドは Agent CLI を入口に、成果物・通知・承認まで確認する手順です。モデルの達成申告だけでなく、保存内容と実行記録を確認します。自動テストではモデル応答と外部通信を固定し、実際のファイル操作・承認ゲート・セッション保存・スケジューラーを動かしています。実サービスの通信品質や実 LLM の成功率は測定していません。

## 共通の準備

1. `.env.example` を参考に `.env.local` に provider を1つ設定し、`npm ci`、`npm run doctor` を実行します。
2. `DATA_DIR` と `SKILL_FILE_SANDBOX_DIR` をそれぞれ専用ディレクトリに設定します。CLI とサーバーから同じ実行を確認する場合は、同じ絶対パスを使います。
3. `npm run dev` で管理画面を起動し、`/dashboard` の Operations からタスクを開きます。HTTP 認証を設定した場合は API キーを入力します。
4. `npm run agent-cli` で作業を開始します。表示される session ID を控えます。

スキルは未設定では low のみです。以下の各シナリオでは `ENABLED_SKILLS` を明示し、設定変更後はプロセスを再起動します。保存先は sandbox 内の相対パスです。

## 1. 調査 → 保存 → 再開

設定例:

```dotenv
ENABLED_SKILLS=fetchUrl,readFile,writeFile
EXECUTION_BACKEND=local
```

入力例（URL は調べたい公開資料に置き換えます）:

```text
/agent https://example.com の内容を fetchUrl で確認し、要点と出典URLを reports/research.md に保存してください。readFile で保存結果を確認してから完了してください。
```

確認する順序:

1. `SKILL_FILE_SANDBOX_DIR/reports/research.md` に本文と出典があること。
2. タスク詳細の「入力・目標」「ツール・成果物の記録」で取得結果・書き込み先・読み戻し結果を確認すること。
3. 「終了理由」が `succeeded` で、最終出力と保存ファイルが一致すること。

途中で provider が失敗したら `/sessions`、`/resume <id> 保存済みの結果から続けてください` を使います。同じ名前・引数の副作用は保存結果を再利用します。完了済みのタスクは再開できません。書き込み結果が不明なら再開は拒否されるため、ファイルを確認して新しい目標を作ります。詳細は [再開ガイド](AGENT_RECOVERY.md) を参照してください。

自動検証: `workflowTutorials.test.ts` は固定された HTML を fetchUrl で読み、実ファイルへ追記した直後に provider を失敗させます。再開後に同じ追記が重複せず、保存先と終了理由をタスク詳細から確認できることを検証します。

## 2. 定期通知 → 実行ログ

1. 管理画面のスケジューラーで名前「朝の作業計画」、時刻 `09:00`、プロンプト「今日の作業計画を3行でまとめてください」を設定します。時刻は実行プロセスのローカル時刻です。
2. Discord のテストチャンネル ID または LINE のテストユーザー ID を設定します。
3. Discord は Bot を接続したプロセスでスケジューラーを動かします。LINE は `LINE_CHANNEL_ACCESS_TOKEN` を設定します。単独実行は `npm run schedule`、Discord の結果転送には Bot 側の通知 callback が必要です。同じ保存先へ複数のデーモンを常駐させないでください。
4. 「今すぐ実行」で本文が届くことを確認してから、次の定刻実行を確認します。テスト後はスケジュールを無効にします。
5. TaskLedger の種別 `schedule` で絞り、入力・最終出力・終了理由を確認します。メタデータの `scheduleId` と `reason`（`manual fire` / `cron`）でスケジュールと実行契機を対応させます。実行ログでも同じ schedule ID を確認します。

`succeeded` はプロンプト処理の成功です。通知はその後に行われるため、配信成功の証明ではありません。通知先で受信を確認し、届かない場合はデーモンの Discord/LINE 送信エラーを確認します。通知の再送は別の副作用であり、受信確認なしで手動実行を繰り返さないでください。

自動検証: `scheduledNotificationWorkflow.test.ts` は実スケジューラーの cron・手動実行を起動し、固定モデルの応答と失敗通知が同じ Discord callback に渡ること、および台帳・ログを確認します。外部チャネルへの実配信は行いません。

## 3. 承認付きファイル変更 → 差分 → 拒否／承認

`writeFile` は medium のため、`HIL_ENABLED=true` だけでは承認対象になりません。以下を `DATA_DIR/policy.json` に保存するか、そのファイルの絶対パスを `TOOL_POLICY_FILE` に指定します。

```json
{
  "version": 1,
  "rules": [
    { "id": "review-file-writes", "skills": ["writeFile"], "approvalMode": "requireApproval" }
  ]
}
```

`ENABLED_SKILLS=readFile,writeFile` を設定し、sandbox 内に `note.md` を作ります。承認ストアはプロセス内メモリのため、**このシナリオは管理画面と同じ Next.js プロセスの HTTP Agent API** から実行します。別プロセスの Agent CLI の承認は管理画面に共有されません。

`POST /api/copilot/agent` に次の JSON を送信します（認証有効なら `Authorization: Bearer <キー>` も付けます）。SSE 接続は承認が終わるまで維持します。

```json
{
  "goal": "note.md を読み、末尾に確認済みと追記してください。拒否されたら達成不能として終了してください。承認後は読み戻して内容を確認してください。",
  "subject": "tutorial-review",
  "skills": ["readFile", "writeFile"]
}
```

1. SSE の `started.taskId` でタスクを特定します。
2. タスク詳細に `pending` の承認 ID、対象パス、変更前後のプレビューが出ることを確認します。承認パネルの同じ ID を開きます。
3. 最初は拒否し、ファイルが変化せず、承認が `rejected`、タスクが `failed` になることを確認します。
4. 新しいタスクで同じ依頼を実行し、差分を確認して承認します。ファイル内容・ツール結果・`approved`・終了理由を確認します。

承認プレビューはサイズ制限があり、外部で編集されると実行時の内容と異なる場合があります。編集用途の対象選択・変更検証・取り消しの設計は [コード編集の設計](CODING_WORKFLOW_DESIGN.md) に記載しています。

自動検証: 実際の `writeFile`、承認ゲート、差分生成、実行ログを使い、承認前と拒否後にファイルが変化しないこと、承認後だけ変更されること、続く `readFile` に前の承認 ID が混入しないことを確認します。

## 再現コマンド

```sh
npm test -- --runInBand __tests__/unit/workflowTutorials.test.ts __tests__/unit/scheduledNotificationWorkflow.test.ts __tests__/api/dashboardTaskDetail.test.ts
```

実 LLM を使った所要時間・反復数・トークン・費用・実チャネルの受信・ブラウザ操作は別の手動測定です。固定応答のテストを性能比較として扱わないでください。
