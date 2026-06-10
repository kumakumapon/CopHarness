import { NextRequest } from 'next/server';
import { POST } from '../../app/api/dashboard/tasks/[id]/agent-dag/retry/route';
import { retryAgentDagNode } from '../../lib/agents/dagRunner';

jest.mock('../../lib/agents/dagRunner', () => ({
  retryAgentDagNode: jest.fn(),
}));

const retryMock = retryAgentDagNode as jest.MockedFunction<typeof retryAgentDagNode>;

describe('POST /api/dashboard/tasks/:id/agent-dag/retry', () => {
  afterEach(() => {
    delete process.env.COPHARNESS_API_KEY;
    jest.resetAllMocks();
  });

  function request(body: unknown, init: ConstructorParameters<typeof NextRequest>[1] = {}) {
    return new NextRequest('http://localhost:3000/api/dashboard/tasks/task_1/agent-dag/retry', {
      method: 'POST',
      body: JSON.stringify(body),
      ...init,
    });
  }

  const context = { params: Promise.resolve({ id: 'task_1' }) };

  it('retries the requested DAG plan', async () => {
    retryMock.mockResolvedValue({
      runId: 'run_1',
      taskId: 'task_1',
      status: 'succeeded',
      progress: [],
      results: [],
      durationMs: 10,
    });

    const res = await POST(request({ planId: 'build' }), context);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(retryMock).toHaveBeenCalledWith('task_1', 'build');
    expect(data.result).toMatchObject({ status: 'succeeded' });
  });

  it('validates planId', async () => {
    const res = await POST(request({}), context);
    await expect(res.json()).resolves.toMatchObject({ error: 'planId (string) is required' });
    expect(res.status).toBe(400);
    expect(retryMock).not.toHaveBeenCalled();
  });

  it('returns conflict details when retry cannot run', async () => {
    retryMock.mockRejectedValue(new Error('dependency failed'));

    const res = await POST(request({ planId: 'test' }), context);

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({ error: 'dependency failed' });
  });

  it('requires dashboard API key when configured', async () => {
    process.env.COPHARNESS_API_KEY = 'secret';
    const res = await POST(request({ planId: 'build' }), context);
    expect(res.status).toBe(401);
  });
});
