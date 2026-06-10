import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { NextRequest } from 'next/server';
import { GET } from '../../app/api/dashboard/skill-proposals/route';
import {
  _resetSkillProposalsForTests,
  createSkillProposal,
  updateSkillProposal,
} from '../../lib/skillProposals/store';
import { _resetDataDirCache } from '../../lib/utils/dataDir';

describe('GET /api/dashboard/skill-proposals', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'copharness-dashboard-proposals-'));
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

  function makeRequest(url = 'http://localhost:3000/api/dashboard/skill-proposals') {
    return new NextRequest(url, { method: 'GET' });
  }

  it('returns all proposals when no filters are applied', async () => {
    await createSkillProposal({
      name: 'propAlpha',
      description: 'First proposal',
      problem: 'Some problem',
      proposedCode: 'return { content: "x" };',
      testPlan: [],
      riskLevel: 'low',
    });
    await createSkillProposal({
      name: 'propBeta',
      description: 'Second proposal',
      problem: 'Another problem',
      proposedCode: 'return { content: "y" };',
      testPlan: [],
      riskLevel: 'high',
    });

    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const data = await res.json() as { proposals: unknown[]; total: number };
    expect(data.total).toBe(2);
    expect(data.proposals).toHaveLength(2);
  });

  it('filters proposals by status', async () => {
    const p1 = await createSkillProposal({
      name: 'draftSkill',
      description: 'Draft',
      problem: 'p',
      proposedCode: '',
      testPlan: [],
      riskLevel: 'low',
    });
    const p2 = await createSkillProposal({
      name: 'testingSkill',
      description: 'Testing',
      problem: 'p',
      proposedCode: '',
      testPlan: [],
      riskLevel: 'medium',
    });
    await updateSkillProposal(p2.id, { status: 'testing' });

    const res = await GET(
      makeRequest('http://localhost:3000/api/dashboard/skill-proposals?status=testing'),
    );
    expect(res.status).toBe(200);
    const data = await res.json() as { proposals: Array<{ id: string }>; total: number };
    expect(data.total).toBe(1);
    expect(data.proposals[0].id).toBe(p2.id);
  });

  it('filters proposals by nameQuery (partial match)', async () => {
    await createSkillProposal({
      name: 'weatherHelper',
      description: 'Weather',
      problem: 'p',
      proposedCode: '',
      testPlan: [],
      riskLevel: 'low',
    });
    await createSkillProposal({
      name: 'calcTaxes',
      description: 'Tax',
      problem: 'p',
      proposedCode: '',
      testPlan: [],
      riskLevel: 'low',
    });

    const res = await GET(
      makeRequest('http://localhost:3000/api/dashboard/skill-proposals?nameQuery=weather'),
    );
    expect(res.status).toBe(200);
    const data = await res.json() as { proposals: Array<{ name: string }>; total: number };
    expect(data.total).toBe(1);
    expect(data.proposals[0].name).toBe('weatherHelper');
  });

  it('filters proposals by riskLevel', async () => {
    await createSkillProposal({
      name: 'lowRiskSkill',
      description: 'Low',
      problem: 'p',
      proposedCode: '',
      testPlan: [],
      riskLevel: 'low',
    });
    await createSkillProposal({
      name: 'highRiskSkill',
      description: 'High',
      problem: 'p',
      proposedCode: '',
      testPlan: [],
      riskLevel: 'high',
    });

    const res = await GET(
      makeRequest('http://localhost:3000/api/dashboard/skill-proposals?riskLevel=high'),
    );
    expect(res.status).toBe(200);
    const data = await res.json() as { proposals: Array<{ name: string }>; total: number };
    expect(data.total).toBe(1);
    expect(data.proposals[0].name).toBe('highRiskSkill');
  });

  it('requires the dashboard API key when configured', async () => {
    process.env.COPHARNESS_API_KEY = 'secret-key';
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
  });

  it('respects the limit query parameter', async () => {
    for (let i = 0; i < 5; i++) {
      await createSkillProposal({
        name: `limSkill${String(i).padStart(2, '0')}x`,
        description: 'x',
        problem: 'p',
        proposedCode: '',
        testPlan: [],
        riskLevel: 'low',
      });
    }

    const res = await GET(
      makeRequest('http://localhost:3000/api/dashboard/skill-proposals?limit=2'),
    );
    expect(res.status).toBe(200);
    const data = await res.json() as { proposals: unknown[]; total: number };
    expect(data.proposals).toHaveLength(2);
    expect(data.total).toBe(5);
  });
});
