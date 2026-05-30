#!/usr/bin/env node
// Starts the Discord bot only when DISCORD_BOT_TOKEN is configured.
// Called by npm run dev / npm start via concurrently.
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const envPath = path.join(root, '.env.local');
const stripWrappingQuotes = (raw) => {
  if (!raw) return raw;
  if (
    (raw.startsWith('"') && raw.endsWith('"')) ||
    (raw.startsWith("'") && raw.endsWith("'"))
  ) {
    return raw.slice(1, -1);
  }
  return raw;
};

if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = stripWrappingQuotes(trimmed.slice(eqIdx + 1).trim());
    if (key && !(key in process.env)) {
      process.env[key] = value;
    }
  }
}

if (!process.env.DISCORD_BOT_TOKEN) {
  console.log('[Discord] DISCORD_BOT_TOKEN not set — Discord bot skipped.');
  process.exit(0);
}

const { spawn } = require('child_process');
const bot = spawn(
  'npx',
  ['tsx', path.join(root, 'discord', 'bot.ts')],
  { stdio: 'inherit', cwd: root, shell: process.platform === 'win32' },
);

bot.on('exit', (code) => process.exit(code ?? 0));
