export type GeneratedSkillPermission = 'env' | 'network' | 'dependencies';

export interface GeneratedSkillManifest {
  name: string;
  version: string;
  riskLevel: 'low' | 'medium' | 'high';
  permissions: GeneratedSkillPermission[];
  allowedEnv: string[];
  allowedNetworkDestinations: string[];
  npmDependencies: string[];
}

const NAME_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]{2,63}$/;
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const VALID_PERMISSIONS = new Set<GeneratedSkillPermission>(['env', 'network', 'dependencies']);

function parseListEnv(name: string): Set<string> {
  return new Set(
    (process.env[name] ?? '')
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean),
  );
}

export function defaultGeneratedSkillManifest(input: {
  name: string;
  riskLevel: 'low' | 'medium' | 'high';
}): GeneratedSkillManifest {
  return {
    name: input.name,
    version: '0.1.0',
    riskLevel: input.riskLevel,
    permissions: [],
    allowedEnv: [],
    allowedNetworkDestinations: [],
    npmDependencies: [],
  };
}

export function normalizeGeneratedSkillManifest(
  manifest: Partial<GeneratedSkillManifest> | undefined,
  fallback: { name: string; riskLevel: 'low' | 'medium' | 'high' },
): GeneratedSkillManifest {
  return {
    ...defaultGeneratedSkillManifest(fallback),
    ...(manifest ?? {}),
    permissions: Array.isArray(manifest?.permissions) ? manifest.permissions : [],
    allowedEnv: Array.isArray(manifest?.allowedEnv) ? manifest.allowedEnv : [],
    allowedNetworkDestinations: Array.isArray(manifest?.allowedNetworkDestinations)
      ? manifest.allowedNetworkDestinations
      : [],
    npmDependencies: Array.isArray(manifest?.npmDependencies) ? manifest.npmDependencies : [],
  };
}

export function validateGeneratedSkillManifest(manifest: GeneratedSkillManifest): void {
  if (!NAME_PATTERN.test(manifest.name)) {
    throw new Error(`Invalid generated skill manifest name "${manifest.name}".`);
  }
  if (!VERSION_PATTERN.test(manifest.version)) {
    throw new Error(`Invalid generated skill manifest version "${manifest.version}"; use semver like 0.1.0.`);
  }
  if (!['low', 'medium', 'high'].includes(manifest.riskLevel)) {
    throw new Error(`Invalid generated skill manifest riskLevel "${manifest.riskLevel}".`);
  }

  const unknownPermission = manifest.permissions.find((p) => !VALID_PERMISSIONS.has(p));
  if (unknownPermission) throw new Error(`Unknown generated skill permission "${unknownPermission}".`);

  const allowedDeps = parseListEnv('GENERATED_SKILL_ALLOWED_DEPENDENCIES');
  for (const dep of manifest.npmDependencies) {
    if (!allowedDeps.has(dep)) {
      throw new Error(`Generated skill dependency "${dep}" is not approved. Add it to GENERATED_SKILL_ALLOWED_DEPENDENCIES before registration.`);
    }
  }

  const allowedEnv = parseListEnv('GENERATED_SKILL_ALLOWED_ENV');
  for (const envName of manifest.allowedEnv) {
    if (!allowedEnv.has(envName)) {
      throw new Error(`Generated skill env var "${envName}" is not approved. Add it to GENERATED_SKILL_ALLOWED_ENV before registration.`);
    }
  }

  const allowedNetwork = parseListEnv('GENERATED_SKILL_ALLOWED_NETWORK');
  for (const destination of manifest.allowedNetworkDestinations) {
    if (!allowedNetwork.has(destination)) {
      throw new Error(`Generated skill network destination "${destination}" is not approved. Add it to GENERATED_SKILL_ALLOWED_NETWORK before registration.`);
    }
  }

  if (manifest.npmDependencies.length > 0 && !manifest.permissions.includes('dependencies')) {
    throw new Error('Generated skill manifest lists npmDependencies but does not request the dependencies permission.');
  }
  if (manifest.allowedEnv.length > 0 && !manifest.permissions.includes('env')) {
    throw new Error('Generated skill manifest lists allowedEnv but does not request the env permission.');
  }
  if (manifest.allowedNetworkDestinations.length > 0 && !manifest.permissions.includes('network')) {
    throw new Error('Generated skill manifest lists allowedNetworkDestinations but does not request the network permission.');
  }
}
