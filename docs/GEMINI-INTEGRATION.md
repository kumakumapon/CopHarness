# Gemini API Integration

This document describes how to configure and use the Google Gemini provider in CopHarness.

---

## Overview

CopHarness supports Google Gemini as an LLM provider via the `GeminiAdapter`.  
The adapter follows the same `LLMAdapter` interface as the existing Copilot, OpenAI, and Anthropic adapters.

**Layer structure:**

```
GeminiAdapter  (lib/adapters/geminiAdapter.ts)
     │
     └── GeminiClient  (lib/services/geminiClient.ts)
              │
              └── Google Gemini REST API
                  https://generativelanguage.googleapis.com/v1beta
```

---

## Environment Variables

Copy `.env.example` to `.env.local` and set the following variables:

| Variable            | Required | Default                                              | Description                                   |
|---------------------|----------|------------------------------------------------------|-----------------------------------------------|
| `GEMINI_API_KEY`    | ✅ yes   | —                                                    | Google AI Studio API key                      |
| `GEMINI_MODEL`      | no       | `gemini-1.5-pro`                                     | Model name (e.g. `gemini-2.0-flash`)          |
| `GEMINI_ENDPOINT`   | no       | `https://generativelanguage.googleapis.com/v1beta`   | Override the base URL                         |
| `GEMINI_TIMEOUT_MS` | no       | `10000`                                              | Per-request timeout in milliseconds           |
| `GEMINI_RETRY_MAX`  | no       | `3`                                                  | Max retries on transient errors (429 / 5xx)   |

### Getting an API key

1. Go to [Google AI Studio](https://aistudio.google.com/apikey).
2. Sign in and click **Create API key**.
3. Copy the key and add it to `.env.local` as `GEMINI_API_KEY`.

---

## Provider Auto-Detection

When `GEMINI_API_KEY` is set (and `COPILOT_PROVIDER` is not explicitly set to another value),  
CopHarness will automatically select the Gemini provider. The priority order is:

1. Explicit `COPILOT_PROVIDER` env var (`gemini`, `openai`, `anthropic`, `copilot`)
2. `GEMINI_API_KEY` present → `gemini`
3. `ANTHROPIC_API_KEY` present → `anthropic`
4. `OPENAI_API_KEY` present → `openai`
5. BYOK key present → `openai`
6. Default → `copilot`

---

## Sample `.env.local`

```dotenv
GEMINI_API_KEY=AIzaSy...your_key_here
GEMINI_MODEL=gemini-1.5-pro
# GEMINI_TIMEOUT_MS=10000
# GEMINI_RETRY_MAX=3
```

---

## Sample API Call

```bash
curl -X POST http://localhost:3000/api/copilot \
  -H 'Content-Type: application/json' \
  -d '{
    "messages": [
      { "role": "user", "content": "Hello! What can you do?" }
    ]
  }'
```

Expected response:

```json
{
  "reply": "I can help you with a wide range of tasks..."
}
```

---

## Architecture Details

### `GeminiClient` (`lib/services/geminiClient.ts`)

Handles raw HTTP communication:

- **Endpoint**: `{GEMINI_ENDPOINT}/models/{model}:generateContent?key={GEMINI_API_KEY}`
- **Method**: `POST`
- **Authentication**: API key as query parameter (`?key=...`)
- **Retry**: Exponential back-off on `429` and `5xx` responses (up to `GEMINI_RETRY_MAX` retries)
- **Timeout**: Uses `AbortSignal.timeout(GEMINI_TIMEOUT_MS)` — throws `TimeoutError` on expiry
- **Errors**: Non-retryable errors throw `GeminiAPIError(status, message, body)`

### `GeminiAdapter` (`lib/adapters/geminiAdapter.ts`)

Maps internal `LLMRequest` → Gemini payload → `LLMResponse`:

| Internal role | Gemini role |
|---------------|-------------|
| `user`        | `user`      |
| `assistant`   | `model`     |
| `system`      | `systemInstruction` (top-level field) |

Response mapping:

```
candidates[0].content.parts[].text  →  LLMResponse.content  (parts joined)
model (from request)                 →  LLMResponse.model
"gemini"                             →  LLMResponse.provider
```

---

## Error Handling

| Condition              | Behaviour                                                  |
|------------------------|------------------------------------------------------------|
| `429 / 5xx`            | Retried with exponential back-off up to `GEMINI_RETRY_MAX` |
| `4xx` (except `429`)   | `GeminiAPIError` thrown immediately (no retry)             |
| Timeout                | `TimeoutError` thrown immediately (no retry)               |
| Route handler          | `504` for timeout, `401/403` for auth, `502` for others    |

---

## Supported Models

Common Gemini model names (see [Google AI documentation](https://ai.google.dev/gemini-api/docs/models/gemini) for the full list):

- `gemini-1.5-pro` (default)
- `gemini-1.5-flash`
- `gemini-2.0-flash`
- `gemini-2.0-flash-lite`

---

## Running Tests

```bash
# All tests (unit + integration)
npm test

# Unit tests only
npx jest __tests__/unit/

# Integration tests only
npx jest __tests__/integration/
```
