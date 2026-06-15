# TASK_WS07_T2: Implement `{type:"tool_call"}` Branch in `responseBuilder.ts`

## Context

- **Workstream**: WS_07 (Tool-Call Response Path)
- **Plan reference**: `docs/plan/workstreams/ws07_tool_call_response_path.md`
- **Phase plan**: `docs/plan/phases/01c_tool_calling_and_acceptance.md`
- **Depends on**: TASK_WS07_T1 (green gate must be held; T1's tests must pass before T2 begins)
- **Blocks**: TASK_WS07_T3 (integration test exercises `buildChatCompletion` on the tool_call path)

---

## Goal & Why

- **Goal**: Replace the `throw new QuotagateError('tool_call branch not yet implemented')` stub in `src/responseBuilder.ts` with a correct implementation of the `{type:"tool_call"}` branch. Update `tests/responseBuilder.test.ts` T-4 to assert the real contract instead of the throw. Add a new T-6 covering the TypeScript compile-time contract for the tool_call branch.
- **Why**: `buildChatCompletion()` is the final seam in the proxy pipeline. It translates the validated `QuotagateCompleteResult` into an OpenAI `ChatCompletion` object that the caller receives. Without the tool_call branch, any request that causes the model to return a tool_call result produces an HTTP 500 (`QuotagateError` unhandled upstream). Implementing it correctly — with `finish_reason:"tool_calls"`, `content:null`, `refusal:null`, and the `tool_calls` array per spec §4.3 — makes Quotagate useful for agentic callers and satisfies invariant #5 (the response is indistinguishable from the real OpenAI API). The compile-time type assignment test (`const out: ChatCompletion = buildChatCompletion(...)`) is the invariant #5 guard at the TypeScript level. If the implementation omits a required field or uses the wrong type, tsc catches it before a test even runs.

---

## Assumptions to Test

| #  | Assumption | Why we believe it | How this task tests it | If false → |
|----|------------|-------------------|------------------------|------------|
| A1 | `ChatCompletionMessage.refusal` is a required field (`string \| null`, no `?`) even when `tool_calls` is populated | Confirmed by reading `node_modules/openai/resources/chat/completions/completions.d.ts` line 1147: `refusal: string \| null` without optional marker | The compile-time assignment test (`const out: ChatCompletion = buildChatCompletion(...)`) will fail tsc if `refusal` is absent | Set `refusal: null` on the message object in the tool_call branch (same as the text branch) |
| A2 | `tool_calls` on `ChatCompletionMessage` is typed as `Array<ChatCompletionMessageToolCall>` where `ChatCompletionMessageToolCall = ChatCompletionMessageFunctionToolCall \| ChatCompletionMessageCustomToolCall` | Confirmed from `completions.d.ts` line 1304 | Type assignment test enforces this at compile time; unit test T-5 asserts `tool_calls[0].type === 'function'` | If the union type changed in a future openai package version, tsc would catch it at upgrade time |
| A3 | `JSON.stringify(result.arguments)` where `result.arguments` is `Record<string,unknown>` produces a valid JSON string that `JSON.parse` round-trips back to the original object | `result.arguments` is a plain JS object validated by Zod; `JSON.stringify` on a plain object always produces valid JSON; `JSON.parse` of that string returns an equal object | T-5 asserts `JSON.parse(out.choices[0].message.tool_calls![0].function.arguments)` deep-equals `{city:"Accra"}` | `result.arguments` somehow contains a non-serializable value (e.g. a `BigInt`) — this cannot happen under the current Zod schema (`z.record(z.string(), z.unknown())`); if it did, `JSON.stringify` would throw, which would surface as a 500 |
| A4 | The existing T-4 in `tests/responseBuilder.test.ts` asserts `throw QuotagateError` — after T2, T-4 must be REPLACED with a contract assertion, not left alongside the implementation | T-4 currently: `expect(() => buildChatCompletion({type:'tool_call',...})).toThrow(QuotagateError)` — if both the old T-4 and a new test exist, the old T-4 would fail (the function no longer throws), which is a regression | T-4 must be rewritten in the same `it()` block; the old assertion is removed | If the old T-4 is accidentally left in place, `npm test` will catch the contradiction — the function no longer throws |

---

## Expected Failures

- **[EF1]** `npm run typecheck` fails with "Property 'refusal' is missing in type '...'". Root cause: `refusal: null` was omitted from the message object in the tool_call branch. Fix: add `refusal: null` to the message object. See Known Pitfall in WS_07 workstream doc.
- **[EF2]** T-4 (old assertion) fails after implementation because `buildChatCompletion` no longer throws for the tool_call input. This is the expected outcome — it proves T-4 was updated correctly. If T-4 somehow still passes (still asserts a throw), the implementation did not replace the stub.
- **[EF3]** `JSON.parse(tool_calls[0].function.arguments)` throws in T-5. Root cause: `function.arguments` was set to the object directly (the double-serialization trap — passing `result.arguments` instead of `JSON.stringify(result.arguments)`). Fix: use `JSON.stringify(result.arguments)`. See WS_07-D2 and Known Pitfalls.
- **[EF4]** The compile-time type assignment test T-6 produces a tsc error for `tool_calls`. Root cause: `tool_calls` was set to an array containing an object literal that does not match `ChatCompletionMessageFunctionToolCall`. The type requires `{id: string, type: 'function', function: {name: string, arguments: string}}`. Ensure each field is present with the exact literal type for `type`.

---

## Test Strategy

- **Unit only**: This task modifies `src/responseBuilder.ts` and `tests/responseBuilder.test.ts`. No integration tests, no new files.
- **Contract assertions**: Every assertion targets the OpenAI response contract (invariant #5). The compile-time assignment (`const out: ChatCompletion`) is the strongest contract assertion — it runs at `npm run typecheck`, before tests execute.
- **T-4 replacement discipline**: The old T-4 (`expect throw QuotagateError`) is REPLACED in the same `it()` block, not left alongside a new `it()`. Leaving both would mean either a failing test (old T-4 would fail on the new implementation) or dead test code if the new one was added with a different name.
- **Regex for UUID**: The `tool_calls[0].id` test asserts `/^call_[0-9a-f-]{36}$/` — the full UUID pattern, not just the prefix. This matches WS_07-D4 and is tighter than the workstream plan's original `/^call_/` shorthand.

---

## Contract: What This Task Inherits

| Symbol / Artifact | Source | Role in This Task |
|-------------------|--------|-------------------|
| `buildChatCompletion(result: QuotagateCompleteResult, model: string): ChatCompletion` | `src/responseBuilder.ts` | The function under implementation |
| `QuotagateCompleteResult` | `src/types.ts` | The discriminated union input; `{type:"tool_call", name: string, arguments: Record<string,unknown>}` is the branch being implemented |
| `ChatCompletion` | `openai/resources/chat/completions` | The return type constraint; must be satisfied at compile time (invariant #5) |
| `ChatCompletionMessage` | `openai/resources/chat/completions` | `refusal: string \| null` is required (non-optional); `tool_calls?: Array<ChatCompletionMessageToolCall>` is optional but must be populated for the tool_call branch |
| `ChatCompletionMessageFunctionToolCall` | `openai/resources/chat/completions` | `{id: string, type: 'function', function: {name: string, arguments: string}}` — the exact type for each element of `tool_calls` |
| `randomUUID` | `node:crypto` | Already imported in `responseBuilder.ts`; used for both `chatcmpl-` id and `call_` tool_call id |
| Existing text branch | `src/responseBuilder.ts` lines 16–33 | Gold standard for the outer shape (`id`, `object`, `created`, `model`, `choices`); tool_call branch shares the same outer shape |
| Existing T-4 in `tests/responseBuilder.test.ts` | `tests/responseBuilder.test.ts` line 37 | Must be REPLACED — currently asserts throw, must assert real contract after this task |

---

## Subtask Progress Table

| #  | Subtask | Status | Iteration | Notes |
|----|---------|--------|-----------|-------|
| 1  | Replace the `throw` stub in `src/responseBuilder.ts` with the tool_call branch implementation | ✅ Done | 1 | `refusal:null` present; `JSON.stringify(result.arguments)` used; `call_`/`chatcmpl-` prefixes correct |
| 2  | Rewrite T-4 in `tests/responseBuilder.test.ts` to assert the tool_call contract (not the throw) | ✅ Done | 1 | Old throw assertion fully replaced; one T-4 only; unused `QuotagateError` import removed |
| 3  | Add T-5: assert `finish_reason`, `content:null`, `tool_calls` array shape, `arguments` JSON round-trip | ✅ Done | 1 | All SC-2 through SC-10 covered; UUID uniqueness included |
| 4  | Add T-6: compile-time ChatCompletion type assignment for the tool_call branch | ✅ Done | 1 | `const out: ChatCompletion = buildChatCompletion(...)` — real structural check, no type cast |
| 5  | Run `npm run typecheck` — 0 errors (EF1 / EF4 would surface here) | ✅ Done | 1 | 0 errors |
| 6  | Run `npm test` — all prior tests pass + T-4 (rewritten) + T-5 + T-6 added (≥ 91 total from 88 T1 baseline) | ✅ Done | 1 | 90 total (T-4 rewrite = 0 net; +2 from T-5, T-6); 0 failures |
| 7  | Run `npm run lint`, `npm run format` — all clean | ✅ Done | 1 | All clean |

_Status icons: `✅ Done` | `🔄 In progress` | `⬚ Not started` | `❌ Blocked`_

---

## Current Subtask Detail

### Subtask 1: Implement the tool_call branch in `src/responseBuilder.ts`

**Approach iteration plan**:
1. Replace the `throw` guard with a branch that constructs the `ChatCompletion` object. Use the text branch as the structural template. Key differences: `finish_reason: 'tool_calls'`; `message.content: null`; `message.refusal: null`; `message.tool_calls: [{id: 'call_' + randomUUID(), type: 'function', function: {name: result.name, arguments: JSON.stringify(result.arguments)}}]`.
2. Run `npm run typecheck` — the compile-time check surfaces missing fields before tests run.
3. Run `npm test` — T-4 (rewritten) + T-5 + T-6 must pass.

- **Current iteration**: 1 of 2
- **Verifiability**: `npm run typecheck` 0 errors; `npm test` shows T-4/T-5/T-6 passing.
- **Challenges**: The `refusal: null` omission is the most likely first error (EF1). The double-serialization trap (EF3) is the second most likely.

**Stop-and-escalate condition**: If `tsc` produces an error that cannot be resolved by adding a field present in the OpenAI type, escalate to PA. Do not suppress with a type cast.

---

## Decisions Made

### D1 — Completion `id` Uses `chatcmpl-` Prefix for Both Branches ✅ LOCKED (Architect, 2026-06-15)

**Decision**: The outer `ChatCompletion.id` field uses `'chatcmpl-' + randomUUID()` for the tool_call branch, identical to the text branch. The `call_` prefix applies only to `tool_calls[0].id` (the per-tool-call identifier). The completion-level id is always `chatcmpl-`.

**Rationale**: The OpenAI API uses `chatcmpl-` for all completion objects regardless of `finish_reason`. Using a different prefix for tool_call responses would make Quotagate's responses distinguishable from the real API, violating invariant #5.

**Rejected alternative — use a different prefix for tool_call completions**: Violates invariant #5. No caller should need to differentiate completion ids by finish_reason.

### D2 — Anti-overengineering scope fence ✅ LOCKED

**This task explicitly does NOT include**:
- Multiple tool_calls in one response (the `tool_calls` array always has exactly one element in Phase 1; the schema is single-tool-call only per `QuotagateCompleteResult`).
- `function_call` (deprecated OpenAI field) — do not populate it.
- Object-form `tool_choice` handling — locked as out of scope by WS_07-D5.
- Any changes to `src/validator.ts`, `src/types.ts`, `src/proxy.ts`, or `src/adapters/`.
- SSE streaming for the tool_call response — Phase 3.
- `usage` field — must remain absent (never fabricated, spec §7.4).

---

## Cross-Task Contracts (Downstream Dependencies on This Task)

### TASK_WS07_T3 will depend on:

- `buildChatCompletion({type:"tool_call", name:"get_weather", arguments:{city:"Accra"}}, "claude-sonnet-4-6")` returns a `ChatCompletion` with `finish_reason:"tool_calls"`, `choices[0].message.content === null`, `choices[0].message.tool_calls[0].function.name === "get_weather"`, and `JSON.parse(choices[0].message.tool_calls[0].function.arguments)` deep-equals `{city:"Accra"}`.
- The function must NOT throw for any schema-valid `{type:"tool_call"}` input.

---

## Files Modified / Created

- `src/responseBuilder.ts` — **modify** (replace the `throw` stub with the tool_call branch implementation)
- `tests/responseBuilder.test.ts` — **modify** (rewrite T-4; add T-5 and T-6; old T-5 empty-content test renumbered T-7)
- `tests/proxy.test.ts` — **consequential update** (pipeline-wiring T-4 retired stub assertion — was HTTP 500 for Phase 1 stub; replaced with HTTP 200 + `finish_reason:'tool_calls'` contract assertion, consistent with green-gate-as-ratchet principle)

---

## Success Criteria / Verifiability

| #    | Criterion | How to verify |
|------|-----------|---------------|
| SC-1 | T-4 (rewritten): `buildChatCompletion({type:"tool_call",name:"get_weather",arguments:{city:"Accra"}}, "m")` does not throw | `expect(() => ...).not.toThrow()` in rewritten T-4 |
| SC-2 | `out.choices[0].finish_reason === 'tool_calls'` | `expect(...).toBe('tool_calls')` in T-5 |
| SC-3 | `out.choices[0].message.content === null` (JSON null, not undefined) | `expect(...).toBeNull()` in T-5 |
| SC-4 | `out.choices[0].message.tool_calls![0].id` matches `/^call_[0-9a-f-]{36}$/` | `expect(...).toMatch(/^call_[0-9a-f-]{36}$/)` in T-5 |
| SC-5 | `out.choices[0].message.tool_calls![0].type === 'function'` | `expect(...).toBe('function')` in T-5 |
| SC-6 | `out.choices[0].message.tool_calls![0].function.name === 'get_weather'` | `expect(...).toBe('get_weather')` in T-5 |
| SC-7 | `JSON.parse(out.choices[0].message.tool_calls![0].function.arguments)` deep-equals `{city:"Accra"}` | `expect(JSON.parse(...)).toEqual({city:'Accra'})` in T-5 |
| SC-8 | Compile-time type assignment `const out: ChatCompletion = buildChatCompletion({type:"tool_call",...}, "m")` produces no tsc error | `npm run typecheck` exits 0 |
| SC-9 | Tool_call id uniqueness: two calls produce different `tool_calls[0].id` values | Two calls in T-5, assert `id1 !== id2` |
| SC-10 | `out.id` matches `/^chatcmpl-[0-9a-f-]{36}$/` (same prefix as text branch) | `expect(...).toMatch(...)` in T-5 |
| SC-11 | Zero regressions — all prior 88 tests (84 baseline + 4 from T1) still pass | `npm test` output ≥ 91 passing, 0 failures |
| SC-12 | `npm run lint` clean; `npm run format` no diff | Both commands exit 0 |

---

## Required Test Cases

File: `tests/responseBuilder.test.ts`

### T-4 (REWRITTEN): tool_call branch does not throw, returns a ChatCompletion (covers SC-1)

Replace the existing T-4 `it()` block entirely. The new T-4 asserts: `expect(() => buildChatCompletion({type:'tool_call', name:'get_weather', arguments:{city:'Accra'}}, 'm')).not.toThrow()`. This is the minimal replacement assertion — the shape contract is in T-5.

**Note to BSE**: The old T-4 text was `'tool_call branch throws QuotagateError with descriptive message (SC-5 / OD-4 / EF1)'`. The new T-4 text should be `'tool_call branch does not throw — implementation complete (SC-1)'`. Update the comment references to SC-1 for this task's criteria table.

### T-5: full tool_call branch contract (covers SC-2 through SC-10)

`const out = buildChatCompletion({type:'tool_call', name:'get_weather', arguments:{city:'Accra'}}, 'claude-sonnet-4-6')`. Assert all of the following:
1. `out.choices[0].finish_reason === 'tool_calls'`
2. `out.choices[0].message.content` is `null` (use `expect(...).toBeNull()`, not `toBeFalsy()`)
3. `out.choices[0].message.tool_calls` has length 1
4. `out.choices[0].message.tool_calls![0].id` matches `/^call_[0-9a-f-]{36}$/`
5. `out.choices[0].message.tool_calls![0].type === 'function'`
6. `out.choices[0].message.tool_calls![0].function.name === 'get_weather'`
7. `JSON.parse(out.choices[0].message.tool_calls![0].function.arguments)` deep-equals `{city:'Accra'}`
8. `out.id` matches `/^chatcmpl-[0-9a-f-]{36}$/`
9. Two successive calls produce different `tool_calls[0].id` values (non-deterministic UUID, same as T-1 id uniqueness test for the text branch)

### T-6: compile-time ChatCompletion type assignment for tool_call branch (covers SC-8)

`const out: ChatCompletion = buildChatCompletion({type:'tool_call', name:'get_weather', arguments:{city:'Accra'}}, 'm')`. `expect(out).toBeDefined()`. This is the invariant #5 guard — the TypeScript compiler rejects the assignment if the returned shape does not satisfy `ChatCompletion`. Do NOT replace with a hand-rolled type assertion; the value of this test is that `tsc` runs `ChatCompletion`'s full structural check.

---

## Review Notes

**Review Date**: 2026-06-15 — Principal Architect

Implementation is structurally correct. `refusal: null` is present (A1 confirmed — `ChatCompletionMessage.refusal` is non-optional in the installed SDK). `JSON.stringify(result.arguments)` correctly avoids the double-serialization trap (A3). `call_` prefix on tool id, `chatcmpl-` on outer completion id (D1 honored). No type casts, no `@ts-ignore`, no `any` suppressions in the implementation. T-6 compile-time assignment does real structural work — tsc would have caught any missing field.

The `tests/proxy.test.ts` pipeline T-4 update is a **legitimate consequential change**: the old assertion correctly described the Phase 1 stub behavior (HTTP 500); with the stub retired, leaving it would have broken the green gate. Updating it atomically with the production change is the correct application of the green-gate-as-ratchet principle. The scope-deviation in the "Files Modified" list was a documentation gap only — now corrected above.

One cosmetic note: the old `responseBuilder.test.ts` T-5 (empty-content test) was renumbered T-7 when T-5 and T-6 were inserted. No functional impact; no future tracker references to `T-5` by label in this test file should be relied upon.

---

## Architect Sign-off

- [x] Implementation reviewed
- [x] All success criteria verified (SC-1 through SC-12, all pass)
- [x] All assumptions resolved (A1–A4 all confirmed — `refusal` required, `tool_calls` typed correctly, `JSON.stringify` round-trips, old T-4 fully replaced)
- [x] No regressions in full test suite (90 tests, 0 failures)
- [x] `npm test` / `typecheck` / `lint` / `format` all clean
