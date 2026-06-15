# TASK_WS06_T3: Error-Path E2E — `stream: true` and Unknown Model Via the HTTP Boundary

## Context

- **Workstream**: WS_06 (No-Tools End-to-End Integration Test)
- **Plan reference**: `docs/plan/workstreams/ws06_e2e_no_tools.md`
- **Phase plan**: `docs/plan/phases/01b_openai_translation_pipeline.md`
- **Depends on**: TASK_WS06_T1 (fixture and server lifecycle). T2 and T3 are independent once T1 is working — T3 does not depend on T2 passing.
- **Blocks**: TASK_WS06_T4

---

## Goal & Why

- **Goal**: Create `tests/integration/e2e.errorPaths.test.ts` with two error-path integration tests: (a) a `stream: true` request receives HTTP 400 with `"Streaming is not supported"` in the error body; (b) an unknown model alias receives HTTP 400 with a body identifying the error as a model-not-supported response. Both tests are exercised through the real HTTP boundary using raw `fetch` (not the `openai` SDK client) to avoid TypeScript overload complications on the streaming path.
- **Why**: The proxy's error guards (`stream: true` → 400, unknown model → 400) were unit-tested in `proxy.test.ts` via Fastify `inject()`. That proves the guards fire. This task proves they fire correctly when a real HTTP client hits the real bound socket — the serialization path, Content-Type header, and JSON error body shape are all exercised in the same configuration a real consumer would encounter. The WS_05 unit tests used `inject()` which bypasses the TCP stack and HTTP serialization layer. This test does not.

---

## Assumptions to Test

| #  | Assumption | Why we believe it | How this task tests it | If false → |
|----|------------|-------------------|------------------------|------------|
| A1 | The `stream: true` guard in `proxy.ts` fires before `adapter.complete()` is called — the subprocess is never spawned | `proxy.ts` lines 101–110: `if (parsed.data.stream === true)` check precedes `adapter.complete()` | The test completes in <1s (no subprocess latency); the response is immediately 400 | Investigate whether Zod parse or stream guard ordering changed |
| A2 | The 400 response body is valid JSON with `{ error: { message, type, code } }` shape | `proxy.ts` sends `reply.status(400).send({ error: { ... } })`; Fastify auto-serializes | Parse the raw `fetch` response body as JSON; assert the expected fields | Fix the response body shape in `proxy.ts` |
| A3 | The unknown model guard fires for a model string not in `config.models` | `proxy.ts` lines 112–123: `config.models[model] === undefined` check | Use model `'not-a-real-model'` which is absent from `config.minimal.yaml` | Verify `loadConfig` loaded the fixture correctly in T1's `beforeAll` |
| A4 | Raw `fetch` against the bound server port works from Vitest test code | Node.js 20+ has native `fetch` (global) | Use `fetch(\`http://127.0.0.1:${port}/v1/chat/completions\`, ...)` without importing anything | Import `fetch` from `node-fetch` or use `http.request` as fallback |

---

## Expected Failures

- **[EF1]** `fetch` is not available as a global in the test environment. Node.js 20+ includes native `fetch` (no import needed). If it is unavailable (unlikely given `engines: >=20` in `package.json`), use `import { fetch } from 'undici'` which is already a transitive dependency via Fastify. Do not add a new dependency.
- **[EF2]** The `stream: true` error body message differs from what the test expects. The exact string in `proxy.ts` is `'Streaming is not supported'`. The test must assert `body.error.message === 'Streaming is not supported'` (exact match, not `.toContain()`). If the message changed, either the test is correct and `proxy.ts` drifted (fix `proxy.ts`) or the test is wrong (fix the test to match the locked message).
- **[EF3]** The error response body for unknown model contains the model name in the message. `proxy.ts` line 117: `\`Model '${model}' is not supported\``. This is correct and intentional — it contains the model name from the request, which is not sensitive information. The test should assert `body.error.code === 'model_not_supported'` rather than the exact message string (which includes the variable model name).
- **[EF4]** `baseURL` / `port` is not accessible in `e2e.errorPaths.test.ts` because it is a separate file from T1's fixture. The error-path tests must either (a) share the fixture by being in the same file as T1/T2, or (b) set up their own `beforeAll`/`afterAll` in `e2e.errorPaths.test.ts`. **Option (b) is required** if the tests are in a separate file. The fixture setup is identical to T1's `beforeAll` — use the same pattern. See D1 below.

---

## Test Strategy

- **Integration only**: Two `it()` blocks, each using raw `fetch` against the live server. No SDK client needed for these tests (avoiding the streaming overload TS issue).
- **No subprocess invocation**: Both error paths are rejected before `adapter.complete()` is called. These tests complete in well under one second. Set `{ timeout: 10_000 }` — a generous buffer that is still tight enough to catch a test that accidentally invokes the subprocess.
- **No mocking**: Per WS_06-D1. The `ClaudeAdapter` is instantiated but never called for these error paths.
- **Raw `fetch` rationale**: The `stream: true` SDK overload returns `APIPromise<Stream<ChatCompletionChunk>>`, which causes TS type errors when awaited in an error-assertion context. Raw `fetch` avoids the overload entirely and directly asserts the HTTP response, which is the contract being tested.

---

## Contract: What This Task Inherits

| Symbol / Artifact | Source | Role in This Task |
|-------------------|--------|-------------------|
| `server`, `adapter`, `port` (or `baseURL`) | T1's `beforeAll` pattern — replicated in `e2e.errorPaths.test.ts`'s own `beforeAll` | The tests need a bound port; they replicate T1's fixture setup |
| `loadConfig('tests/fixtures/config.minimal.yaml')` | `src/config.ts` | Provides the config with `claude-sonnet-4-6` only — `not-a-real-model` is absent by construction |
| `createServer(config, adapter): FastifyInstance` | `src/proxy.ts` | The server under test |
| `proxy.ts` stream guard: HTTP 400, `code: 'streaming_not_supported'`, `message: 'Streaming is not supported'` | `src/proxy.ts` lines 101–110 | Exact values to assert |
| `proxy.ts` model guard: HTTP 400, `code: 'model_not_supported'`, `message: "Model '${model}' is not supported"` | `src/proxy.ts` lines 112–123 | `code` to assert; `message` contains variable model name |

---

## Subtask Progress Table

| #  | Subtask | Status | Iteration | Notes |
|----|---------|--------|-----------|-------|
| 1  | Create `tests/integration/e2e.errorPaths.test.ts` with imports and a `beforeAll`/`afterAll` fixture identical in structure to T1's (same pattern: `loadConfig`, `ClaudeAdapter`, `createServer`, `listen({ port: 0 })`, extract port) | ✅ Done | 1 | File created; identical fixture pattern to T1 |
| 2  | Write T-3a: raw `fetch` POST with `{ model: 'claude-sonnet-4-6', messages: [...], stream: true }`; assert `response.status === 400`; parse body; assert `body.error.message === 'Streaming is not supported'`; assert `body.error.code === 'streaming_not_supported'` | ✅ Done | 1 | All three SC-1/SC-2/SC-3 assertions pass |
| 3  | Write T-3b: raw `fetch` POST with `{ model: 'not-a-real-model', messages: [...] }`; assert `response.status === 400`; parse body; assert `body.error.code === 'model_not_supported'` | ✅ Done | 1 | SC-4/SC-5 assertions pass; message not asserted (EF3) |
| 4  | Add `healthCheck()` guard (`ctx.skip()` if false) inside each `it()` block | ✅ Done | 1 | Both `it()` blocks guard with `ctx.skip()` |
| 5  | Run `npm test` — confirm both test cases pass when `healthCheck()` returns true (or skip cleanly if false) | ✅ Done | 1 | 84 tests, 17 files, all passing (82 baseline + 2 new) |
| 6  | Run `npm run typecheck`, `npm run lint`, `npm run format` — all clean | ✅ Done | 1 | All three gates clean; prettier reformatted one long type cast |

_Status icons: `✅ Done` | `🔄 In progress` | `⬚ Not started` | `❌ Blocked`_

---

## Current Subtask Detail

### Subtask 1: Create the error-path test file

**Approach iteration plan**:
1. Create the file with imports and the `beforeAll`/`afterAll` fixture (same structure as T1). Verify `typecheck` passes.
2. Add T-3a (stream guard). Run and confirm 400 response.
3. Add T-3b (unknown model guard). Run and confirm 400 response.

- **Current iteration**: 1 of 3
- **Verifiability**: Both tests pass with correct status codes and body fields; `typecheck` is clean.
- **Key detail on raw `fetch`**: The request body must be `JSON.stringify({...})` with `Content-Type: 'application/json'` header. The response body is read with `await response.json()`. Type the response body as `{ error: { message: string; type: string; code: string } }`.

---

## Decisions Made

### D1 — Separate test file with its own fixture, not shared with T1/T2 ✅ LOCKED (Architect, 2026-06-12)

**Decision**: Error-path tests live in `tests/integration/e2e.errorPaths.test.ts`, a separate file from `e2e.noTools.test.ts`. The file has its own `beforeAll`/`afterAll` with an identical server lifecycle setup.

**Rationale**: The happy-path test (T2) holds the server open for 5–60 seconds waiting for the subprocess. The error-path tests complete in <1 second because they are rejected before subprocess invocation. A shared file would serialize them (Vitest's `describe` scoping), forcing the error-path tests to wait behind the happy-path test. Separate files allow Vitest to schedule them independently. The fixture duplication is four lines of identical code — negligible.

**Rejected alternative — share the fixture in `e2e.noTools.test.ts`**: Couples fast (error-path) and slow (happy-path) tests in the same describe block; complicates the timeout configuration (both tests would inherit the same timeout despite very different latency profiles).

### D2 — Raw `fetch` for both error-path tests ✅ LOCKED (Architect, 2026-06-12)

**Decision**: Both T-3a and T-3b use native Node.js 20 `fetch()`, not the `openai` SDK client.

**Rationale**: The `stream: true` SDK overload has a TypeScript type mismatch that makes error-assertion patterns awkward (requires unsafe casts). The error-path tests are testing the HTTP boundary contract — raw `fetch` directly asserts status codes and body fields, which is what matters here. The SDK client adds no value for these tests.

**Rejected alternative — use the `openai` SDK and catch `APIError`**: Requires a TS cast or `@ts-expect-error` for the stream overload. The `APIError.status` and `APIError.code` fields are available, but the indirection adds complexity. Raw `fetch` is simpler and more direct.

### D3 — `{ timeout: 10_000 }` for error-path tests ✅ LOCKED (Architect, 2026-06-12)

**Decision**: Error-path tests use `{ timeout: 10_000 }` (10 seconds), not 60 seconds.

**Rationale**: Both guards fire before `adapter.complete()` is called — no subprocess is spawned, no network I/O beyond the loopback TCP connection. A 10-second timeout is generous for a loopback request. If the test exceeds 10 seconds, it indicates the guard is NOT firing (the request went into the adapter pipeline) — which is a bug, not a latency issue.

**Rejected alternative — use the same 60 second timeout as T2**: Hides the failure mode where a guard stops firing. A timeout at 10s is a signal, not just a ceiling.

### D4 — Anti-overengineering scope fence ✅ LOCKED

**This task explicitly does NOT include**:
- Happy-path assertions (T2's responsibility).
- Testing error paths that involve the adapter or subprocess (those are 500-class errors handled in proxy.test.ts).
- Testing malformed JSON bodies (covered in proxy.test.ts T-3b).
- Any streaming implementation work.

---

## Cross-Task Contracts

### TASK_WS06_T4 will depend on:

- Both T-3a and T-3b passing.
- `e2e.errorPaths.test.ts` counted in the Vitest suite total.

---

## Files Modified / Created

- `tests/integration/e2e.errorPaths.test.ts` — **create new** (fixture + T-3a + T-3b)

---

## Success Criteria / Verifiability

| #    | Criterion | How to verify |
|------|-----------|---------------|
| SC-1 | T-3a: raw `fetch` with `stream: true` returns HTTP 400 | `expect(response.status).toBe(400)` |
| SC-2 | T-3a: error body `message === 'Streaming is not supported'` | `expect(body.error.message).toBe('Streaming is not supported')` |
| SC-3 | T-3a: error body `code === 'streaming_not_supported'` | `expect(body.error.code).toBe('streaming_not_supported')` |
| SC-4 | T-3b: raw `fetch` with unknown model returns HTTP 400 | `expect(response.status).toBe(400)` |
| SC-5 | T-3b: error body `code === 'model_not_supported'` | `expect(body.error.code).toBe('model_not_supported')` |
| SC-6 | T-3a latency is < 1s (no subprocess spawned) | Test completes well within 10-second timeout |
| SC-7 | Both tests skip cleanly when `healthCheck()` returns false | Skip output in `npm test --reporter=verbose`; no failure |
| SC-8 | No regressions — full suite green | `npm test` shows all prior tests still passing |
| SC-9 | `npm run typecheck` clean; `npm run lint` clean; `npm run format` no diff | Zero errors/issues |

---

## Required Test Cases

File: `tests/integration/e2e.errorPaths.test.ts`

### T-3a: stream guard — `stream: true` returns 400 with correct error body (covers SC-1, SC-2, SC-3)

In `beforeAll`: replicate T1's fixture (same `loadConfig` / `ClaudeAdapter` / `createServer` / `listen({ port: 0 })` pattern). Extract `port`. In the `it()` body: call `adapter.healthCheck()`; `ctx.skip()` if false. Send `fetch(\`http://127.0.0.1:${port}/v1/chat/completions\`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'claude-sonnet-4-6', messages: [{ role: 'user', content: 'Hello' }], stream: true }) })`. Assert `response.status === 400`. Parse body. Assert `body.error.message === 'Streaming is not supported'` and `body.error.code === 'streaming_not_supported'`. Test options: `{ timeout: 10_000 }`.

### T-3b: model guard — unknown model alias returns 400 with correct error body (covers SC-4, SC-5)

Same fixture. In the `it()` body: same `healthCheck` guard. Send `fetch(...)` with `{ model: 'not-a-real-model', messages: [...] }`. Assert `response.status === 400`. Parse body. Assert `body.error.code === 'model_not_supported'`. Test options: `{ timeout: 10_000 }`.

---

## Review Notes

_(Architect fills after BSE submits.)_

---

## Architect Sign-off

- [ ] Implementation reviewed
- [ ] All success criteria verified
- [ ] All assumptions resolved
- [ ] No regressions in full test suite
- [ ] `npm test` / `typecheck` / `lint` / `format` all clean
