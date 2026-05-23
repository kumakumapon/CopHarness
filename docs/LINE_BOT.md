# LINE Bot — 設定と使い方

概要
- このプロジェクトには LINE Messaging API 用の webhook 実装があり、エンドポイントは POST /api/line です。
- 受信メッセージは LLM（Copilot/OpenAI/Anthropic/Gemini など）へ渡して応答を返信します。

必須環境変数
- LINE_CHANNEL_SECRET: LINE チャネルの Channel secret（署名検証に使用）
- LINE_CHANNEL_ACCESS_TOKEN: Messaging API のチャネルアクセストークン（返信に使用）

任意設定
- LINE_MAX_HISTORY: ユーザーごとに保持するメッセージ対の上限（デフォルト: 20）
- LINE_GREETING_MESSAGE: follow イベント時に送信する挨拶メッセージ

エンドポイント
- POST /api/line
  - リクエストボディに events 配列を含め、各 event に replyToken と message を含めてください。
  - サーバー側で x-line-signature ヘッダーの検証を行います。

テスト
- ユニットテスト: __tests__/api/line.test.ts に webhook の主要ケース（署名検証、テキストイベント、follow、エラーハンドリング等）のテストがあります。CI で実行してください。

注意点と推奨
- 本番環境では LINE_CHANNEL_SECRET と ACCESS_TOKEN を安全に保管してください（シークレットマネージャ等を推奨）。
- Webhook の公開 URL を LINE コンソールに設定する際は HTTPS を使用してください。
- 応答テキストは 5000 文字に切り詰められます。長い生成結果はトリミングされます。
- LLM API キー（GITHUB_COPILOT_API_KEY / OPENAI_API_KEY など）が未設定だと通常は応答を行いません（ローカルプロバイダを除く）。

トラブルシューティング
- 401 (Invalid signature): LINE_CHANNEL_SECRET が一致しないか、受信ボディが改変されています。署名と raw ボディを確認してください。
- 503 (credentials not configured): チャネルの SECRET/ACCESS_TOKEN が未設定です。

その他
- 実装は app/api/line/route.ts にあります。必要であればリトライやエラーハンドリングの強化、並列処理の最適化を検討してください。
