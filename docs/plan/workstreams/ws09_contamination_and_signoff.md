# Workstream WS_09: Full Contamination Test Suite & Phase-1 Sign-Off

> A workstream scopes ~1 day of work and is more detailed than its parent phase: concrete goals +
> deliverables, locked decisions (with rejected alternatives), a task breakdown, cross-task
> contracts, and success/quality gates. It is the bridge from phase goals to hour-sized tasks.

## Workstream Overview

- **Parent Phase**: [Phase 1C — Tool Calling & Acceptance](../phases/01c_tool_calling_and_acceptance.md)
- **Timeframe**: ~1 day
- **Status**: ✅ **Completed** (Phase 1 closed, 2026-08-24 — T4 sign-off; OD-1 resolved option (a), all four tasks archived)
- **Dependencies**: WS_07 signed off (tool-call validator and response builder branches; tool-call integration test; invariant #1 proof) AND WS_08 signed off (retry loop fully exercised at proxy level; `router.ts` integrated; `proxy.ts` migrated). Both must be green-gate-clean before this workstream begins. This workstream is an acceptance/proof workstream, not a development workstream — it writes no new production code.

---

## Goals & Deliverables

- **Goal 1**: The full contamination test suite — all three sub-cases from spec §6, exercised against the live Fastify server through the full HTTP proxy path.
  - Deliverable (T1): `tests/integration/contamination.sequential.http.integration.test.ts` — the **HTTP-path** sequential probe (OpenAI SDK → real listening Fastify server → `ClaudeAdapter` → subprocess). This is a **new file**; it does **not** modify the existing adapter-level `contamination.sequential.integration.test.ts`, which is retained as the WS_03 adapter-isolation guard. (Naming: `.http.integration.test.ts` follows the project's `*.integration.test.ts` convention and disambiguates the HTTP variant from the adapter variant — see §Cross-Task Contracts.)
  - Deliverable (T2): `tests/integration/contamination.concurrent.http.integration.test.ts` — two simultaneous `client.chat.completions.create()` calls from the OpenAI SDK fired with `Promise.all` against the real listening server (D-1C-04); assert each response contains its **own** expected content and **not** the other request's distinctive token. Real HTTP-level concurrency, not `Promise.all` at the adapter level.
  - Deliverable (T3): `tests/integration/contamination.retryPath.integration.test.ts` — forced retry on request A (malformed first response via a `vi.fn()` adapter double per D-1C-02); request B sent through the same server (same double, OD-1 (a)); assert B's `complete()` input and response contain no trace of A's correction-note context. Proves invariant #10 on the error path. (OD-1 resolved: option (a), the same double drives B — deterministic; no `healthCheck()` skip.)

- **Goal 2**: The retry-exhaustion path — confirm coverage; do **not** re-author what already exists.
  - **Status:** The retry-exhaustion → HTTP 500 path is **already proven at the proxy/HTTP level** by `tests/proxy.test.ts` `WS_08 T3-SC1` (three malformed responses via the injected adapter double → HTTP 500, `error.{code,type}='validation_error'`, no stack leak, exactly 3 adapter calls, asserted through `server.inject()` → `setErrorHandler`). That is the production error path. **WS_09 does not duplicate it.**
  - The **only** gap is the OpenAI-SDK *surface* assertion: that a real `openai` client pointed at a real listening port surfaces the 500 as an `APIError`/`APIError`-subclass with the OpenAI-shaped body intact. This is one thin assertion, **folded into T1** as a companion case (the T1 server fixture is already up with a real port and an SDK client) — see TASK_WS09_T1. No separate file, no separate task.

- **Goal 3**: Phase-1 green-gate sign-off — the complete Phase 1 acceptance criteria from spec §6, validated in one final run.
  - Deliverable: WS_09 sign-off IS the Phase 1 sign-off. The sign-off records: all spec §6 criteria checked; all three contamination sub-cases passing; tool-call path proven; retry-exhaustion path proven; green gate (`npm test`, `typecheck`, `lint`, `format`) clean. This is a **housekeeping/documentation deliverable, not code**. The files updated are: (a) `.claude/CLAUDE.md` Session State ("What was completed" — the Phase 1 sign-off note); (b) `docs/plan/phases/01a_*.md`, `01b_*.md`, `01c_*.md` status → Completed; (c) the WS_01–WS_09 workstream-doc statuses → Completed. No source files change. T4 owns this and is the close-out task (depends on T1–T3 green).

---

## Why This Workstream Matters

The contamination tests are the proof that the spec's core safety guarantee — "no state leaks across requests" (invariant #10) — holds in practice, not just in theory. On the subprocess transport, this guarantee is free (fresh OS process per request), but "free by construction" is only safe if a test is there to catch the day the construction changes. Phase 2's MCP upgrade is exactly such a construction change: when a persistent MCP session is introduced, invariants #10 and #11 must be _re-earned_ by the `_mcp_lock`. These contamination tests are the regression guard that the MCP upgrade must keep green. If WS_09 is not written, Phase 2's MCP work has no automated proof that it preserved the isolation guarantee.

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

**Assertion design (2026-06-26 — closes a weakness):** A "B does not contain A's token" assertion is only a *real* proof of isolation if A's token could *plausibly* have bled into B. Both requests therefore inject a **distinct, request-specific code word** and ask the model to echo it back; the test asserts (1) each response contains **its own** code word (proves the right request got the right answer — no request-swap under concurrency) **and** (2) each response does **not** contain the **other** request's code word (the contamination guard). Without (1), a server that returned two empty/error bodies would pass (2) vacuously. Both halves are required.

**Rejected alternative — test at the adapter layer with `Promise.all`**: Skips the HTTP layer. The Fastify concurrency handling is part of the system under test; a test that bypasses it cannot prove isolation under real-world concurrency.

**Rejected alternative — assert only "B has no trace of A"**: Vacuously passable. If both responses are empty (e.g. a degraded server), the contamination assertion passes while proving nothing. The own-content assertion (1) is the guard against a false green.

### WS_09-D3 — Sequential Contamination Sub-Case Migrated to Full HTTP Path ✅ LOCKED (Architect, 2026-06-08)

**Decision**: `tests/integration/contamination.sequential.test.ts`, authored in WS_03 at the adapter level (calling `adapter.complete()` directly), is extended in WS_09 to run through the full HTTP path (OpenAI SDK → Fastify → adapter → subprocess). The adapter-level version is kept as a regression guard for the adapter in isolation; the HTTP-path version is the Phase 1C acceptance criterion.

**Rationale**: The WS_03 sequential test proved the adapter is stateless. WS_09 proves the full proxy stack is stateless. The additional layer (Fastify, `proxy.ts`, `router.ts`) could theoretically introduce state — for example, a request cache, a connection pool, or a shared variable — that the adapter-level test would not catch. The HTTP-path version catches those.

**Rejected alternative — rely on the WS_03 adapter-level sequential test as the Phase 1C criterion**: Insufficient. The Phase 1C contamination criterion is explicitly about the full proxy path, not just the adapter.

### WS_09-D4 — Retry-Path Contamination Test Uses a `vi.fn()` Adapter Double to Force A's Retry ✅ LOCKED (Architect, 2026-06-08; refined 2026-06-26)

Inherits **D-1C-02** from the parent phase plan.

**Decision**: The retry-path contamination test in WS_09 uses a `vi.fn()` double (the established `{ complete: vi.fn(), healthCheck: vi.fn(), install: vi.fn() } satisfies CLIAdapter` pattern from `tests/proxy.test.ts`, injected via `createServer(config, { claude: stubAdapter })`) to inject a malformed first response for request A (triggering the retry loop), then a well-formed response on A's attempt 2. The double is wired at the adapter boundary so the full proxy path (Fastify → `resolve()` → `adapter.complete()` → `validateWithRetry()` → `buildChatCompletion`) is exercised. The contamination assertion is on request B's response content and on the **messages array B's `complete()` call receives** — it must contain no trace of the correction context appended to A's messages.

**Rationale**: The only reliable way to force a retry deterministically is a controlled test double. A real malformed response from `claude --print` is non-deterministic. The double injects the exact malformed payload needed to trigger the retry, then returns a well-formed response on attempt 2.

**Resolution (2026-06-26) — OD-1 closed: option (a), the same double drives B (user-decided).** The original wording said "request B gets its own adapter call (a separate subprocess)." That is not literally true behind a single injected double: `createServer` binds **one** adapter for all requests, so the same `vi.fn()` services A's two calls *and* B's call. The user resolved OD-1 in favor of **option (a)**: B is also double-driven. The double is sequenced — call 1 malformed (A attempt 1) → call 2 valid (A attempt 2) → call 3 valid (B) — and the contamination assertion inspects `stubAdapter.complete.mock.calls[2][0].messages` (B's input must equal B's originals with no correction note, no A history) and B's response body (no correction-note prefix, no A content). Total calls: exactly 3. This is the strongest *contamination* proof and is fully deterministic; T1/T2 already prove real-subprocess isolation, so a real B would add non-determinism without coverage. **No `healthCheck()` skip** (the double has no live dependency); CI exclusion is handled by the `tests/integration/**` path. Full detail in `docs/active/TASK_WS09_T3.md` §Decisions D1/D2.

**Rejected alternative — B hits a real adapter (OD-1 option (b)) / hybrid (option (c))**: contrived two-alias or two-fixture wiring, non-deterministic, live-dependent, redundant with T1. Rejected.

**Rejected alternative — wait for a real malformed response from the model**: Non-deterministic. The retry-path sub-case would be labeled "manual only" rather than automated. The spec (§6) requires all three contamination sub-cases to pass — a manual-only sub-case does not satisfy the acceptance criterion.

---

## Task Breakdown

| Task ID | Description                                                                                                                                                                                                                                                                                                                                                                                                                                         | Est. Duration | Status        | Task Tracker Link              |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ------------- | ------------------------------ |
| T1      | New file `contamination.sequential.http.integration.test.ts`: HTTP-path sequential probe (real listening server + OpenAI SDK). Call A injects a fixed UUID code word; Call B is a generic probe. Assert B's response has no trace of A's token. **Plus the Goal-2 SDK-surface case** (separate `describe`, injected double): 3× malformed → `openai` `APIError` carrying the OpenAI-shaped 500 body. `healthCheck()`-guard the live-Claude cases only.                                                                                                          | ~1 hour       | ⬚ Not started     | `../../active/TASK_WS09_T1.md` |
| T2      | New file `contamination.concurrent.http.integration.test.ts`: `Promise.all` of two simultaneous `client.chat.completions.create()` calls, each injecting its **own** distinct code word and asking the model to echo it. Assert each response contains its own code word AND not the other's. Document the fresh-process rationale + Phase-2 regression-guard purpose in-file.                                                                                                                                                                                | ~1 hour       | ⬚ Not started     | `../../active/TASK_WS09_T2.md` |
| T3      | New file `contamination.retryPath.integration.test.ts`: one `vi.fn()` double drives both requests (OD-1 (a)) — sequenced malformed→valid (A) then valid (B). Assert A resolves on attempt 2 (200); assert `calls[2][0].messages` equals B's originals (no correction note, no A history) and B's response carries no correction-note prefix / no A content; `complete` called exactly 3×. No `healthCheck()` skip (deterministic). Driven via `server.inject()`.                                                                                                       | ~1 hour       | ⬚ Not started     | `../../active/TASK_WS09_T3.md` |
| T4      | Phase-1 sign-off (housekeeping, no code): run the full gate; confirm local-suite count and CI count (CI excludes `tests/integration/**` → stays 91). Verify every spec §6 criterion maps to a named test. Update `.claude/CLAUDE.md` Session State with the Phase 1 sign-off note; set phase statuses 01a/01b/01c → Completed and WS_01–WS_09 → Completed. Record Phase 2 head (MCP upgrade) as next.                                                                                                                                                            | ~1 hour       | ⬚ Not started     | `../../active/TASK_WS09_T4.md` |

_Status: `✅ Completed` | `🔄 In Progress` | `⬚ Not started` | `❌ Blocked`_

_T1, T2, and T3 are all independent and can run in any order or in parallel (OD-1 resolved — T3 unblocked). T4 is the close-out and depends on T1, T2, and T3 passing. If T2 reveals unexpected failures, investigate the subprocess-spawn path (WS_02/WS_04) before escalating — the most likely cause is shared state in a module-level variable, not a subprocess leak. T3 is deterministic (pure double); a T3 failure indicates a real proxy/validator state-leak across requests._

---

## Open Decisions

_None open. OD-1 resolved 2026-06-26 (see below). T1, T2, T3, T4 are all unblocked._

### OD-1 — Retry-path test: is request B driven by the same adapter double, or by a real adapter? ✅ RESOLVED (user, 2026-06-26) — option (a)

**Question.** `createServer(config, adapters)` binds **one** `CLIAdapter` per model alias for the lifetime of the server. To force A's retry deterministically, T3 injects a `vi.fn()` double as the `claude` adapter — and that same double then also services request B. So B cannot be "a real subprocess" while A is double-driven, behind one server. How should B be sourced?

**Resolution — option (a): the same double drives B.** The `vi.fn()` is sequenced: call 1 malformed (A attempt 1), call 2 valid (A attempt 2), call 3 valid (B). The contamination assertion inspects `stubAdapter.complete.mock.calls[2][0].messages` (B's input — must be B's originals only, no correction note, no A history) and B's response body (no correction-note prefix, no A content); `complete` is called exactly 3 times. Fully deterministic; directly observes the leak surface D-1C-02 names. **No `healthCheck()` skip** (no live dependency); the `tests/integration/**` path keeps it CI-excluded so CI stays 91. Full wiring in `docs/active/TASK_WS09_T3.md` §D1/D2.

**Rejected — (b) B hits a real adapter via a second alias/server:** genuine subprocess for B, but contrived two-alias wiring, non-deterministic, live-dependent, and redundant with T1. **Rejected — (c) hybrid across two fixtures:** two server lifecycles, ordering coupling, highest complexity. Not chosen.

---

## Cross-Task Contracts

### Test server fixture (inherited from WS_06 / WS_07 pattern → consumed by T1, T2, T3)

All three contamination tests use the same `beforeAll`/`afterAll` server lifecycle pattern established in WS_06 and WS_07: `createServer(config, adapters)` factory, `healthCheck()` skip guard, server bound to a test port. T1 reuses the WS_06 fixture directly (or extends it); T2 and T3 follow the same pattern. Do not spin up a new server per test — one server per describe block.

### Adapter-level sequential test (inherited from WS_03 T3 → preserved by T1)

WS_03's existing **`tests/integration/contamination.sequential.integration.test.ts`** (note the `.integration.` infix — that is the actual on-disk filename) calls `adapter.complete()` directly at the adapter level. T1 does **not** modify it. T1 creates a **new companion file**, `contamination.sequential.http.integration.test.ts`, for the HTTP-path version. Both files are kept — the adapter-level file is the unit-level isolation guard; the new HTTP-path file is the Phase 1C acceptance criterion. (The workstream doc previously implied a single `contamination.sequential.test.ts` with no infix; that filename does not exist and would break the `*.integration.test.ts` naming convention. Corrected 2026-06-26.)

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
  - [ ] _Sequential (HTTP path)_: OpenAI SDK call A with UUID token → call B "what was the code word?" → B's response contains no trace of the token. (Invariant #10.)
  - [ ] _Concurrent_: Two simultaneous SDK calls (A: UUID token, B: different prompt). `Promise.all` resolves; neither response contains the other's token. (Isolation under real HTTP concurrency; invariant #10/#11 regression guard.)
  - [ ] _Retry-path_: Request A forced to retry (malformed first response via double); request B fires independently; B's response contains no content from A's correction note. (Invariant #10 on the error path.)

- **Functional requirements — retry exhaustion**:
  - [ ] Three consecutive malformed responses (test double) cause the proxy to return HTTP 500 with an OpenAI-format error body; no stack trace; no raw model output in the body.

- **Functional requirements — Phase 1 acceptance criteria (re-confirmed from spec §6)**:
  - [ ] No-tools path: `finish_reason: "stop"`, non-empty `content`, correct `id` prefix. (Re-run from WS_06.)
  - [ ] Tool-call path: `finish_reason: "tool_calls"`, correct function name, parseable arguments, no execution side effect. (Re-run from WS_07.)
  - [ ] Green gate: `npm test` green, `typecheck` clean, `lint` clean, `format` no-diff, no test-count regression.

- **Named tests that prove this workstream done**:
  - [ ] `tests/integration/contamination.sequential.http.integration.test.ts` — B's response has no trace of A's token (HTTP path); + the Goal-2 SDK-surface case (`APIError` on retry exhaustion).
  - [ ] `tests/integration/contamination.concurrent.http.integration.test.ts` — each response contains its **own** code word and not the other's.
  - [ ] `tests/integration/contamination.retryPath.integration.test.ts` — B's `complete()` input and response have no trace of A's correction context; A resolves on attempt 2; `complete` called exactly 3×.
  - [ ] (pre-existing, re-confirmed) `tests/proxy.test.ts` `WS_08 T3-SC1` — retry exhaustion → HTTP 500; this is the proxy-level retry-exhaustion proof Goal 2 relies on (not re-authored here).

- **Quality gates**:
  - [ ] `npm test` (full local suite) green; no test-count regression from the WS_08 local baseline (100)
  - [ ] **CI count unchanged at 91** — all WS_09 deliverables live under `tests/integration/**`, which `vitest.config.ts` excludes when `CI` is set. No new CI-runnable tests are added.
  - [ ] `npm run typecheck` clean
  - [ ] `npm run lint` clean; `npm run format` produces no diff
  - [ ] Phase 1 sign-off recorded in `.claude/CLAUDE.md` Session State with spec §6 criteria list checked
  - [ ] Phase plan statuses updated: 01a, 01b, 01c → Completed; workstream statuses WS_01–WS_09 → Completed

---

## Known Pitfalls & Implementation Notes

**Concurrent test timing**: `Promise.all([createA, createB])` fires both SDK calls from the same JavaScript event loop tick. In practice, the two HTTP requests arrive at Fastify nearly simultaneously, but "nearly simultaneously" is not guaranteed to be concurrent at the OS-process level — one subprocess may start and finish before the second request arrives at the Fastify route handler. This is acceptable: the test asserts isolation, not true simultaneity. On the subprocess transport, isolation holds regardless of whether the spawns overlap or are sequential — the test is a proof that no shared state is introduced at the Fastify/proxy layer.

**Retry-path test ordering for request B**: In T3, inject POST A first (it retries internally and resolves), then inject POST B sequentially. What matters for the contamination assertion is that B's `complete()` input and B's response carry no knowledge of A's correction note — not the precise interleave.

**Test double wiring for retry-path test (OD-1 (a), locked)**: T3's double is the established `{ complete: vi.fn(), healthCheck: vi.fn(), install: vi.fn() } satisfies CLIAdapter` pattern from `tests/proxy.test.ts`, injected via `createServer(config, { claude: stubAdapter })`. The chain is `vi.fn().mockResolvedValueOnce(malformedA).mockResolvedValueOnce(wellFormedA).mockResolvedValueOnce(wellFormedB)` — three calls total (A attempt 1, A attempt 2, B). The load-bearing assertion is on `stubAdapter.complete.mock.calls[2][0].messages` (B's input): it must equal B's original messages with **no** appended correction note and **no** A history. `wellFormedA` / `wellFormedB` carry **distinct** content so a cross-leak is visible. See TASK_WS09_T3 §Required Test Cases for the exact sequence.

**Why the contamination tests pass (document in the test files)**: Each contamination test should contain a brief comment explaining the mechanism: "On the `claude --print` subprocess transport, isolation holds because each call to `adapter.complete()` spawns a new OS process that exits after one response. There is no shared session, buffer, or in-memory state between requests. This test is the regression guard for Phase 2's MCP upgrade, which must preserve this property by means of `_mcp_lock` serialization and fresh-context-per-call (invariant #10)." This comment turns the test from a black-box assertion into architectural documentation.

**`_mcp_lock` and invariant #11 — explicitly out of scope**: There is no MCP session in Phase 1. These contamination tests make no reference to `_mcp_lock`, `sanitised_env` beyond what was built in WS_02, or any Phase 2 MCP mechanism. The tests pass solely because of the subprocess transport's fresh-process guarantee. Any attempt to introduce MCP-related code in WS_09 is a Phase 1 scope violation (D-SEQ-01).

**Green gate close-out scope**: T4 runs the full local `npm test` (which includes all `tests/integration/**`) AND must confirm the CI-gated subset by running with `CI=1` (or inspecting `vitest.config.ts`'s exclusion) so both counts are recorded: full-local and CI-91. If any integration test fails due to a live subscription issue (expired auth, CLI update), run `claude whoami` and re-authenticate before concluding the failure is a code issue. The `healthCheck()` guard skips the live cases cleanly if auth is unavailable; it will not produce a misleading failure. Note that the WS_08 local baseline was **100** local / **91** CI — T4 confirms the new local total and that CI is still exactly 91.

**Phase 1 sign-off content in CLAUDE.md**: T4's sign-off note should be placed in the Session State "What was completed" section and should be specific: list each spec §6 criterion, its test name, and its outcome. This is the record that the next working session (Phase 2 planning) reads to understand what was proven and what the Phase 2 head must preserve.
