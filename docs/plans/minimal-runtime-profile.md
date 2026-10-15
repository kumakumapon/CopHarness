# Minimal runtime profile implementation record

Draft PR #168 was opened with only this plan before implementation.

- [x] Add `COPHARNESS_PROFILE=minimal|full`; keep full as the default.
- [x] Minimal mode registers only explicitly selected core tools; empty/none means no tools. Extension and generated skills are not initialized.
- [x] Disable optional HTTP/UI surfaces, bot/automation startup, persistent harness records, detailed telemetry, cache, provider fallback and automatic summarization.
- [x] Preserve CLI and HTTP chat/stream/single-agent execution, authentication, cancellation, validation, tool policy, approval gates and configured budgets.
- [x] Separate optional adapter decorators and persistent services from core composition. Move budget enforcement and cancellation into core; keep compatibility exports.
- [x] Restrict Copilot SDK sessions to supplied harness tools, with optional SDK memory, shared store, skills, hooks and compaction disabled.
- [x] Document settings and add regression and production smoke checks to CI.

## Verification

- Jest: 96 suites / 1,536 tests passed.
- Lint and TypeScript checks passed.
- Seven deterministic mock evaluation scenarios passed.
- Production build passed.
- Production smoke checks passed against a local OpenAI-compatible fixture server: minimal/full HTTP chat, SSE, agent completion, API authentication, optional-route behavior, full extension registration and persistence.
- Both CLI entry points loaded the profile from `.env.local`, obtained real adapter responses from the local fixture, and exited without saving in minimal mode.
- Discord startup was skipped in minimal mode even with a token configured.
- Production dependency audit: zero vulnerabilities.

`npm run smoke:profiles` reproduces the production checks after `npm run build`. The RSS unit fixture also mocks DNS (HTTP was already mocked), removing an unrelated dependency on live external DNS from the regression run.

## Scope and limits

Minimal budgets and approvals are process-local; they reset on restart and are not shared between workers. Persistent conversation/session resume is disabled. Existing saved data is retained. Approval APIs remain accessible for core tool policy; other optional routes return 404. Restart when changing the profile.

The bare core adapter factory does not load extensions; import `lib/bootstrap` first to apply the selected composition, as all application entry points do. Real external LLM/channel calls were not made. Copilot SDK settings were checked against installed SDK types and exercised through the SDK mock; the SDK runtime's own authentication/diagnostic storage is outside the harness DATA_DIR contract.
