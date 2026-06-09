# Workstream WS_07: Tool-Call Response Path

> A workstream scopes ~1 day of work and is more detailed than its parent phase: concrete goals +
> deliverables, locked decisions (with rejected alternatives), a task breakdown, cross-task
> contracts, and success/quality gates. It is the bridge from phase goals to hour-sized tasks.

## Workstream Overview

- **Parent Phase**: [Phase 1C — Tool Calling & Acceptance](../phases/01c_tool_calling_and_acceptance.md)
- **Timeframe**: ~2 days
- **Status**: Proposed
- **Dependencies**: WS_06 signed off — no-tools end-to-end integration test passing; Phase 1B green gate holding. WS_07 and WS_08 are largely independent and can proceed in parallel once WS_06 is signed off. WS_09 depends on both.

---

## Goals & Deliverables

- **Goal 1**: The `{type:"tool_call"}` Zod validation branch in `validator.ts`.
  - Deliverable: Extended `src/validator.ts` — adds Zod parsing of `{type:"tool_call", name: string, arguments: Record<string,unknown>}` to the discriminated union check. Malformed tool-call shapes (missing `name`, non-object `arguments`, wrong `type`) trigger the same retry loop as malformed text. Unit tests cover: valid tool-call fixture parses; missing `name` field triggers retry; non-object `arguments` triggers retry; `type: "tool_call"` with no `arguments` field triggers retry.

- **Goal 2**: The `{type:"tool_call"}` branch of `responseBuilder.ts`.
  - Deliverable: Extended `src/responseBuilder.ts` — adds the `finish_reason: "tool_calls"` branch: `choices[0].message.content` is `null`; `choices[0].message.tool_calls` is a well-formed array per spec §4.3 (`id: "call_<uuid>"`, `type: "function"`, `function.name`, `function.arguments` as a serialized JSON string). Named Vitest tests validate against the `openai` package's TypeScript types for `ChatCompletion` with `finish_reason: "tool_calls"`. **The tool is never executed — invariant #1.**

- **Goal 3**: The tool-call integration test — an OpenAI SDK call with a `tools` array produces `finish_reason: "tool_calls"` and the correct declared function name, with no side effect within the proxy process.
  - Deliverable: `tests/integration/e2e.toolCall.test.ts` — real OpenAI SDK against the running Fastify server (same `beforeAll`/`afterAll` pattern as WS_06); a request with a `get_weather` tool and a user message asking for weather; asserts `finish_reason: "tool_calls"`, `tool_calls[0].function.name === "get_weather"`, `arguments` is parseable JSON. Asserts invariant #1 per D-1C-03: no execution side effect within the proxy process (absence-of-side-effect test using a `write_file` tool; asserts no file was created at the path in the arguments).

---

## Why This Workstream Matters

The tool-call path is the second half of Quotagate's core value proposition — it is what makes Quotagate useful for agentic applications, not just chat. The `{type:"tool_call"}` branch of the validator and response builder is also where invariant #1 ("the proxy never executes tool calls") must be asserted as a test, not assumed. The test for invariant #1 is the proof that the proxy returns a declaration and nothing else.

The absence-of-side-effect test strategy (D-1C-03) is the correct way to assert invariant #1, because there is no "execute tool" function inside Quotagate to mock — that code path literally does not exist. The test reflects that architectural reality: instead of asserting `spy.notCalled()`, it asserts that the world did not change. This is an important distinction to preserve in the test code.

WS_07 and WS_08 are independent of each other. They can proceed in parallel after WS_06 sign-off. WS_09 (the acceptance gate) depends on both; do not attempt WS_09 until both are signed off.

---

## Locked Decisions

### WS_07-D1 — `{type:"tool_call"}` Validator Branch Added to Existing `validator.ts`; No New File ✅ LOCKED (Architect, 2026-06-08)

**Decision**: The tool-call Zod branch is added to the existing `validate()` function in `src/validator.ts` — it is a new arm of the existing discriminated union parse, not a separate function or file. The `QuotagateCompleteResult` Zod schema already defines both branches (WS_01-D3); `validate()` now exercises both.

**Rationale**: The validator's job is to parse any `QuotagateCompleteResult` shape — the routing decision (which branch was returned) is determined by the Zod parse result, not by separate entry points. A separate function would duplicate the retry loop logic, creating a drift risk between the two paths.

**Rejected alternative — a separate `validateToolCall()` function**: Duplicates the retry loop. The retry behavior is identical for both branches — only the Zod schema differs. Keeping one `validate()` entry point that routes internally is cleaner and less error-prone.

### WS_07-D2 — `responseBuilder.ts` Tool-Call Branch: `arguments` Is a JSON String, Not an Object ✅ LOCKED (Architect, 2026-06-08)

**Decision**: In the OpenAI `tool_calls` array, `function.arguments` must be a **serialized JSON string** — `JSON.stringify(result.arguments)` — not the raw `Record<string,unknown>` object. This is the OpenAI API contract (spec §4.3, step 6). The test asserts `JSON.parse(tool_calls[0].function.arguments)` succeeds and produces the expected object.

**Rationale**: The OpenAI API specification defines `function.arguments` as a string. The `openai` TypeScript package types it as `string`. A caller using the standard SDK pattern — `JSON.parse(toolCall.function.arguments)` — would throw if the value were already an object. This is a subtle but load-bearing distinction that has caused real-world bugs in proxy implementations.

**Rejected alternative — pass `result.arguments` (the object) directly**: Violates the OpenAI response contract (invariant #5). The TypeScript type is `string`; passing an object would produce a type error if strict checks are applied.

### WS_07-D3 — Invariant #1 Asserted via Absence-of-Side-Effect, Not a Spy ✅ LOCKED (Architect, 2026-06-08)

Inherits **D-1C-03** from the parent phase plan.

**Decision**: The tool-call integration test asserts invariant #1 ("the proxy never executes tool calls") by:
(a) Sending a request with a tool named `get_weather`; asserting the response is `finish_reason: "tool_calls"` with `function.name === "get_weather"` and no execution.
(b) Sending a request with a tool named `write_file` and a `path` argument pointing to a file that does not exist; asserting the response is `{type:"tool_call"}` and that the file was NOT created at the path in the arguments.

There is no `executeTool()` function inside Quotagate to spy on — invariant #1 means that code path does not exist.

**Rationale**: Mocking a non-existent function proves nothing. The absence-of-side-effect test is the only honest assertion for this invariant. It also serves as a canary: if someone accidentally introduces an execution path in a future refactor, the test will catch it by observing the file system state change.

**Rejected alternative — mock a "tool execution layer" and assert it was not called**: There is no such layer to mock. The test would be asserting on an invented fixture, not on the actual behavior. The absence-of-side-effect test is grounded in the real world.

### WS*07-D4 — Tool-Call `id` Format Is `call*<uuid>` ✅ LOCKED (Architect, 2026-06-08)

**Decision**: The `tool_calls[0].id` in the response builder output uses the format `"call_" + crypto.randomUUID()`. The unit test asserts the id matches `/^call_/`.

**Rationale**: The OpenAI API uses `call_` prefixed ids for tool call objects. Matching this prefix makes Quotagate's responses indistinguishable from the real API (invariant #5). The full id is non-deterministic (UUID) — the test asserts the prefix, not the full value.

**Rejected alternative — use a sequential counter (`call_0`, `call_1`, ...)**: Non-deterministic ids from a UUID are safer in concurrent scenarios (no counter state to share). The OpenAI API uses non-sequential ids; matching that pattern is correct.

---

## Task Breakdown

| Task ID | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Est. Duration | Status        | Task Tracker Link              |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ------------- | ------------------------------ |
| T1      | Add `{type:"tool_call"}` Zod branch to `src/validator.ts`. Unit tests: valid tool-call fixture parses; missing `name` triggers retry; non-object `arguments` triggers retry; `type: "tool_call"` missing `arguments` triggers retry; both text and tool-call branches parse correctly from the same `validate()` entry point.                                                                                                                                                                        | ~1 hour       | ⬚ Not started | `../../active/TASK_WS07_T1.md` |
| T2      | Add `{type:"tool_call"}` branch to `src/responseBuilder.ts`. Produces: `finish_reason: "tool_calls"`, `content: null`, `tool_calls: [{id: "call_<uuid>", type: "function", function: {name, arguments: JSON.stringify(args)}}]`. Unit tests: `finish_reason === "tool_calls"`; `content === null`; `tool_calls[0].function.name` correct; `JSON.parse(tool_calls[0].function.arguments)` round-trips the input `arguments`; id matches `/^call_/`; TypeScript type-checks as valid `ChatCompletion`. | ~1 hour       | ⬚ Not started | `../../active/TASK_WS07_T2.md` |
| T3      | Author `tests/integration/e2e.toolCall.test.ts`: (a) `get_weather` tool call — assert `finish_reason: "tool_calls"`, `tool_calls[0].function.name === "get_weather"`, `arguments` parseable JSON. (b) `write_file` absence-of-side-effect — assert file NOT created. Use `beforeAll`/`afterAll` server fixture (same pattern as WS_06). Guard with `healthCheck()` skip.                                                                                                                             | ~1 hour       | ⬚ Not started | `../../active/TASK_WS07_T3.md` |
| T4      | Green-gate close-out: run the full suite (`npm test`, `typecheck`, `lint`, `format`). Fix any issues from the live tool-call run (constraint wording for tool calls, `arguments` serialization edge cases). Confirm the `write_file` absence-of-side-effect test is not brittle (no file created at the temp path regardless of test run order).                                                                                                                                                     | ~45 min       | ⬚ Not started | `../../active/TASK_WS07_T4.md` |

_Status: `✅ Completed` | `🔄 In Progress` | `⬚ Not started` | `❌ Blocked`_

_T1 and T2 are independent and can run in parallel. T3 depends on T1 and T2 (the integration test exercises both). T4 depends on T3. If constraint wording issues are found in T3, the fix is in `adapters/claude.ts` (WS_02 — no changes to T1/T2 needed)._

---

## Cross-Task Contracts

### `validate()` with tool-call branch (extended by T1 → consumed by T3, WS_05 T3, WS_09)

`validate()` in `src/validator.ts` now handles both `{type:"text"}` and `{type:"tool_call"}` via the `QuotagateCompleteResult` discriminated union. The function signature does not change (owned by WS_04-T2/T3). The `invoker` callback and retry loop are identical for both branches. Consumers (WS_05's `proxy.ts`, WS_09's acceptance tests) do not need to change their call site — the validator routes internally based on the parsed `type` field.

### `buildChatCompletion()` with tool-call branch (extended by T2 → consumed by T3, WS_05, WS_09)

`buildChatCompletion()` in `src/responseBuilder.ts` now handles both branches. The function signature does not change. `proxy.ts` (WS_05) calls it unconditionally; the branching is internal. The return type is still `ChatCompletion` — the OpenAI package's TypeScript type accommodates both `finish_reason: "stop"` and `finish_reason: "tool_calls"` in the `choices[0]` discriminated union.

### `write_file` absence-of-side-effect test (T3 → WS_09 scope note)

The `write_file` test in T3 generates a temp path (e.g. `/tmp/quotagate-test-<uuid>`). The test asserts the file does not exist after the request. This path should be unique per test run to avoid cross-run interference. WS_09 does not re-run this specific assertion — WS_07 T3 owns the invariant #1 proof.

### `QuotagateCompleteResult` `{type:"tool_call"}` branch (inherited from WS_01 T3)

The Zod schema for `{type:"tool_call", name: string, arguments: Record<string,unknown>}` is already defined in `src/types.ts`. T1 and T2 import it from `src/types.ts` — they do not redefine it. Any change to the `tool_call` branch of `QuotagateCompleteResult` is a breaking contract change requiring a Decision Log entry.

---

## Success & Evaluation Criteria

- **Functional requirements**:
  - [ ] `validate('{"type":"tool_call","name":"get_weather","arguments":{"city":"Accra"}}', ...)` resolves to `{type:"tool_call", name:"get_weather", arguments:{city:"Accra"}}` on the first attempt.
  - [ ] `validate('{"type":"tool_call","arguments":{"city":"Accra"}}', ...)` (missing `name`) triggers the retry loop.
  - [ ] `buildChatCompletion({type:"tool_call", name:"get_weather", arguments:{city:"Accra"}}, "claude-sonnet-4-6")` returns an object with `finish_reason: "tool_calls"`, `choices[0].message.content === null`, `choices[0].message.tool_calls[0].function.name === "get_weather"`, `JSON.parse(choices[0].message.tool_calls[0].function.arguments)` equals `{city:"Accra"}`.
  - [ ] Real OpenAI SDK call with `tools: [{type:"function", function:{name:"get_weather", ...}}]` returns `finish_reason: "tool_calls"` and `tool_calls[0].function.name === "get_weather"`.
  - [ ] Real OpenAI SDK call with `tools: [{type:"function", function:{name:"write_file", parameters:{...path...}}}]` returns `{type:"tool_call"}` and the file at the path in `arguments` was NOT created by the proxy process (absence-of-side-effect assertion).

- **Named tests that prove this workstream done**:
  - [ ] `tests/validator.test.ts` (extended) — valid tool-call branch; missing `name` retry; non-object `arguments` retry; both branches work from one entry point.
  - [ ] `tests/responseBuilder.test.ts` (extended) — `finish_reason: "tool_calls"`; `content: null`; `tool_calls` array shape; `arguments` is a JSON string; id prefix; TypeScript type assignment.
  - [ ] `tests/integration/e2e.toolCall.test.ts` — `get_weather` function name and parseable arguments; `write_file` absence-of-side-effect.

- **Quality gates**:
  - [ ] `npm test` green; no test-count regression from WS_06 baseline
  - [ ] `npm run typecheck` clean — `ChatCompletion` type constraint satisfied for both branches
  - [ ] `npm run lint` clean; `npm run format` produces no diff
  - [ ] Coverage: new `tool_call` branches in `validator.ts` and `responseBuilder.ts` at 100% in unit tests

---

## Known Pitfalls & Implementation Notes

**`content: null` vs `content: undefined`**: The OpenAI API specifies `choices[0].message.content === null` (the JSON null value, not JavaScript `undefined`) when `finish_reason === "tool_calls"`. The `openai` TypeScript package types this as `string | null`. Use `content: null` explicitly — do not rely on `undefined` being serialized to `null` by `JSON.stringify`, which it is not (undefined properties are dropped from JSON serialization entirely).

**`arguments` as a JSON string — double serialization trap**: `result.arguments` is a `Record<string,unknown>` (a JavaScript object). `JSON.stringify(result.arguments)` produces the correct string. Do NOT `JSON.stringify` a value that has already been stringified — if the model ever returns `arguments` as a pre-serialized string (a malformed response), the validator's Zod schema should catch it (since the schema requires `arguments` to be an object). The test should explicitly verify the round-trip: `JSON.parse(response.tool_calls[0].function.arguments)` produces the original object.

**Constraint wording for tool-call requests**: The `build_constrained_prompt` in `adapters/claude.ts` must handle the `tools` array correctly to produce `{type:"tool_call"}` responses reliably. If the integration test in T3 shows a high retry rate on the tool-call path, iterate the constraint wording in `adapters/claude.ts` — do not lower the validator's Zod strictness. The constraint is tunable (Quotagate owns the prompt); the schema is the contract.

**`write_file` test path generation**: Use `/tmp/quotagate-invariant1-<crypto.randomUUID()>` as the path. The UUID ensures the path is unique per test run. After the test, clean up with `fs.rmSync(path, {force:true})` in `afterEach` — even though the file should not exist if invariant #1 holds, defensive cleanup prevents a false positive on a re-run if a previous implementation did create the file.

**Multiple tool calls in one response**: The OpenAI API allows `tool_calls` to be an array with multiple entries (the model could decide to call multiple functions). In Phase 1, Quotagate's `QuotagateCompleteResult` schema only handles a single tool call: `{type:"tool_call", name: string, arguments: Record<string,unknown>}`. `responseBuilder.ts` therefore produces a `tool_calls` array with exactly one element. Multi-tool-call responses are not in scope until the schema is extended; the validator will correctly reject a malformed response that does not match the single-tool-call shape and trigger a retry.

**OpenAI SDK `tool_calls` type checking**: The `openai` package's `ChatCompletionMessage` type has `tool_calls?: Array<ChatCompletionMessageToolCall>`. Each `ChatCompletionMessageToolCall` has `id: string`, `type: "function"`, `function: {name: string, arguments: string}`. Import this type and use it to verify `buildChatCompletion`'s return type compiles cleanly in T2.
