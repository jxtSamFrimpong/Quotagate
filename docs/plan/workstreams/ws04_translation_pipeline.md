# Workstream WS_04: Argument Builder, Validator & Response Builder

> A workstream scopes ~1 day of work and is more detailed than its parent phase: concrete goals +
> deliverables, locked decisions (with rejected alternatives), a task breakdown, cross-task
> contracts, and success/quality gates. It is the bridge from phase goals to hour-sized tasks.

## Workstream Overview

- **Parent Phase**: [Phase 1B — OpenAI Translation Pipeline](../phases/01b_openai_translation_pipeline.md)
- **Timeframe**: ~1 day (4 tasks × ~1 hour focused implementation + green-gate / review overhead)
- **Status**: ✅ **Completed** (Phase 1 closed, 2026-08-24 — WS_09 T4 sign-off)
- **Dependencies**: WS_03 signed off — `adapter.complete()` proven against the real subscription; `AdapterResponse` contract stable; green gate holding from Phase 1A.

---

## Goals & Deliverables

- **Goal 1**: A pure, transport-agnostic function that serializes an incoming OpenAI request into the adapter's `AdapterRequest` shape — with zero constraint text injected.
  - Deliverable: `src/argumentBuilder.ts` — `buildAdapterRequest(body: OpenAIChatRequest): AdapterRequest`. Passes messages through unmodified; serializes optional `tools` and `toolChoice` fields. Never adds constraint text (the constraint is owned by the adapter's `build_constrained_prompt`). Named Vitest tests confirm the separation-of-concerns guarantee.

- **Goal 2**: A JSON-parse-and-validate **core** that checks the raw string returned by `adapter.complete()` against the `QuotagateCompleteResult` Zod schema, plus a thin retry **orchestrator** layered on top of it (OD-5 LOCKED — split, not one fused function).
  - Deliverable: `src/validator.ts` — two exports:
    - `parseAndValidate(raw: string): QuotagateCompleteResult` (T2) — pure: parses JSON, validates with Zod, returns the typed result or throws `ValidationError`. No `invoker`, no `attempt`, no adapter knowledge. The `{type:"text"}` Zod branch is exercised here; a schema-valid `{type:"tool_call"}` is returned faithfully (OD-7 — rejection of the unsupported branch is `responseBuilder`'s job, not the validator's).
    - `validateWithRetry(raw: string, messages: OpenAIMessage[], invoker: (messages: OpenAIMessage[]) => Promise<AdapterResponse>): Promise<QuotagateCompleteResult>` (T3) — wraps `parseAndValidate` in a bounded `for` loop: on `ValidationError`, append a single content-free correction note to the original `messages`, re-invoke the adapter via `invoker`, re-validate; max 3 attempts, then throw `ValidationError`. Only `ValidationError` retries (a `TransportError` propagates). Fully written and unit-tested against synthetic malformed-response fixtures (`vi.fn()` doubles). Live exercise of the retry path on a real response is Phase 1C WS_08 (D-1B-02).

- **Goal 3**: A pure function that converts a validated `QuotagateCompleteResult` (text branch only this phase) into a well-formed OpenAI `chat.completion` object.
  - Deliverable: `src/responseBuilder.ts` — `buildChatCompletion(result: QuotagateCompleteResult, model: string): ChatCompletion`. Produces **all** fields the `openai` SDK's `ChatCompletion` requires: deterministic `id` (`"chatcmpl-" + crypto.randomUUID()`), `object: "chat.completion"`, numeric `created` (unix seconds), the echoed `model`, and `choices[0] = { index: 0, message: { role: "assistant", content: <result.content>, refusal: null }, finish_reason: "stop", logprobs: null }`. (An earlier draft of this goal omitted `created` and `logprobs`, which the real `ChatCompletion` type requires — corrected here.) On `{type:"tool_call"}` it throws the base `QuotagateError` (OD-4); the real tool-call branch is added in WS_07. The `openai` package is added as a pinned dependency and `ChatCompletion` is imported as `import type` (OD-2). Named Vitest tests validate the return value against the `openai` package's own `ChatCompletion` type at compile time.

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

### WS_04-D5 — Elevation Open Decisions Resolved (OD-1…OD-7) ✅ LOCKED (User + Architect, 2026-06-10)

The 2026-06-10 elevation pass surfaced seven open decisions; all are resolved and locked. Each is recorded with its choice, rationale, and rejected alternative.

- **OD-1 — `toolChoice` default: PASS-THROUGH.** `buildAdapterRequest` forwards `tool_choice` verbatim (omitted → `toolChoice: undefined`); the adapter's existing `req.toolChoice ?? 'auto'` (claude.ts L90) is the sole default. _Rationale:_ honors WS_04-D1 (no injection at the translation layer); one default, one owner; lets each Phase-2 adapter choose its own default. _Rejected — inject `"auto"` at the builder:_ duplicates the default across two layers and locks all future backends to the OpenAI default.

- **OD-2 — `openai` dependency: ADD (pinned major), `import type` only.** `ChatCompletion` is imported as `import type { ChatCompletion } from "openai/resources/chat/completions"`; tsup tree-shakes the runtime away. _Rationale:_ the `ChatCompletion` shape (notably `usage` optionality, `logprobs`) varies by major, so the compile-time contract (invariant #5) must be pinned. _Rejected — hand-roll a parallel `ChatCompletion` type:_ drifts from the SDK and defeats the compile-time guard.

- **OD-3 — `OpenAIChatRequest` source: HAND-ROLLED Zod schema in `src/types.ts`.** A minimal schema for the Phase-1B fields (`model`, `messages`, `tools?`, `tool_choice?`, `stream?`); its inferred type drives both the builder's input and WS_05's HTTP-body parsing. _Rationale:_ WS_05 must Zod-parse the body anyway; a single source prevents parser/type drift. _Rejected — import the request-params type from `openai`:_ it is a type, not a runtime validator, so WS_05 would still need a separate Zod schema.

- **OD-4 — `tool_call` throw error type: base `QuotagateError`.** `buildChatCompletion` throws `QuotagateError("tool_call branch not yet implemented")`. _Rationale:_ WS_07 replaces the throw with the real implementation, so a bespoke subclass would be short-lived. _Rejected — a dedicated routing-error subclass:_ premature.

- **OD-5 — validator/retry seam: SPLIT.** A pure `parseAndValidate(raw)` (T2) plus a separate `validateWithRetry(raw, messages, invoker)` orchestrator (T3), both in `validator.ts`; the `attempt` counter is internal to a bounded `for` loop, not a public parameter. _Rationale:_ single-responsibility at the exact seam where the Phase-2 MCP transport substitutes in (the `invoker` becomes an MCP-backed callback; neither function changes); the bug-prone schema validation stays purely testable; the correction-note contamination logic stays beside the validation. This also resolves the workstream's contradictory `validate()` signature (it was written two ways). _Rejected — single inline `validate(raw, invoker, attempt)`:_ fuses parse/validate to re-invocation, untestable in isolation, leaks `attempt` into the signature. _Rejected — retry orchestrated in `proxy.ts`:_ overloads the HTTP layer and makes the policy unreusable.

- **OD-6 — markdown-fence stripping: NO.** The validator does not strip fences or normalize output; fenced/prose-wrapped output fails `parseAndValidate` → `ValidationError` → retry. _Rationale:_ stripping would mask a constraint regression (the `--system-prompt` constraint is what keeps output bare JSON — WS_03); a parse failure that triggers a retry is the honest signal. _Rejected — strip fences before parsing:_ papers over a constraint failure and hides it from the retry path.

- **OD-7 — unsupported `{type:"tool_call"}` rejection seam: in `responseBuilder`, not the validator.** `parseAndValidate` returns a schema-valid `tool_call` faithfully; `responseBuilder.buildChatCompletion` is the single loud rejection point (throws `QuotagateError`, WS_04-D4 / OD-4). _Rationale:_ rejecting schema-valid output in the validator is dishonest; two components rejecting one condition risks divergent error types. _Rejected — reject in the validator:_ redundant double-rejection.

---

## Task Breakdown

| Task ID | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Est. Duration | Status        | Task Tracker Link              |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------- | ------------- | ------------------------------ |
| T1      | Author `src/argumentBuilder.ts`: `buildAdapterRequest(body)` — maps `messages`, `tools`, `toolChoice` to `AdapterRequest`. Unit tests: messages passed through unmodified (no constraint text); `tools: undefined` and `tools: []` produce identical `AdapterRequest`; `toolChoice` forwarded verbatim; separation-of-concerns assertion (no system message added).                                                                                                                                          | ~1 hour       | ⬚ Not started | `../../active/TASK_WS04_T1.md` |
| T2      | Author `src/validator.ts` success path: `parseAndValidate()` parses JSON and Zod-validates the `{type:"text"}` branch (a schema-valid `{type:"tool_call"}` is returned faithfully — OD-7). Unit tests: valid text fixture parses; malformed JSON throws `ValidationError`; wrong `type` field throws `ValidationError`; missing `content` throws `ValidationError`.                                                                                                                                                                                                                          | ~1 hour       | ⬚ Not started | `../../active/TASK_WS04_T2.md` |
| T3      | Extend `src/validator.ts` with the `validateWithRetry` orchestrator (OD-5) wrapping T2's pure core. Unit tests using `vi.fn()` doubles: malformed-then-good sequence resolves on attempt 2; three malformed responses throw `ValidationError` after 3 attempts; correction note appended to messages on retry (assert message array length and last message role/content); attempt counter increments.                                                                                                                                                            | ~1 hour       | ⬚ Not started | `../../active/TASK_WS04_T3.md` |
| T4      | Author `src/responseBuilder.ts` (`{type:"text"}` branch only): `buildChatCompletion(result, model)` — `id` `chatcmpl-<uuid>`, `object`, numeric `created`, echoed `model`, `choices[0]` with `finish_reason: "stop"`, `message` shape, and `logprobs: null`. Unit tests: assert `id` matches `/^chatcmpl-/`; `finish_reason === "stop"`; `choices[0].message.role === "assistant"`; `content` non-null and equals `result.content`; output satisfies `openai` package TypeScript type. Explicit `QuotagateError` throw for `{type:"tool_call"}` (OD-4); adds the pinned `openai` dependency (OD-2). Green gate passes. | ~1 hour       | ⬚ Not started | `../../active/TASK_WS04_T4.md` |

_Status: `✅ Completed` | `🔄 In Progress` | `⬚ Not started` | `❌ Blocked`_

_T1 and T2 are independent and can run in parallel. T3 depends on T2 (extends the same file). T4 is independent of T1–T3. Run T1 and T4 in parallel if two sessions are available, then T2 and T3._

---

## Cross-Task Contracts

### `buildAdapterRequest` signature (owned by T1 → consumed by WS_05 T2, WS_06)

Defined in `src/argumentBuilder.ts`. Signature:

```typescript
function buildAdapterRequest(body: OpenAIChatRequest): AdapterRequest;
```

`proxy.ts` calls this to produce the `AdapterRequest` it hands to the adapter. This function must be a pure function of its input — no I/O, no side effects, no module-level state. WS_05 imports it directly; consumers must not modify the returned object.

### `validator.ts` signatures (owned by T2/T3 → consumed by WS_05 T2, WS_06, WS_08) — OD-5 SPLIT

Defined in `src/validator.ts`. Two exports (OD-5 LOCKED — split core + orchestrator):

```typescript
// T2 — pure parse-and-validate core: no I/O, no adapter knowledge.
function parseAndValidate(raw: string): QuotagateCompleteResult;

// T3 — retry orchestrator wrapping parseAndValidate.
function validateWithRetry(
  raw: string,
  messages: OpenAIMessage[],
  invoker: (messages: OpenAIMessage[]) => Promise<AdapterResponse>,
): Promise<QuotagateCompleteResult>;
```

`parseAndValidate` parses JSON, Zod-validates against `QuotagateCompleteResultSchema`, and returns the typed result or throws `ValidationError` — the only two outcomes. `validateWithRetry` is the retry-aware entry point WS_05 calls: on a `ValidationError` it rebuilds `[...messages, correctionNote]` (a single content-free note, WS_04-D3), re-invokes the adapter via `invoker`, and re-runs `parseAndValidate` — for at most 3 attempts (a bounded `for` loop; the `attempt` counter is internal), then throws `ValidationError`. Only `ValidationError` triggers a retry; any other throwable (e.g. `TransportError`) propagates unwrapped. WS_05 wires `(msgs) => adapter.complete(buildAdapterRequest({ ...body, messages: msgs }))` as the invoker. WS_08 replaces the invoker with a test double for the retry-exhaustion test. Consumers must not bypass these to read `AdapterResponse.raw` directly.

### `buildChatCompletion` signature (owned by T4 → consumed by WS_05 T2, WS_06, WS_07)

Defined in `src/responseBuilder.ts`. Signature:

```typescript
function buildChatCompletion(
  result: QuotagateCompleteResult,
  model: string,
): ChatCompletion;
```

`proxy.ts` calls this to produce the response body. WS_07 adds the `{type:"tool_call"}` branch to the same function; it does not change the signature. The return type must satisfy the `openai` package's `ChatCompletion` TypeScript type — this is validated in T4's unit tests. The `openai` package is added as a pinned dependency (OD-2) and `ChatCompletion` is imported as `import type { ChatCompletion } from "openai/resources/chat/completions"`, so tsup tree-shakes the runtime away.

### `QuotagateCompleteResult` / `AdapterRequest` / `AdapterResponse` (inherited from WS_01 T3)

All three translation pipeline modules import these from `src/types.ts`. No redefinition. Changes to these types are breaking cross-workstream contract revisions that require a Decision Log entry.

---

## Success & Evaluation Criteria

- **Functional requirements**:
  - [ ] `buildAdapterRequest({ model:"…", messages:[{role:"user",content:"Hi"}] })` returns `{ messages:[{role:"user",content:"Hi"}], tools: undefined, toolChoice: undefined }` — no additional fields, no constraint text, **no injected `toolChoice` default** (OD-1 — the adapter applies `?? 'auto'`).
  - [ ] `buildAdapterRequest` with `tools: []` and `tools: undefined` produce structurally identical `AdapterRequest` objects (no tool schema injected in either case).
  - [ ] `parseAndValidate('{"type":"text","content":"Hello"}')` returns `{ type:"text", content:"Hello" }`.
  - [ ] `parseAndValidate('{"type":"tool_call","name":"f","arguments":{}}')` returns the parsed `tool_call` faithfully (OD-7 — does not throw; rejection is `responseBuilder`'s job).
  - [ ] `validateWithRetry('not json', messages, invoker)` with a double returning a good response on attempt 2 resolves after one retry.
  - [ ] `validateWithRetry` with three consecutive malformed responses throws `ValidationError` after exactly 3 attempts (`invoker` called exactly twice).
  - [ ] Retry appends a content-free correction note — the `invoker` receives `messages.length + 1` messages, the last has `role: "user"`, and its content does not echo the malformed prior response (WS_04-D3).
  - [ ] A non-`ValidationError` from the `invoker` (e.g. `TransportError`) propagates unwrapped — no retry, no `ValidationError` wrap.
  - [ ] `buildChatCompletion({type:"text", content:"Hi"}, "claude-sonnet-4-6")` returns an object with `id` matching `/^chatcmpl-/`, `object: "chat.completion"`, numeric `created`, `finish_reason: "stop"`, `choices[0].message.content === "Hi"`, and `choices[0].logprobs === null` — assignable to `openai`'s `ChatCompletion` with no cast.
  - [ ] `buildChatCompletion` with `{type:"tool_call", ...}` throws `QuotagateError` (explicit pending stub, OD-4).

- **Named tests that prove this workstream done**:
  - [ ] `tests/argumentBuilder.test.ts` — messages-passthrough test (assert no constraint text; assert no additional system message); `tools: undefined` and `tools: []` equivalence; `toolChoice` forwarding.
  - [ ] `tests/validator.test.ts` — (`parseAndValidate`) valid text success, malformed JSON failure, unknown-discriminant failure, missing `content` failure, schema-valid `tool_call` resolves faithfully, content-free `ValidationError` message; (`validateWithRetry`) malformed-then-good resolves on attempt 2, triple-malformed exhaustion after exactly 3 attempts, content-free correction-note structure, `TransportError` propagates without retry.
  - [ ] `tests/responseBuilder.test.ts` — `chatcmpl-` prefix; `finish_reason: "stop"`; `choices[0].message.role === "assistant"`; `content` equality; TypeScript type assignment to `ChatCompletion`; `tool_call` throws.

- **Quality gates**:
  - [ ] `npm test` green; no test-count regression from the 33-test WS_03 baseline (new WS_04 unit tests added)
  - [ ] `npm run build` (tsup) succeeds with the added pinned `openai` dependency (OD-2)
  - [ ] `npm run typecheck` clean — zero `any`, no implicit `any`
  - [ ] `npm run lint` clean; `npm run format` produces no diff
  - [ ] Coverage: `argumentBuilder.ts` and `responseBuilder.ts` at 100% branch coverage (pure functions); `validator.ts` retry branches fully covered by the unit tests in T3

---

## Known Pitfalls & Implementation Notes

**`buildAdapterRequest` and the `tools: undefined` vs `tools: []` trap**: The OpenAI SDK sends `tools: undefined` when not set and `tools: []` in some client configurations. `buildAdapterRequest` must normalize both to the same `AdapterRequest` shape so that `build_constrained_prompt` (in the adapter) does not differentiate between them. The unit test in T1 explicitly asserts this equivalence.

**`validateWithRetry` — threading the `invoker` callback (OD-5)**: The retry loop re-invokes the adapter with a modified messages array (original messages + a single content-free correction note). Pass the invoker as a function parameter rather than coupling `validator.ts` to the adapter directly. This keeps the pure `parseAndValidate` core untouched and `validateWithRetry` testable — T3 passes a `vi.fn()` double as the invoker, the exact mechanism WS_08's retry-exhaustion test reuses. Do not reach through to the adapter from inside the validator.

**`validateWithRetry` loop form (OD-5 LOCKED)**: The retry up to 3 attempts is a bounded `for` loop with an explicit *internal* `attempt` counter — not recursion, and the counter is not a public parameter. The loop form avoids tail-call confusion in async contexts and keeps the public signature clean.

**`buildChatCompletion` UUID generation**: `crypto.randomUUID()` is available natively in Node 20+ (no import needed). Use `"chatcmpl-" + crypto.randomUUID()` for the `id`. Do not use a third-party UUID library — it is an unnecessary dependency.

**`openai` package TypeScript types**: The `ChatCompletion` type from the `openai` npm package is the contract for `buildChatCompletion`'s return type. Import it as `import type { ChatCompletion } from "openai/resources/chat/completions"`. The TypeScript structural check at compile time is the validator — do not hand-roll a parallel type definition.

**Correction note wording**: The correction note appended on retry must not contain the malformed response text (WS_04-D3). A safe template: `"The previous response was not valid JSON or did not match the required schema. Please respond with a single raw JSON object in one of these forms: {\"type\":\"text\",\"content\":\"<string>\"} or {\"type\":\"tool_call\",\"name\":\"<string>\",\"arguments\":{...}}"`. Keep this wording stable — changing it after WS_08's contamination test is written may invalidate the test's correction-note structure assertion.

**Test isolation for `validate`**: Each test case in `tests/validator.test.ts` must create a fresh `vi.fn()` invoker. Do not reuse a mock across test cases — stale call counts from a prior test will break the attempt-counter assertion.
