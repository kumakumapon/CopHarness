import { NextRequest, NextResponse } from 'next/server';
import { requireApiKey } from '../../../../lib/apiAuth';
import { listChannelIdentities, listPeople, type ChannelIdentity } from '../../../../lib/identity/store';
import { listTasks, type TaskRecord } from '../../../../lib/tasks/ledger';

function compareIsoDesc(a?: string, b?: string): number {
  return new Date(b ?? 0).getTime() - new Date(a ?? 0).getTime();
}

export async function GET(req: NextRequest) {
  const unauthorized = requireApiKey(req);
  if (unauthorized) return unauthorized;

  const url = new URL(req.url);
  const limitParam = Number(url.searchParams.get('limit') ?? '50');
  const limit = Number.isFinite(limitParam) ? Math.min(Math.max(1, limitParam), 100) : 50;
  const recentTaskLimitParam = Number(url.searchParams.get('recentTaskLimit') ?? '3');
  const recentTaskLimit = Number.isFinite(recentTaskLimitParam)
    ? Math.min(Math.max(0, recentTaskLimitParam), 10)
    : 3;

  const identitiesByPerson = new Map<string, ChannelIdentity[]>();
  for (const identity of listChannelIdentities()) {
    const identities = identitiesByPerson.get(identity.personId) ?? [];
    identities.push(identity);
    identitiesByPerson.set(identity.personId, identities);
  }

  const tasksByPerson = new Map<string, TaskRecord[]>();
  for (const task of listTasks(1000)) {
    if (!task.personId) continue;
    const tasks = tasksByPerson.get(task.personId) ?? [];
    tasks.push(task);
    tasksByPerson.set(task.personId, tasks);
  }

  const allPeople = listPeople()
    .map((person) => {
      const identities = (identitiesByPerson.get(person.personId) ?? []).sort((a, b) => compareIsoDesc(a.updatedAt, b.updatedAt));
      const tasks = (tasksByPerson.get(person.personId) ?? []).sort((a, b) => compareIsoDesc(a.updatedAt, b.updatedAt));
      const runningTasks = tasks.filter((task) => task.status === 'running');
      return {
        ...person,
        channelIdentities: identities,
        channelCount: identities.length,
        taskCount: tasks.length,
        runningTaskCount: runningTasks.length,
        recentTasks: tasks.slice(0, recentTaskLimit),
      };
    })
    .sort((a, b) => compareIsoDesc(a.updatedAt, b.updatedAt));

  return NextResponse.json({ people: allPeople.slice(0, limit), total: allPeople.length });
}
