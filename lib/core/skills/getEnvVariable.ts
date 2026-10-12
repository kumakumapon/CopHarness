import { type SkillDefinition } from '../skill';

/**
 * Returns the value of an explicitly allowed environment variable.
 * The allowlist is configured via EXPOSED_ENV_VARS (comma-separated list of variable names).
 * Defaults to a safe set of non-secret variables if EXPOSED_ENV_VARS is not set.
 */

const DEFAULT_EXPOSED_VARS = [
  'NODE_ENV',
  'COPILOT_PROVIDER',
  'COPILOT_MODEL',
  'TZ',
  'LANG',
  'HOME',
  'USER',
  'SHELL',
  'PATH',
];

function getExposedSet(): Set<string> {
  const env = process.env.EXPOSED_ENV_VARS;
  if (env && env.trim()) {
    return new Set(env.split(',').map((s) => s.trim()).filter(Boolean));
  }
  return new Set(DEFAULT_EXPOSED_VARS);
}

export const getEnvVariable: SkillDefinition = {
  name: 'getEnvVariable',
  description:
    'Returns the value of a permitted environment variable. ' +
    'The list of allowed variables is configured via the EXPOSED_ENV_VARS environment variable ' +
    '(comma-separated). When not set, a small default set of non-secret variables is exposed.',
  parameters: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Name of the environment variable to retrieve.',
      },
    },
    required: ['name'],
  },
  category: 'system',
  riskLevel: 'low',
  handler: async (args) => {
    const name = String(args.name ?? '').trim();
    if (!name) return { content: 'Error: name is required', isError: true };
    const allowed = getExposedSet();
    if (!allowed.has(name)) {
      return {
        content: `Error: variable "${name}" is not in the exposed variables list. Allowed: ${[...allowed].join(', ')}`,
        isError: true,
      };
    }
    const value = process.env[name];
    if (value === undefined) return { content: `(not set)` };
    return { content: value };
  },
};
