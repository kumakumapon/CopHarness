# CopHarness

複数の LLM プロバイダ（GitHub Copilot / OpenAI / Anthropic / Gemini）と対話するためのハーネス（TypeScript）。

- **CLI** — コマンドラインから対話型でやり取り
- **Discord Bot** — Discord の DM / @メンションで LLM と会話（画像添付対応）
- **HTTP API** — `POST /api/copilot` エンドポイント（Next.js）
- **スケジューラー** — cron 式でプロンプトを定期実行（即時実行・中断対応）
- **スキル（ツール呼び出し）** — LLM からローカル関数を呼び出すツール機能

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
- **画像添付**: メッセージに画像を添付すると LLM に渡されます（テキストなしの場合は「画像について教えてください。」がデフォルトプロンプトになります）

```
@CopHarness こんにちは！
@CopHarness [画像を添付] この画像について説明して
```

### オプション設定

| 変数名 | 説明 | デフォルト |
|--------|------|-----------|
| `DISCORD_BOT_TOKEN` | Discord ボットトークン | （必須） |
| `DISCORD_MAX_HISTORY` | チャンネルごとの会話履歴保持数（ペア） | `20` |
| `DISCORD_MAX_IMAGE_BYTES` | 画像添付のダウンロード上限（バイト） | `8388608`（8 MB） |
| `COPILOT_SYSTEM_PROMPT` | システムプロンプト | （なし） |
| `COPILOT_MODEL` | 使用するモデル名 | `gpt-5-mini` |
| `COPILOT_TIMEOUT_MS` | LLM タイムアウト（ミリ秒） | `120000` |

---

## スケジューラー

cron 式またはショートハンドでプロンプトを定期実行できます。スケジュール情報はプロジェクトルートの `schedules.json` に保存されます。

### コマンド一覧

```bash
npm run schedule list                              # 登録済みスケジュール一覧
npm run schedule add <cron> <prompt>               # スケジュール追加
npm run schedule add <cron> <prompt> --name <名前>  # 名前付きで追加
npm run schedule remove <id>                       # スケジュール削除（ID プレフィックス可）
npm run schedule enable <id>                       # スケジュール有効化
npm run schedule disable <id>                      # スケジュール無効化
npm run schedule fire <id>                         # 実行中のデーモンに即時実行を指示
npm run schedule stop <id>                         # 実行中のプロンプトを中断
npm run schedule run                               # スケジューラーデーモン起動
```

### cron 形式

| 形式 | 例 | 説明 |
|------|----|------|
| `HH:MM` | `09:00` | 毎日 09:00 に実行 |
| 5フィールド cron | `0 9 * * *` | 毎日 09:00 に実行 |
| 5フィールド cron | `*/15 * * * *` | 15 分ごとに実行 |
| 5フィールド cron | `0 18 * * 5` | 毎週金曜 18:00 に実行 |

フィールドの記法: `*`、`N`、`N-M`（範囲）、`*/N`（ステップ）、`N,M`（リスト）

### 使用例

```bash
# 毎朝 9 時に今日のフォーカスを確認
npm run schedule add "09:00" "今日何に集中すべきか教えて" --name "朝の確認"

# 毎週金曜 18 時に週次サマリー
npm run schedule add "0 18 * * 5" "今週のまとめを教えて" --name "週次サマリー"

# 30 分ごとに ping
npm run schedule add "*/30 * * * *" "Ping"

# 一覧表示
npm run schedule list

# スケジュール削除（ID の先頭数文字で指定可能）
npm run schedule remove abc123

# cron 時刻を待たずに即時実行（デーモン起動中に有効）
npm run schedule fire abc123

# 実行中のプロンプトを中断
npm run schedule stop abc123

# デーモン起動（SIGINT / SIGTERM で終了）
npm run schedule run
```

### デーモンの動作

`npm run schedule run` を実行すると、5 秒ごとにポーリングしながら次の処理を行います。

- **cron 評価**: 分境界ごとに cron 式を評価し、該当スケジュールを実行
- **即時実行** (`fire`): `runNow` フラグが立ったスケジュールを 5 秒以内に実行
- **中断** (`stop`): `stopRequested` フラグが立ったスケジュールの実行中プロンプトを中断
- 複数スケジュールは並列実行（各スケジュールは同時に 1 実行のみ）

`Ctrl+C` または SIGTERM で正常終了します（実行中のプロンプトはすべて中断されます）。

---

## スキル（ツール呼び出し）

スキルは LLM がリクエスト中にローカル関数を呼び出せるようにする仕組みです（OpenAI function calling / Anthropic tool use / Gemini function calling に対応）。

### 組み込みスキル

| スキル名 | 説明 |
|---------|------|
| `currentDateTime` | 現在の日時を ISO 8601 形式で返す |

### スキルの定義

```typescript
import { type SkillDefinition } from './lib/skill';

const mySkill: SkillDefinition = {
  name: 'mySkill',
  description: 'スキルの説明（LLM に渡されます）',
  parameters: {
    type: 'object',
    properties: {
      input: { type: 'string', description: '入力値' },
    },
    required: ['input'],
  },
  handler: async (args) => {
    return { content: `結果: ${args.input}` };
  },
};
```

### スキルの登録と利用

```typescript
import { registerSkill, resolveSkills } from './lib/skill';
import { createAdapter } from './lib/adapterFactory';

registerSkill(mySkill);

const adapter = createAdapter({ provider: 'openai', model: 'gpt-4o', apiKey: '...' });
const response = await adapter.complete({
  messages: [{ role: 'user', content: '現在時刻を教えて' }],
  skills: resolveSkills(['currentDateTime']),
});
```

### 動作の仕組み

LLM がツール呼び出しを要求した場合、アダプターが自動的にハンドラーを実行して結果を LLM に返します。無限ループを防ぐため、1 回のリクエストあたりの最大反復回数は **10 回**（`MAX_SKILL_ITERATIONS`）に制限されています。

### 対応プロバイダ

| プロバイダ | 実装方式 |
|-----------|---------|
| OpenAI | function calling (`tools` / `tool_calls`) |
| Anthropic | tool use (`tools` / `tool_use` blocks) |
| Gemini | function calling (`functionDeclarations` / `functionResponse`) |

---

## HTTP API（Next.js）

開発サーバーを起動して HTTP 経由で LLM を呼び出せます。

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

## 対応プロバイダ

| プロバイダ | キー変数 | 備考 |
|-----------|---------|------|
| GitHub Copilot | `GITHUB_COPILOT_API_KEY` | Copilot サブスクリプション必須 |
| OpenAI | `OPENAI_API_KEY` | `OPENAI_MODEL` でモデル指定可 |
| Anthropic | `ANTHROPIC_API_KEY` | `ANTHROPIC_MODEL` でモデル指定可 |
| Google Gemini | `GEMINI_API_KEY` | 詳細は [docs/GEMINI-INTEGRATION.md](docs/GEMINI-INTEGRATION.md) |
| LM Studio | なし（ローカル） | `LMSTUDIO_BASE_URL` / `LMSTUDIO_MODEL` で設定 |
| Lemonade Server | なし（ローカル） | `LEMONADE_BASE_URL` / `LEMONADE_MODEL` で設定 |

プロバイダの自動判定順（`COPILOT_PROVIDER` 未設定時）:

1. `GEMINI_API_KEY` あり → `gemini`
2. `ANTHROPIC_API_KEY` あり → `anthropic`
3. `OPENAI_API_KEY` あり → `openai`
4. `LMSTUDIO_BASE_URL` あり → `lmstudio`
5. `LEMONADE_BASE_URL` あり → `lemonade`
6. それ以外 → `copilot`

`COPILOT_PROVIDER` 環境変数で明示指定した場合はその値が優先されます（`lmstudio` / `lemonade` も指定可）。

### LM Studio の使い方

1. [LM Studio](https://lmstudio.ai/) を起動し、使用したいモデルをロードする
2. LM Studio の「Local Server」タブでサーバーを起動（デフォルト: `http://localhost:1234`）
3. `.env.local` に以下を設定:

```env
COPILOT_PROVIDER=lmstudio
# または LMSTUDIO_BASE_URL を設定するだけでも自動検出されます
LMSTUDIO_BASE_URL=http://localhost:1234/v1
LMSTUDIO_MODEL=          # 空白にするとロード済みモデルをそのまま使用
```

### Lemonade Server の使い方

1. [AMD Lemonade Server](https://github.com/amd/lemonade) を起動する（デフォルト: `http://localhost:8000`）
2. `.env.local` に以下を設定:

```env
COPILOT_PROVIDER=lemonade
# または LEMONADE_BASE_URL を設定するだけでも自動検出されます
LEMONADE_BASE_URL=http://localhost:8000/api/v0
LEMONADE_MODEL=your-model-name
```

---

## セキュリティについて

- API キーはサーバー側の環境変数にのみ保存されます。
- `.env.local` は `.gitignore` に含まれています。コミットしないよう注意してください。
- Discord Bot を使用する場合、**Message Content Intent** が必要です。
- `schedules.json` にはプロンプトの内容が平文で保存されます。機密情報を含めないよう注意してください。
