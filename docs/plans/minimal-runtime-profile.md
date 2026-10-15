# Minimal runtime profile implementation plan

Draft PR is opened before implementation as requested.

- Add explicit minimal/full runtime profiles; preserve existing behavior in full mode.
- In minimal mode, register only explicitly selected core tools, without loading extension skill packs or generated skills.
- Disable optional API/UI surfaces, bot/scheduler/watcher startup, persistence, detailed telemetry and automatic LLM summarization.
- Keep provider access, single-agent execution, validation, authentication, cancellation, tool policy and configured budget limits.
- Separate optional adapter decoration and persistence from core runtime composition.
- Add regression coverage and run tests, lint, typecheck, mock evaluation and production build/runtime smoke checks.
- Update this record and the PR with actual verification results, then mark the PR ready for review.
