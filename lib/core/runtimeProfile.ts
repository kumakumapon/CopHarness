/** A process uses one profile for its lifetime. Restart after changing the environment. */
export function runtimeProfile(): 'full' | 'minimal' {
  const value = process.env.COPHARNESS_PROFILE?.trim().toLowerCase() || 'full';
  if (value !== 'full' && value !== 'minimal') {
    throw new Error('COPHARNESS_PROFILE must be full or minimal');
  }
  return value;
}

export function isMinimalRuntime(): boolean {
  return runtimeProfile() === 'minimal';
}
