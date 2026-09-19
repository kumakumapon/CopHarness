# Issue #132 implementation plan

- Unify agent termination reasons across the loop, CLI, SSE and task ledger.
- Share provider configuration and add a secret-free doctor command; reject invalid execution backends.
- Persist agent sessions, tool execution outcomes and pending questions. Resume explicitly by session ID, preventing automatic replay of side effects with uncertain outcomes.
- Connect CLI and HTTP continuation to saved sessions and conversation context.
- Add regression coverage, deterministic mock evaluation, typecheck and build CI gates.
- Correct onboarding documentation and document recovery and operational limits.

Validation: targeted regression tests, full Jest suite, lint, TypeScript, production build and deterministic mock evaluation. Real provider and channel calls require configured credentials and are outside deterministic validation.
