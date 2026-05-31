#!/usr/bin/env node
// scripts/verify_copilot_token.js
// Usage (PowerShell):
//   $env:GITHUB_COPILOT_API_KEY='ghp_xxx'; node scripts/verify_copilot_token.js

const token = process.env.GITHUB_COPILOT_API_KEY
if (!token) {
  console.error('Missing GITHUB_COPILOT_API_KEY environment variable.')
  console.error("Set it and re-run. Example (PowerShell): $env:GITHUB_COPILOT_API_KEY='ghp_xxx'; node scripts/verify_copilot_token.js")
  process.exit(2)
}

;(async () => {
  try {
    const res = await fetch('https://api.github.com/copilot_internal/v2/token', {
      headers: {
        Authorization: `token ${token}`,
        'editor-version': 'vscode/1.95.3',
        'editor-plugin-version': 'copilot-chat/0.22.4',
        'user-agent': 'GitHubCopilotChat/0.22.4',
        'Copilot-Integration-Id': 'vscode-chat',
      },
    })

    console.log(`Status: ${res.status} ${res.statusText}`)
    const text = await res.text()
    try {
      const json = JSON.parse(text)
      console.log('Body:', JSON.stringify(json, null, 2))
    } catch (_) {
      console.log('Body:', text)
    }

    if (!res.ok) {
      if (res.status === 403) console.error('403 Forbidden: Resource not accessible by this token (likely token scope/type or org policy).')
      if (res.status === 401) console.error('401 Unauthorized: invalid credentials or expired token.')
      process.exit(1)
    }

    console.log('Token exchange succeeded. Do not share the returned token.')
  } catch (e) {
    console.error('Request failed:', e && e.message ? e.message : String(e))
    process.exit(1)
  }
})()
