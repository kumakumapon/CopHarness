// PreToolUse hook example: refuse bash commands that read credential files.
// Receives {"event","sessionId","tool","input"} on stdin. Exit code 2 blocks the call.
let data = '';
process.stdin.on('data', c => { data += c; });
process.stdin.on('end', () => {
  const { input } = JSON.parse(data || '{}');
  const command = String(input?.command ?? '');
  if (/\.env|id_rsa|\.ssh\/|credentials/i.test(command)) {
    process.stderr.write('認証情報ファイルへのアクセスは禁止されています');
    process.exit(2);
  }
  process.exit(0);
});
