# TASK_WS05_T2: Proxy Skeleton — Fastify Factory, Error Handler, Guards (`src/proxy.ts`)

## Context

- **Workstream**: WS_05 (Fastify Proxy & Config)
- **Plan reference**: `docs/plan/workstreams/ws05_fastify_proxy_and_config.md`
- **Phase plan**: `docs/plan/phases/01b_openai_translation_pipeline.md`
- **Depends on**: WS_05-T1 (`QuotagateConfig` type must exist before `createServer(config, adapter)`
  can be typed); WS_01 T3 (`CLIAdapter` interface, `OpenAIChatRequestSchema`, `QuotagateError`
  subclasses all already implemented).
- **Blocks**: WS_05-T3 (wires the full pipeline into the skeleton T2 creates); WS_05-T4 (imports
  `createServer`); WS_06 (relies on the error handler shape).

---

## Goal & Why

- **Goal**: Implement the structural skeleton of `src/proxy.ts` — the Fastify factory function
  (`createServer`), the exhaustive `setErrorHandler` mapping, the `POST /v1/chat/completions` route
  with Zod body parsing using `OpenAIChatRequestSchema`, and the two guard checks (`stream: true` →
  400, unknown model alias → 400). The pipeline call itself (T3) is not wired in this task; the
  route handler returns a stub 200 or throws a stub error after the guards pass.

- **Why**: The skeleton is the correct first atomic unit because the error handler, body parsing
  contract, and guard semantics are independent of — and must be verified before — the pipeline
  wiring. If T2 and T3 were merged into one task, a bug in the error handler shape would be
  entangled with a bug in the invoker closure, making root cause analysis harder. The pattern also
  enforces the architectural invariant that route handlers throw typed errors and never set status
  codes directly — a constraint that is easier to establish in a skeleton with no production logic
  than to retrofit after the pipeline is already wired. This skeleton is the contract WS_06's
  integration test asserts against: the same error body shape, the same 400 guard semantics.

---

## Assumptions to Test

| #  | Assumption                                                                                        | Why we believe it                                                                             | How this task tests it                                                                          | If false →                                                                              |
|----|---------------------------------------------------------------------------------------------------|-----------------------------------------------------------------------------------------------|--------------------------------------------------------------------------------------------------|-----------------------------------------------------------------------------------------|
| A1 | Fastify v5 `setErrorHandler` handler must call `reply.status(code).send(body)` explicitly; returning a value is insufficient | Confirmed from Fastify 5.8.5 test suite and source | T-4/T-5: `setErrorHandler` sends the error body; test asserts the response body is the OpenAI-format error, not an empty 200 or undefined | Re-examine v5 docs; adjust to the correct send pattern |
| A2 | `OpenAIChatRequestSchema.safeParse(request.body)` works correctly in a Fastify v5 route handler — `request.body` is a parsed JS object, not a raw string | Fastify parses JSON bodies by default (Content-Type: application/json) | T-1: inject a valid payload, assert `parsed.success === true`; T-3: inject a malformed payload, assert `parsed.success === false` → 400 | Investigate Fastify's content-type parser configuration |
| A3 | `Fastify({ logger: false })` in test fixtures suppresses log output without affecting behavior    | Standard Fastify pattern                                                                       | Test suite runs cleanly without log noise                                                        | Use `pino.transport()` with a null destination                                           |
| A4 | The `stream: true` guard and unknown-alias guard can send 400 responses directly (via `reply.status(400).send(...)`) without going through `setErrorHandler`, and this is consistent with the error body contract | The route handler can send early responses before the pipeline runs | T-2/T-3: assert the 400 body shape matches the OpenAI error schema regardless of which code path sends it | Route the 400 guards through a small typed error + `setErrorHandler` instead |

---

## Expected Failures

- **[EF1] `stream: true` in the request body** — guard returns HTTP 400 before the pipeline runs.
  Handled by: `if (parsed.data.stream === true) { reply.status(400).send({error:{...}}); return; }`.
  The route handler exits immediately; T3's pipeline never runs.
- **[EF2] Unknown model alias** — lookup against `config.models` returns `undefined` or
  `backend !== "claude"`. Handled by: same early-return 400 pattern.
- **[EF3] Malformed JSON body** — `request.body` is not a JS object because the client sent
  non-JSON. Fastify v5 returns HTTP 400 with its own error body by default when the JSON parser
  fails before the route handler runs. This is acceptable in Phase 1; the error body is not
  OpenAI-shaped. Document this in the test (T-3b: malformed JSON at the transport level → Fastify
  400, shape not guaranteed). This is a known limitation, not a bug; fixing it would require
  overriding Fastify's content-type parser.
- **[EF4] `ValidationError` thrown from downstream (pipeline — T3)** — handled by `setErrorHandler`
  → HTTP 500. This task stubs the pipeline so we can test the error handler directly; T3 tests it
  with the real pipeline.
- **[EF5] `TransportError` thrown from downstream** — same path as EF4.
- **[EF6] Unexpected `Error` (not a `QuotagateError`)** — `setErrorHandler` catches it; must send
  HTTP 500 with a generic OpenAI-format error body and no stack trace.

---

## Test Strategy

- **Unit**: All tests in `tests/proxy.test.ts` using Fastify's `server.inject(...)` API. No network
  sockets. Create a `createServer(config, adapter)` instance with `{ logger: false }` and a stub
  `CLIAdapter` (`vi.fn()`) in each test. Call `server.close()` in `afterEach` to prevent instance
  leaks.
- **Integration**: None in T2. T3 adds the integration cases; WS_06 does the full end-to-end.
- **Contract**: Assert the error body shape `{ error: { message, type, code } }` for every error
  path. This is the contract WS_06 depends on.
- **Pipeline stub in T2**: Since the pipeline is not yet wired, the route handler after the guards
  should throw a `new QuotagateError("pipeline not yet wired")` or call
  `reply.status(200).send({ stub: true })` to allow the T2 guard tests to pass without T3's logic
  being present. Document this stub explicitly so T3 knows to replace it.

---

## Implementation-Time Decision (BSE resolves in code — not user-blocking)

This is a code-structure choice the implementer makes and documents with a comment per WS_05-D2; it
is **not** one of the resolved user decisions (WS_05-D5…D8) and does not block starting the task.
Recommendation below is direct-send.

- **[T2-OD-1] Guard response path — direct send vs. typed error + `setErrorHandler`**:
  Should the `stream: true` guard and unknown-alias guard send their 400 responses directly
  (`reply.status(400).send(...)` inside the route handler) or throw a small typed error that
  `setErrorHandler` catches?

  **Direct send**: simpler code; the guard logic is immediately readable; no intermediate error
  type needed. Risk: if the error body shape ever needs to change, it is in two places (inline
  guard + error handler).

  **Typed error + handler**: all error responses flow through one code path; the error body shape
  is defined in one place; adding a new guard type is one new `instanceof` branch in the handler.
  Slight complexity cost: need a `RequestError` subclass or a `ValidationError` with a 400 code
  carrier, which the current `src/errors.ts` does not have.

  **Recommendation:** Direct send for Phase 1. The 400 guards are pre-pipeline checks — they fire
  before any `QuotagateError` can be thrown, and they are not part of the `QuotagateError`
  hierarchy. Keeping them as direct `reply.send()` calls is the honest model: they are request
  validation rejections, not adapter/transport failures. Consistency note: the OpenAI error body
  shape must still be used for the 400 bodies, even though they are sent directly.

  This decision must be documented in the T2 implementation (a comment in the route handler
  explaining the pattern choice) so future maintainers understand why the 400 guards do not go
  through `setErrorHandler`.

---

## Contract: What This Task Inherits

| Symbol / Artifact           | Source                  | Role in This Task                                                                                     |
|-----------------------------|-------------------------|-------------------------------------------------------------------------------------------------------|
| `QuotagateConfig`           | `src/config.ts` (T1)    | First parameter of `createServer`; `config.models` used for inline alias resolution                   |
| `CLIAdapter`                | `src/adapters/base.ts`  | Second parameter of `createServer`; injected adapter (stub in T2 tests, real in T4/WS_06)             |
| `OpenAIChatRequestSchema`   | `src/types.ts`          | Used directly in the route handler for `request.body` parsing; must NOT be re-defined here            |
| `QuotagateError`, `ValidationError`, `TransportError` | `src/errors.ts` | `setErrorHandler` maps these to HTTP codes; all three must be imported and handled |
| WS_05-D2 (stream guard)     | WS_05 plan              | Exact error body shape for `stream: true` rejection                                                   |
| WS_05-D3 (alias resolution) | WS_05 plan              | Inline `config.models` lookup; `backend === "claude"` is the pass condition in Phase 1                |
| WS_05-D4 (error mapping)    | WS_05 plan              | Exhaustive `setErrorHandler` mapping; `reply.status(code).send(body)` is the correct v5 pattern       |

---

## Subtask Progress Table

| #  | Subtask                                                                                                   | Status        | Iteration | Notes |
|----|-----------------------------------------------------------------------------------------------------------|---------------|-----------|-------|
| 1  | Scaffold `src/proxy.ts`: `import Fastify`, define `createServer(config, adapter)` factory returning `FastifyInstance` | ✅ Done | 1 | |
| 2  | Register `setErrorHandler` with exhaustive `QuotagateError` → HTTP mapping (V, T, Q, catch-all)          | ✅ Done | 1 | Fastify-internal pre-check added (Advisory A1) |
| 3  | Register `POST /v1/chat/completions` route: parse body with `OpenAIChatRequestSchema.safeParse`; `stream` guard; alias guard; stub body | ✅ Done | 1 | stub calls `adapter.complete` to allow per-test error injection |
| 4  | Write `tests/proxy.test.ts` — T2 guard/error-handler cases (see Required Test Cases below)               | ✅ Done | 2 | T-3c, T-4b added; T-4/T-5 rewritten to hit correct branches (Advisories A2/A3) |
| 5  | Green gate: `npm test` · `typecheck` · `lint` · `format`                                                  | ✅ Done | 1 | 70 tests passing |

_Status icons: `✅ Done` | `🔄 In progress` | `⬚ Not started` | `❌ Blocked`_

---

## Current Subtask Detail

### Subtask 2: `setErrorHandler` registration

**Approach iteration plan**:

1. Register a catch-all handler that maps any error to HTTP 500 with a generic OpenAI-format body.
2. Add `instanceof ValidationError` → 500 with `"validation_error"` type/code.
3. Add `instanceof TransportError` → 500 with `"transport_error"` type/code.
4. Add `instanceof QuotagateError` (base, not a subclass caught above) → 500 with `"proxy_error"`.
5. Verify `reply.status(500).send(...)` is called explicitly (not returned) in every branch.

- **Current iteration**: 1 of 5
- **Verifiability**: T-4 (ValidationError → 500) and T-5 (unhandled Error → 500, no stack trace) pass.
- **Challenges**: TypeScript type narrowing — `TError = unknown` requires `instanceof` checks before
  accessing `error.message`.

---

## Decisions Made

### [D1] — `createServer` returns `FastifyInstance` with no port binding ✅ LOCKED (Architect, 2026-06-11)

**Decision**: `createServer` creates and configures the Fastify instance (routes, error handler)
but does NOT call `listen()`. The caller (`index.ts`) calls `server.listen({ port: 8080, host:
"127.0.0.1" })`. This lets tests inject requests without binding a real port.

**Rationale**: Fastify's `inject()` method works on an unbound instance; binding a port in tests
causes conflicts when multiple test files run in parallel (Vitest runs suites concurrently by
default). The factory-only pattern is the standard Fastify testing approach.

**Rejected alternative — `createServer` calls `listen` internally**: Tests would require unique
ports per suite, or a `beforeEach`/`afterEach` bind/close cycle that is fragile under parallel
test execution. The separation of "configure" from "start" is cleaner.

### [D2] — Anti-overengineering scope fence ✅ LOCKED

**This task explicitly does NOT include**:

- The full request pipeline (`buildAdapterRequest` → `adapter.complete()` → `validateWithRetry` →
  `buildChatCompletion`) — that is T3.
- The `listen()` call — that is T4.
- HTTP 429 rate-limiting — out of scope for Phase 1.
- Request-id / correlation headers — not in the Phase 1 spec; Phase 4 DX work.
- The `GET /health` endpoint — explicitly out of scope in the Phase 1B plan.

---

## Cross-Task Contracts (Downstream Dependencies on This Task)

### `TASK_WS05_T3` will depend on:

- `createServer` factory export — T3 extends the route handler with the real pipeline. T3 must not
  re-scaffold the factory; it imports and modifies the existing route handler body.
- `setErrorHandler` registered in T2 — T3's pipeline errors flow through it automatically. T3 must
  throw typed `QuotagateError` subclasses; it must NOT manually call `reply.status(500)`.
- Stub pipeline body — T3 replaces the stub with the real pipeline call.

### `TASK_WS05_T4` will depend on:

- `createServer` export — `index.ts` imports and calls it; then calls `server.listen(...)`.

### `WS_06` will depend on:

- The error body shape `{ error: { message, type, code } }` — the integration test asserts this
  shape on error paths. If the shape changes after T2, WS_06 must be updated.

---

## Files Modified / Created

- `src/proxy.ts` — **create new** (factory, error handler, route skeleton with guards)
- `tests/proxy.test.ts` — **create new** (T2 guard and error-handler test cases; T3 extends this file)

---

## Success Criteria / Verifiability

| #    | Criterion                                                                                           | How to verify                                              |
|------|-----------------------------------------------------------------------------------------------------|------------------------------------------------------------|
| SC-1 | `createServer(config, adapter)` returns a `FastifyInstance` without throwing                        | T-0 (smoke test for factory creation) passes               |
| SC-2 | `POST /v1/chat/completions` with `stream: true` → HTTP 400, `error.code === "streaming_not_supported"` | T-2 passes                                             |
| SC-3 | `POST /v1/chat/completions` with unknown model alias → HTTP 400, `error.code === "model_not_supported"` | T-3 passes                                           |
| SC-4 | `POST /v1/chat/completions` with missing `messages` field → HTTP 400                               | T-3b passes                                               |
| SC-5 | Route handler throwing `new ValidationError("...")` → HTTP 500, OpenAI-format error body, no stack trace | T-4 passes                                         |
| SC-6 | Route handler throwing `new Error("unexpected")` → HTTP 500, generic message, no stack trace        | T-5 passes                                                |
| SC-7 | `npm test` green; test count does not decrease from 56-test WS_04 baseline                          | `npm test` output                                         |
| SC-8 | `npm run typecheck` clean; `npm run lint` clean; `npm run format` no diff                           | Each command exits 0                                       |

---

## Required Test Cases

File: `tests/proxy.test.ts`

### T-0: `createServer` factory creates a Fastify instance (covers SC-1)

Call `createServer(minimalConfig, stubAdapter)` where `minimalConfig` is a valid `QuotagateConfig`
literal and `stubAdapter` is a `vi.fn()` double. Assert: the return value is truthy; calling
`server.inject(...)` does not throw (proof the instance is usable).

### T-1: valid request body is accepted by the Zod parse (covers A2)

Inject `POST /v1/chat/completions` with `{ model: "claude-sonnet-4-6", messages: [{ role: "user",
content: "Hello" }] }`. Assert: status is NOT 400 (the stub pipeline body runs — may be 200 or
500 depending on stub, but not a parse-rejection 400).

### T-2: `stream: true` guard returns HTTP 400 (covers SC-2)

Inject with `{ model: "claude-sonnet-4-6", messages: [...], stream: true }`. Assert: status 400;
body has `error.type === "invalid_request_error"`; `error.code === "streaming_not_supported"`.

### T-3: unknown model alias returns HTTP 400 (covers SC-3)

Inject with `{ model: "unknown-model-xyz", messages: [...] }` using a `config` with only
`claude-sonnet-4-6` in `models`. Assert: status 400; `error.code === "model_not_supported"`.

### T-3b: malformed body (missing `messages`) returns HTTP 400 (covers SC-4)

Inject with `{ model: "claude-sonnet-4-6" }` (no `messages`). Assert: status 400.

### T-4: `ValidationError` thrown in route → HTTP 500 OpenAI-format body (covers SC-5)

Wire the stub pipeline body to `throw new ValidationError("test error")`. Inject a valid request.
Assert: status 500; body has `error.message` (non-empty string); no `stack` field in the response
body; `error.type` is a string (not undefined).

### T-5: unexpected `Error` thrown in route → HTTP 500, no stack trace (covers SC-6)

Wire the stub pipeline body to `throw new Error("unexpected internal error")`. Inject a valid
request. Assert: status 500; `response.json().error.message` does not contain "unexpected internal
error" (i.e., the internal error message is NOT leaked); no `stack` field in the response body.

---

## Review Notes

**Verdict**: APPROVED WITH ADVISORIES (Principal Architect, 2026-06-11)

**Advisories applied by BSE before T3:**

- **A1 — setErrorHandler Fastify-internal pre-check**: Added a `statusCode < 500` pre-check as the first branch in `setErrorHandler` to re-map Fastify JSON-parse failures from HTTP 500 → 400 with OpenAI-shaped body. EF3 in this tracker incorrectly stated Fastify would emit a 400 by itself — it does not; the error reaches `setErrorHandler` as a `FastifyError` with a numeric `statusCode`.
- **A2 — T-4/T-5 branch coverage**: Rewrote T-4 to throw `ValidationError` (asserts `code: "validation_error"`), added T-4b for `TransportError`, and rewrote T-5 to throw a raw `Error` and assert the internal message is NOT leaked (`error.message === "An internal error occurred"`). All three previously-untested `setErrorHandler` branches are now exercised.
- **A3 — T-3c alias guard second branch**: Added T-3c to cover the `entry.backend !== 'claude'` branch (model present in config but wrong backend).
- **SC-6 deferral note**: The catch-all raw-`Error` non-leaking behavior is now fully tested in T-5 (not deferred to T3/WS_06 as originally noted in the implementation).

---

## Architect Sign-off

- [x] Implementation reviewed
- [x] All success criteria verified
- [x] All assumptions resolved (proven, or fallback taken & documented)
- [x] No regressions in full test suite
- [x] `npm test` / `typecheck` / `lint` / `format` all clean
