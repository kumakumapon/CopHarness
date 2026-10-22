# Patched Node.js runtime baseline

Draft PR #170 was opened with this plan before implementation.

## Changes

- Require Node.js 22.23.4+ within major 22, 24.22.1+ within major 24, or 26.12.1+ within major 26. Package and lockfile engines use `^22.23.4 || ^24.22.1 || ^26.12.1`.
- Default local development to Node.js 24.22.1 using `.nvmrc`; `.npmrc` enables strict engine checks for installation.
- Run the existing complete CI pipeline independently on all three minimum releases.
- Update setup instructions and the system-information example.
- Keep guarded HTTP requests on the same Undici implementation as their dispatcher. Node 26's built-in fetch uses a different handler API from the installed Undici Agent; mixing them caused `invalid onError method` failures. Matching fetch and Agent preserves DNS-rebinding and redirect checks without changing dependency versions.

## Verification

- All three releases were present in the official Node.js distribution index; downloaded Linux x64 binaries passed the published SHA-256 checksum checks.
- Full Jest suite passed on each of 22.23.4, 24.22.1 and 26.12.1: 96 suites / 1,536 tests per runtime.
- Guarded HTTP integration tests passed on Node 26, including private-address rejection, DNS-rebinding prevention, allowed-host requests and redirect validation. RSS unit fixtures now intercept the matching Undici fetch client.
- Lint, TypeScript, seven mock evaluation scenarios and the production build passed on Node 24.22.1.
- The production build passed the existing minimal/full HTTP and CLI smoke checks under all three runtimes using a local fixed-response provider.
- Production dependency audit reported zero vulnerabilities.
- Semver boundary checks accepted the three patched minima and subsequent minor releases, rejected earlier patches and unsupported major branches, and verified package/lockfile/.nvmrc consistency.
- An installation dry run under the previous Node.js 24.19.0 was rejected with `EBADENGINE`.

Deployments must also update their installed runtime, reinstall dependencies, rebuild and restart services. Repository configuration alone does not replace already running Node.js processes. No deployment or external LLM request was performed.
