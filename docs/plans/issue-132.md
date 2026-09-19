# Issue #132 implementation plan

- Unify agent termination reasons across the loop, CLI, SSE and task ledger.
- Share provider configuration and add a secret-free doctor command; reject invalid execution backends.
- Persist agent sessions, tool execution outcomes and pending questions. Resume explicitly by session ID, preventing automatic replay of side effects with uncertain outcomes.
- Connect CLI and HTTP continuation to saved sessions and conversation context.
- Add regression coverage, deterministic mock evaluation, typecheck and build CI gates.
- Correct onboarding documentation and document recovery and operational limits.

Validation: targeted regression tests, full Jest suite, lint, TypeScript, production build and deterministic mock evaluation. Real provider and channel calls require configured credentials and are outside deterministic validation.

## Implementation and validation result

Implemented structured outcomes in loop/CLI/SSE/ledger/dashboard; shared provider settings in CLI, HTTP and evaluation; offline/optional-online doctor; strict backend configuration; persistent CLI/HTTP sessions with input continuation, tool receipts, replay protection and file leases; CLI completion/multiline input; CI quality gates and recovery documentation.

Local validation: 79 Jest suites / 1,266 tests passed; lint, typecheck, seven deterministic mock-evaluation scenarios and Next.js production build passed. The doctor command was exercised offline. Tests cover HTTP provider parity, disconnect cancellation, question continuation, side-effect reuse, uncertain outcomes, concurrent leases and checkpoint write failure.

Limits: local single-host checkpointing; stale crash leases require operator verification; semantic duplicate detection across different arguments or sessions is not provided. Real LLM/channel/browser performance and P2 coding undo/file selection remain follow-up work. See docs/AGENT_RECOVERY.md.
