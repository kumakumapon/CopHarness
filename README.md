# CopHarness

複数の LLM プロバイダ（GitHub Copilot / OpenAI / Anthropic / Gemini）と対話するためのハーネス（TypeScript）。

- **CLI** — コマンドラインから対話型でやり取り
- **Discord Bot** — Discord の DM / @メンションで LLM と会話
- **HTTP API** — `POST /api/copilot` エンドポイント（Next.js）

---

## セットアップ

### 1. 環境変数の設定

```bash
cp .env.example .env.local
```

`.env.local` を開き、利用したいプロバイダに応じて API キーを設定してください。

| 変数名 | 説明 |
|--------|------|
| `GITHUB_COPILOT_API_KEY` | GitHub Copilot PAT（`read:user` + `copilot` スコープ） |
| `OPENAI_API_KEY` | OpenAI API キー |
| `ANTHROPIC_API_KEY` | Anthropic API キー |
| `GEMINI_API_KEY` | Google Gemini API キー |
| `DISCORD_BOT_TOKEN` | Discord ボットトークン（Discord Bot のみ必要） |

どれか一つの LLM キーがあれば自動判定されます。複数セット時は `COPILOT_PROVIDER` で明示指定も可能です。

> ⚠️ `.env.local` はリポジトリにコミットしないでください（`.gitignore` に含まれています）。

**GitHub Copilot トークン取得方法:**
1. [https://github.com/settings/tokens](https://github.com/settings/tokens) を開く
2. "Generate new token (classic)" をクリック
3. スコープで **`read:user`** と **`copilot`** を選択してトークンを生成
4. GitHub Copilot Individual または Business のサブスクリプションが有効であることを確認

### 2. 依存パッケージのインストール

```bash
npm install
```

---

## CLI（対話型コマンドライン）

```bash
npm run cli
```

起動すると `You:` プロンプトが表示されます。メッセージを入力して Enter を押すと LLM の返答が表示されます。会話履歴は同一セッション中は保持されます。

```
CopHarness CLI — provider: openai, model: gpt-5-mini
Type your message and press Enter. Type "exit" or "quit" to quit.

You: こんにちは
Assistant: こんにちは！何かお手伝いできることはありますか？

You: exit
Goodbye!
```

### オプション設定

| 変数名 | 説明 | デフォルト |
|--------|------|-----------|
| `COPILOT_MODEL` | 使用するモデル名 | `gpt-5-mini` |
| `COPILOT_TIMEOUT_MS` | LLM タイムアウト（ミリ秒） | `120000` |
| `COPILOT_SYSTEM_PROMPT` | システムプロンプト | （なし） |

---

## Discord Bot

### Discord アプリの作成

1. [Discord Developer Portal](https://discord.com/developers/applications) でアプリを作成
2. "Bot" タブでボットを作成し、**Bot Token** をコピー
3. 必要な Privileged Gateway Intents を有効化:
   - **Message Content Intent**
4. OAuth2 → URL Generator で `bot` スコープ + 必要な権限（`Send Messages`, `Read Message History`）を選択してサーバーに招待

### 起動

```bash
npm run discord
```

### 使い方

- **DM（ダイレクトメッセージ）**: ボットに直接メッセージを送ると返答します
- **サーバー内**: ボットを @メンションしてメッセージを送ると返答します

```
@CopHarness こんにちは！
```

### オプション設定

| 変数名 | 説明 | デフォルト |
|--------|------|-----------|
| `DISCORD_BOT_TOKEN` | Discord ボットトークン | （必須） |
| `DISCORD_MAX_HISTORY` | チャンネルごとの会話履歴保持数（ペア） | `20` |
| `COPILOT_SYSTEM_PROMPT` | システムプロンプト | （なし） |
| `COPILOT_MODEL` | 使用するモデル名 | `gpt-5-mini` |
| `COPILOT_TIMEOUT_MS` | LLM タイムアウト（ミリ秒） | `120000` |

---

## HTTP API（Next.js）

開発サーバーを起動して HTTP 経由で LLM を呼び出すこともできます。

```bash
npm run dev
```

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
| 504 | LLM API タイムアウト |

---

## テスト

```bash
npm test
```

---

## セキュリティについて

- API キーはサーバー側の環境変数にのみ保存されます。
- `.env.local` は `.gitignore` に含まれています。コミットしないよう注意してください。
- Discord Bot を使用する場合、**Message Content Intent** が必要です。

---

## 対応プロバイダ

| プロバイダ | キー変数 | 備考 |
|-----------|---------|------|
| GitHub Copilot | `GITHUB_COPILOT_API_KEY` | Copilot サブスクリプション必須 |
| OpenAI | `OPENAI_API_KEY` | `OPENAI_MODEL` でモデル指定可 |
| Anthropic | `ANTHROPIC_API_KEY` | `ANTHROPIC_MODEL` でモデル指定可 |
| Google Gemini | `GEMINI_API_KEY` | 詳細は [docs/GEMINI-INTEGRATION.md](docs/GEMINI-INTEGRATION.md) |


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