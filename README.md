# CopChat

GitHub Copilot SDK を使ったチャットアプリケーション（Next.js 15 + TypeScript）。

## セットアップ

### 1. 環境変数の設定

```bash
cp .env.example .env.local
```


`.env.local` を開き、利用したいプロバイダに応じて API キーを設定してください。

- Copilot: `GITHUB_COPILOT_API_KEY` または `COPILOT_PROVIDER_API_KEY` または `COPILOT_API_KEY`
- OpenAI: `OPENAI_API_KEY`
- Anthropic: `ANTHROPIC_API_KEY`
- Gemini: `GEMINI_API_KEY`（詳細は [docs/GEMINI-INTEGRATION.md](docs/GEMINI-INTEGRATION.md) を参照）

（どれか一つがあれば自動判定されます。複数セット時は `COPILOT_PROVIDER` で明示指定も可能）

**トークン取得方法:**
1. [https://github.com/settings/tokens](https://github.com/settings/tokens) を開く
2. "Generate new token (classic)" をクリック
3. スコープで **`read:user`** と **`copilot`** を選択してトークンを生成
4. GitHub Copilot Individual または Business のサブスクリプションが有効であることを確認

> ⚠️ `.env.local` はリポジトリにコミットしないでください（`.gitignore` に含まれています）。

```env
GITHUB_COPILOT_API_KEY=ghp_xxxxxxxxxxxx
```

### オプション: タイムアウト設定

デフォルトの LLM 待機タイムアウトは **120 秒（2 分）** です。  
`COPILOT_TIMEOUT_MS` 環境変数を設定することで任意の値（ミリ秒）に変更できます。

```env
# タイムアウトを 3 分に延長する例
COPILOT_TIMEOUT_MS=180000
```

**認証フロー:**  
アプリはリクエストごとに各プロバイダの API キーを利用し、BotHarness 由来のアダプタ群（Copilot/OpenAI/Anthropic）を自動選択して呼び出します。


### 注意: 403 Forbidden や認証エラー

各プロバイダの API キーやトークンが無効・権限不足の場合、認証エラーや 403/401 が返ります。Copilot の場合は `copilot` スコープ付き PAT を推奨します。OpenAI/Anthropic も同様に有効な API キーが必要です。

### 2. 依存パッケージのインストール

```bash
npm install
```

### 3. 開発サーバーの起動

```bash
npm run dev
```

ブラウザで [http://localhost:3000](http://localhost:3000) を開くとチャット画面が表示されます。

## テスト

```bash
npm test
```

## API 仕様

### POST /api/copilot

**リクエスト**

```json
{
  "messages": [
    { "role": "user", "content": "こんにちは" }
  ]
}
```

**レスポンス（成功）**

```json
{
  "reply": "こんにちは！今日はどうされましたか？"
}
```


**エラーレスポンス**

| ステータス | 説明 |
|-----------|------|
| 400 | リクエストボディが不正（messages なし・空配列・不正 JSON） |
| 401 | API キー未設定、または LLM 認証失敗 |
| 502 | LLM API エラー |
| 504 | LLM API タイムアウト（30 秒） |

## セキュリティについて

- API キーはサーバー側の環境変数にのみ保存され、クライアントには公開されません。
- **個人情報や機密情報はチャットに入力しないでください。** 送信内容は GitHub Copilot API に転送されます。
- `.env.local` は `.gitignore` に含まれています。コミットしないよう注意してください。

## 手動確認手順

1. `.env.local` に利用したいプロバイダの API キー（例: `GITHUB_COPILOT_API_KEY` や `OPENAI_API_KEY` など）を設定
2. `npm install && npm run dev` を実行
3. ブラウザで <http://localhost:3000> を開く
4. テキスト欄に「こんにちは」と入力して **送信**
5. LLM からの返信がチャットバブルとして表示されることを確認