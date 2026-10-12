/**
 * Child-process worker for the cross-process lock tests (run through tsx).
 *   mode "counter": read-modify-write a counter file under withFileLockSync
 *   mode "schedule": addSchedule() against SCHEDULES_FILE
 *   modes "identity" | "task" | "proposal" | "history" | "violation": the cached JSON stores (DATA_DIR)
 */
import * as fs from 'fs';
import { addSchedule } from '../../lib/extensions/automation/scheduler/store';
import { resolveIdentity } from '../../lib/extensions/channels/identity/store';
import { startTask } from '../../lib/extensions/tasks/ledger';
import { createSkillProposal } from '../../lib/extensions/skill-proposals/store';
import { saveHistory } from '../../lib/extensions/conversations/store';
import { recordViolation } from '../../lib/core/guardrails/violationLog';
import { atomicWriteJsonSync, readJsonFileSync, withFileLockSync } from '../../lib/core/utils/jsonFile';

const [mode, target, countArg, tag] = process.argv.slice(2);
const count = Number(countArg);

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

async function main(): Promise<void> {
  for (let i = 0; i < count; i += 1) {
    const name = `${tag}-${i}`;
    if (mode === 'counter') {
      withFileLockSync(target, () => {
        const current = readJsonFileSync<{ n: number }>(target, () => ({ n: 0 }));
        sleepSync(2); // widen the race window
        atomicWriteJsonSync(target, { n: current.n + 1 });
      }, { timeoutMs: 20_000 });
    } else if (mode === 'schedule') {
      addSchedule({ name, cron: '* * * * *', prompt: 'p' });
    } else if (mode === 'identity') {
      await resolveIdentity('api', name);
    } else if (mode === 'task') {
      await startTask({ id: name, kind: 'chat' });
    } else if (mode === 'proposal') {
      await createSkillProposal({
        name: `skill_${tag}_${i}`,
        description: 'd',
        problem: 'p',
        proposedCode: 'return "ok";',
        testPlan: [],
        riskLevel: 'low',
      });
    } else if (mode === 'history') {
      await saveHistory(name, [{ role: 'user', content: name }]);
    } else if (mode === 'violation') {
      recordViolation(name, ['e'], 'c');
    }
  }
  fs.writeSync(1, 'done');
}

main().catch((err) => {
  fs.writeSync(2, String(err && err.stack ? err.stack : err));
  process.exit(1);
});
