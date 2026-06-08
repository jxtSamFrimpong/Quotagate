# Workstream WS_09: Full Contamination Test Suite & Phase-1 Sign-Off

> A workstream scopes ~1 day of work and is more detailed than its parent phase: concrete goals +
> deliverables, locked decisions (with rejected alternatives), a task breakdown, cross-task
> contracts, and success/quality gates. It is the bridge from phase goals to hour-sized tasks.

## Workstream Overview
- **Parent Phase**: [Phase 1C — Tool Calling & Acceptance](../phases/01c_tool_calling_and_acceptance.md)
- **Timeframe**: ~1 day
- **Status**: Proposed
- **Dependencies**: WS_07 signed off (tool-call validator and response builder branches; tool-call integration test; invariant #1 proof) AND WS_08 signed off (retry loop fully exercised at proxy level; `router.ts` integrated; `proxy.ts` migrated). Both must be green-gate-clean before this workstream begins. This workstream is an acceptance/proof workstream, not a development workstream — it writes no new production code.

---

## Goals & Deliverables

- **Goal 1**: The full contamination test suite — all three sub-cases from spec §6, exercised via real OpenAI SDK concurrency against the live Fastify server.
  - Deliverable: `tests/integration/contamination.sequential.test.ts` — already authored in WS_03 at the adapter level; extended here to run through the full HTTP proxy path (OpenAI SDK → Fastify → adapter → subprocess).
  - Deliverable: `tests/integration/contamination.concurrent.test.ts` — two simultaneous `client.chat.completions.create()` calls from the OpenAI SDK in parallel (D-1C-04); assert neither response contains the other's content. Real HTTP-level concurrency, not `Promise.all` at the adapter level.
  - Deliverable: `tests/integration/contamination.retryPath.test.ts` — forced retry on request A (malformed first response via test double per D-1C-02); independent request B sent immediately after; assert B's response contains no trace of A's correction context. Proves invariant #10 on the error path.

- **Goal 2**: The retry-exhaustion integration test through the full HTTP path.
  - Deliverable: Additional case in `tests/integration/` (or in the contamination suite) — three consecutive malformed responses from a test double cause the Fastify server to return HTTP 500 with a descriptive, non-leaking error body (no raw model output, no stack trace). The error body conforms to the OpenAI error format and is surfaced by the OpenAI SDK as an `APIError`.

- **Goal 3**: Phase-1 green-gate sign-off — the complete Phase 1 acceptance criteria from spec §6, validated in one final run.
  - Deliverable: WS_09 sign-off IS the Phase 1 sign-off. The sign-off records: all spec §6 criteria checked; all three contamination sub-cases passing; tool-call path proven; retry-exhaustion path proven; green gate (`npm test`, `typecheck`, `lint`, `format`) clean. The sign-off note is recorded in CLAUDE.md Session State and updates the Phase 1C plan status to Completed.

---

## Why This Workstream Matters

The contamination tests are the proof that the spec's core safety guarantee — "no state leaks across requests" (invariant #10) — holds in practice, not just in theory. On the subprocess transport, this guarantee is free (fresh OS process per request), but "free by construction" is only safe if a test is there to catch the day the construction changes. Phase 2's MCP upgrade is exactly such a construction change: when a persistent MCP session is introduced, invariants #10 and #11 must be *re-earned* by the `_mcp_lock`. These contamination tests are the regression guard that the MCP upgrade must keep green. If WS_09 is not written, Phase 2's MCP work has no automated proof that it preserved the isolation guarantee.

The concurrent sub-case (D-1C-04) uses real OpenAI SDK concurrency because the spec frames the test as "fire A and B in parallel as an OpenAI SDK client would." Testing only at the adapter layer would miss the Fastify request-handling layer — the actual concurrency surface in production is HTTP, not a `Promise.all` inside a test.

WS_09 is the formal close of Phase 1. Nothing in Phase 2 begins until WS_09 is signed off. The MCP upgrade (Phase 2 head) depends on this gate because it must inherit the contamination test suite and keep it green. That dependency is structural, not optional.

---

## Locked Decisions

### WS_09-D1 — Contamination Tests Satisfy Invariant #10 via Fresh-Process Isolation; `_mcp_lock` Is Not Phase 1 ✅ LOCKED (Architect, 2026-06-08)
Inherits **D-SEQ-01** from CLAUDE.md and the parent phase plan.

**Decision**: On the `claude --print` subprocess transport, contamination isolation holds by construction — each request is a fresh OS process that exits after one response. The three contamination sub-cases pass because of this construction, not because of any serialization mechanism built by Quotagate. The `_mcp_lock` (invariant #11) and the persistent MCP session are not in Phase 1 and are not tested here.

**Rationale**: D-SEQ-01 explicitly states that invariants #10 and #11 need no machinery in Phase 1 because the subprocess transport provides isolation for free. The contamination tests are not testing a Quotagate mechanism — they are asserting a property that must be preserved by future mechanisms. Recording why they pass in Phase 1 (fresh-process isolation) is as important as recording that they pass.

**Phase 2 implication (documented here, not implemented)**: The Phase 2 MCP upgrade introduces `_mcp_lock` serialization to re-earn invariant #10. The contamination test suite must remain green after that upgrade. If any of the three sub-cases fail after the MCP migration, the MCP upgrade has introduced a state-leak bug, and the fix is in the MCP adapter, not in these tests.

**Rejected alternative — implement `_mcp_lock` now to pass the contamination tests "properly"**: Anti-overengineering. There is no MCP session in Phase 1, so there is nothing to serialize. The tests pass correctly without the lock. Implementing the lock against a non-existent session would be dead code that cannot be tested.

### WS_09-D2 — Concurrent Test Uses Real OpenAI SDK Concurrency; Not `Promise.all` at the Adapter Layer ✅ LOCKED (Architect, 2026-06-08)
Inherits **D-1C-04** from the parent phase plan.

**Decision**: The concurrent contamination test fires two simultaneous `client.chat.completions.create()` calls using the `openai` npm SDK against the running Fastify server. Both are in flight at the HTTP level. `Promise.all([createA, createB])` at the test level is the mechanism — this is real HTTP-level concurrency because the Fastify server receives two HTTP requests nearly simultaneously and dispatches them to two separate subprocess invocations.

**Rationale**: Testing only at the adapter layer (two `adapter.complete()` calls with `Promise.all`) skips the Fastify request-handling layer. The spec (§6) frames the concurrent test as "fire A and B in parallel as an OpenAI SDK client would." The test must honor that framing. On the subprocess transport, isolation holds because each HTTP request spawns a separate OS process — the test proves this end-to-end.

**Rejected alternative — test at the adapter layer with `Promise.all`**: Skips the HTTP layer. The Fastify concurrency handling is part of the system under test; a test that bypasses it cannot prove isolation under real-world concurrency.

### WS_09-D3 — Sequential Contamination Sub-Case Migrated to Full HTTP Path ✅ LOCKED (Architect, 2026-06-08)
**Decision**: `tests/integration/contamination.sequential.test.ts`, authored in WS_03 at the adapter level (calling `adapter.complete()` directly), is extended in WS_09 to run through the full HTTP path (OpenAI SDK → Fastify → adapter → subprocess). The adapter-level version is kept as a regression guard for the adapter in isolation; the HTTP-path version is the Phase 1C acceptance criterion.

**Rationale**: The WS_03 sequential test proved the adapter is stateless. WS_09 proves the full proxy stack is stateless. The additional layer (Fastify, `proxy.ts`, `router.ts`) could theoretically introduce state — for example, a request cache, a connection pool, or a shared variable — that the adapter-level test would not catch. The HTTP-path version catches those.

**Rejected alternative — rely on the WS_03 adapter-level sequential test as the Phase 1C criterion**: Insufficient. The Phase 1C contamination criterion is explicitly about the full proxy path, not just the adapter.

### WS_09-D4 — Retry-Path Contamination Test Uses the Same `vi.fn()` Double Pattern as WS_08-D1 ✅ LOCKED (Architect, 2026-06-08)
Inherits **D-1C-02** from the parent phase plan.

**Decision**: The retry-path contamination test in WS_09 uses a `vi.fn()` double to inject a malformed first response for request A (triggering the retry loop). Request B is sent concurrently or immediately after. The double is wired at the adapter boundary so the full proxy path is exercised. The assertion is on request B's response content — it must contain no trace of the correction context from A's retry.

**Rationale**: The only reliable way to force a retry deterministically is a controlled test double. A real malformed response from `claude --print` is non-deterministic. The double injects the exact malformed payload needed to trigger the retry, then returns a well-formed response on attempt 2. Request B gets its own adapter call (a separate subprocess) and should have no knowledge of A's correction note.

**Rejected alternative — wait for a real malformed response from the model**: Non-deterministic. The retry-path sub-case would be labeled "manual only" rather than automated. The spec (§6) requires all three contamination sub-cases to pass — a manual-only sub-case does not satisfy the acceptance criterion.

---

## Task Breakdown

| Task ID | Description | Est. Duration | Status | Task Tracker Link |
|---------|-------------|---------------|--------|-------------------|
| T1 | Extend `tests/integration/contamination.sequential.test.ts` to run through the full HTTP path (OpenAI SDK → Fastify → subprocess). Call A: distinctive UUID token. Call B: probe. Assert B's response has no trace of A's token through the HTTP path. Guard with `healthCheck()` skip. | ~45 min | ⬚ Not started | `../../active/TASK_WS09_T1.md` |
| T2 | Author `tests/integration/contamination.concurrent.test.ts`: `Promise.all` of two simultaneous `client.chat.completions.create()` calls (A with a distinctive UUID token, B with a different prompt). Assert neither response contains the other's token or content. Document in the test: "isolation holds on subprocess because each HTTP request spawns a separate OS process; this test is the regression guard for Phase 2's MCP `_mcp_lock`." | ~1 hour | ⬚ Not started | `../../active/TASK_WS09_T2.md` |
| T3 | Author `tests/integration/contamination.retryPath.test.ts`: `vi.fn()` double injects malformed first response for request A; request B fires immediately (or concurrently) with no double. Assert A eventually resolves (attempt 2 succeeds with real adapter); assert B's response contains no trace of A's correction note content. | ~1 hour | ⬚ Not started | `../../active/TASK_WS09_T3.md` |
| T4 | Phase-1 green-gate sign-off: run the full suite (`npm test`, `typecheck`, `lint`, `format`). Fix any issues. Verify all Phase 1A/1B/1C acceptance criteria from spec §6 are satisfied by the test suite. Update CLAUDE.md Session State with Phase 1 sign-off note. Update phase plan statuses (01a, 01b, 01c) to Completed. Record what is next (Phase 2 head: MCP upgrade). | ~1 hour | ⬚ Not started | `../../active/TASK_WS09_T4.md` |

*Status: `✅ Completed` | `🔄 In Progress` | `⬚ Not started` | `❌ Blocked`*

*T1, T2, and T3 are independent and can run in any order or in parallel. T4 is the close-out and depends on all three passing. If T2 or T3 reveal unexpected failures, investigate the subprocess-spawn path (WS_02/WS_04) before escalating — the most likely cause is shared state in a module-level variable, not a subprocess leak.*

---

## Cross-Task Contracts

### Test server fixture (inherited from WS_06 / WS_07 pattern → consumed by T1, T2, T3)
All three contamination tests use the same `beforeAll`/`afterAll` server lifecycle pattern established in WS_06 and WS_07: `createServer(config, adapters)` factory, `healthCheck()` skip guard, server bound to a test port. T1 reuses the WS_06 fixture directly (or extends it); T2 and T3 follow the same pattern. Do not spin up a new server per test — one server per describe block.

### Adapter-level sequential test (inherited from WS_03 T3 → preserved by T1)
WS_03's `tests/integration/contamination.sequential.test.ts` calls `adapter.complete()` directly. T1 adds an HTTP-path version alongside it in the same file or a companion file. Both versions are kept in the test suite — the adapter-level version is a unit-level guard; the HTTP-path version is the Phase 1C acceptance criterion.

### Phase 1 sign-off (produced by T4 → consumed by Phase 2 planning)
WS_09 T4 is the formal exit from Phase 1. The sign-off in CLAUDE.md Session State records:
- All spec §6 criteria verified: no-tools path, tool-call path, retry path, all three contamination sub-cases.
- Green gate clean.
- Why the contamination tests pass (fresh-process isolation; the property Phase 2's `_mcp_lock` must preserve).
- What is next: Phase 2 head = MCP upgrade (persistent `quotagate_complete` tool server, Mechanism B, installer, MCP client, `_mcp_lock`).

### Contamination token convention (inherited from WS_03-D3 → applied in T1, T2, T3)
Each contamination test uses a fixed UUID constant (not `crypto.randomUUID()` at runtime) as the distinctive token, following WS_03-D3. The UUID is a fixed constant in the test file, commented with its purpose. T2 and T3 use different UUIDs from T1 to prevent cross-test token collisions.

---

## Success & Evaluation Criteria

- **Functional requirements — contamination (all three sub-cases; spec §6)**:
  - [ ] *Sequential (HTTP path)*: OpenAI SDK call A with UUID token → call B "what was the code word?" → B's response contains no trace of the token. (Invariant #10.)
  - [ ] *Concurrent*: Two simultaneous SDK calls (A: UUID token, B: different prompt). `Promise.all` resolves; neither response contains the other's token. (Isolation under real HTTP concurrency; invariant #10/#11 regression guard.)
  - [ ] *Retry-path*: Request A forced to retry (malformed first response via double); request B fires independently; B's response contains no content from A's correction note. (Invariant #10 on the error path.)

- **Functional requirements — retry exhaustion**:
  - [ ] Three consecutive malformed responses (test double) cause the proxy to return HTTP 500 with an OpenAI-format error body; no stack trace; no raw model output in the body.

- **Functional requirements — Phase 1 acceptance criteria (re-confirmed from spec §6)**:
  - [ ] No-tools path: `finish_reason: "stop"`, non-empty `content`, correct `id` prefix. (Re-run from WS_06.)
  - [ ] Tool-call path: `finish_reason: "tool_calls"`, correct function name, parseable arguments, no execution side effect. (Re-run from WS_07.)
  - [ ] Green gate: `npm test` green, `typecheck` clean, `lint` clean, `format` no-diff, no test-count regression.

- **Named tests that prove this workstream done**:
  - [ ] `tests/integration/contamination.sequential.test.ts` (HTTP-path extension) — B's response has no trace of A's token.
  - [ ] `tests/integration/contamination.concurrent.test.ts` — neither response contains the other's content.
  - [ ] `tests/integration/contamination.retryPath.test.ts` — B's response has no trace of A's correction context; A resolves successfully on attempt 2.

- **Quality gates**:
  - [ ] `npm test` green; all integration tests counted; no test-count regression from WS_08 baseline
  - [ ] `npm run typecheck` clean
  - [ ] `npm run lint` clean; `npm run format` produces no diff
  - [ ] Phase 1 sign-off recorded in CLAUDE.md Session State with spec §6 criteria list checked
  - [ ] Phase plan statuses updated: 01a, 01b, 01c → Completed; workstream statuses WS_01–WS_09 → Completed

---

## Known Pitfalls & Implementation Notes

**Concurrent test timing**: `Promise.all([createA, createB])` fires both SDK calls from the same JavaScript event loop tick. In practice, the two HTTP requests arrive at Fastify nearly simultaneously, but "nearly simultaneously" is not guaranteed to be concurrent at the OS-process level — one subprocess may start and finish before the second request arrives at the Fastify route handler. This is acceptable: the test asserts isolation, not true simultaneity. On the subprocess transport, isolation holds regardless of whether the spawns overlap or are sequential — the test is a proof that no shared state is introduced at the Fastify/proxy layer.

**Retry-path test timing for request B**: In T3, request B must fire either after A's retry begins (but before A's second attempt resolves) or after A fully resolves. If B fires before A's first response arrives, the test is effectively the concurrent sub-case. Either ordering is acceptable for the contamination assertion — what matters is that B's response has no knowledge of A's correction note. The simplest implementation fires B sequentially after A completes (B is sent only after `await createA`). This is the conservative approach and is correct.

**Test double wiring for retry-path test**: T3's double is wired at the adapter's `complete()` method via a class mock or by passing a stub adapter to `createServer`. The double must return the malformed string only for request A's first call, then return a well-formed response for A's second call (retry), and return a different well-formed response for request B. A `vi.fn().mockResolvedValueOnce(malformed).mockResolvedValueOnce(wellFormedA).mockResolvedValueOnce(wellFormedB)` chain achieves this. If the ordering is sensitive, add a call counter to the mock's assertion.

**Why the contamination tests pass (document in the test files)**: Each contamination test should contain a brief comment explaining the mechanism: "On the `claude --print` subprocess transport, isolation holds because each call to `adapter.complete()` spawns a new OS process that exits after one response. There is no shared session, buffer, or in-memory state between requests. This test is the regression guard for Phase 2's MCP upgrade, which must preserve this property by means of `_mcp_lock` serialization and fresh-context-per-call (invariant #10)." This comment turns the test from a black-box assertion into architectural documentation.

**`_mcp_lock` and invariant #11 — explicitly out of scope**: There is no MCP session in Phase 1. These contamination tests make no reference to `_mcp_lock`, `sanitised_env` beyond what was built in WS_02, or any Phase 2 MCP mechanism. The tests pass solely because of the subprocess transport's fresh-process guarantee. Any attempt to introduce MCP-related code in WS_09 is a Phase 1 scope violation (D-SEQ-01).

**Green gate close-out scope**: T4's `npm test` run includes all integration tests — WS_03, WS_06, WS_07, and WS_09. If any integration test fails due to a live subscription issue (expired auth, CLI update), run `claude whoami` and re-authenticate before concluding the failure is a code issue. The `healthCheck()` guard will skip the suite cleanly if auth is unavailable; it will not produce a misleading failure.

**Phase 1 sign-off content in CLAUDE.md**: T4's sign-off note should be placed in the Session State "What was completed" section and should be specific: list each spec §6 criterion, its test name, and its outcome. This is the record that the next working session (Phase 2 planning) reads to understand what was proven and what the Phase 2 head must preserve.
