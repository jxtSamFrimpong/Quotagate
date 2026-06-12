# TASK_WS06_T2: Happy-Path E2E — Real Claude Subscription, Full OpenAI SDK Assertion

## Context

- **Workstream**: WS_06 (No-Tools End-to-End Integration Test)
- **Plan reference**: `docs/plan/workstreams/ws06_e2e_no_tools.md`
- **Phase plan**: `docs/plan/phases/01b_openai_translation_pipeline.md`
- **Depends on**: TASK_WS06_T1 (fixture and server lifecycle must exist and pass)
- **Blocks**: TASK_WS06_T4 (T4 cannot close out Phase 1B until T2 passes)

---

## Goal & Why

- **Goal**: Add the happy-path test case to `tests/integration/e2e.noTools.test.ts`. The test calls `client.chat.completions.create({ model: 'claude-sonnet-4-6', messages: [{ role: 'user', content: 'Hello' }] })` against the real Claude subprocess through the live Fastify server and asserts all six Phase 1B success criteria on the returned `ChatCompletion` object.
- **Why**: This is the first time the entire Phase 1B stack — `OpenAI SDK → Fastify → proxy.ts pipeline → argumentBuilder → ClaudeAdapter subprocess → validator → responseBuilder` — is exercised as an end-to-end unit without any mocking. Unit tests prove each component in isolation; this test proves they are correctly composed. If it fails, the fix must land in the production code (WS_04 or WS_05 files), not in the test assertions. Per Engineering Integrity §5: "Tests must prove the fix, not hide the failure."

---

## Assumptions to Test

| #  | Assumption | Why we believe it | How this task tests it | If false → |
|----|------------|-------------------|------------------------|------------|
| A1 | `ClaudeAdapter._completeViaSubprocess` delivers `CONSTRAINT_INSTRUCTIONS` via `--system-prompt` and the model returns `{"type":"text","content":"<string>"}` for a simple no-tools message | Proven in WS_03 T-I1 (`constraint.integration.test.ts`) against `adapter.complete()` directly | The full pipeline test exercises the same subprocess path; if the response is not Zod-valid JSON, `validateWithRetry` will retry and eventually throw `ValidationError` | Fix the constraint wording in `src/adapters/claude.ts` `CONSTRAINT_INSTRUCTIONS` |
| A2 | `buildChatCompletion` produces a `ChatCompletion` shape that the `openai` v6 SDK client accepts without throwing | `responseBuilder.ts` imports `ChatCompletion` from `openai/resources/chat/completions` and the unit tests validate against it | Assign `await client.chat.completions.create(...)` to a typed `ChatCompletion` variable; assert the six criteria | Fix `responseBuilder.ts` — check required fields against the `openai` TypeScript type definition |
| A3 | `Fastify` serializes the `ChatCompletion` object to JSON with `Content-Type: application/json` and the `openai` SDK client deserializes it correctly | Fastify v5 auto-serializes objects passed to `reply.send()` | The SDK client successfully returns a typed `ChatCompletion` without throwing a parse error | Check if a custom `reply.type('application/json')` is needed; it should not be |
| A4 | `response.usage` is absent from the response body and the SDK client does not throw when accessing it | `responseBuilder.ts` returns an object without a `usage` key; `ChatCompletion.usage` is `usage?: CompletionUsage` (optional); the SDK deserializes JSON as-is | Assert `response.usage === undefined` | If the SDK throws: add `usage: null` to `responseBuilder.ts` return value (spec §7.4 allows null; never fabricate counts) |

---

## Expected Failures

- **[EF1]** First run: `validateWithRetry` exhausts all 3 retries because the constraint prompt causes the model to return prose wrapping the JSON (e.g., markdown fences). Root cause: `CONSTRAINT_INSTRUCTIONS` in `src/adapters/claude.ts` wording has drifted. Fix: revise the constraint wording. Do not adjust the validator to strip fences — `OD-6` locks that decision.
- **[EF2]** `buildChatCompletion` produces a shape the SDK rejects. Most likely cause: a required field on `ChatCompletion` is missing (e.g., `created`, `model`, `object`). Fix: add the missing field to the return value in `responseBuilder.ts`. Cross-reference the `ChatCompletion` TypeScript type in `openai/resources/chat/completions/completions.d.ts`.
- **[EF3]** `adapter.complete()` is called twice (once for the initial response, once as the `invoker` in the retry path) due to a parsing error. This surfaces as `stubAdapter.complete` being called more than once in the Vitest output. Root cause is EF1. The fix is EF1's fix.
- **[EF4]** The test times out at 60,000ms. Cause: the subprocess is taking unusually long under load. Raise to 90,000ms as a last resort. Do not mask the real issue (which would be a constraint failure causing retries, not raw latency).
- **[EF5]** `response.choices[0].message.content` is `null` rather than a non-empty string. This means `buildChatCompletion` received a `tool_call` result instead of a `text` result, which throws a `QuotagateError` in the current implementation — so this would surface as a 500, not a null content. If it somehow reaches the assertion, it indicates the constraint is returning `tool_call` unexpectedly for a no-tools request.

---

## Test Strategy

- **Integration only**: This task adds exactly one `it()` block to the existing file from T1. No new files.
- **No mocking**: Per WS_06-D1. The `ClaudeAdapter` is the real subprocess adapter. The server is the real Fastify instance from T1's `beforeAll`.
- **Contract assertions**: All six Phase 1B criteria are asserted explicitly (not implicitly via type assignment). A 7th assertion (`response.usage === undefined`) confirms the absence of fabricated token counts.
- **Failure triage discipline**: If the test fails, identify which component is broken before touching any code. The failure will manifest at one of three seams: (1) `validateWithRetry` throws after 3 retries → constraint issue in `claude.ts`; (2) `buildChatCompletion` throws `QuotagateError` → unexpected `tool_call` result; (3) SDK rejects the response shape → `responseBuilder.ts` field mismatch. Match the error to the seam and fix at the source.

---

## Contract: What This Task Inherits

| Symbol / Artifact | Source | Role in This Task |
|-------------------|--------|-------------------|
| `server`, `client`, `baseURL`, `adapter` | T1's `beforeAll` in `e2e.noTools.test.ts` | Module-scoped variables; consumed here directly |
| `client.chat.completions.create(body): APIPromise<ChatCompletion>` | `openai` v6 | The call under test; no `stream` flag (non-streaming overload) |
| `ChatCompletion` type | `openai/resources/chat/completions` | Type for the response; used for typed assignment and assertion |
| `CONSTRAINT_INSTRUCTIONS` in `ClaudeAdapter` | `src/adapters/claude.ts` line 32–43 | The subprocess constraint that must produce `{"type":"text","content":"<string>"}` |
| `buildChatCompletion(result, model): ChatCompletion` | `src/responseBuilder.ts` | Produces the response object; must emit `id`, `object`, `created`, `model`, `choices[0]` |
| `validateWithRetry` | `src/validator.ts` | Retry orchestrator; 3 attempts max (`MAX_ATTEMPTS = 3`) |

---

## Subtask Progress Table

| #  | Subtask | Status | Iteration | Notes |
|----|---------|--------|-----------|-------|
| 1  | Add T-2 happy-path `it()` block to `e2e.noTools.test.ts` with the `healthCheck` guard and `{ timeout: 60_000 }` | ⬚ Not started | — | |
| 2  | Call `await client.chat.completions.create({ model: 'claude-sonnet-4-6', messages: [{ role: 'user', content: 'Hello' }] })` and assign to a typed `ChatCompletion` variable | ⬚ Not started | — | |
| 3  | Assert SC-1: `response.choices[0].finish_reason === 'stop'` | ⬚ Not started | — | |
| 4  | Assert SC-2: `response.choices[0].message.role === 'assistant'` | ⬚ Not started | — | |
| 5  | Assert SC-3: `response.choices[0].message.content` is a non-empty string (`typeof ... === 'string'` and `length > 0`) | ⬚ Not started | — | |
| 6  | Assert SC-4: `response.id` matches `/^chatcmpl-/` | ⬚ Not started | — | |
| 7  | Assert SC-5: `response.object === 'chat.completion'` | ⬚ Not started | — | |
| 8  | Assert SC-6: `response.usage === undefined` | ⬚ Not started | — | |
| 9  | Run `npm test` against the real subscription; triage any failures per the EF list above | ⬚ Not started | — | |
| 10 | If any failure requires a production code fix, apply it in the correct `src/` file, re-run the full suite, confirm no regressions | ⬚ Not started | — | |
| 11 | Run `npm run typecheck`, `npm run lint`, `npm run format` — all clean | ⬚ Not started | — | |

_Status icons: `✅ Done` | `🔄 In progress` | `⬚ Not started` | `❌ Blocked`_

---

## Current Subtask Detail

### Subtask 1: Add T-2 test block

**Approach iteration plan**:
1. Write the test body with all assertions. Run with `healthCheck()` skip guard in place.
2. If the test runs and fails, identify the seam (constraint / response shape / SDK rejection) and fix the production code.
3. Confirm all six assertions pass; confirm `response.usage` is `undefined`.

- **Current iteration**: 1 of 3
- **Verifiability**: `npm test` shows T-2 passing with all assertions; no `expect()` failure; no timeout.
- **Challenges**: The constraint is the most likely failure point on first run (EF1). Do not adjust test assertions to be lenient — diagnose and fix the source.

**Stop-and-escalate condition**: If `validateWithRetry` retries but the second or third attempt also fails with a different parse error (not a fence-wrapping issue), escalate to the Principal Architect before modifying `CONSTRAINT_INSTRUCTIONS`. A new failure mode may indicate a deeper contract issue.

---

## Decisions Made

### D1 — Assertions are the Phase 1B spec criteria verbatim ✅ LOCKED (Architect, 2026-06-12)

**Decision**: The six assertions (finish_reason, role, content, id, object, usage) are the canonical Phase 1B success criteria plus the `usage` clarification. They are not relaxed for convenience.

**Rationale**: Engineering Integrity §5 and §6. "Any response that is 'close enough but not quite right' is a breaking change for every consumer using the real OpenAI SDK." The test expresses the correct contract; production code must meet it.

**Rejected alternative — assert only finish_reason and role**: Insufficient. A response could have correct metadata but a null or empty `content`, which is a broken contract for the consumer.

### D2 — Fix production code, not the test, if assertions fail ✅ LOCKED (Architect, 2026-06-12)

**Decision**: If T-2 fails, the fix lands in `src/adapters/claude.ts` (constraint wording), `src/validator.ts` (retry logic), or `src/responseBuilder.ts` (shape), not in the test assertions.

**Rationale**: Engineering Integrity §4: "A test that passes because it bypasses the broken code path is a deferred bug." The test correctly describes the contract.

**Rejected alternative — broaden assertions (e.g., assert content is a string but not non-empty)**: Masks real failures. An empty string response would be a broken contract.

### D3 — Anti-overengineering scope fence ✅ LOCKED

**This task explicitly does NOT include**:
- Error-path tests (T3's responsibility).
- Any streaming-related code or assertions.
- Token count assertions — `usage` must be `undefined`, never fabricated.
- Multi-turn conversation tests (Phase 1C scope).

---

## Files Modified / Created

- `tests/integration/e2e.noTools.test.ts` — **modify** (add T-2 `it()` block)
- Potentially `src/adapters/claude.ts` — **modify** (constraint wording if EF1 manifests)
- Potentially `src/responseBuilder.ts` — **modify** (missing required field if EF2 manifests)

---

## Success Criteria / Verifiability

| #    | Criterion | How to verify |
|------|-----------|---------------|
| SC-1 | `response.choices[0].finish_reason === 'stop'` | `expect(...).toBe('stop')` in T-2 |
| SC-2 | `response.choices[0].message.role === 'assistant'` | `expect(...).toBe('assistant')` in T-2 |
| SC-3 | `response.choices[0].message.content` is a non-empty string | `expect(typeof ...).toBe('string')` and `expect(...length).toBeGreaterThan(0)` |
| SC-4 | `response.id` matches `/^chatcmpl-/` | `expect(...).toMatch(/^chatcmpl-/)` |
| SC-5 | `response.object === 'chat.completion'` | `expect(...).toBe('chat.completion')` |
| SC-6 | `response.usage === undefined` | `expect(...).toBeUndefined()` |
| SC-7 | No regressions — full suite still green | `npm test` shows ≥ 81 tests passing (80 WS_01–WS_05 baseline + T1 smoke + T2) |
| SC-8 | `npm run typecheck` clean; `npm run lint` clean; `npm run format` no diff | Zero errors/issues |

---

## Required Test Cases

File: `tests/integration/e2e.noTools.test.ts`

### T-2: happy path — full Phase 1B stack, six assertions (covers SC-1 through SC-6)

Call `await client.chat.completions.create({ model: 'claude-sonnet-4-6', messages: [{ role: 'user', content: 'Hello' }] })`. Assign result to `const response: ChatCompletion`. Assert:
1. `response.choices[0].finish_reason === 'stop'`
2. `response.choices[0].message.role === 'assistant'`
3. `typeof response.choices[0].message.content === 'string'` and `response.choices[0].message.content.length > 0`
4. `response.id` matches `/^chatcmpl-/`
5. `response.object === 'chat.completion'`
6. `response.usage === undefined`

Test options: `{ timeout: 60_000 }`. Guard: `adapter.healthCheck()` → `ctx.skip()` if false.

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
