# CopHarness

複数の LLM プロバイダ（GitHub Copilot / OpenAI / Anthropic / Gemini）と対話するためのハーネス（TypeScript）。

- **CLI** — コマンドラインから対話型でやり取り
- **Discord Bot** — Discord の DM / @メンションで LLM と会話（画像添付対応）
- **LINE Bot** — LINE メッセージに LLM が返答（ウェブフック経由）
- **HTTP API** — `POST /api/copilot` エンドポイント（Next.js）
- **ストリーミング API** — `POST /api/copilot/stream` SSE ストリーミングエンドポイント
- **ダッシュボード** — `/dashboard` でプロバイダ状態・スケジュール・スキル・実行ログを確認（Web UI）
- **スケジューラー** — cron 式でプロンプトを定期実行（即時実行・中断対応）
- **スキル（ツール呼び出し）** — LLM からローカル関数を呼び出すツール機能
- **MCP クライアント** — 外部 MCP サーバーのツールをスキルとして自動登録
- **マルチエージェント** — 複数の役割エージェントを実行（A2A プロトコル対応）
- **OpenTelemetry** — LLM 呼び出しをスパン計装し OTLP/HTTP で外部へエクスポート
- **Human-in-the-Loop** — リスク高スキルの実行前に人間の承認を要求
- **学習ガイド** — 利用シーン別の導入手順と実践課題は [`docs/USE_CASE_LEARNING.md`](docs/USE_CASE_LEARNING.md) を参照

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
| `COPILOT_PROVIDER_API_KEY` | 汎用 BYOK キー（`GITHUB_COPILOT_API_KEY` の別名として利用可） |
| `COPILOT_API_KEY` | 汎用 BYOK キー（`GITHUB_COPILOT_API_KEY` の別名として利用可） |
| `OPENAI_API_KEY` | OpenAI API キー |
| `ANTHROPIC_API_KEY` | Anthropic API キー |
| `GEMINI_API_KEY` | Google Gemini API キー |
| `LMSTUDIO_BASE_URL` | LM Studio ローカルサーバーの URL（デフォルト: `http://localhost:1234/v1`） |
| `LEMONADE_BASE_URL` | Lemonade Server の URL（デフォルト: `http://localhost:8000/api/v0`） |
| `DISCORD_BOT_TOKEN` | Discord ボットトークン（Discord Bot のみ必要） |
| `MCP_SERVERS` | MCP サーバーの URL リスト（カンマ区切りまたは JSON 配列） |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | OTLP/HTTP エクスポート先 URL（例: `http://localhost:4318`） |
| `HIL_ENABLED` | `true` または `1` に設定するとリスク高スキルに承認ゲートを適用 |
| `HIL_APPROVAL_TIMEOUT_MS` | 承認待ちタイムアウト（ミリ秒、デフォルト: `300000`） |
| `COPHARNESS_API_KEY` | HTTP API の Bearer 認証キー（設定時のみ認証が有効） |

どれか一つの LLM キーがあれば自動判定されます。複数セット時は `COPILOT_PROVIDER` で明示指定も可能です。

> ⚠️ `.env.local` はリポジトリにコミットしないでください（`.gitignore` に含まれています）。

**GitHub Copilot トークン取得方法:**
1. [https://github.com/settings/tokens](https://github.com/settings/tokens) を開く
2. "Generate new token (classic)" をクリック
3. スコープで **`read:user`** と **`copilot`** を選択してトークンを生成
4. GitHub Copilot Individual または Business のサブスクリプションが有効であることを確認

> ⚠️ **免責事項**: GitHub Copilot プロバイダは、Copilot API を公式クライアント以外から利用する形になります。この利用形態は [GitHub の利用規約](https://docs.github.com/site-policy/github-terms/github-terms-for-additional-products-and-features)（GitHub Copilot に関する条項）に抵触する可能性があります。利用する場合は、最新の規約をご自身で確認のうえ、自己責任でご利用ください。規約違反によるアカウント停止等について、本プロジェクトは一切の責任を負いません。規約リスクを避けたい場合は、OpenAI / Anthropic / Gemini / ローカル LLM（LM Studio / Lemonade）プロバイダの利用を推奨します。

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
| `COPILOT_MODEL` | 使用するモデル名（全プロバイダ共通） | `gpt-5-mini` |
| `OPENAI_MODEL` | OpenAI 用モデル名（`COPILOT_MODEL` より優先度低） | （なし） |
| `ANTHROPIC_MODEL` | Anthropic 用モデル名 | （なし） |
| `GEMINI_MODEL` | Gemini 用モデル名 | `gemini-1.5-pro` |
| `LMSTUDIO_MODEL` | LM Studio 用モデル名 | （ロード済みモデル） |
| `LEMONADE_MODEL` | Lemonade Server 用モデル名 | （なし） |
| `COPILOT_TIMEOUT_MS` | LLM タイムアウト（ミリ秒） | `120000` |
| `COPILOT_SYSTEM_PROMPT` | システムプロンプト | （なし） |

---

## LINE Bot

LINE Messaging API Webhook として動作するボットです。Next.js の開発サーバーまたはデプロイ済み環境で `POST /api/line` エンドポイントがウェブフックを受け取ります。

### LINE チャネルの作成

1. [LINE Developers Console](https://developers.line.biz/console/) でプロバイダーとチャネル（Messaging API）を作成
2. チャネル基本設定から **Channel Secret** をコピー
3. Messaging API 設定から **Channel Access Token** を発行・コピー
4. Webhook URL に `https://<your-domain>/api/line` を設定し、**Webhook の利用** を有効化
5. （ローカル開発時は [ngrok](https://ngrok.com/) 等で HTTPS トンネルを作成してください）

### 環境変数の設定

`.env.local` に以下を追加してください。

```env
LINE_CHANNEL_SECRET=your_line_channel_secret_here
LINE_CHANNEL_ACCESS_TOKEN=your_line_channel_access_token_here
```

### 起動

```bash
npm run dev
```

Next.js の開発サーバーが起動し、`POST /api/line` でウェブフックを受け付けます。

### 使い方

LINE 公式アカウントにメッセージを送ると LLM が返答します。ユーザーごとに会話履歴が保持されます。

### オプション設定

| 変数名 | 説明 | デフォルト |
|--------|------|-----------|
| `LINE_CHANNEL_SECRET` | チャネルシークレット（必須） | — |
| `LINE_CHANNEL_ACCESS_TOKEN` | チャネルアクセストークン（必須） | — |
| `LINE_MAX_HISTORY` | ユーザーごとの会話履歴保持数（ペア） | `20` |
| `COPILOT_SYSTEM_PROMPT` | システムプロンプト | （なし） |
| `COPILOT_MODEL` | 使用するモデル名 | `gpt-5-mini` |
| `COPILOT_TIMEOUT_MS` | LLM タイムアウト（ミリ秒） | `120000` |

---


## Slack チャネル

Slack Events API の `url_verification`、DM（`message` / `channel_type=im`）、`app_mention` payload は `normalizeSlackEvent` で共通形式に正規化できます。Slack ユーザーは `slack:<userId>` の `channelKey` として扱われ、Discord / LINE / API と同じ IdentityStore 連携に載せやすい形になります。スレッド単位の会話分離には `slack:<channelId>:<thread_ts|ts>` の `threadKey` を使います。

```env
SLACK_BOT_TOKEN=
SLACK_SIGNING_SECRET=
```

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

> 📖 **詳しい使い方は [docs/SKILLS_GUIDE.md](docs/SKILLS_GUIDE.md) を参照してください。**

### 組み込みスキル一覧

#### ユーティリティ系（外部依存なし）

| スキル名 | 説明 | リスク |
|---------|------|-------|
| `currentDateTime` | 現在の日時を ISO 8601 形式で返す | 低 |
| `calculator` | 算術式を安全に評価して結果を返す（+, -, *, /, %, ^, 数学関数, 定数 pi/e） | 低 |
| `randomNumber` | 指定範囲の乱数を返す（整数モードあり） | 低 |
| `uuidGenerate` | UUID v4 を生成する（複数生成も可） | 低 |
| `base64Encode` | 文字列を Base64 にエンコード | 低 |
| `base64Decode` | Base64 文字列をデコード | 低 |
| `jsonFormat` | JSON 文字列を整形して返す | 低 |
| `hashText` | テキストの暗号ハッシュを返す（sha256 / sha512 / sha1 / md5） | 低 |
| `regexMatch` | 正規表現でテキストを検索し全マッチを返す | 低 |
| `textStats` | テキストの文字数・単語数・行数・文数・平均単語長を集計 | 低 |
| `generatePassword` | 暗号学的に安全なランダムパスワードを生成 | 低 |
| `csvParse` | CSV 文字列を JSON 配列に変換（ヘッダー行対応） | 低 |

#### ファイル操作系

ファイル操作は `SKILL_FILE_SANDBOX_DIR`（デフォルト: `./workspace`）内に制限されます。パストラバーサルは拒否されます。

| スキル名 | 説明 | リスク |
|---------|------|-------|
| `readFile` | サンドボックス内ファイルの内容を読み込む | 中 |
| `writeFile` | サンドボックス内にファイルを書き込む（上書き・追記対応） | 中 |
| `listDirectory` | サンドボックス内のディレクトリ一覧を取得 | 低 |
| `searchInFiles` | サンドボックス内のファイルをパターン検索（正規表現対応） | 低 |

#### Web 系

| スキル名 | 説明 | リスク | 必要な環境変数 |
|---------|------|-------|--------------|
| `fetchUrl` | URL のコンテンツを取得（HTML は自動でテキスト変換） | 中 | — |
| `webSearch` | DuckDuckGo API でウェブ検索 | 低 | — |
| `getWeather` | Open-Meteo API で現在の天気情報を取得（無料・キー不要） | 低 | — |

#### システム系

| スキル名 | 説明 | リスク | 備考 |
|---------|------|-------|-----|
| `runCommand` | ホワイトリスト制限付きコマンドを実行 | 高 | 許可コマンド: `ls`, `echo`, `date`, `cat`, `grep` 等 |
| `getSystemInfo` | OS・CPU・メモリ・Node.js バージョン等を返す | 低 | — |
| `getEnvVariable` | 許可リスト内の環境変数を返す（`EXPOSED_ENV_VARS` で制御） | 低 | — |

#### メモリ系

メモリは `SKILL_MEMORY_FILE`（デフォルト: `./memory.json`）に JSON で永続化されます。

| スキル名 | 説明 | リスク |
|---------|------|-------|
| `memorySet` | キーバリュー形式でメモを保存 | 中 |
| `memoryGet` | 保存済みメモを取得 | 低 |
| `memoryList` | 保存済みメモ一覧を表示 | 低 |

#### 外部 API 連携系

| スキル名 | 説明 | リスク | 必要な環境変数 |
|---------|------|-------|--------------|
| `githubSearch` | GitHub API でリポジトリ・Issue を検索 | 低 | `GITHUB_TOKEN`（任意、レート制限緩和） |
| `translateText` | LLM でテキストを翻訳 | 低 | — |
| `sendNotification` | Slack / Discord Webhook に通知を送信 | 高 | `SLACK_WEBHOOK_URL`, `DISCORD_WEBHOOK_URL` |

### スキルの有効/無効設定

`ENABLED_SKILLS` 環境変数（カンマ区切りのスキル名）を設定すると、そのスキルのみが利用可能になります。未設定時は全スキルが有効です。

```env
# 例: 特定スキルのみ有効にする
ENABLED_SKILLS=currentDateTime,calculator,getWeather,memorySet,memoryGet,memoryList,hashText,regexMatch
```


### 生成スキル manifest と依存許可

`proposeSkill` で作られる generated skill は、承認・登録前に manifest を検証します。manifest には `name`、`version`、`riskLevel`、`permissions`、`allowedEnv`、`allowedNetworkDestinations`、`npmDependencies` を含められます。既存データに manifest がない場合は、読み込み時に依存・環境変数・ネットワーク権限なしの既定 manifest が補完されます。

依存 package、環境変数、ネットワーク宛先を要求する manifest は、それぞれ以下の allowlist に含まれていない限り登録されません。

```env
GENERATED_SKILL_ALLOWED_DEPENDENCIES=
GENERATED_SKILL_ALLOWED_ENV=
GENERATED_SKILL_ALLOWED_NETWORK=
```

`npmDependencies` を指定する場合は `permissions` に `dependencies`、`allowedEnv` を指定する場合は `env`、`allowedNetworkDestinations` を指定する場合は `network` も含める必要があります。

### スキルのカスタム定義

```typescript
import { type SkillDefinition } from './lib/skill';

const mySkill: SkillDefinition = {
  name: 'mySkill',
  description: 'スキルの説明（LLM に渡されます）',
  parameters: {
    type: 'object',
    properties: {
      input: { type: 'string', description: '入力値' },
      count: { type: 'number', description: '件数', minimum: 1, maximum: 100 },
    },
    required: ['input'],
  },
  category: 'utility',  // 'utility' | 'file' | 'web' | 'system' | 'memory' | 'external'
  riskLevel: 'low',     // 'low' | 'medium' | 'high'
  requiresEnv: [],      // 必要な環境変数名（任意）
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
  skills: resolveSkills(['currentDateTime', 'mySkill']),
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
  ],
  "attachments": [],
  "skills": ["currentDateTime"],
  "timeoutMs": 30000
}
```

| フィールド | 型 | 必須 | 説明 |
|------------|-----|------|------|
| `messages` | `LLMMessage[]` | ✅ | 会話メッセージ配列（`role`: `user` / `assistant` / `system`） |
| `attachments` | `LLMAttachment[]` | — | 画像などのバイナリ添付（`type: "blob"`, `data`, `mimeType`） |
| `skills` | `string[]` | — | 有効にするスキル名のリスト（例: `["currentDateTime"]`） |
| `timeoutMs` | `number` | — | タイムアウト上書き（ミリ秒）。サーバー設定値が上限 |

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
| 403 | LLM 認証拒否（403 エラーが返された場合） |
| 502 | LLM API エラー |
| 504 | LLM API タイムアウト |

---

## ダッシュボード（Web UI）

`npm run dev` でサーバーを起動した後、ブラウザで `http://localhost:3000/dashboard` を開くと管理ダッシュボードが表示されます。

### 機能

| タブ / パネル | 説明 |
|--------------|------|
| **プロバイダ状態** | 設定済みの LLM プロバイダ・ボット一覧と設定状況を表示 |
| **スケジュール** | スケジュール一覧の確認、有効/無効の切り替え、即時実行・中断操作 |
| **スキル** | 登録済みスキル（ツール）の一覧表示 |
| **実行ログ** | スケジューラーの実行履歴（成功・失敗・中断）を最大 200 件表示 |
| **Telemetry** | 直近の OTel スパン一覧（プロバイダ・モデル・所要時間・ステータス）を表示 |
| **承認待ち** | Human-in-the-Loop で待機中のスキル実行を承認または拒否（3 秒ポーリング） |

ダッシュボードは自動更新に対応しており、右上のトグルで切り替え可能です。

### Dashboard API エンドポイント

ダッシュボードは以下の REST API を内部で使用しています。直接呼び出すことも可能です。

| メソッド | パス | 説明 |
|---------|------|------|
| `GET` | `/api/dashboard/status` | アクティブなプロバイダ・モデル、各プロバイダとボットの設定状況を返す |
| `GET` | `/api/dashboard/schedules` | 登録済みスケジュール一覧（次回実行時刻付き）を返す |
| `PATCH` | `/api/dashboard/schedules` | スケジュールの有効/無効を切り替える（`{ id, enabled }` を送信） |
| `PATCH` | `/api/dashboard/schedules/[id]` | 指定スケジュールの有効/無効を切り替える（`{ enabled }` を送信） |
| `POST` | `/api/dashboard/schedules/[id]/fire` | 指定スケジュールをデーモンに即時実行させる |
| `POST` | `/api/dashboard/schedules/[id]/stop` | 指定スケジュールの実行中プロンプトを中断させる |
| `GET` | `/api/dashboard/logs` | 実行ログを返す（`?limit=N` で件数指定、最大 200） |
| `GET` | `/api/dashboard/skills` | 登録済みスキルの名前、説明、リスク、実行メトリクスを返す |
| `GET` | `/api/dashboard/skill-executions` | スキル実行履歴を返す（`status`、`riskLevel`、`personQuery`、`channelQuery`、`taskQuery`、期間で絞り込み可能） |
| `GET` | `/api/dashboard/tasks` | TaskLedger のタスク一覧を返す（`status`、`kindQuery`、`personQuery`、`channelQuery`、期間で絞り込み可能） |
| `GET` | `/api/dashboard/telemetry` | 直近の OTel スパン一覧を返す（`?limit=N` で件数指定） |
| `GET` | `/api/dashboard/approvals` | 承認待ちスキル実行リストを返す |
| `POST` | `/api/dashboard/approvals/[id]/approve` | 指定リクエストを承認する |
| `POST` | `/api/dashboard/approvals/[id]/reject` | 指定リクエストを拒否する |

---

## ストリーミング API

LLM の返答をリアルタイムで受け取れる SSE（Server-Sent Events）エンドポイントです。OpenAI / Anthropic / Gemini アダプターはネイティブストリーミングに対応します。

```bash
npm run dev
```

### POST /api/copilot/stream

リクエスト形式は `POST /api/copilot` と同じです（`messages`, `attachments`, `skills`, `timeoutMs` フィールド）。

**レスポンス形式（SSE）**

```
data: {"chunk":"こんにちは"}
data: {"chunk":"！"}
data: [DONE]
```

エラー時:

```
data: {"error":"タイムアウトしました"}
```

**クライアント実装例**

```typescript
const res = await fetch('/api/copilot/stream', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ messages: [{ role: 'user', content: 'こんにちは' }] }),
});

const reader = res.body!.getReader();
const decoder = new TextDecoder();
for await (const { done, value } of { [Symbol.asyncIterator]: () => ({ next: () => reader.read() }) }) {
  if (done) break;
  for (const line of decoder.decode(value).split('\n')) {
    if (!line.startsWith('data: ')) continue;
    const payload = line.slice(6);
    if (payload === '[DONE]') break;
    const { chunk, error } = JSON.parse(payload);
    if (chunk) process.stdout.write(chunk);
  }
}
```

### 対応プロバイダ

| プロバイダ | ストリーミング実装 |
|-----------|-----------------|
| OpenAI | ネイティブ SSE (`stream: true`) |
| Anthropic | ネイティブ SSE (`stream: true`) |
| Gemini | ネイティブ SSE (`streamGenerateContent`) |
| LM Studio | OpenAI アダプターに委譲 |
| Lemonade | OpenAI アダプターに委譲 |
| GitHub Copilot | フォールバック（`complete()` 後に一括 yield） |

---

## MCP クライアント

[Model Context Protocol (MCP)](https://modelcontextprotocol.io/) 準拠サーバーのツールを、CopHarness のスキルとして自動登録します。JSON-RPC over HTTP（2024-11-05 仕様）に対応しています。

### 設定

`MCP_SERVERS` 環境変数に MCP サーバーの URL を指定します。

```env
# カンマ区切り（シンプルな形式）
MCP_SERVERS=http://localhost:3100,http://localhost:3101

# JSON 配列（名前付き）
MCP_SERVERS=[{"url":"http://localhost:3100","name":"my-tools"},{"url":"http://localhost:3101"}]
```

### 動作の仕組み

起動時に `MCP_SERVERS` のサーバーに接続し、`tools/list` で利用可能なツールを取得してスキルとして登録します。登録後は通常のスキルと同様に LLM から呼び出せます。

```
[MCP] Registered 5 skill(s) from 2 server(s)
```

---

## マルチエージェント

複数の役割（ロール）を持つエージェントを実行し、結果を連携させるオーケストレーション機能です。

### 組み込みロール

| ロール名 | 説明 |
|---------|------|
| `researcher` | 情報収集と詳細レポートの作成 |
| `coder` | クリーンで効率的なコードの実装 |
| `reviewer` | コードレビューと改善提案 |
| `summarizer` | 複雑な情報の簡潔なまとめ |
| `planner` | 目標達成のための計画立案 |

### TypeScript API

```typescript
import { runAgentTask, runAgentPipeline } from './lib/agents/orchestrator';

// 単一タスク
const result = await runAgentTask({
  role: 'researcher',
  userPrompt: 'TypeScript の最新トレンドを調査して',
});
console.log(result.content);

// パイプライン（順次実行）
const results = await runAgentPipeline([
  { role: 'researcher', userPrompt: '課題を調査して' },
  { role: 'coder',      userPrompt: '調査結果を元に実装して' },
  { role: 'reviewer',   userPrompt: '実装をレビューして' },
]);

// カスタムロール
const result2 = await runAgentTask({
  role: { name: 'translator', description: '翻訳者', systemPrompt: 'あなたはプロの翻訳者です。' },
  userPrompt: 'Hello, world! を日本語に翻訳して',
  skills: ['currentDateTime'],
  model: 'gpt-4o',
});
```

### A2A エンドポイント

Google が提唱する [Agent2Agent (A2A) プロトコル](https://developers.googleblog.com/en/a2a-a-new-era-of-agent-interoperability/)に準拠したエンドポイントです。

**POST /api/a2a**

```json
{
  "task": {
    "id": "optional-uuid",
    "role": "researcher",
    "input": "TypeScript の最新トレンドを調査して",
    "skills": ["webSearch"],
    "timeoutMs": 60000,
    "model": "gpt-4o"
  }
}
```

カスタムシステムプロンプトを指定する場合は `systemPrompt` フィールドを追加します。

```json
{
  "task": {
    "role": "custom",
    "input": "...",
    "systemPrompt": "あなたはカスタムエージェントです。"
  }
}
```

**レスポンス**

```json
{
  "result": {
    "id": "uuid",
    "role": "researcher",
    "output": "調査結果...",
    "status": "completed",
    "model": "gpt-4o",
    "provider": "openai",
    "durationMs": 3210,
    "startedAt": "2026-01-01T00:00:00.000Z",
    "completedAt": "2026-01-01T00:00:03.210Z"
  }
}
```

---

## OpenTelemetry（可観測性）

`OTEL_EXPORTER_OTLP_ENDPOINT` を設定すると、全 LLM 呼び出しがスパンとして計装され、OTLP/HTTP で外部の可観測性バックエンド（Jaeger、Grafana Tempo 等）にエクスポートされます。

### 設定

```env
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
```

エンドポイント未設定時もスパンはインプロセスのバッファ（最大 500 件）に保持され、ダッシュボードの **Telemetry** パネルで確認できます。

### スパン属性

| 属性 | 説明 |
|------|------|
| `llm.provider` | プロバイダ名（`openai`, `anthropic` 等） |
| `llm.model` | モデル名 |
| `llm.message_count` | 送信メッセージ数 |
| `llm.content_length` | 返答のテキスト長 |
| `llm.duration_ms` | 所要時間（ミリ秒） |

### API

```
GET /api/dashboard/telemetry?limit=50
```

---

## Human-in-the-Loop（承認ゲート）

`HIL_ENABLED=true` に設定すると、リスクレベルが `high` のスキル（`runCommand`, `sendNotification`, `spawnAgent` 等）は実行前に人間の承認を要求します。

### 設定

```env
HIL_ENABLED=true
HIL_APPROVAL_TIMEOUT_MS=300000   # 5 分（デフォルト）
```

### 動作フロー

1. LLM がリスク高スキルを呼び出そうとする
2. スキルが実行待機状態になり、ダッシュボードの **承認待ち** パネルに表示される
3. オペレーターがダッシュボードまたは API で承認 / 拒否する
4. 承認された場合はスキルが実行され、結果が LLM に返る
5. 拒否またはタイムアウトの場合はエラーメッセージが LLM に返る

### 承認 API

```
GET  /api/dashboard/approvals              # 待機中リスト
POST /api/dashboard/approvals/{id}/approve # 承認
POST /api/dashboard/approvals/{id}/reject  # 拒否
```

---

## テスト

```bash
npm test
```

### Eval / CI quality gate

LLM を使った組み込み評価を実行し、合格率が閾値を下回ると終了コード 1 を返します。プロバイダに対応する API キーが必要です。

```bash
npm run eval
EVAL_PASS_THRESHOLD=0.9 npm run eval
```

CI向けに、標準出力へJSONまたはJUnit XMLを出力できます。機械可読形式では進捗ログを標準出力へ混在させません。

```bash
npm run eval -- --json
npm run eval -- --junit --output reports/eval.xml
```

カスタムケースは `EVAL_CASES_FILE` でJSONファイルを指定します。終了コードは合格が `0`、品質ゲート未達が `1`、引数・設定・実行エラーが `2` です。fork由来のPull RequestにはLLM APIキーを渡さず、信頼できるブランチまたは手動workflowで実行してください。


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
| Antigravity (Google Gemini API) | `ANTIGRAVITY_API_KEY` | `ANTIGRAVITY_MODEL` でモデル指定可（デフォルト: `gemini-2.0-flash`） |

プロバイダの自動判定順（`COPILOT_PROVIDER` 未設定時）:

1. `GEMINI_API_KEY` あり → `gemini`
2. `ANTHROPIC_API_KEY` あり → `anthropic`
3. `OPENAI_API_KEY` あり → `openai`
4. `ANTIGRAVITY_API_KEY` → `antigravity`
5. `LMSTUDIO_BASE_URL` あり → `lmstudio`
6. `LEMONADE_BASE_URL` あり → `lemonade`
7. `COPILOT_PROVIDER_API_KEY` または `COPILOT_API_KEY` あり → `openai`（互換アダプター）
8. それ以外 → `copilot`（GitHub Copilot SDK）

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
- `logs.json` にはスケジュール実行結果（プロンプト・LLM の返答）が平文で保存されます。同様に機密情報を含めないよう注意してください。
