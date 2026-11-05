/**
 * Child-process worker for the cross-process lock tests (run through tsx).
 *   mode "counter":  read-modify-write a counter file under withFileLockSync
 *   mode "schedule": ScheduleStore.add() against the data directory given as target
 */
import * as fs from 'fs';
import { ScheduleStore } from '../../lib/scheduler';
import { atomicWriteJsonSync, readJsonFileSync, withFileLockSync } from '../../lib/util/jsonFile';

const [mode, target, countArg, tag] = process.argv.slice(2);
const count = Number(countArg);

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

for (let i = 0; i < count; i += 1) {
  if (mode === 'counter') {
    withFileLockSync(target, () => {
      const current = readJsonFileSync<{ n: number }>(target, () => ({ n: 0 }));
      sleepSync(2); // widen the race window
      atomicWriteJsonSync(target, { n: current.n + 1 });
    }, { timeoutMs: 20_000 });
  } else if (mode === 'schedule') {
    new ScheduleStore(target).add({ name: `${tag}-${i}`, cron: '* * * * *', prompt: 'p' });
  }
}
fs.writeSync(1, 'done');
