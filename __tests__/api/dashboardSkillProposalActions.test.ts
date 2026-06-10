/**
 * Tests for:
 *   POST /api/dashboard/skill-proposals/[id]/test
 *   POST /api/dashboard/skill-proposals/[id]/approve
 *   POST /api/dashboard/skill-proposals/[id]/reject
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { NextRequest } from 'next/server';
import { _resetDataDirCache } from '../../lib/utils/dataDir';
import {
  _resetSkillProposalsForTests,
  createSkillProposal,
  updateSkillProposal,
} from '../../lib/skillProposals/store';

// Dynamic imports to pick up the correct route handlers after env is set
import { POST as testPost } from '../../app/api/dashboard/skill-proposals/[id]/test/route';
import { POST as approvePost } from '../../app/api/dashboard/skill-proposals/[id]/approve/route';
import { POST as rejectPost } from '../../app/api/dashboard/skill-proposals/[id]/reject/route';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let _counter = 0;
function uniqueName(base: string): string {
  _counter += 1;
  return `${base}${String(_counter).padStart(3, '0')}`;
}

const PASSING_CODE = 'module.exports = async (args) => ({ content: "ok" });';
const FAILING_CODE = 'module.exports = async (args) => ({ content: "fail", isError: true });';

function makeTestPlan(expectError = false) {
  return [
    {
      description: 'basic',
      args: {},
      expect: expectError ? { isError: true } : { contains: 'ok' },
    },
  ];
}

function makeRequest(
  url: string,
  method = 'POST',
  body?: object,
  apiKey?: string,
): NextRequest {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
  return new NextRequest(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'copharness-api-actions-'));
  process.env.DATA_DIR = tmpDir;
  _resetDataDirCache();
  _resetSkillProposalsForTests();
});

afterEach(() => {
  delete process.env.DATA_DIR;
  delete process.env.COPHARNESS_API_KEY;
  _resetDataDirCache();
  _resetSkillProposalsForTests();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// POST /test
// ---------------------------------------------------------------------------

describe('POST /api/dashboard/skill-proposals/[id]/test', () => {
  it('runs tests and returns 200 with proposal on success', async () => {
    const name = uniqueName('apiTestPass');
    const proposal = await createSkillProposal({
      name,
      description: 'Test',
      problem: 'p',
      proposedCode: PASSING_CODE,
      testPlan: makeTestPlan(),
      riskLevel: 'low',
    });

    const req = makeRequest(
      `http://localhost:3000/api/dashboard/skill-proposals/${proposal.id}/test`,
    );
    const res = await testPost(req, { params: Promise.resolve({ id: proposal.id }) });

    expect(res.status).toBe(200);
    const data = await res.json() as { proposal: { status: string } };
    expect(data.proposal.status).toBe('awaiting_approval');
  });

  it('returns 404 when proposal does not exist', async () => {
    const req = makeRequest(
      'http://localhost:3000/api/dashboard/skill-proposals/proposal-nonexistent/test',
    );
    const res = await testPost(req, { params: Promise.resolve({ id: 'proposal-nonexistent' }) });

    expect(res.status).toBe(404);
    const data = await res.json() as { error: string };
    expect(data.error).toMatch(/not found/i);
  });

  it('returns 409 when proposal is in a wrong status for testing', async () => {
    const name = uniqueName('apiTestWrongStatus');
    const proposal = await createSkillProposal({
      name,
      description: 'Test',
      problem: 'p',
      proposedCode: PASSING_CODE,
      testPlan: makeTestPlan(),
      riskLevel: 'low',
    });

    // Move to awaiting_approval
    await updateSkillProposal(proposal.id, { status: 'awaiting_approval' });

    const req = makeRequest(
      `http://localhost:3000/api/dashboard/skill-proposals/${proposal.id}/test`,
    );
    const res = await testPost(req, { params: Promise.resolve({ id: proposal.id }) });

    expect(res.status).toBe(409);
    const data = await res.json() as { error: string };
    expect(data.error).toBeTruthy();
  });

  it('requires the dashboard API key when configured', async () => {
    process.env.COPHARNESS_API_KEY = 'secret-test-key';

    const name = uniqueName('apiTestAuth');
    const proposal = await createSkillProposal({
      name,
      description: 'Test',
      problem: 'p',
      proposedCode: PASSING_CODE,
      testPlan: makeTestPlan(),
      riskLevel: 'low',
    });

    // Request without Authorization header
    const req = new NextRequest(
      `http://localhost:3000/api/dashboard/skill-proposals/${proposal.id}/test`,
      { method: 'POST' },
    );
    const res = await testPost(req, { params: Promise.resolve({ id: proposal.id }) });

    expect(res.status).toBe(401);
  });

  it('succeeds with correct API key', async () => {
    process.env.COPHARNESS_API_KEY = 'secret-test-key';

    const name = uniqueName('apiTestAuthOk');
    const proposal = await createSkillProposal({
      name,
      description: 'Test',
      problem: 'p',
      proposedCode: PASSING_CODE,
      testPlan: makeTestPlan(),
      riskLevel: 'low',
    });

    const req = makeRequest(
      `http://localhost:3000/api/dashboard/skill-proposals/${proposal.id}/test`,
      'POST',
      undefined,
      'secret-test-key',
    );
    const res = await testPost(req, { params: Promise.resolve({ id: proposal.id }) });

    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// POST /approve
// ---------------------------------------------------------------------------

describe('POST /api/dashboard/skill-proposals/[id]/approve', () => {
  it('approves an awaiting_approval proposal and returns 200', async () => {
    const name = uniqueName('apiApprovePass');
    const proposal = await createSkillProposal({
      name,
      description: 'Approve',
      problem: 'p',
      proposedCode: PASSING_CODE,
      testPlan: makeTestPlan(),
      riskLevel: 'medium',
    });

    // Move to awaiting_approval via test phase
    await updateSkillProposal(proposal.id, {
      status: 'awaiting_approval',
      approvalRequestId: undefined,
    });

    const req = makeRequest(
      `http://localhost:3000/api/dashboard/skill-proposals/${proposal.id}/approve`,
    );
    const res = await approvePost(req, { params: Promise.resolve({ id: proposal.id }) });

    expect(res.status).toBe(200);
    const data = await res.json() as { proposal: { status: string } };
    expect(['approved', 'registered']).toContain(data.proposal.status);
  });

  it('returns 404 when proposal does not exist', async () => {
    const req = makeRequest(
      'http://localhost:3000/api/dashboard/skill-proposals/proposal-nonexistent/approve',
    );
    const res = await approvePost(req, { params: Promise.resolve({ id: 'proposal-nonexistent' }) });

    expect(res.status).toBe(404);
  });

  it('returns 409 when proposal is in a wrong status for approval', async () => {
    const name = uniqueName('apiApproveWrongStatus');
    const proposal = await createSkillProposal({
      name,
      description: 'Approve',
      problem: 'p',
      proposedCode: PASSING_CODE,
      testPlan: makeTestPlan(),
      riskLevel: 'medium',
    });

    // Still draft — not awaiting_approval
    const req = makeRequest(
      `http://localhost:3000/api/dashboard/skill-proposals/${proposal.id}/approve`,
    );
    const res = await approvePost(req, { params: Promise.resolve({ id: proposal.id }) });

    expect(res.status).toBe(409);
    const data = await res.json() as { error: string };
    expect(data.error).toBeTruthy();
  });

  it('requires the dashboard API key when configured', async () => {
    process.env.COPHARNESS_API_KEY = 'secret-approve-key';

    const name = uniqueName('apiApproveAuth');
    const proposal = await createSkillProposal({
      name,
      description: 'Approve',
      problem: 'p',
      proposedCode: PASSING_CODE,
      testPlan: makeTestPlan(),
      riskLevel: 'medium',
    });

    const req = new NextRequest(
      `http://localhost:3000/api/dashboard/skill-proposals/${proposal.id}/approve`,
      { method: 'POST' },
    );
    const res = await approvePost(req, { params: Promise.resolve({ id: proposal.id }) });

    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// POST /reject
// ---------------------------------------------------------------------------

describe('POST /api/dashboard/skill-proposals/[id]/reject', () => {
  it('rejects a draft proposal and returns 200', async () => {
    const name = uniqueName('apiRejectDraft');
    const proposal = await createSkillProposal({
      name,
      description: 'Reject',
      problem: 'p',
      proposedCode: PASSING_CODE,
      testPlan: makeTestPlan(),
      riskLevel: 'low',
    });

    const req = makeRequest(
      `http://localhost:3000/api/dashboard/skill-proposals/${proposal.id}/reject`,
      'POST',
      { reason: 'Not needed' },
    );
    const res = await rejectPost(req, { params: Promise.resolve({ id: proposal.id }) });

    expect(res.status).toBe(200);
    const data = await res.json() as { proposal: { status: string; errorPreview?: string } };
    expect(data.proposal.status).toBe('rejected');
    expect(data.proposal.errorPreview).toBe('Not needed');
  });

  it('rejects without a reason body', async () => {
    const name = uniqueName('apiRejectNoReason');
    const proposal = await createSkillProposal({
      name,
      description: 'Reject',
      problem: 'p',
      proposedCode: PASSING_CODE,
      testPlan: makeTestPlan(),
      riskLevel: 'low',
    });

    const req = new NextRequest(
      `http://localhost:3000/api/dashboard/skill-proposals/${proposal.id}/reject`,
      { method: 'POST' },
    );
    const res = await rejectPost(req, { params: Promise.resolve({ id: proposal.id }) });

    expect(res.status).toBe(200);
    const data = await res.json() as { proposal: { status: string } };
    expect(data.proposal.status).toBe('rejected');
  });

  it('returns 404 when proposal does not exist', async () => {
    const req = makeRequest(
      'http://localhost:3000/api/dashboard/skill-proposals/proposal-nonexistent/reject',
    );
    const res = await rejectPost(req, { params: Promise.resolve({ id: 'proposal-nonexistent' }) });

    expect(res.status).toBe(404);
  });

  it('returns 409 when proposal is in a non-rejectable status', async () => {
    const name = uniqueName('apiRejectWrongStatus');
    const proposal = await createSkillProposal({
      name,
      description: 'Reject',
      problem: 'p',
      proposedCode: PASSING_CODE,
      testPlan: makeTestPlan(),
      riskLevel: 'medium',
    });

    // Move to awaiting_approval then approve
    await updateSkillProposal(proposal.id, { status: 'awaiting_approval' });

    const req2 = makeRequest(
      `http://localhost:3000/api/dashboard/skill-proposals/${proposal.id}/approve`,
    );
    await approvePost(req2, { params: Promise.resolve({ id: proposal.id }) });

    // Now try to reject a registered proposal — should 409
    const req = makeRequest(
      `http://localhost:3000/api/dashboard/skill-proposals/${proposal.id}/reject`,
    );
    const res = await rejectPost(req, { params: Promise.resolve({ id: proposal.id }) });

    expect(res.status).toBe(409);
  });

  it('requires the dashboard API key when configured', async () => {
    process.env.COPHARNESS_API_KEY = 'secret-reject-key';

    const name = uniqueName('apiRejectAuth');
    const proposal = await createSkillProposal({
      name,
      description: 'Reject',
      problem: 'p',
      proposedCode: PASSING_CODE,
      testPlan: makeTestPlan(),
      riskLevel: 'low',
    });

    const req = new NextRequest(
      `http://localhost:3000/api/dashboard/skill-proposals/${proposal.id}/reject`,
      { method: 'POST' },
    );
    const res = await rejectPost(req, { params: Promise.resolve({ id: proposal.id }) });

    expect(res.status).toBe(401);
  });
});
