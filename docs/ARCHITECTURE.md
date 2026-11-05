# CopHarness の設計

## 方針

1. **ループは1つ。** チャットも長い作業も同じエージェントループで動かします。モデルがツールを呼ぶ限り続け、ツールを呼ばずに答えたらターン終了です。「完了ツール」や「続けて」の自動メッセージは使いません。
2. **ツールは少なく、汎用的に。** ファイル操作・検索・シェル・Web 取得・作業リスト・サブエージェント・メモの 10 個です。細かな機能はモデル自身か `bash` に任せ、外部サービスは MCP、作業手順は Agent Skills で足します。
3. **安全性は「権限」と「フック」で。** ツールを読み取り / 内部状態 / 編集 / 実行に分類し、権限モードとルールで決めます。プロジェクト固有の制御はコマンドフックで書きます。承認はどの入口からでも答えられます。
4. **入口は薄く。** CLI・Web UI・HTTP API・チャット・定期実行はすべて `Runtime` を呼ぶだけで、会話・権限・承認・使用量の扱いは共通です。
5. **履歴は追記のみ。** 送ったメッセージは書き換えません。プロンプトキャッシュと、推論の署名（Anthropic の thinking、Gemini の thought signature）が有効なまま保たれます。

## モジュール

```
lib/
  types.ts            会話の型（Message / ContentPart）と AgentEvent
  config.ts           copharness.json + 環境変数（v1 変数の読み替えと警告）
  runtime.ts          セッション管理・ターン実行の直列化・イベント配信・承認の取り次ぎ
  agent/
    loop.ts           エージェントループ（権限 → フック → 承認 → 実行 → 結果）
    compaction.ts     会話全体を要約1件に置き換える圧縮
    systemPrompt.ts   セッション開始時に1度だけ作るシステムプロンプト
  providers/          1回のモデル呼び出し（ストリーミング）を各 SDK で実装
    anthropic.ts      @anthropic-ai/sdk（自動キャッシュ、adaptive thinking、サーバー側フォールバック）
    openai.ts         openai SDK の Chat Completions（LM Studio / Ollama / OpenRouter なども）
    gemini.ts         @google/genai
    copilot.ts        @github/copilot-sdk（SDK がツールループを持つため runTurn で実装）
  tools/              組み込みツール
  permissions.ts      権限モードとルール
  hooks.ts            コマンドフック
  mcp.ts              MCP クライアント（@modelcontextprotocol/sdk、stdio / Streamable HTTP / SSE）
  skills.ts           Agent Skills の検出と skill ツール
  sessions/           追記型 JSONL の保存と承認ブローカー
  usage.ts            トークン・費用・日次上限
  scheduler.ts        定期実行
  channels/           Discord / LINE / Slack 共通のゲートウェイと配信
  server/             API 認証・レート制限・SSE・v1 互換
app/                  Web UI（app/page.tsx）と API ルート（app/api）
scripts/cli.ts        CLI
```

## 1ターンの流れ

```
ユーザー入力
  → UserPromptSubmit フック
  → （必要なら）圧縮
  → モデル呼び出し（text_delta / reasoning_delta を配信）
  → ツール呼び出しがあれば各呼び出しについて:
       引数の検証 → 権限判定（deny > ask > allow > モード）→ PreToolUse フック
       → 確認が必要なら permission_request を配信して承認待ち
       → 実行 → PostToolUse フック → tool_result を配信
     （連続する読み取りツールは並列実行）
  → 結果をまとめて1つのユーザーメッセージとして追記し、モデル呼び出しへ戻る
  → ツール呼び出しがなければ turn_end（Stop フック）
```

中断されたときは、未完了のツール呼び出しに「中断されました」の結果を追記してから終了します。次のターンでも履歴の整合性が保たれます。

## 会話の保存

`data/sessions/<id>.jsonl` に1行1レコードで追記します。

| レコード | 内容 |
|---|---|
| `session` | ID・タイトル・所有者・チャネル・モデル（一覧表示はこの1行だけを読む） |
| `context` | システムプロンプトとツール定義（セッション中は固定） |
| `message` | 会話のメッセージ（プロバイダ固有の応答 `native` を含む） |
| `compaction` | 要約。読み込み時はここで履歴が要約1件に置き換わる |
| `meta` | モデル・権限モード・「常に許可」・作業リストなどの変更 |
| `usage` | モデル呼び出しごとのトークンと費用 |

システムプロンプトとツール定義を固定するのは、途中で変えるとプロンプトキャッシュが無効になり、Anthropic の新しいモデルでは過去の thinking ブロックが検証に失敗するためです。MCP やスキルを追加した場合は新しい会話から反映されます。

## プロバイダの扱い

- 各プロバイダは「履歴を受け取り、1回分の応答を返す」だけです。ツールループはエージェントループ側にあります。
- 応答はプロバイダ非依存の形（テキスト・ツール呼び出し・推論）と、元の形（`native`）の両方で保存します。同じプロバイダには元の形をそのまま返し、別のプロバイダに切り替えたときは非依存の形から組み立てます。
- **Anthropic**: 既定モデルは `claude-opus-5-5`。対応モデルでは adaptive thinking（要約表示）と `effort`、トップレベルの自動プロンプトキャッシュ、ツール入力の逐次ストリーミング、拒否時のサーバー側フォールバック（`fallbacks: "default"`）を使います。`temperature` などのサンプリング設定は送りません。
- **圧縮**は「会話全体を要約1件に置き換える」方式です。一部のターンだけを残す方式は推論署名の検証と相性が悪いため使いません。要約の依頼は同じシステムプロンプトとツールのまま、履歴に1件追記して行います。
- **GitHub Copilot** は SDK 自身がツールループを持つため、`runTurn` でターン全体を任せます。SDK の組み込みツールは無効にし、CopHarness のツールだけを渡します。各ツール呼び出しはハーネスの権限・フック・承認を通ります。
- 一時的なエラー（429 / 5xx など）は、まだ何も出力していない場合に限り再試行します。

## 承認

`ApprovalBroker` が承認待ちをプロセス内で保持します。CLI のプロンプト、Web UI のボタン、`POST /api/approvals/:id`、チャットの `/approve` のどれで答えても同じ待ちが解決します。誰も答えなければ `approvalTimeoutMs` 後に拒否され、ヘッドレス実行（`-p`、v1 互換 API）では確認が必要な呼び出しは待たずに拒否されます。

## プロセス構成

`npm run dev` / `npm start` は Next.js サーバー1つです。`instrumentation.ts` から MCP 接続、定期実行、Discord ボットを起動します。CLI は同じ `data/` を使う別プロセスとして動き、会話の一覧や再開を共有します。
