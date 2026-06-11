# TASK_WS05_T3: Full Request Pipeline Wiring (`src/proxy.ts`)

## Context

- **Workstream**: WS_05 (Fastify Proxy & Config)
- **Plan reference**: `docs/plan/workstreams/ws05_fastify_proxy_and_config.md`
- **Phase plan**: `docs/plan/phases/01b_openai_translation_pipeline.md`
- **Depends on**: WS_05-T2 (proxy skeleton with factory, error handler, and guards); WS_04
  **signed off** — `buildAdapterRequest` (`src/argumentBuilder.ts`), `validateWithRetry`
  (`src/validator.ts`), and `buildChatCompletion` (`src/responseBuilder.ts`) must be finalized
  before this task begins. Do not stub these functions in T3; wire the real implementations.
- **Blocks**: WS_05-T4 (needs the fully-wired `createServer`); WS_06 (integration test depends on
  the full pipeline being present).

---

## Goal & Why

- **Goal**: Replace T2's stub pipeline body in the `POST /v1/chat/completions` route handler with
  the real request pipeline:

  ```
  inline alias resolution
    → buildAdapterRequest(parsed.data)
    → adapter.complete(adapterReq)        ← produces AdapterResponse
    → validateWithRetry(                  ← retry orchestrator (OD-5)
        response.raw,
        parsed.data.messages,
        invoker                           ← Phase 2 transport seam
      )
    → buildChatCompletion(result, parsed.data.model)
    → reply.send(completion)
  ```

  where the `invoker` closure is:
  ```typescript
  const invoker = (msgs: OpenAIMessage[]) =>
    adapter.complete(buildAdapterRequest({ ...parsed.data, messages: msgs }));
  ```

- **Why**: This task closes the final gap between the HTTP boundary (T2) and the translation
  pipeline (WS_04). The invoker closure is the Phase 2 transport seam — it is why `validateWithRetry`
  takes a callback instead of calling the adapter directly. When the MCP adapter arrives in Phase 2,
  the `CLIAdapter.complete()` interface is the same, and this closure does not change. Wiring it
  correctly now means Phase 2's MCP upgrade is a drop-in adapter swap, not a proxy rewrite.

  Equally important: T3 tests the retry path under the HTTP layer — specifically that when the
  adapter returns malformed JSON on attempt 1 and well-formed JSON on attempt 2, `proxy.ts`
  returns HTTP 200 (not 500) because `validateWithRetry` resolved. This is a behavioral invariant
  that cannot be confirmed by testing `validator.ts` in isolation; it requires the full
  pipeline-under-HTTP path.

---

## Assumptions to Test

| #  | Assumption                                                                                                        | Why we believe it                                                                                     | How this task tests it                                                                                   | If false →                                                                                       |
|----|-------------------------------------------------------------------------------------------------------------------|-------------------------------------------------------------------------------------------------------|----------------------------------------------------------------------------------------------------------|--------------------------------------------------------------------------------------------------|
| A1 | `buildAdapterRequest(parsed.data)` produces an `AdapterRequest` compatible with `adapter.complete()`             | Confirmed in WS_04 T1 unit tests; both types come from `src/types.ts`                                 | T-1: stub adapter receives the `AdapterRequest`; assert `adapter.complete` was called with correct shape  | Diagnose type mismatch between `OpenAIChatRequest` and `AdapterRequest`                          |
| A2 | `validateWithRetry` called with `(response.raw, parsed.data.messages, invoker)` resolves on a well-formed response | Confirmed in WS_04 T3 unit tests                                                                     | T-1: stub adapter returns `{ raw: '{"type":"text","content":"Hello"}', backend: "claude-subprocess" }`;  assert HTTP 200 | Diagnose invoker closure construction |
| A3 | On a retry, the invoker is called with `[...original_messages, CORRECTION_NOTE]`, not the original messages alone | WS_04 OD-5 — `validateWithRetry` appends `CORRECTION_NOTE` internally and calls invoker with corrected msgs | T-3: first adapter call returns malformed raw; second call returns valid; assert second call received `messages.length + 1` messages | Re-examine the invoker argument threading in `validateWithRetry` |
| A4 | `buildChatCompletion(result, parsed.data.model)` returns a shape that Fastify can serialize with `reply.send()`  | Fastify serializes any JS object with `reply.send()`; `ChatCompletion` is a plain object               | T-1: assert `response.body` parses as JSON; `JSON.parse(response.body).choices[0].finish_reason === "stop"` | Check `reply.send()` content-type headers; may need `reply.type("application/json")` |
| A5 | A `TransportError` from `adapter.complete()` propagates through `validateWithRetry` unwrapped (WS_04 OD-5)       | `validateWithRetry` only retries on `ValidationError`; other errors propagate — unit-tested in WS_04   | T-2: stub adapter throws `new TransportError("spawn failed")`; assert HTTP 500, OpenAI-format error body  | Diagnose the propagation path; the `validateWithRetry` code is clear on this point              |

---

## Expected Failures

- **[EF1] Malformed adapter response on first attempt, well-formed on second** — handled by
  `validateWithRetry`'s retry loop. Route handler never sees `ValidationError` if retry succeeds.
  The proxy returns HTTP 200.
- **[EF2] All 3 attempts malformed** — `validateWithRetry` throws `ValidationError` after attempt 3.
  `setErrorHandler` maps it to HTTP 500. The route handler does not need to catch this; it
  propagates automatically through Fastify's error pipeline.
- **[EF3] `TransportError` from `adapter.complete()`** — propagates unwrapped through
  `validateWithRetry` (WS_04 OD-5). `setErrorHandler` maps it to HTTP 500.
- **[EF4] `buildChatCompletion` called with `{type:"tool_call"}` result** — throws `QuotagateError`
  (WS_04 OD-4). `setErrorHandler` maps to HTTP 500. This is a known stub behavior for Phase 1
  (the tool-call branch is WS_07); the test must verify the 500 response shape is correct.
- **[EF5] Invoker closure captures stale `parsed.data`** — if the route handler uses `body` from
  an outer closure after re-parsing, the `messages` field could diverge. The invoker must capture
  `parsed.data` (the Zod-validated result), not a re-parsed body.

---

## Test Strategy

- **Unit**: All tests in `tests/proxy.test.ts` (extending the file created in T2). Use Fastify's
  `server.inject(...)`. The `adapter` argument to `createServer` is a `vi.fn()` double that returns
  controlled `AdapterResponse` values (via `vi.fn().mockResolvedValueOnce(...)`).
- **Integration**: None in T3. WS_06 is the live integration test.
- **Contract**: Two critical contract assertions:
  1. The response body is assignable to the OpenAI `ChatCompletion` shape (TypeScript compile-time
     — import `ChatCompletion` from `openai/resources/chat/completions` in the test file and assign
     the parsed response body; `tsc` validates the shape at compile time).
  2. The invoker closure threads messages correctly on retry: assert `adapter.complete` mock was
     called with `messages.length + 1` messages on the second invocation.
- **Contamination/isolation**: Not in scope for T3. The retry-path contamination proof is WS_08.

---

## Contract: What This Task Inherits

| Symbol / Artifact             | Source                     | Role in This Task                                                                                                              |
|-------------------------------|----------------------------|--------------------------------------------------------------------------------------------------------------------------------|
| `buildAdapterRequest`         | `src/argumentBuilder.ts`   | Converts the Zod-parsed `OpenAIChatRequest` to `AdapterRequest`; called first in the pipeline                                  |
| `validateWithRetry`           | `src/validator.ts`         | Retry orchestrator; called with `(response.raw, parsed.data.messages, invoker)`; must NOT be replaced with `parseAndValidate` |
| `buildChatCompletion`         | `src/responseBuilder.ts`   | Converts `QuotagateCompleteResult` + model string to `ChatCompletion`; throws on `{type:"tool_call"}`                          |
| `OpenAIMessage`               | `src/types.ts`             | Type for the `invoker` callback parameter                                                                                      |
| `AdapterResponse`             | `src/types.ts`             | Return type of `adapter.complete()`; `.raw` is passed to `validateWithRetry`                                                   |
| `setErrorHandler` (T2)        | `src/proxy.ts`             | All errors thrown in the pipeline propagate here automatically; T3 must NOT catch and re-throw                                  |
| WS_04 OD-5 (validator split)  | WS_04 plan                 | `validateWithRetry` is the correct entry point; `parseAndValidate` is for isolated testing only                                 |

---

## Subtask Progress Table

| #  | Subtask                                                                                                                   | Status        | Iteration | Notes |
|----|---------------------------------------------------------------------------------------------------------------------------|---------------|-----------|-------|
| 1  | Import `buildAdapterRequest`, `validateWithRetry`, `buildChatCompletion`, `OpenAIMessage` in `src/proxy.ts`               | ⬚ Not started | —         |       |
| 2  | Replace the T2 stub pipeline body with the real pipeline call sequence                                                    | ⬚ Not started | —         |       |
| 3  | Construct and pass the `invoker` closure: `(msgs) => adapter.complete(buildAdapterRequest({ ...parsed.data, messages: msgs }))` | ⬚ Not started | — | |
| 4  | Write pipeline-wired test cases in `tests/proxy.test.ts`: success path (T-1), TransportError path (T-2), retry path (T-3), tool_call throw path (T-4) | ⬚ Not started | — | |
| 5  | Green gate: `npm test` · `typecheck` · `lint` · `format`                                                                  | ⬚ Not started | —         |       |

_Status icons: `✅ Done` | `🔄 In progress` | `⬚ Not started` | `❌ Blocked`_

---

## Current Subtask Detail

### Subtask 3: Invoker closure construction

**Approach iteration plan**:

1. Write the closure naively: `(msgs) => adapter.complete(buildAdapterRequest({ ...parsed.data, messages: msgs }))`.
2. Verify TypeScript types: `msgs` is `OpenAIMessage[]`; the spread `{ ...parsed.data, messages: msgs }`
   must satisfy `OpenAIChatRequest` — which it does, because `parsed.data` already has all required
   fields and `messages` overrides the array.
3. Verify the closure does not close over a mutable variable — `parsed.data` is stable within the
   route handler's scope.

- **Current iteration**: not started (blocked on T2 and WS_04 sign-off)
- **Verifiability**: T-3 asserts the invoker is called with the corrected messages array.
- **Challenges**: Ensuring `parsed.data.messages` (original) vs `msgs` (corrected) are not confused;
  the closure captures `parsed.data` as a whole, and `messages` is overridden in the spread — this
  is the correct semantics.

---

## Decisions Made

### [D1] — `validateWithRetry` is wired, not `parseAndValidate` ✅ LOCKED (Architect, 2026-06-11)

**Decision**: `proxy.ts` calls `validateWithRetry(response.raw, parsed.data.messages, invoker)`.
It does NOT call `parseAndValidate` directly in the route handler.

**Rationale**: `parseAndValidate` is the pure core — it is for isolated unit testing. `validateWithRetry`
is the production entry point that includes the retry loop and the Phase 2 transport seam (the
`invoker` callback). A proxy that calls `parseAndValidate` directly would silently discard the
retry behavior on the first malformed response — a correctness regression visible only in
production under adverse model behavior. The `invoker` closure is also the seam the Phase 2 MCP
adapter substitutes into; wiring `validateWithRetry` is what makes the Phase 2 upgrade a
drop-in swap rather than a proxy rewrite.

**Rejected alternative — call `parseAndValidate` directly and add a manual retry loop in `proxy.ts`**:
Duplicates the retry loop logic; the correction-note wording would need to be maintained in two
places; the `invoker` seam would not be established. The WS_04 OD-5 decision specifically exists
to prevent this.

### [D2] — Anti-overengineering scope fence ✅ LOCKED

**This task explicitly does NOT include**:

- The `{type:"tool_call"}` response path in `buildChatCompletion` — WS_07. The current
  `buildChatCompletion` throws `QuotagateError` on that branch (WS_04-D4); T3 must test that
  this throws and maps to HTTP 500, but must not implement the branch.
- Retry-path contamination proof — WS_08. T3 verifies the invoker closure threads messages
  correctly, but does not run the sequential/concurrent/retry-path isolation tests.
- Streaming (`stream: true`) — already guarded in T2 before the pipeline runs.

---

## Cross-Task Contracts (Downstream Dependencies on This Task)

### `TASK_WS05_T4` will depend on:

- `createServer(config, adapter)` fully wired — `index.ts` calls this and then calls `server.listen()`.
  T4 does not re-test the pipeline; it tests the startup sequence and health-check gate.

### `WS_06` will depend on:

- The full pipeline being present in `proxy.ts`: `buildAdapterRequest` → `adapter.complete()` →
  `validateWithRetry` → `buildChatCompletion` → `reply.send()`. WS_06 replaces the stub adapter
  with the real `ClaudeAdapter` and asserts the end-to-end output.
- The invoker closure being correct: WS_06's integration assertion (HTTP 200 with valid completion)
  depends on the invoker being wired to the real adapter on the real message array.

---

## Files Modified / Created

- `src/proxy.ts` — **modify** (replace stub pipeline body with real pipeline; add imports for
  `buildAdapterRequest`, `validateWithRetry`, `buildChatCompletion`, `OpenAIMessage`)
- `tests/proxy.test.ts` — **modify** (add T-1 through T-4 pipeline-wired test cases)

---

## Success Criteria / Verifiability

| #    | Criterion                                                                                                                  | How to verify                                                      |
|------|----------------------------------------------------------------------------------------------------------------------------|--------------------------------------------------------------------|
| SC-1 | Success path: stub adapter returns valid `AdapterResponse` → HTTP 200, `finish_reason: "stop"`, `chatcmpl-` id           | T-1 passes                                                         |
| SC-2 | `TransportError` from adapter → HTTP 500, OpenAI-format error body, no stack trace                                        | T-2 passes                                                         |
| SC-3 | Retry path: adapter returns malformed on attempt 1, valid on attempt 2 → HTTP 200 (retry resolved)                        | T-3 passes; `adapter.complete` mock called twice                   |
| SC-4 | `invoker` on retry receives `original.messages.length + 1` messages (CORRECTION_NOTE appended)                            | T-3 asserts `adapter.complete.mock.calls[1][0].messages.length === original + 1` |
| SC-5 | `{type:"tool_call"}` result from adapter → HTTP 500 (base `QuotagateError` from `buildChatCompletion`)                   | T-4 passes                                                         |
| SC-6 | `validateWithRetry` is called in the pipeline (not `parseAndValidate`)                                                    | Code review of `proxy.ts` imports; T-3 would not pass if `parseAndValidate` is used |
| SC-7 | HTTP 200 response body is assignable to `ChatCompletion` TypeScript type (compile-time)                                   | `npm run typecheck` clean; no cast needed in the test              |
| SC-8 | `npm test` green; test count does not decrease from WS_04 baseline (56 tests)                                             | `npm test` output                                                  |
| SC-9 | `npm run typecheck` clean; `npm run lint` clean; `npm run format` no diff                                                  | Each command exits 0                                               |

---

## Required Test Cases

File: `tests/proxy.test.ts` (extending T2's file)

### T-1: success path — stub adapter returns valid response → HTTP 200 with valid completion shape (covers SC-1, SC-7)

Wire stub adapter: `vi.fn().mockResolvedValueOnce({ raw: '{"type":"text","content":"Hello, world!"}', backend: "claude-subprocess" })`.
Inject `POST /v1/chat/completions` with `{ model: "claude-sonnet-4-6", messages: [{ role: "user", content: "Hi" }] }`.
Assert: status 200; parsed body `choices[0].finish_reason === "stop"`; `choices[0].message.role === "assistant"`;
`choices[0].message.content === "Hello, world!"`; `id` matches `/^chatcmpl-/`; TypeScript assigns
the parsed body to `ChatCompletion` without cast.

### T-2: `TransportError` from adapter → HTTP 500 OpenAI-format error body (covers SC-2)

Wire stub adapter: `vi.fn().mockRejectedValueOnce(new TransportError("spawn failed"))`.
Inject a valid request. Assert: status 500; `error.message` is a non-empty string; no `stack` field
in the response body.

### T-3: retry path — malformed then valid → HTTP 200; invoker receives corrected messages (covers SC-3, SC-4)

Wire stub adapter: first call returns `{ raw: "not json", backend: "claude-subprocess" }`;
second call returns `{ raw: '{"type":"text","content":"Retry worked"}', backend: "claude-subprocess" }`.
Inject a valid request with `messages: [{ role: "user", content: "Test" }]`.
Assert: status 200; `adapter.complete` was called exactly twice; second call received an
`AdapterRequest` whose `messages` array has length 2 (original 1 message + CORRECTION_NOTE).

### T-4: `{type:"tool_call"}` from adapter → HTTP 500 (covers SC-5)

Wire stub adapter: `vi.fn().mockResolvedValueOnce({ raw: '{"type":"tool_call","name":"fn","arguments":{}}', backend: "claude-subprocess" })`.
Inject a valid request. Assert: status 500 (because `buildChatCompletion` throws `QuotagateError`
on `tool_call` in Phase 1 — WS_04 OD-4).

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
