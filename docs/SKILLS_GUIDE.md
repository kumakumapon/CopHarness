# スキル使い方ガイド

スキルとは、LLM（AI）が会話中にローカル関数や外部 API を呼び出せるようにする仕組みです。  
たとえば「今の天気は？」と聞くと、LLM が `getWeather` スキルを呼び出して実際の気象データを取得し、その結果をもとに回答します。

> **対応プロバイダ:** OpenAI / Anthropic / Gemini / LM Studio / Lemonade  
> ※ GitHub Copilot アダプターはスキルを現在サポートしていません。

---

## 目次

1. [スキルを使ってみる（クイックスタート）](#1-スキルを使ってみるクイックスタート)
2. [使えるスキル一覧](#2-使えるスキル一覧)
3. [各スキルの詳細と使用例](#3-各スキルの詳細と使用例)
   - [ユーティリティ系](#31-ユーティリティ系)
   - [ファイル操作系](#32-ファイル操作系)
   - [Web 系](#33-web-系)
   - [システム系](#34-システム系)
   - [メモリ系](#35-メモリ系)
   - [外部 API 連携系](#36-外部-api-連携系)
   - [拡張スキル系（AI アシスタント向け）](#37-拡張スキル系ai-アシスタント向け)
4. [特定のスキルだけ有効にする](#4-特定のスキルだけ有効にする)
5. [スキルを自作して登録する](#5-スキルを自作して登録する)
6. [HTTP API からスキルを使う](#6-http-api-からスキルを使う)
7. [スキルが動かないときの確認事項](#7-スキルが動かないときの確認事項)

---

## 1. スキルを使ってみる（クイックスタート）

### CLI で使う

```bash
npm run cli
```

起動後、普通に話しかけるだけです。スキルは自動的に有効になっています。

```
You: 今何時ですか？
Assistant: 現在時刻は 2025-05-01T12:34:56.789Z です。

You: 東京の天気は？
Assistant: 東京の現在の天気情報をお伝えします...
           🌡️ Temperature: 22°C (feels like 21°C)
           ...

You: sqrt(144) + 10 を計算して
Assistant: sqrt(144) + 10 = 22 です。
```

スキルの有効・無効は `.env.local` で制御します（[セクション 4](#4-特定のスキルだけ有効にする) 参照）。

---

## 2. 使えるスキル一覧

| カテゴリ | スキル名 | 説明 | 必要な環境変数 |
|---------|---------|------|--------------|
| **ユーティリティ** | `currentDateTime` | 現在の日時（ISO 8601） | — |
| | `calculator` | 数式評価 | — |
| | `randomNumber` | 乱数生成 | — |
| | `uuidGenerate` | UUID v4 生成 | — |
| | `base64Encode` | Base64 エンコード | — |
| | `base64Decode` | Base64 デコード | — |
| | `jsonFormat` | JSON 整形 | — |
| | `hashText` | ハッシュ計算（SHA-256 等） | — |
| | `regexMatch` | 正規表現マッチ | — |
| | `textStats` | テキスト統計 | — |
| | `generatePassword` | パスワード生成 | — |
| | `csvParse` | CSV → JSON 変換 | — |
| **ファイル操作** | `readFile` | ファイル読み込み | — |
| | `writeFile` | ファイル書き込み | — |
| | `listDirectory` | ディレクトリ一覧 | — |
| | `searchInFiles` | ファイル内検索 | — |
| **Web** | `fetchUrl` | URL コンテンツ取得 | — |
| | `webSearch` | Web 検索（Tavily） | `TAVILY_API_KEY` |
| | `getWeather` | 天気情報取得 | — |
| **システム** | `runCommand` | コマンド実行（ホワイトリスト制限） | — |
| | `getSystemInfo` | システム情報取得 | — |
| | `getEnvVariable` | 環境変数取得（許可リスト制限） | — |
| **メモリ** | `memorySet` | メモ保存 | — |
| | `memoryGet` | メモ取得 | — |
| | `memoryList` | メモ一覧 | — |
| **外部 API** | `githubSearch` | GitHub 検索 | `GITHUB_TOKEN`（任意） |
| | `translateText` | DeepL 翻訳 | `DEEPL_API_KEY` |
| | `sendNotification` | Slack/Discord 通知 | `SLACK_WEBHOOK_URL`, `DISCORD_WEBHOOK_URL` |
| **拡張（AI アシスタント）** | `arXivSearch` | arXiv 論文検索 | — |
| | `techNews` | テックニュース取得（RSS） | — |
| | `githubRepo` | GitHub リポジトリ詳細分析 | `GITHUB_TOKEN`（任意） |
| | `youtubeInfo` | YouTube 動画情報取得 | — |
| | `noteCreate` | ノート作成 | — |
| | `noteRead` | ノート読み取り・検索 | — |
| | `noteList` | ノート一覧 | — |
| | `noteDelete` | ノート削除 | — |
| | `markdownToHtml` | Markdown → HTML 変換 | — |
| | `diffText` | テキスト差分比較 | — |
| | `colorConvert` | カラーコード変換（HEX/RGB/HSL） | — |

> **リスクレベルについて**  
> - 🟢 低（low）: 読み取り専用・副作用なし  
> - 🟡 中（medium）: ローカル状態を変更する可能性あり  
> - 🔴 高（high）: コード実行・外部 API 呼び出し（副作用あり）

---

## 3. 各スキルの詳細と使用例

### 3.1 ユーティリティ系

API キー不要。全環境で動作します。

---

#### `currentDateTime` — 現在の日時

**できること:** 現在時刻を ISO 8601 形式（UTC）で返します。

**チャットでの呼び出し例:**
```
今何時ですか？
現在の日時を教えて
What time is it now?
```

**返答例:**
```
2025-05-01T12:34:56.789Z
```

---

#### `calculator` — 数式計算

**できること:** 数式を安全に評価して結果を返します。`eval` を使わない独自パーサーで実装されています。

**対応演算子・関数:**
- 四則演算: `+`, `-`, `*`, `/`, `%`
- べき乗: `^`
- 数学関数: `sqrt`, `abs`, `round`, `floor`, `ceil`, `sin`, `cos`, `tan`, `log`, `log2`, `log10`, `exp`, `min`, `max`, `pow`, `atan2`, `cbrt`, `trunc`, `sign`, `asin`, `acos`, `atan`
- 定数: `pi`, `e`

**チャットでの呼び出し例:**
```
2 * (3 + 4) を計算して
sqrt(144) + pi の値は？
sin(pi/2) はいくつ？
min(10, 20, 5) の最小値は？
```

**返答例:**
```
14
15.141592653589793
1
（min は2引数まで対応、別途 LLM が調整）
```

---

#### `randomNumber` — 乱数生成

**パラメータ:**
| 名前 | 型 | 説明 | デフォルト |
|------|----|------|-----------|
| `min` | number | 最小値（含む） | `0` |
| `max` | number | 最大値（含む） | `1` |
| `integer` | boolean | 整数で返すか | `false` |

**チャットでの呼び出し例:**
```
1から100の整数の乱数を出して
0から1の乱数を5回生成して
サイコロ（1〜6）を振って
```

---

#### `uuidGenerate` — UUID v4 生成

**パラメータ:**
| 名前 | 型 | 説明 | デフォルト |
|------|----|------|-----------|
| `count` | number | 生成数（1–100） | `1` |

**チャットでの呼び出し例:**
```
UUID を生成して
UUID を5個作って
```

---

#### `base64Encode` / `base64Decode` — Base64 変換

**チャットでの呼び出し例:**
```
"Hello, World!" を Base64 にエンコードして
SGVsbG8sIFdvcmxkIQ== をデコードして
```

---

#### `jsonFormat` — JSON 整形

**パラメータ:**
| 名前 | 型 | 説明 | デフォルト |
|------|----|------|-----------|
| `json` | string | 整形したい JSON 文字列 | 必須 |
| `indent` | number | インデント幅（1–8） | `2` |

**チャットでの呼び出し例:**
```
{"name":"Alice","age":30} を整形して
このJSON文字列を4スペースで整形して: [1,2,{"a":true}]
```

---

#### `hashText` — ハッシュ計算 ★新規

**できること:** テキストの暗号ハッシュ（ダイジェスト）を16進数文字列で返します。

**パラメータ:**
| 名前 | 型 | 説明 | デフォルト |
|------|----|------|-----------|
| `text` | string | ハッシュ対象のテキスト | 必須 |
| `algorithm` | string | `sha256` / `sha512` / `sha1` / `md5` | `sha256` |

**チャットでの呼び出し例:**
```
"password123" の SHA-256 ハッシュを計算して
このテキストの MD5 を出して: hello world
"secret" を SHA-512 でハッシュ化して
```

**返答例:**
```
2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824
```

> **注意:** MD5・SHA-1 はチェックサム用途には使えますが、パスワード保存には使わないでください。

---

#### `regexMatch` — 正規表現マッチ ★新規

**できること:** テキスト中から正規表現にマッチする部分をすべて抽出します。

**パラメータ:**
| 名前 | 型 | 説明 | デフォルト |
|------|----|------|-----------|
| `text` | string | 検索対象のテキスト | 必須 |
| `pattern` | string | 正規表現パターン（スラッシュなし） | 必須 |
| `flags` | string | フラグ（`i`, `m`, `s`, `g` 等） | `g` |

**チャットでの呼び出し例:**
```
"cat bat hat mat" から「at」で終わる単語を全部抽出して
このメールアドレスからドメイン部分を取り出して: user@example.com, admin@test.org
"Error: 404, Error: 500" からエラーコードを抽出して
大文字小文字区別なしで "hello" を全部探して: "Hello World hello HELLO"
```

**返答例（「at」で終わる単語）:**
```
3 match(es):
1. "cat"
2. "bat"
3. "hat"
```

---

#### `textStats` — テキスト統計 ★新規

**できること:** テキストの文字数・単語数・行数・文数・平均単語長を返します。

**パラメータ:**
| 名前 | 型 | 説明 |
|------|----|------|
| `text` | string | 分析するテキスト（必須） |

**チャットでの呼び出し例:**
```
このテキストの文字数や単語数を数えて: "Hello world. This is a test."
レポートの単語数を数えて（テキストを貼り付けて）
この文章は何行ありますか？
```

**返答例:**
```
Characters (with spaces): 30
Characters (without spaces): 25
Words: 6
Lines: 1
Sentences: 2
Average word length: 4.17
```

---

#### `generatePassword` — パスワード生成 ★新規

**できること:** 暗号学的に安全なランダムパスワードを生成します。モジュロバイアスのない rejection sampling アルゴリズムを使用。

**パラメータ:**
| 名前 | 型 | 説明 | デフォルト |
|------|----|------|-----------|
| `length` | number | パスワード長（8–128） | `16` |
| `includeUppercase` | boolean | 大文字（A–Z）を含める | `true` |
| `includeDigits` | boolean | 数字（0–9）を含める | `true` |
| `includeSymbols` | boolean | 記号（`!@#$%^&*...`）を含める | `true` |

**チャットでの呼び出し例:**
```
安全なパスワードを生成して
32文字のパスワードを作って
記号なしで20文字のパスワードを作って
英小文字と数字だけで12文字のパスワードを生成して
```

**返答例:**
```
mK7$pL#2vX9!nQ4@
```

---

#### `csvParse` — CSV パース ★新規

**できること:** CSV テキストを JSON 配列に変換します。ヘッダー行がある場合はオブジェクト配列に、ない場合は配列の配列に変換します。

**パラメータ:**
| 名前 | 型 | 説明 | デフォルト |
|------|----|------|-----------|
| `csv` | string | CSV テキスト | 必須 |
| `delimiter` | string | 区切り文字 | `,` |
| `hasHeader` | boolean | 先頭行がヘッダーか | `true` |

**チャットでの呼び出し例:**
```
このCSVをJSONに変換して:
name,age,city
Alice,30,Tokyo
Bob,25,Osaka

セミコロン区切りのCSVを変換して: id;name\n1;Alice\n2;Bob
```

**返答例:**
```json
[
  { "name": "Alice", "age": "30", "city": "Tokyo" },
  { "name": "Bob", "age": "25", "city": "Osaka" }
]
```

---

### 3.2 ファイル操作系

ファイル操作はサンドボックス内に制限されます。  
サンドボックスのパスは `SKILL_FILE_SANDBOX_DIR` 環境変数で指定（デフォルト: `./workspace`）。  
サンドボックス外へのパストラバーサル（`../` 等）は自動的に拒否されます。

---

#### `readFile` — ファイル読み込み

**パラメータ:**
| 名前 | 型 | 説明 |
|------|----|------|
| `path` | string | サンドボックス内のファイルパス（必須） |

**チャットでの呼び出し例:**
```
workspace/notes.txt を読んで
config.json の内容を表示して
```

---

#### `writeFile` — ファイル書き込み

**パラメータ:**
| 名前 | 型 | 説明 | デフォルト |
|------|----|------|-----------|
| `path` | string | 書き込み先パス | 必須 |
| `content` | string | 書き込む内容 | 必須 |
| `append` | boolean | 追記モード | `false` |

**チャットでの呼び出し例:**
```
"Hello, World!" を output.txt に書き込んで
log.txt にこのメッセージを追記して: "処理完了"
```

---

#### `listDirectory` — ディレクトリ一覧

**パラメータ:**
| 名前 | 型 | 説明 | デフォルト |
|------|----|------|-----------|
| `path` | string | 一覧を取得するパス | `.`（サンドボックスルート） |

**チャットでの呼び出し例:**
```
workspaceのファイル一覧を見せて
subdir フォルダの中に何がある？
```

---

#### `searchInFiles` — ファイル内検索

**パラメータ:**
| 名前 | 型 | 説明 | デフォルト |
|------|----|------|-----------|
| `pattern` | string | 検索パターン（正規表現可） | 必須 |
| `path` | string | 検索ディレクトリ | `.` |

**チャットでの呼び出し例:**
```
workspace内で "TODO" を含む行を全部探して
エラーが書かれている行を検索して
```

---

### 3.3 Web 系

---

#### `fetchUrl` — URL 取得

HTML は自動的にプレーンテキストに変換されます（最大 20,000 文字）。

**チャットでの呼び出し例:**
```
https://example.com の内容を取得して
このURLの記事を読んで: https://news.example.com/article/123
```

---

#### `webSearch` — Web 検索（要: `TAVILY_API_KEY`）

**パラメータ:**
| 名前 | 型 | 説明 | デフォルト |
|------|----|------|-----------|
| `query` | string | 検索クエリ | 必須 |
| `maxResults` | number | 結果数（1–10） | `5` |

**セットアップ:**
```bash
# https://tavily.com で無料アカウントを作成してキーを取得
TAVILY_API_KEY=tvly-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

**チャットでの呼び出し例:**
```
「TypeScript 5.5 新機能」で検索して
最新の Node.js LTS バージョンを調べて
Python 機械学習ライブラリを検索して、3件返して
```

---

#### `getWeather` — 天気情報（API キー不要）

Open-Meteo API を使用（無料・キー不要）。

**チャットでの呼び出し例:**
```
東京の今の天気は？
ロンドンの気温を教えて
New York の天気と湿度を確認して
```

**返答例:**
```
📍 Tokyo, Tokyo, Japan
🕐 2025-05-01T12:00
🌡️ Temperature: 22°C (feels like 21°C)
💧 Humidity: 65%
💨 Wind: 15 km/h
🌧️ Precipitation: 0 mm
⛅ Condition: Partly cloudy (code 2)
```

---

### 3.4 システム系

---

#### `runCommand` — コマンド実行

**⚠️ リスクレベル: 高**  
安全のため、実行できるコマンドはホワイトリストに限定されています。  
シェル演算子（`|`, `;`, `&&` 等）は使用不可。

**許可されているコマンド:**
`ls`, `dir`, `pwd`, `echo`, `date`, `whoami`, `hostname`, `cat`, `head`, `tail`, `wc`, `grep`, `find`, `sort`, `uniq`, `which`, `env`, `printenv`, `df`, `du`, `uname`, `uptime`, `node`, `python3`, `python`, `ruby`, `go`

**チャットでの呼び出し例:**
```
現在のディレクトリを表示して
"Hello from skill" をエコーして
uptime を確認して
```

---

#### `getSystemInfo` — システム情報

**チャットでの呼び出し例:**
```
サーバーのスペックを教えて
Node.js のバージョンは？
メモリの使用状況を確認して
```

**返答例:**
```
OS: Linux x64 (5.15.0)
CPU: 4 cores
Memory: 4.2 GB free / 8.0 GB total
Node.js: v22.0.0
Uptime: 3600 seconds
```

---

#### `getEnvVariable` — 環境変数取得

セキュリティのため、`EXPOSED_ENV_VARS`（カンマ区切り）で許可した変数のみ取得可能。

**セットアップ:**
```env
EXPOSED_ENV_VARS=NODE_ENV,APP_VERSION,DEPLOYMENT_REGION
```

**チャットでの呼び出し例:**
```
NODE_ENV の値を教えて
現在の環境（本番/開発）を確認して
```

---

### 3.5 メモリ系

会話をまたいで情報を記憶・参照できます。  
データは `SKILL_MEMORY_FILE`（デフォルト: `./memory.json`）に JSON として保存されます。

---

#### `memorySet` — メモ保存

**チャットでの呼び出し例:**
```
「ユーザー名」に「Alice」を覚えておいて
プロジェクト名を "CopHarness" として記憶して
次回のタスクとして「ドキュメントを更新する」を保存して
```

---

#### `memoryGet` — メモ取得

**チャットでの呼び出し例:**
```
「ユーザー名」として覚えていた値は？
プロジェクト名を思い出して
```

---

#### `memoryList` — メモ一覧

**チャットでの呼び出し例:**
```
記憶していることを全部教えて
保存されているメモを一覧表示して
```

**返答例:**
```
"ユーザー名": "Alice"
"プロジェクト名": "CopHarness"
"次回のタスク": "ドキュメントを更新する"
```

---

### 3.6 外部 API 連携系

---

#### `githubSearch` — GitHub 検索

GitHub Search API を使用します。`GITHUB_TOKEN` は任意ですが、設定するとレート制限が緩和されます。

**パラメータ:**
| 名前 | 型 | 説明 | デフォルト |
|------|----|------|-----------|
| `query` | string | 検索クエリ（GitHub 検索構文対応） | 必須 |
| `type` | string | `repositories` または `issues` | `repositories` |
| `maxResults` | number | 結果数（1–10） | `5` |

**チャットでの呼び出し例:**
```
「TypeScript LLM」でGitHubリポジトリを検索して
stars が多い React UI ライブラリを GitHub で探して
「Next.js」の open な Issue を検索して
language:go stars:>1000 のリポジトリを探して
```

---

#### `translateText` — 翻訳（要: `DEEPL_API_KEY`）

**セットアップ:**
```bash
# https://www.deepl.com/pro-api で無料アカウントを作成
DEEPL_API_KEY=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx:fx  # 無料プランは末尾 :fx
```

**対応言語（ターゲット）:** JA, EN-US, EN-GB, ZH, KO, DE, FR, ES, IT, PT-BR, RU, 他多数

**チャットでの呼び出し例:**
```
「Hello, world!」を日本語に翻訳して
このテキストを英語に翻訳して: 「本日はよろしくお願いします。」
「Bonjour le monde」を中国語に翻訳して
```

---

#### `sendNotification` — Slack/Discord 通知（要: Webhook URL）

**⚠️ リスクレベル: 高**

**セットアップ:**
```env
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/T.../B.../xxxxxxxxxxxxxxxxxxxxxxxx
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/xxxxxxxxxx/xxxxxxxxxxxxxxxxxxxxxxxx
```

**パラメータ:**
| 名前 | 型 | 説明 | デフォルト |
|------|----|------|-----------|
| `message` | string | 通知メッセージ | 必須 |
| `target` | string | `slack`, `discord`, `all` | `all` |

**チャットでの呼び出し例:**
```
「デプロイが完了しました！」をSlackに通知して
「エラーが発生しました。確認してください。」をDiscordに送って
「定期レポートを準備しました」を全チャンネルに通知して
```

---

### 3.7 拡張スキル系（AI アシスタント向け）

[karaage0703/ai-assistant-workspace](https://github.com/karaage0703/ai-assistant-workspace) のスキルを参考に追加した拡張スキル群です。  
すべて API キー不要（`githubRepo` のみ `GITHUB_TOKEN` 任意）で動作します。

---

#### `arXivSearch` — arXiv 論文検索 ★新規

**できること:** arXiv Atom API を使って学術論文を検索します（無料・キー不要）。AI/ML・物理・数学・コンピュータサイエンスの最新論文を探せます。

**パラメータ:**
| 名前 | 型 | 説明 | デフォルト |
|------|----|------|-----------|
| `query` | string | 検索クエリ（arXiv 検索構文対応: `ti:`, `au:`, `cat:cs.AI` 等） | 必須 |
| `maxResults` | number | 取得件数（1–10） | `5` |
| `sortBy` | string | `relevance` / `lastUpdatedDate` / `submittedDate` | `relevance` |

**チャットでの呼び出し例:**
```
LLM エージェントの最新論文を探して
「transformer attention mechanism」で arXiv を検索して
cat:cs.AI で最新 5 件の論文を教えて
著者 Vaswani の論文を調べて: au:Vaswani
この 1 週間の LLM トレンド論文を submittedDate 順で 10 件
```

**返答例:**
```
Found 5 paper(s) for "LLM agent":

1. **Autonomous Agents with LLMs**
   Authors: Smith, John; Doe, Jane
   Published: 2025-04-28
   arXiv ID: 2504.12345  →  https://arxiv.org/abs/2504.12345
   Categories: cs.AI, cs.LG
   Abstract: We propose a novel framework for autonomous LLM agents...
```

---

#### `techNews` — テックニュース取得 ★新規

**できること:** 公開 RSS フィードから最新のテック/AI ニュースを取得します（キー不要）。

**パラメータ:**
| 名前 | 型 | 説明 | デフォルト |
|------|----|------|-----------|
| `topic` | string | `ai`（AI/ML ニュース）/ `tech`（一般テック）/ `dev`（開発者・Hacker News） | `ai` |
| `maxResults` | number | 取得件数（1–10） | `5` |

**RSS ソース:**

| トピック | ソース |
|---------|--------|
| `ai` | VentureBeat AI, AI News |
| `tech` | Ars Technica, Wired |
| `dev` | Hacker News, DEV Community |

**チャットでの呼び出し例:**
```
今日のAIニュースを教えて
テックニュースを5件見せて
開発者向けニュース（Hacker News）を確認して
Wired の最新記事を教えて（topic: tech）
```

---

#### `githubRepo` — GitHub リポジトリ詳細分析 ★新規

**できること:** GitHub リポジトリのメタデータ（スター数・フォーク数・トピック・ライセンス等）、最近のコミット、主要コントリビュータ、オープン Issue を一括取得します。

**パラメータ:**
| 名前 | 型 | 説明 |
|------|----|------|
| `repo` | string | `owner/repo` 形式または GitHub URL（必須） |

**チャットでの呼び出し例:**
```
microsoft/vscode を分析して
https://github.com/vercel/next.js を調べて
このリポジトリ分析して: facebook/react
openai/openai-python の最近のコミットを見て
```

**返答例:**
```
## microsoft/vscode
**Code editing. Redefined.**

🔗 https://github.com/microsoft/vscode
⭐ Stars: 165,000  |  🍴 Forks: 29,000  |  👁 Watchers: 3,200
💻 Primary Language: TypeScript
📄 License: MIT License
🏷️ Topics: editor, typescript, electron, vscode

### Recent Commits
- `a1b2c3d` fix: improve keyboard shortcut handling  (John, 2025-04-30)
...
```

---

#### `youtubeInfo` — YouTube 動画情報取得 ★新規

**できること:** YouTube oEmbed API を使って動画のタイトル・チャンネル名・サムネイル URL を取得します（API キー不要）。

**パラメータ:**
| 名前 | 型 | 説明 |
|------|----|------|
| `url` | string | YouTube URL または動画 ID（必須） |

**チャットでの呼び出し例:**
```
https://www.youtube.com/watch?v=dQw4w9WgXcQ の動画を教えて
この動画のタイトルは？: youtu.be/dQw4w9WgXcQ
動画 ID dQw4w9WgXcQ の情報を取得して
```

**返答例:**
```
🎬 **Never Gonna Give You Up**
📺 Channel: Rick Astley  (https://www.youtube.com/@RickAstley)
🔗 URL: https://www.youtube.com/watch?v=dQw4w9WgXcQ
🖼️ Thumbnail: https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg
```

---

#### `noteCreate` / `noteRead` / `noteList` / `noteDelete` — ノート管理 ★新規

**できること:** タイムスタンプ付きの構造化ノートを保存・検索・一覧・削除します。  
データは `SKILL_NOTES_FILE`（デフォルト: `./notes.json`）に保存されます。  
`memorySet`/`memoryGet` よりリッチな構造（タイトル・タグ・本文・日時）を持ちます。

**`noteCreate` パラメータ:**
| 名前 | 型 | 説明 |
|------|----|------|
| `title` | string | ノートのタイトル（必須） |
| `content` | string | ノートの本文（必須） |
| `tags` | string | コンマ区切りのタグ（任意） |

**`noteRead` パラメータ:**
| 名前 | 型 | 説明 |
|------|----|------|
| `id` | string | ノート ID（`noteList` 出力から取得） |
| `keyword` | string | タイトル・本文をキーワード検索 |

**`noteList` パラメータ:**
| 名前 | 型 | 説明 | デフォルト |
|------|----|------|-----------|
| `tag` | string | タグでフィルタ | — |
| `limit` | number | 表示件数（最新順） | `20` |

**チャットでの呼び出し例:**
```
「今日の日記」というノートを作って: 今日は〇〇について勉強した。
会議メモを保存して（タグ: work, meeting）
「量子コンピュータ」のノートを作って（調査結果を本文に）
ノートを一覧表示して
workタグのノートを全部見せて
「LLM」というキーワードでノートを検索して
ノート abc123 の内容を読んで
```

**`SKILL_NOTES_FILE` のカスタマイズ:**
```env
SKILL_NOTES_FILE=./workspace/my-notes.json
```

---

#### `markdownToHtml` — Markdown → HTML 変換 ★新規

**できること:** Markdown テキストをスタイル付きの完全な HTML ドキュメントに変換します（外部ライブラリ不要）。

**対応構文:**
- 見出し（`#` `##` `###` 等）
- 太字（`**bold**`）・イタリック（`*italic*`）・取り消し線（`~~text~~`）
- インラインコード（`` `code` ``）・コードブロック（` ``` ` 言語名付き対応）
- 順序なし / 順序付きリスト
- リンク（`[text](url)`）・画像（`![alt](url)`）
- 引用（`> blockquote`）・水平線（`---`）

**チャットでの呼び出し例:**
```
このMarkdownをHTMLに変換して:
# タイトル
これは**太字**のテキストです。
- リスト項目 1
- リスト項目 2

README.md の内容をHTMLに変換してブラウザ用にして
```

---

#### `diffText` — テキスト差分比較 ★新規

**できること:** 2 つのテキストを行単位で比較し、追加・削除・変更箇所を unified diff 形式で表示します（外部ライブラリ不要）。

**パラメータ:**
| 名前 | 型 | 説明 | デフォルト |
|------|----|------|-----------|
| `oldText` | string | 元のテキスト（必須） |
| `newText` | string | 新しいテキスト（必須） |
| `contextLines` | number | 変更箇所前後に表示する行数（0–10） | `3` |

**チャットでの呼び出し例:**
```
この2つのコードの差分を見せて（oldText と newText を貼り付けて）
バージョン1とバージョン2の違いを比較して
この設定ファイルの変更点を差分で教えて（コンテキスト行数: 1）
```

**返答例:**
```
📊 Summary: +2 line(s) added, -1 line(s) removed

```diff
  def greet():
-     print("Hello")
+     print("Hello, World!")
+     return True
```
```

---

#### `colorConvert` — カラーコード変換 ★新規

**できること:** HEX・RGB・HSL のカラーコードを相互変換します（外部ライブラリ不要）。

**入力フォーマット（すべて自動判定）:**
- HEX: `#ff6347` または `#f63`（3桁短縮形）
- RGB: `255, 99, 71` または `rgb(255, 99, 71)`
- HSL: `9, 100%, 64%` または `hsl(9, 100%, 64%)`

**チャットでの呼び出し例:**
```
#ff6347 を RGB と HSL に変換して
255, 99, 71 を HEX に変換して
hsl(9, 100%, 64%) の RGB 値は？
この色コードを変換して: #3498db
```

**返答例:**
```
🎨 Color: #ff6347
  HEX:  #ff6347
  RGB:  rgb(255, 99, 71)
  HSL:  hsl(9, 100%, 64%)
```

---

## 4. 特定のスキルだけ有効にする

`ENABLED_SKILLS` 環境変数にカンマ区切りでスキル名を指定すると、そのスキルのみが有効になります。  
未設定の場合はすべてのスキルが有効です。

```env
# .env.local に追記

# 安全な読み取り系のみ有効にする例
ENABLED_SKILLS=currentDateTime,calculator,randomNumber,uuidGenerate,getWeather,memorySet,memoryGet,memoryList

# 翻訳・検索に特化した例
ENABLED_SKILLS=webSearch,translateText,githubSearch,fetchUrl,getWeather

# AI アシスタント系スキルを有効にする例
ENABLED_SKILLS=arXivSearch,techNews,githubRepo,youtubeInfo,noteCreate,noteRead,noteList,noteDelete

# 新しい解析スキルを追加した例
ENABLED_SKILLS=currentDateTime,calculator,hashText,regexMatch,textStats,generatePassword,csvParse

# スキルをすべて無効にする（スキルなしで動作）
ENABLED_SKILLS=
```

> **ヒント:** `ENABLED_SKILLS` が空文字列の場合、すべてのスキルが有効（制限なし）になります。  
> 特定のスキルを**完全に無効**にしたい場合は、必要なスキル名だけをリストに含めてください。

---

## 5. スキルを自作して登録する

既存スキルと同じ `SkillDefinition` インターフェースを実装するだけです。

### 手順 1: スキルファイルを作成

```typescript
// lib/skills/myCustomSkill.ts
import { type SkillDefinition } from '../skill';

export const myCustomSkill: SkillDefinition = {
  name: 'myCustomSkill',           // LLM がツールを呼ぶときに使う名前
  description: 'このスキルは〇〇を行います。LLM に渡される説明文です。',
  parameters: {
    type: 'object',
    properties: {
      input: {
        type: 'string',
        description: '処理する入力テキスト',
      },
      count: {
        type: 'number',
        description: '繰り返し回数（1–10）',
        minimum: 1,
        maximum: 10,
      },
    },
    required: ['input'],
  },
  category: 'utility',    // 'utility' | 'file' | 'web' | 'system' | 'memory' | 'external'
  riskLevel: 'low',       // 'low' | 'medium' | 'high'
  requiresEnv: [],        // 必要な環境変数（省略可）

  handler: async (args) => {
    const input = String(args.input ?? '');
    const count = typeof args.count === 'number' ? args.count : 1;
    // 処理ロジックをここに書く
    return { content: input.repeat(count) };
    // エラーの場合は isError: true を付ける
    // return { content: 'Error: 〇〇が発生しました', isError: true };
  },
};
```

### 手順 2: `lib/skills/index.ts` に登録

```typescript
// lib/skills/index.ts に追記

import { myCustomSkill } from './myCustomSkill';

// allSkills 配列に追加
const allSkills = [
  // ... 既存スキル ...
  myCustomSkill,
];

// export にも追加
export {
  // ... 既存スキル ...
  myCustomSkill,
};
```

これだけで CLI・Discord Bot・LINE Bot・HTTP API すべてで自動的に使用可能になります。

### 手順 3: 動作確認

```bash
npm run cli
```

```
You: myCustomSkill を使ってみて
Assistant: [myCustomSkill が自動で呼ばれる]
```

---

## 6. HTTP API からスキルを使う

`POST /api/copilot` のリクエスト `skills` フィールドにスキル名を配列で指定します。

```bash
curl -X POST http://localhost:3000/api/copilot \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      { "role": "user", "content": "東京の天気と現在時刻を教えて" }
    ],
    "skills": ["getWeather", "currentDateTime"]
  }'
```

**レスポンス例:**
```json
{
  "reply": "東京の現在時刻は 2025-05-01T12:34:56.789Z で、天気は晴れ（22°C）です。"
}
```

スキル名を渡さなかった場合はスキルなしで動作します（通常の LLM 会話）。

---

## 7. スキルが動かないときの確認事項

### スキルが呼ばれない

1. **`ENABLED_SKILLS` を確認**: 使いたいスキルがリストに含まれているか確認してください。空文字以外の値が設定されている場合、記載されていないスキルは無効です。
2. **プロバイダを確認**: GitHub Copilot アダプターはスキルをサポートしていません。`COPILOT_PROVIDER` を `openai`, `anthropic`, `gemini` 等に設定してください。
3. **プロンプトを具体的に**: 「天気を調べて」よりも「東京の今の天気を getWeather スキルで取得して」のように明示すると確実に呼ばれます。

### API キーエラー

| スキル | 確認すること |
|--------|------------|
| `webSearch` | `TAVILY_API_KEY` が `.env.local` に設定されているか |
| `translateText` | `DEEPL_API_KEY` が正しいか（無料プランは末尾 `:fx`） |
| `sendNotification` | `SLACK_WEBHOOK_URL` / `DISCORD_WEBHOOK_URL` が有効か |
| `githubSearch` | `GITHUB_TOKEN` は任意。設定しなくてもレート制限内なら動作 |
| `githubRepo` | `GITHUB_TOKEN` は任意。Private リポジトリにはトークンが必要 |
| `arXivSearch` | API キー不要。arXiv サーバーが一時的にダウンしている場合あり |
| `techNews` | API キー不要。RSS フィードが一時的に取得できない場合あり |

### ファイル操作スキルのエラー

- `SKILL_FILE_SANDBOX_DIR` で指定したディレクトリが存在するか確認してください（自動作成されますが、権限がない場合は手動作成）。
- パスに `../` を含めないでください（セキュリティのため自動拒否）。

### メモリ・ノートスキルのエラー

- `SKILL_MEMORY_FILE` で指定したファイルのディレクトリに書き込み権限があるか確認してください。
- `SKILL_NOTES_FILE` で指定したファイルのディレクトリに書き込み権限があるか確認してください。

### ダッシュボードでスキル一覧を確認

```bash
npm run dev
# ブラウザで http://localhost:3000/dashboard を開く
# 「スキル」タブで登録済みスキルの一覧を確認できます
```

または API で確認：
```bash
curl http://localhost:3000/api/dashboard/skills
```
