import os from 'node:os';
import { type SkillDefinition } from '../skill';

function bytesToMb(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

function uptimeToHuman(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const parts = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(' ');
}

export const getSystemInfo: SkillDefinition = {
  name: 'getSystemInfo',
  description: 'Returns information about the host system: OS, CPU, memory, uptime, and Node.js version.',
  parameters: {
    type: 'object',
    properties: {},
  },
  category: 'system',
  riskLevel: 'low',
  handler: async () => {
    const cpus = os.cpus();
    const lines = [
      `🖥️  OS: ${os.type()} ${os.release()} (${os.arch()})`,
      `📛 Hostname: ${os.hostname()}`,
      `⏱️  Uptime: ${uptimeToHuman(os.uptime())}`,
      `💾 Memory: ${bytesToMb(os.totalmem() - os.freemem())} used / ${bytesToMb(os.totalmem())} total`,
      `🔧 CPUs: ${cpus.length}× ${cpus[0]?.model ?? 'unknown'} @ ${((cpus[0]?.speed ?? 0) / 1000).toFixed(2)} GHz`,
      `🟢 Node.js: ${process.version}`,
      `📁 CWD: ${process.cwd()}`,
    ];
    return { content: lines.join('\n') };
  },
};
