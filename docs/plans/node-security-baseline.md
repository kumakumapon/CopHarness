# Patched Node.js runtime baseline

This plan is committed before implementation so a draft PR can be opened first.

- Require patched runtime branches: Node.js 22.23.4+, 24.22.1+, or 26.12.1+.
- Update CI and local runtime selection consistently; do not accept vulnerable earlier patch releases or unsupported intervening major versions.
- Synchronize package and lockfile metadata and document setup/restart requirements.
- Verify release availability, runtime version selection, dependency installation, checks, build and the existing production smoke tests.
- Record actual verification results and mark the PR ready for review when complete.
