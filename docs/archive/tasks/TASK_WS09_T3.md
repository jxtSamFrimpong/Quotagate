# TASK_WS09_T3: Retry-Path Contamination (Same Double Drives A and B)

## Context

- **Workstream**: WS_09 (Full Contamination Test Suite & Phase-1 Sign-Off)
- **Plan reference**: `docs/plan/workstreams/ws09_contamination_and_signoff.md` (§Locked Decisions WS_09-D4 / OD-1)
- **Phase plan**: `docs/plan/phases/01c_tool_calling_and_acceptance.md` (D-1C-02)
- **Depends on**: WS_08 signed off; **OD-1 resolved (option (a) — same double drives B)**
- **Blocks**: T4 (Phase-1 sign-off depends on T3 passing)

> **OD-1 RESOLVED (2026-06-26): option (a) — A and B are serviced by the same `vi.fn()` double.**
> This unblocks T3. Status set to ⬚ Not Started.

---

## Goal & Why

- **Goal**: Create `tests/integration/contamination.retryPath.integration.test.ts`. Use a single
  `vi.fn()` adapter double, sequenced so request A retries once (malformed → valid) and request B
  resolves on its first call. Assert that A's appended correction note appears in **neither B's
  `complete()` input messages array nor B's HTTP response**, and that A resolves cleanly on attempt 2.
- **Why**: This proves invariant #10 on the **error/retry branch** — the exact surface D-1C-02 names
  as the contamination risk: the messages array that `validateWithRetry` mutates (appends
  `CORRECTION_NOTE`) and feeds back through `complete()`. The happy-path tests (T1 sequential, T2
  concurrent) cannot observe this branch. The double makes the leak surface directly inspectable
  (`mock.calls[2][0].messages`) and the test fully deterministic, so it is a stable Phase-2 regression
  guard for when the MCP upgrade's persistent session re-introduces the leak risk (invariant #11).

---

## Assumptions to Test

| #   | Assumption                                                                                                       | Why we believe it                                                                                  | How this task tests it                                                                 | If false →                                                                            |
| --- | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| A1  | `validateWithRetry` rebuilds corrected messages as `[...originalA, CORRECTION_NOTE]` and never mutates a shared array. | `src/validator.ts` (WS_04-D3, EF6: "Corrected messages are always `[...messages, CORRECTION_NOTE]`, rebuilt"). | Assert A's attempt-2 call (`calls[1][0].messages`) has length 2 with the note last; B's call (`calls[2][0].messages`) has only B's originals. | A real shared-array mutation leak exists — that is exactly the bug this test must catch; do NOT mask it. |
| A2  | B's `complete()` call closes over B's request, not A's, in `proxy.ts`'s `invoker` closure.                       | `proxy.ts` builds a fresh `invoker` per request handler; each request has its own `parsed.data`.   | Assert `calls[2][0].messages` equals B's original messages (no A history, no note).     | `proxy.ts` leaks request state across handlers — investigate the closure scope.        |
| A3  | The proxy is stateless across the two HTTP requests (no module-level cache/pool retaining A's context).          | Invariant #3 (stateless per request); proven for happy path in T1/T2.                              | The B-input assertion + B-response assertion together prove no A context survived.      | Module-level state leak — investigate `proxy.ts`/`router.ts`.                          |

---

## Expected Failures

- **[EF1]** None from a live subscription — this test is **deterministic** (the double never spawns a
  subprocess). See D2: **no `healthCheck()` skip**.
- **[EF2]** A's first (malformed) response must produce a real `ValidationError` inside
  `validateWithRetry` (live `JSON.parse('not json')` throws) → drives the real retry path, not a
  mocked-out one. This is the integrity requirement: the retry is genuinely exercised.
- **[EF3]** If `CORRECTION_NOTE` content ever appeared in `calls[2][0].messages` → real contamination;
  the test must fail loudly. Do not soften this assertion.

---

## Test Strategy

- **Unit**: none.
- **Integration (deterministic)**: real Fastify server built via `createServer(config, { claude: stubAdapter })`
  with an injected `vi.fn()` double. Driven via `server.inject()` (two sequential POSTs, A then B) —
  `inject` is sufficient and avoids a real port; the production path through `setErrorHandler` /
  `validateWithRetry` / `buildChatCompletion` is fully exercised. (If the BSE prefers a real listening
  port + `openai` SDK for parity with T1/T2, that is acceptable, but `inject` is the simpler correct
  choice for a pure-double test.)
- **Contamination/Isolation**: the core — inspect B's `complete()` **input** (`mock.calls[2][0].messages`)
  AND B's HTTP **response** body for any trace of A's correction context.
- **Contract**: B's response is a valid `chat.completion` (status 200) carrying B's expected content.
- **No live dependency → not `healthCheck()`-guarded** (D2). File lives under `tests/integration/**`
  so `vitest.config.ts` excludes it from CI regardless (CI stays 91).

---

## Contract: What This Task Inherits

| Symbol / Artifact                                  | Source                                       | Role in This Task                                                          |
| -------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------- |
| `createServer(config, adapters)`                   | `src/proxy.ts`                               | Build the server with the injected double.                                |
| `{ complete: vi.fn(), healthCheck, install }` stub | pattern from `tests/proxy.test.ts:20`        | The single double servicing A (×2) and B (×1).                            |
| `validateWithRetry` + `CORRECTION_NOTE`            | `src/validator.ts`                           | The production retry path under test (note prefix is the load-bearing assertion). |
| `loadConfig` + `config.minimal.yaml`               | `src/config.ts`                              | `claude-sonnet-4-6`, `retry.max_attempts: 3`.                             |
| `server.inject()`                                  | Fastify                                      | Drive A then B without a real port.                                       |

---

## Subtask Progress Table

| #   | Subtask                                                                                                       | Status        | Iteration | Notes |
| --- | ------------------------------------------------------------------------------------------------------------ | ------------- | --------- | ----- |
| 1   | Create file; `beforeAll` builds server from `vi.fn()` double; `beforeEach` clears mocks.                       | ✅ Done        | 1         | No skip guard (D2). |
| 2   | Sequence the double: `mockResolvedValueOnce` malformed (A1), valid A (A2), valid B (B1).                       | ✅ Done        | 1         | Exactly 3 returns. |
| 3   | T-1: inject POST A (retries, 200); inject POST B (200). Capture both responses.                                | ✅ Done        | 1         | SC-1, SC-2. |
| 4   | Assert A resolves (200, A content), B resolves (200, B content); `complete` called exactly 3×.                 | ✅ Done        | 1         | SC-1, SC-3. |
| 5   | Assert `calls[1][0].messages` (A retry) = `[origA, CORRECTION_NOTE]`; `calls[2][0].messages` = `[origB]` only.  | ✅ Done        | 1         | SC-2. |
| 6   | Assert no entry in `calls[2][0].messages` has content starting with the CORRECTION_NOTE prefix.                | ✅ Done        | 1         | SC-2. |
| 7   | Assert B's response body contains no CORRECTION_NOTE prefix and not A's distinctive content.                   | ✅ Done        | 1         | SC-2. |
| 8   | Run `npm test`; confirm CI-excluded path; green gate.                                                          | ✅ Done        | 1         | SC-4, SC-5. |

---

## Decisions Made

### [D1] — OD-1 resolved: same `vi.fn()` double drives A and B ✅ DECIDED (user, 2026-06-26)

**Decision**: Both A and B are serviced by one injected `vi.fn()` double, sequenced:
1. **Call 1 (A, attempt 1)**: `{ raw: 'not json', backend: 'claude-subprocess' }` — malformed → triggers retry.
2. **Call 2 (A, attempt 2)**: `{ raw: JSON.stringify(validResultA), backend: 'claude-subprocess' }` — valid → A resolves.
3. **Call 3 (B, attempt 1)**: `{ raw: JSON.stringify(validResultB), backend: 'claude-subprocess' }` — valid → B resolves.

`validResultA` / `validResultB` are `QuotagateCompleteResult` text objects with **distinct** content,
e.g. `{ type:'text', content:'ALPHA-<fixed-uuid>' }` and `{ type:'text', content:'BRAVO-<fixed-uuid>' }`,
so a cross-leak would be visible.

**Load-bearing assertions** (all required):
- `stubAdapter.complete.mock.calls[2][0].messages` **equals B's original messages** — no correction note, no A history.
- No entry in `calls[2][0].messages` has `content` starting with `"The previous response was not valid JSON"`.
- B's HTTP response is a valid `chat.completion` (status 200) containing B's expected content (`validResultB.content`) and **not** A's content or the correction-note prefix.
- `stubAdapter.complete` called **exactly 3** times total.

**Rationale**: T3's unique job is the **error-path** leak — the messages array `validateWithRetry`
mutates and feeds back through `complete()` (D-1C-02). A double observes that surface precisely and
deterministically; T1/T2 already prove real-subprocess isolation, so a real B adds no coverage here,
only non-determinism. (PA lean confirmed by user.)

**Rejected alternative — B hits a real adapter (OD-1 option (b))**: contrived two-alias wiring,
non-deterministic, live-dependent, redundant with T1.

### [D2] — No `healthCheck()` skip guard ✅ LOCKED (Architect, 2026-06-26)

**Decision**: This test does **not** skip on `healthCheck() === false`. It runs unconditionally.
**Rationale**: Under OD-1 option (a) the double never spawns a subprocess — there is **no live
dependency**. A `healthCheck()` skip would let a real retry-path contamination regression go
undetected on any machine without live Claude, defeating the test's purpose as a Phase-2 regression
guard. The file still lives under `tests/integration/**`, so `vitest.config.ts`'s
`exclude: ['tests/integration/**']` keeps it out of CI and CI stays 91 — the placement, not a skip
guard, is what controls CI inclusion.
**Note on the relayed instruction**: the OD-1 hand-off suggested "follow the same `healthCheck()` skip
pattern as all other integration tests." That pattern exists because the other integration tests have
a live dependency; this one does not. Applying the skip here would be incorrect (Engineering
Integrity: a test must not be able to silently no-op the very regression it guards). Flagged for the
user; if the user explicitly wants the skip anyway it is a one-line addition — but the PA
recommendation is **no skip**. (BSE: implement without the skip; this is the locked default.)

### [D3] — Anti-overengineering scope fence ✅ LOCKED

**This task explicitly does NOT include**:

- Any `_mcp_lock` / MCP code (Phase 2; D-SEQ-01).
- The sequential (T1) or concurrent (T2) sub-cases.
- Re-proving retry exhaustion (exists in `proxy.test.ts` `WS_08 T3-SC1`; SDK surface in T1).
- A real subprocess for B (OD-1 rejected that).

---

## Files Modified / Created

- `tests/integration/contamination.retryPath.integration.test.ts` — **create new**.

---

## Success Criteria / Verifiability

| #    | Criterion                                                                                                                              | How to verify                                  |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| SC-1 | A resolves on attempt 2: POST A returns HTTP 200 with a valid `chat.completion` carrying `validResultA.content`.                       | Test T-1 assertions on response A.             |
| SC-2 | **Contamination (the core).** (a) `calls[2][0].messages` equals B's original messages exactly; (b) no entry in `calls[2][0].messages` has `content` starting with `"The previous response was not valid JSON"`; (c) B's response body contains `validResultB.content`, and does NOT contain the CORRECTION_NOTE prefix nor `validResultA.content`. | Test T-1 contamination assertions.             |
| SC-3 | `stubAdapter.complete` was called **exactly 3** times total across A and B.                                                           | `expect(...).toHaveBeenCalledTimes(3)`.         |
| SC-4 | File under `tests/integration/**`; `CI=1 npx vitest run` count unchanged (CI stays **91**). Test runs without a `healthCheck()` skip.  | `CI=1 npx vitest run` count == 91; local run executes T-1. |
| SC-5 | `npm run typecheck` clean; `npm run lint` clean; `npm run format` no diff; full local `npm test` green, no regressions.                | Green gate.                                    |

---

## Required Test Cases

File: `tests/integration/contamination.retryPath.integration.test.ts`

### T-1: retry-path contamination — A's correction context does not bleed into B (covers SC-1, SC-2, SC-3)

- `beforeAll`: `const stubAdapter = { complete: vi.fn(), healthCheck: vi.fn(), install: vi.fn() } satisfies CLIAdapter;`
  then `server = createServer(loadConfig(FIXTURE_CONFIG_PATH), { claude: stubAdapter });`.
- `beforeEach`: `vi.clearAllMocks();` (so the sequenced `mockResolvedValueOnce` chain is clean).
- Define distinct fixed-string results, e.g.
  `const CONTENT_A = 'ALPHA-7c1f...'; const CONTENT_B = 'BRAVO-3e9d...';` (fixed constants, commented per WS_03-D3).
- Sequence the double:
  ```ts
  stubAdapter.complete
    .mockResolvedValueOnce({ raw: 'not json', backend: 'claude-subprocess' })                                              // A attempt 1 (malformed)
    .mockResolvedValueOnce({ raw: JSON.stringify({ type: 'text', content: CONTENT_A }), backend: 'claude-subprocess' })    // A attempt 2 (valid)
    .mockResolvedValueOnce({ raw: JSON.stringify({ type: 'text', content: CONTENT_B }), backend: 'claude-subprocess' });   // B attempt 1 (valid)
  ```
- POST A via `server.inject` with messages `[{ role:'user', content:'Request A' }]`; assert status 200,
  body parses as `chat.completion`, `choices[0].message.content === CONTENT_A`.
- POST B via `server.inject` with messages `[{ role:'user', content:'Request B' }]`; assert status 200,
  `choices[0].message.content === CONTENT_B`.
- `expect(stubAdapter.complete).toHaveBeenCalledTimes(3)`.
- **Contamination assertions**:
  - `const aRetryMsgs = stubAdapter.complete.mock.calls[1][0].messages;` →
    `expect(aRetryMsgs).toHaveLength(2)`; `expect(aRetryMsgs[1].role).toBe('user')`;
    `expect(aRetryMsgs[1].content).toMatch(/^The previous response was not valid JSON/)`
    (proves the retry genuinely appended the note to A — establishes the note exists to leak).
  - `const bMsgs = stubAdapter.complete.mock.calls[2][0].messages;` →
    `expect(bMsgs).toHaveLength(1)`; `expect(bMsgs[0].content).toBe('Request B')`;
    `expect(bMsgs.some((m) => typeof m.content === 'string' && m.content.startsWith('The previous response was not valid JSON'))).toBe(false)`.
  - B response body (stringify or assert on content):
    `expect(bodyBString).not.toContain('The previous response was not valid JSON')` and
    `expect(bodyBString).not.toContain(CONTENT_A)`.
- In-file comment: same fresh-process / Phase-2 `_mcp_lock` regression-guard note as T1/T2, adapted to
  the error path ("this guards the retry branch's context reset across requests").

---

## Review Notes

**Verdict: ✅ APPROVE** (PA, 2026-08-24)

Reviewed `tests/integration/contamination.retryPath.integration.test.ts` line-by-line against this tracker.

- **D1 verified**: single `vi.fn()` double services A ×2 and B ×1; exactly three `mockResolvedValueOnce` returns in the locked sequence. CONTENT_A/CONTENT_B are fixed UUID constants, distinct from every other test file's tokens (WS_03-D3 honored).
- **D2 verified**: no `healthCheck()` guard anywhere — the test cannot silently no-op.
- **Load-bearing assertions all present and unsoftened**:
  - Retry-genuineness: `calls[1][0].messages` length 2, `[0] === 'Request A'`, `[1]` user-role with content matching `^The previous response was not valid JSON` — proves the note existed and could have leaked (guards a vacuous pass).
  - Input-side contamination: `calls[2][0].messages` deep-equals exactly B's originals **and** an explicit `.some(...)` negative assertion on the note prefix. If A1 were false (shared-array mutation), BOTH fail loudly. If A2 were false (closure leak), the deep-equal fails. Verified by trace.
  - Response-side contamination: B's body asserted to contain CONTENT_B and NOT contain the note prefix nor CONTENT_A — covers A3 (module-level state).
  - Call-count contract: exactly 3 total.
- **EF2 integrity confirmed**: call 1 returns `'not json'`; the real `JSON.parse` failure inside `parseAndValidate` drives the genuine retry path — nothing mocked out.
- **Deviation adjudicated — ACCEPTED (non-blocking)**: spec sketched `beforeAll` server construction; implementation builds per-test in `beforeEach` (+ `vi.clearAllMocks()`, `afterEach` server close). For an `inject()`-driven test against a stateless server this is functionally equivalent and matches the established `tests/proxy.test.ts` convention; it also guarantees a clean mock chain per test. No weakening identified.
- **Router key invariant checked**: adapters map key `'claude'` equals config `backend: claude` (config.minimal.yaml) — resolve() finds the double.
- Gate re-verified by PA this session: typecheck/lint/prettier-scoped clean; local 104/104; `CI=1` == 91.

---

## Architect Sign-off

- [x] Implementation reviewed
- [x] All success criteria verified (SC-1..SC-5)
- [x] All assumptions resolved (A1/A2/A3 proven by assertion trace)
- [x] No regressions in full test suite (104/104 local; CI 91 unchanged)
- [x] `npm test` / `typecheck` / `lint` / `format` all clean
