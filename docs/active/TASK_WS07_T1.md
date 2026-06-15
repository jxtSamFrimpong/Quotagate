# TASK_WS07_T1: Retry-Triggering Unit Tests for `{type:"tool_call"}` Branch

## Context

- **Workstream**: WS_07 (Tool-Call Response Path)
- **Plan reference**: `docs/plan/workstreams/ws07_tool_call_response_path.md`
- **Phase plan**: `docs/plan/phases/01c_tool_calling_and_acceptance.md`
- **Depends on**: TASK_WS06_T4 (Phase 1B green gate must be held — 84 tests baseline)
- **Blocks**: TASK_WS07_T3 (integration test needs confidence that the retry path handles malformed tool_calls before going live)

---

## Goal & Why

- **Goal**: Add four new `it()` blocks to `tests/validator.test.ts` covering the retry-triggering cases for the `{type:"tool_call"}` Zod branch. No changes to `src/validator.ts` or `src/types.ts`.
- **Why**: The `QuotagateCompleteResultSchema` already defines both the `text` and `tool_call` branches (WS_01-D3), and `parseAndValidate()` already resolves a valid `tool_call` faithfully (T-5 in the existing suite proves this, WS_04 OD-7). What the suite lacks is explicit test coverage for the Zod rejection path when a `tool_call` shape is malformed: missing `name`, wrong `arguments` type, or missing `arguments`. Without these tests, a future change that accidentally loosens the Zod schema for `tool_call` (e.g., making `name` optional) would not be caught by the test suite until a bad response from the model silently passed the validator. T1 closes that gap. It also covers the `validateWithRetry` retry loop for the tool_call case — a malformed tool_call on attempt 1 followed by a valid one on attempt 2 must resolve correctly, matching the proven behavior for the text branch.

---

## Assumptions to Test

| #  | Assumption | Why we believe it | How this task tests it | If false → |
|----|------------|-------------------|------------------------|------------|
| A1 | `parseAndValidate('{"type":"tool_call","arguments":{"city":"Accra"}}')` (missing `name`) throws `ValidationError` | `QuotagateCompleteResultSchema` has `name: z.string()` as a required field in the `tool_call` arm; Zod `safeParse` fails on a missing required field; `parseAndValidate` maps any `safeParse` failure to `ValidationError` | T-7a: call `parseAndValidate` with the missing-name payload, assert `instanceof ValidationError` | The Zod schema has accidentally made `name` optional — file a schema correction as a separate task; do not weaken the test |
| A2 | `parseAndValidate('{"type":"tool_call","name":"get_weather","arguments":"city=Accra"}')` (string `arguments`) throws `ValidationError` | `z.record(z.string(), z.unknown())` requires a plain object; a string fails the discriminated union branch check | T-7b: call with `arguments` as a string, assert `instanceof ValidationError` | The Zod schema has been widened to accept strings — that is a breaking contract change; escalate to PA |
| A3 | `parseAndValidate('{"type":"tool_call","name":"get_weather"}')` (no `arguments` key) throws `ValidationError` | `arguments` is not marked `.optional()` in the Zod schema; omitting it is a schema mismatch | T-7c: call with no `arguments` key, assert `instanceof ValidationError` | The Zod schema has `arguments` marked optional — that changes the `QuotagateCompleteResult` type contract; escalate to PA |
| A4 | `validateWithRetry` with a malformed tool_call on attempt 1 and a valid tool_call on attempt 2 resolves to the valid tool_call without throwing | The retry loop calls `parseAndValidate`, catches `ValidationError`, appends `CORRECTION_NOTE`, calls `invoker`, and returns the next attempt's result — this behavior is symmetric for both `text` and `tool_call` shapes | T-8: mock `invoker` to return a valid `tool_call` on the second call; assert the resolved value equals `{type:"tool_call", name:"get_weather", arguments:{city:"Accra"}}` and `invoker` was called exactly once | The retry loop has a branch that inspects `result.type` and short-circuits for tool_call — that would be a contract violation (OD-7); fix it in `validator.ts` |

---

## Expected Failures

- **[EF1]** One of the malformed payloads resolves instead of throwing. Root cause: the Zod schema has drifted (e.g., `name` became optional, or `arguments` type was widened). Fix: correct the schema in `src/types.ts` and document the change as a separate decision. Do NOT weaken the test assertion.
- **[EF2]** `validateWithRetry` in T-8 throws instead of resolving. Most likely cause: the `invoker` mock is not returning `AdapterResponse` format (`{raw, backend}`). The `invoker` type is `(messages: OpenAIMessage[]) => Promise<AdapterResponse>` — mock must return `{ raw: '{"type":"tool_call","name":"get_weather","arguments":{"city":"Accra"}}', backend: 'claude-subprocess' }`.
- **[EF3]** T-8 resolves but `invoker` was called zero times. Root cause: the malformed first raw string accidentally passes `parseAndValidate` (see EF1). Fix EF1's root cause.

---

## Test Strategy

- **Unit only**: This task adds to `tests/validator.test.ts`. No integration tests, no new files.
- **No mocking for T-7a/b/c**: `parseAndValidate` is a pure synchronous function; no mocks needed. Call it directly and assert the thrown error.
- **Minimal mocking for T-8**: `validateWithRetry` requires an `invoker` callback. Use `vi.fn()` returning `mockResolvedValueOnce` with a valid `AdapterResponse`. The pattern is identical to `validateWithRetry` T-2 in the existing suite.
- **Contract assertion**: Each `parseAndValidate` test asserts `instanceof ValidationError` (not `instanceof ZodError` — the Zod error must not escape the boundary, per WS_04-D3 and T-2 in the existing `parseAndValidate` suite).
- **No changes to production code**: If any test fails because the existing production code is wrong, stop, document the finding, and escalate to PA. T1 is test coverage, not a bug-fix task.

---

## Contract: What This Task Inherits

| Symbol / Artifact | Source | Role in This Task |
|-------------------|--------|-------------------|
| `parseAndValidate(raw: string): QuotagateCompleteResult` | `src/validator.ts` | Called directly in T-7a/b/c; must throw `ValidationError` for malformed tool_call inputs |
| `validateWithRetry(raw, messages, invoker)` | `src/validator.ts` | Called in T-8 with a malformed first raw; must retry and resolve on second attempt |
| `QuotagateCompleteResultSchema` | `src/types.ts` | The Zod schema under test — `tool_call` arm requires `name: z.string()`, `arguments: z.record(z.string(), z.unknown())` |
| `ValidationError` | `src/errors.ts` | The expected thrown type from `parseAndValidate` on schema failure |
| `AdapterResponse` | `src/types.ts` | Return type of the `invoker` mock in T-8: `{raw: string, backend: 'claude-subprocess'}` |
| Existing `validateWithRetry` T-2 | `tests/validator.test.ts` line 87 | Gold-standard pattern for the malformed-attempt-1/good-attempt-2 mock setup |

---

## Subtask Progress Table

| #  | Subtask | Status | Iteration | Notes |
|----|---------|--------|-----------|-------|
| 1  | Add T-7a: `parseAndValidate` with missing `name` field throws `ValidationError` | ⬚ Not started | — | |
| 2  | Add T-7b: `parseAndValidate` with `arguments` as a string throws `ValidationError` | ⬚ Not started | — | |
| 3  | Add T-7c: `parseAndValidate` with no `arguments` key throws `ValidationError` | ⬚ Not started | — | |
| 4  | Add T-8: `validateWithRetry` with malformed tool_call on attempt 1, valid tool_call on attempt 2 resolves successfully | ⬚ Not started | — | |
| 5  | Run `npm test` — assert all 84 prior tests still pass + 4 new tests added (≥ 88 total) | ⬚ Not started | — | |
| 6  | Run `npm run typecheck`, `npm run lint`, `npm run format` — all clean | ⬚ Not started | — | |

_Status icons: `✅ Done` | `🔄 In progress` | `⬚ Not started` | `❌ Blocked`_

---

## Current Subtask Detail

### Subtask 1: Add T-7a through T-7c (parseAndValidate malformed tool_call cases)

**Approach iteration plan**:
1. Add the three `it()` blocks inside the existing `describe('parseAndValidate')` block, directly after T-5 and T-6.
2. Run `npm test` — all three should pass immediately given the Zod schema already rejects these shapes.
3. If any fails (resolves instead of throwing), the schema has drifted — stop, do not weaken the test.

- **Current iteration**: 1 of 2 (step 2 may reveal an EF1 condition)
- **Verifiability**: `npm test` output shows T-7a, T-7b, T-7c all green; test count increases by 3.
- **Challenges**: Low — these are pure synchronous assertions on existing Zod behavior.

---

## Decisions Made

### D1 — No Production Code Changes in T1 ✅ LOCKED (Architect, 2026-06-15)

**Decision**: T1 adds test cases only. `src/validator.ts` and `src/types.ts` are not modified. If a test fails because the production code is wrong, the finding is escalated to PA before any fix is applied.

**Rationale**: The Phase 1B green gate (84 tests) is a ratchet. T1's purpose is to prove existing behavior, not to change it. A production code change in a task scoped to "test coverage" is a scope violation and a signal of unexpected contract drift — it requires architect review.

**Rejected alternative — modify `parseAndValidate()` to add explicit tool_call-specific validation**: Not needed and not correct. `parseAndValidate()` already delegates all schema work to `QuotagateCompleteResultSchema.safeParse()`. Adding hand-rolled checks would duplicate the Zod schema's job and create drift between the two validation paths.

### D2 — Anti-overengineering scope fence ✅ LOCKED

**This task explicitly does NOT include**:
- Any changes to `src/validator.ts`, `src/types.ts`, or any other production file.
- Value-level validation of individual `arguments` fields against the caller's tool schema — this would require threading the `tools` array into `parseAndValidate()`, violating OD-5. See Known Pitfalls in the WS_07 workstream doc.
- Integration tests — those belong to T3.
- Coverage of the text branch retry cases — already proven in the existing `validateWithRetry` T-2 and T-3.

---

## Files Modified / Created

- `tests/validator.test.ts` — **modify** (add T-7a, T-7b, T-7c to `describe('parseAndValidate')`; add T-8 to `describe('validateWithRetry')`)

---

## Success Criteria / Verifiability

| #    | Criterion | How to verify |
|------|-----------|---------------|
| SC-1 | T-7a: `parseAndValidate('{"type":"tool_call","arguments":{"city":"Accra"}}')` throws `ValidationError` | `expect(...).toThrow(ValidationError)` in new test |
| SC-2 | T-7b: `parseAndValidate('{"type":"tool_call","name":"get_weather","arguments":"city=Accra"}')` throws `ValidationError` | `expect(...).toThrow(ValidationError)` in new test |
| SC-3 | T-7c: `parseAndValidate('{"type":"tool_call","name":"get_weather"}')` throws `ValidationError` | `expect(...).toThrow(ValidationError)` in new test |
| SC-4 | T-8: `validateWithRetry` with malformed attempt 1, valid tool_call attempt 2 resolves to `{type:"tool_call",name:"get_weather",arguments:{city:"Accra"}}` and `invoker` called exactly once | `expect(result).toEqual(...)` and `expect(invoker).toHaveBeenCalledTimes(1)` |
| SC-5 | Zero regressions — all 84 prior tests still pass | `npm test` output shows ≥ 88 passing, 0 failures |
| SC-6 | `npm run typecheck` clean; `npm run lint` clean; `npm run format` no diff | All three commands exit 0 with no output |

---

## Required Test Cases

File: `tests/validator.test.ts`

### T-7a: `tool_call` with missing `name` field throws `ValidationError` (covers SC-1)

Inside `describe('parseAndValidate')`. Call `parseAndValidate('{"type":"tool_call","arguments":{"city":"Accra"}}')`. Assert the thrown error is `instanceof ValidationError`. Assert it is NOT `instanceof ZodError` (Zod must not escape the boundary — same pattern as existing T-2).

### T-7b: `tool_call` with non-object `arguments` throws `ValidationError` (covers SC-2)

Inside `describe('parseAndValidate')`. Call `parseAndValidate('{"type":"tool_call","name":"get_weather","arguments":"city=Accra"}')`. Assert `instanceof ValidationError`.

### T-7c: `tool_call` with missing `arguments` key throws `ValidationError` (covers SC-3)

Inside `describe('parseAndValidate')`. Call `parseAndValidate('{"type":"tool_call","name":"get_weather"}')`. Assert `instanceof ValidationError`.

### T-8: `validateWithRetry` — malformed tool_call attempt 1, valid tool_call attempt 2 resolves (covers SC-4)

Inside `describe('validateWithRetry')`. Set up `invoker` with `vi.fn().mockResolvedValueOnce({ raw: '{"type":"tool_call","name":"get_weather","arguments":{"city":"Accra"}}', backend: 'claude-subprocess' })`. Call `validateWithRetry('{"type":"tool_call","name":"get_weather"}', baseMessages, invoker)` (missing `arguments` — malformed). Assert the resolved value deep-equals `{type:"tool_call", name:"get_weather", arguments:{city:"Accra"}}`. Assert `invoker` was called exactly once. Assert `invoker` received an array of length `baseMessages.length + 1` (the CORRECTION_NOTE was appended).

---

## Review Notes

_(Architect fills after BSE submits.)_

---

## Architect Sign-off

- [ ] Implementation reviewed
- [ ] All success criteria verified
- [ ] All assumptions resolved (proven, or fallback taken & documented)
- [ ] No regressions in full test suite
- [ ] `npm test` / `typecheck` / `lint` / `format` all clean
