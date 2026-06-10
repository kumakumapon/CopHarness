import { NextRequest, NextResponse } from 'next/server';
import { requireApiKey } from '../../../../lib/apiAuth';
import { listToolsets } from '../../../../lib/skills/toolsets';
import { listMcpServers } from '../../../../lib/mcp/registry';
import { listSkills, listActiveSkills } from '../../../../lib/skill';
import { matchesGlob } from '../../../../lib/skills/toolsets';
import '../../../../lib/skills/index';

export async function GET(req: NextRequest) {
  const unauthorized = requireApiKey(req);
  if (unauthorized) return unauthorized;

  const activeNames = new Set(listActiveSkills().map((s) => s.name));
  const registeredSkills = new Map(listSkills().map((s) => [s.name, s]));

  const toolsets = listToolsets().map((toolset) => {
    // For each pattern in the toolset, find matching skills
    const skillEntries = toolset.skills.flatMap((pattern) => {
      const matched = Array.from(registeredSkills.values()).filter((s) =>
        matchesGlob(pattern, s.name),
      );
      if (matched.length > 0) {
        return matched.map((s) => ({
          name: s.name,
          riskLevel: s.riskLevel ?? 'low',
          active: activeNames.has(s.name),
          registered: true,
        }));
      }
      // Pattern matched nothing — include as unregistered placeholder
      return [{ name: pattern, riskLevel: 'low' as const, active: false, registered: false }];
    });

    // Deduplicate by name
    const seen = new Set<string>();
    const dedupedSkills = skillEntries.filter((e) => {
      if (seen.has(e.name)) return false;
      seen.add(e.name);
      return true;
    });

    return {
      name: toolset.name,
      description: toolset.description,
      source: toolset.source,
      skillCount: dedupedSkills.filter((s) => s.registered).length,
      skills: dedupedSkills,
    };
  });

  return NextResponse.json({ toolsets, mcpServers: listMcpServers() });
}
