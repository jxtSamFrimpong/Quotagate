# Workstream WS_04: Argument Builder, Validator & Response Builder

> A workstream scopes ~1 day of work and is more detailed than its parent phase: concrete goals +
> deliverables, locked decisions (with rejected alternatives), a task breakdown, cross-task
> contracts, and success/quality gates. It is the bridge from phase goals to hour-sized tasks.

## Workstream Overview
- **Parent Phase**: [Phase 1B — OpenAI Translation Pipeline](../phases/01b_openai_translation_pipeline.md)
- **Timeframe**: ~2 days
- **Status**: Proposed
- **Dependencies**: WS_03 signed off — `adapter.complete()` proven against the real subscription; `AdapterResponse` contract stable; green gate holding from Phase 1A.

---

## Goals & Deliverables

- **Goal 1**: A pure, transport-agnostic function that serializes an incoming OpenAI request into the adapter's `AdapterRequest` shape — with zero constraint text injected.
  - Deliverable: `src/argumentBuilder.ts` — `buildAdapterRequest(body: OpenAIChatRequest): AdapterRequest`. Passes messages through unmodified; serializes optional `tools` and `toolChoice` fields. Never adds constraint text (the constraint is owned by the adapter's `build_constrained_prompt`). Named Vitest tests confirm the separation-of-concerns guarantee.

- **Goal 2**: A JSON-parse-and-validate function that checks the raw string returned by `adapter.complete()` against the `QuotagateCompleteResult` Zod schema, with a scaffolded retry loop.
  - Deliverable: `src/validator.ts` — `validate(raw: string, invoker: () => Promise<AdapterResponse>, attempt: number): Promise<QuotagateCompleteResult>`. Parses JSON; validates with Zod; on failure, re-invokes the adapter via the supplied `invoker` callback with a correction note appended to messages, up to 3 attempts, then throws `ValidationError`. The `{type:"text"}` Zod branch is exercised here. The retry loop is fully written and unit-tested against synthetic malformed-response fixtures. Live exercise of the retry path on a real response is Phase 1C (D-1B-02).

- **Goal 3**: A pure function that converts a validated `QuotagateCompleteResult` (text branch only this phase) into a well-formed OpenAI `chat.completion` object.
  - Deliverable: `src/responseBuilder.ts` — `buildChatCompletion(result: QuotagateCompleteResult, model: string): ChatCompletion`. Produces: deterministic `id` (`chatcmpl-<uuid>`), `object: "chat.completion"`, `finish_reason: "stop"`, `choices[0].message` with `role: "assistant"` and non-null `content`. The `{type:"tool_call"}` branch is added in WS_07; this workstream handles `{type:"text"}` only. Named Vitest tests validate against the `openai` package's TypeScript types.

---

## Why This Workstream Matters

The translation pipeline is the backbone of every request Quotagate will ever handle. `argumentBuilder.ts`, `validator.ts`, and `responseBuilder.ts` are the only components that touch both the OpenAI shape and the adapter shape, so they are also the components where constraint text could leak in — or where the OpenAI output contract (invariant #5) could be violated. Getting these three files correct in isolation, with full unit tests, is what makes WS_06's end-to-end integration test a confirmation pass rather than a debugging session.

The separation-of-concerns test in this workstream is specifically a regression guard: it asserts that `argumentBuilder.ts` adds no constraint text at the translation layer. Without that test, a future maintainer could accidentally add a "helpful" system prompt here — and the behavior would be invisible until the WS_09 contamination tests started failing for inexplicable reasons. The test makes the invariant visible.

WS_05 (Fastify proxy and config) can proceed in parallel with this workstream since they operate on different files and both depend only on the `AdapterRequest`/`AdapterResponse` contracts from WS_01. WS_06 depends on both WS_04 and WS_05 being signed off.

---

## Locked Decisions

### WS_04-D1 — `argumentBuilder.ts` Is a Pure Function With No Constraint Injection ✅ LOCKED (Architect, 2026-06-08)
Inherits **D-1B-01** from the parent phase plan (the workstream where the implementation lives).

**Decision**: `buildAdapterRequest` maps OpenAI request fields to `AdapterRequest` fields one-for-one. It does not append a system message, modify the `messages` array, or inject any text that is not present in the caller's original request. The constraint is owned exclusively by `build_constrained_prompt` inside `src/adapters/claude.ts` (WS_02).

**Rationale**: The translation pipeline must be transport-agnostic (invariant #4). If constraint text were injected here, adding a Gemini adapter in Phase 2 would require `argumentBuilder.ts` to know which backend it is targeting — collapsing the clean abstraction. The adapter is the correct owner of the constraint because the constraint is specific to how that adapter needs to be invoked (Mechanism A: per-request prompt engineering in Phase 1; Mechanism B: structural tool definition in Phase 2).

**Rejected alternative — inject the constraint as a system message in `argumentBuilder.ts`**: Breaks transport-agnosticism. When Phase 2 adds the Gemini adapter (which uses a different constraint mechanism or none), `argumentBuilder.ts` would need branching logic per backend. The translation layer would no longer be a clean OpenAI→adapter mapping.

### WS_04-D2 — Validator Retry Loop Written and Unit-Tested in WS_04; Live Exercise Is WS_08 ✅ LOCKED (Architect, 2026-06-08)
Inherits **D-1B-02** from the parent phase plan.

**Decision**: In WS_04, the retry loop (attempt counter, re-invoke with correction note, max-3 termination, `ValidationError` throw on exhaustion) is fully written and unit-tested using Vitest `vi.fn()` doubles that return a malformed raw string on attempt 1 and a well-formed result on attempt 2. The test exercises loop increment, re-invocation, and termination. The live forced-retry path (real adapter response, retry-path contamination proof) is Phase 1C WS_08.

**Rationale**: The validator is in the hot path of the WS_06 no-tools integration test — a well-formed response still flows through it. Deferring the validator to 1C entirely would block WS_06. Conversely, a live forced-retry test is non-deterministic from the network and belongs with the full acceptance work in 1C where a controlled test double is mandated by D-1C-02.

**Rejected alternative — defer all of `validator.ts` to WS_08**: Blocks the WS_06 integration test, which requires the validator to be present on the success path.

### WS_04-D3 — Correction Note Carries Formatting Instruction Only; No Prior-Turn Content ✅ LOCKED (Architect, 2026-06-08)
**Decision**: When the retry loop re-invokes the adapter, the correction note appended to the `messages` array is a formatting instruction only — for example: `{role: "user", content: "The previous response was not valid JSON. Please respond with a single raw JSON object matching the schema: {type:\"text\",content:\"...\"}"}`. It does not echo or reference any content from the malformed prior response.

**Rationale**: Echoing prior-turn content in the correction note would be a stateful contamination vector — the correction turn would carry prior-session context into the retry attempt, violating invariant #10 ("persist the process, never the conversation"). The note is a formatting nudge, not a history entry. This keeps the retry path as clean as the initial path.

**Rejected alternative — echo the malformed response in the correction note ("your last output was: ...")**: Introduces prior-turn content into the retry's message array. On the subprocess transport this is contained to one request's messages, but the pattern must not leak contamination; keeping the note content-free is the correct default.

### WS_04-D4 — `responseBuilder.ts` Handles `{type:"text"}` Branch Only in WS_04 ✅ LOCKED (Architect, 2026-06-08)
**Decision**: `buildChatCompletion` in WS_04 handles only `QuotagateCompleteResult` where `type === "text"`. If called with `type === "tool_call"`, it throws `new QuotagateError("tool_call branch not yet implemented")`. The tool-call branch is added in WS_07.

**Rationale**: Adding the tool-call branch before WS_07 is premature — WS_07 is the workstream that validates the tool-call path, and a partially-tested half-implementation in WS_04 would create false confidence. The explicit throw makes the omission loud rather than silently wrong.

**Rejected alternative — implement both branches now**: The `{type:"tool_call"}` branch requires the full OpenAI `tool_calls` array shape, the `content: null` requirement, `finish_reason: "tool_calls"`, and the `call_<id>` format — all of which are tested properly in WS_07. Implementing it here without those tests creates untested code in the green gate.

---

## Task Breakdown

| Task ID | Description | Est. Duration | Status | Task Tracker Link |
|---------|-------------|---------------|--------|-------------------|
| T1 | Author `src/argumentBuilder.ts`: `buildAdapterRequest(body)` — maps `messages`, `tools`, `toolChoice` to `AdapterRequest`. Unit tests: messages passed through unmodified (no constraint text); `tools: undefined` and `tools: []` produce identical `AdapterRequest`; `toolChoice` forwarded verbatim; separation-of-concerns assertion (no system message added). | ~1 hour | ⬚ Not started | `../../active/TASK_WS04_T1.md` |
| T2 | Author `src/validator.ts` success path: `validate()` parses JSON and Zod-validates `{type:"text"}` branch. Unit tests: valid text fixture parses; malformed JSON throws `ValidationError`; wrong `type` field throws `ValidationError`; missing `content` throws `ValidationError`. | ~1 hour | ⬚ Not started | `../../active/TASK_WS04_T2.md` |
| T3 | Extend `src/validator.ts` with the retry loop. Unit tests using `vi.fn()` doubles: malformed-then-good sequence resolves on attempt 2; three malformed responses throw `ValidationError` after 3 attempts; correction note appended to messages on retry (assert message array length and last message role/content); attempt counter increments. | ~1 hour | ⬚ Not started | `../../active/TASK_WS04_T3.md` |
| T4 | Author `src/responseBuilder.ts` (`{type:"text"}` branch only): `buildChatCompletion(result, model)` — `id` format `chatcmpl-<uuid>`, `object: "chat.completion"`, `finish_reason: "stop"`, `choices[0].message` shape. Unit tests: assert `id` matches `/^chatcmpl-/`; `finish_reason === "stop"`; `choices[0].message.role === "assistant"`; `content` non-null and equals `result.content`; output satisfies `openai` package TypeScript type. Explicit throw for `{type:"tool_call"}`. Green gate passes. | ~1 hour | ⬚ Not started | `../../active/TASK_WS04_T4.md` |

*Status: `✅ Completed` | `🔄 In Progress` | `⬚ Not started` | `❌ Blocked`*

*T1 and T2 are independent and can run in parallel. T3 depends on T2 (extends the same file). T4 is independent of T1–T3. Run T1 and T4 in parallel if two sessions are available, then T2 and T3.*

---

## Cross-Task Contracts

### `buildAdapterRequest` signature (owned by T1 → consumed by WS_05 T2, WS_06)
Defined in `src/argumentBuilder.ts`. Signature:
```typescript
function buildAdapterRequest(body: OpenAIChatRequest): AdapterRequest
```
`proxy.ts` calls this to produce the `AdapterRequest` it hands to the adapter. This function must be a pure function of its input — no I/O, no side effects, no module-level state. WS_05 imports it directly; consumers must not modify the returned object.

### `validate` signature (owned by T2/T3 → consumed by WS_05 T2, WS_06, WS_08)
Defined in `src/validator.ts`. Signature:
```typescript
async function validate(
  raw: string,
  invoker: (correctionMessages: OpenAIMessage[]) => Promise<AdapterResponse>,
  attempt?: number
): Promise<QuotagateCompleteResult>
```
The `invoker` callback is the retry mechanism: when Zod validation fails, `validate` calls `invoker` with the original messages plus the correction note appended, receives a new `AdapterResponse`, and recurses. The `attempt` counter is threaded through to enforce the max-3 limit. WS_05 wires the adapter's `complete()` as the invoker. WS_08 replaces this with a test double for the retry-exhaustion test. Consumers must not bypass `validate` to read `AdapterResponse.raw` directly.

### `buildChatCompletion` signature (owned by T4 → consumed by WS_05 T2, WS_06, WS_07)
Defined in `src/responseBuilder.ts`. Signature:
```typescript
function buildChatCompletion(result: QuotagateCompleteResult, model: string): ChatCompletion
```
`proxy.ts` calls this to produce the response body. WS_07 adds the `{type:"tool_call"}` branch to the same function; it does not change the signature. The return type must satisfy the `openai` package's `ChatCompletion` TypeScript type — this is validated in T4's unit tests.

### `QuotagateCompleteResult` / `AdapterRequest` / `AdapterResponse` (inherited from WS_01 T3)
All three translation pipeline modules import these from `src/types.ts`. No redefinition. Changes to these types are breaking cross-workstream contract revisions that require a Decision Log entry.

---

## Success & Evaluation Criteria

- **Functional requirements**:
  - [ ] `buildAdapterRequest({ messages:[{role:"user",content:"Hi"}] })` returns `{ messages:[{role:"user",content:"Hi"}], tools: undefined, toolChoice: "auto" }` — no additional fields, no constraint text.
  - [ ] `buildAdapterRequest` with `tools: []` and `tools: undefined` produce structurally identical `AdapterRequest` objects (no tool schema injected in either case).
  - [ ] `validate('{"type":"text","content":"Hello"}', ...)` resolves to `{ type:"text", content:"Hello" }` on the first attempt.
  - [ ] `validate('not json', ...)` with a double returning a good response on attempt 2 resolves after one retry.
  - [ ] `validate` with three consecutive malformed responses throws `ValidationError` after exactly 3 attempts.
  - [ ] Retry attempt appends a correction note to messages — the `invoker` receives `messages.length + 1` messages on retry, and the last message has `role: "user"`.
  - [ ] `buildChatCompletion({type:"text", content:"Hi"}, "claude-sonnet-4-6")` returns an object with `id` matching `/^chatcmpl-/`, `finish_reason: "stop"`, `choices[0].message.content === "Hi"`.
  - [ ] `buildChatCompletion` with `{type:"tool_call", ...}` throws `QuotagateError` (explicit pending stub).

- **Named tests that prove this workstream done**:
  - [ ] `tests/argumentBuilder.test.ts` — messages-passthrough test (assert no constraint text; assert no additional system message); `tools: undefined` and `tools: []` equivalence; `toolChoice` forwarding.
  - [ ] `tests/validator.test.ts` — valid text fixture success; malformed JSON failure; missing `content` failure; malformed-then-good retry sequence; triple malformed exhaustion; correction note structure assertion.
  - [ ] `tests/responseBuilder.test.ts` — `chatcmpl-` prefix; `finish_reason: "stop"`; `choices[0].message.role === "assistant"`; `content` equality; TypeScript type assignment to `ChatCompletion`; `tool_call` throws.

- **Quality gates**:
  - [ ] `npm test` green; no test-count regression from WS_03 baseline
  - [ ] `npm run typecheck` clean — zero `any`, no implicit `any`
  - [ ] `npm run lint` clean; `npm run format` produces no diff
  - [ ] Coverage: `argumentBuilder.ts` and `responseBuilder.ts` at 100% branch coverage (pure functions); `validator.ts` retry branches fully covered by the unit tests in T3

---

## Known Pitfalls & Implementation Notes

**`buildAdapterRequest` and the `tools: undefined` vs `tools: []` trap**: The OpenAI SDK sends `tools: undefined` when not set and `tools: []` in some client configurations. `buildAdapterRequest` must normalize both to the same `AdapterRequest` shape so that `build_constrained_prompt` (in the adapter) does not differentiate between them. The unit test in T1 explicitly asserts this equivalence.

**`validate` signature — threading the `invoker` callback**: The retry loop requires re-invoking the adapter with a modified messages array (original messages + correction note). The cleanest way to do this without coupling `validator.ts` to the adapter directly is to pass the invoker as a function parameter. This keeps `validator.ts` pure and testable — T3 passes a `vi.fn()` double as the invoker, which is the exact mechanism used in WS_08's retry-exhaustion test. Do not reach through to the adapter from inside the validator.

**`validate` recursion vs loop**: The retry up to 3 attempts can be written as a loop or as a bounded recursion. A `for` loop with an explicit `attempt` counter is simpler to read and debug than recursion. Either is acceptable, but the loop form is recommended — it avoids tail-call confusion in async contexts.

**`buildChatCompletion` UUID generation**: `crypto.randomUUID()` is available natively in Node 20+ (no import needed). Use `"chatcmpl-" + crypto.randomUUID()` for the `id`. Do not use a third-party UUID library — it is an unnecessary dependency.

**`openai` package TypeScript types**: The `ChatCompletion` type from the `openai` npm package is the contract for `buildChatCompletion`'s return type. Import it as `import type { ChatCompletion } from "openai/resources/chat/completions"`. The TypeScript structural check at compile time is the validator — do not hand-roll a parallel type definition.

**Correction note wording**: The correction note appended on retry must not contain the malformed response text (WS_04-D3). A safe template: `"The previous response was not valid JSON or did not match the required schema. Please respond with a single raw JSON object in one of these forms: {\"type\":\"text\",\"content\":\"<string>\"} or {\"type\":\"tool_call\",\"name\":\"<string>\",\"arguments\":{...}}"`. Keep this wording stable — changing it after WS_08's contamination test is written may invalidate the test's correction-note structure assertion.

**Test isolation for `validate`**: Each test case in `tests/validator.test.ts` must create a fresh `vi.fn()` invoker. Do not reuse a mock across test cases — stale call counts from a prior test will break the attempt-counter assertion.
