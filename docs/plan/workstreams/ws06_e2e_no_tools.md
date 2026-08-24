# Workstream WS_06: No-Tools End-to-End Integration Test

> A workstream scopes ~1 day of work and is more detailed than its parent phase: concrete goals +
> deliverables, locked decisions (with rejected alternatives), a task breakdown, cross-task
> contracts, and success/quality gates. It is the bridge from phase goals to hour-sized tasks.

## Workstream Overview

- **Parent Phase**: [Phase 1B — OpenAI Translation Pipeline](../phases/01b_openai_translation_pipeline.md)
- **Timeframe**: ~1 day
- **Status**: ✅ **Completed** (Phase 1 closed, 2026-08-24 — WS_09 T4 sign-off)
- **Dependencies**: WS_04 signed off (translation pipeline: `argumentBuilder.ts`, `validator.ts`, `responseBuilder.ts`) AND WS_05 signed off (Fastify proxy, config, `index.ts` entrypoint). Both must be green-gate-clean before this workstream begins. This workstream is an integration/proof workstream, not a development workstream — it writes no new production code.

---

## Goals & Deliverables

- **Goal 1**: A passing end-to-end integration test that drives the full Phase 1B stack from an OpenAI SDK client through the Fastify server and the real Claude subprocess to a valid `chat.completion` response.
  - Deliverable: `tests/integration/e2e.noTools.test.ts` — uses the `openai` npm package with `baseURL: "http://127.0.0.1:8080/v1"` and `apiKey: "quotagate"`. Calls `client.chat.completions.create({ model: "claude-sonnet-4-6", messages: [{role: "user", content: "Hello"}] })`. Asserts: `response.choices[0].finish_reason === "stop"`; `response.choices[0].message.role === "assistant"`; `response.choices[0].message.content` is a non-empty string; `response.id` matches `/^chatcmpl-/`. No mocking — hits the real Claude subscription via `claude --print`.

- **Goal 2**: Explicit rejection tests via the real HTTP boundary — stream and unknown-model guards exercised through the OpenAI SDK, not Fastify `inject`.
  - Deliverable: Additional test cases in the same file (or a companion `tests/integration/e2e.errorPaths.test.ts`): (a) the OpenAI SDK with `stream: true` receives an error response that the SDK surfaces as a non-2xx status (assert the error is caught and its message contains `"Streaming is not supported"`); (b) an unknown model alias (`"not-a-model"`) receives an error the SDK surfaces with a 400-like code.

- **Goal 3**: Phase 1B green-gate close-out — the full suite (unit tests from WS_01–WS_05 plus these integration tests) passes; WS_06 sign-off is the formal Phase 1B sign-off and the gate for Phase 1C.
  - Deliverable: `npm test` green with integration tests counted, `typecheck` clean, `lint` clean, `format` no-diff, after the integration tests are folded into the suite per the tag convention established in WS_03-D2.

---

## Why This Workstream Matters

Unit tests prove that each component behaves correctly in isolation. The end-to-end test proves they behave correctly together, with the actual `claude --print` subprocess, the actual Fastify HTTP layer, and the actual `openai` npm SDK client. The gaps between those three are exactly where the most dangerous bugs live: serialization mismatches, content-type misconfigurations, async lifecycle ordering issues, and OpenAI SDK version quirks.

WS_06 is also the first time the Phase 1B success criterion from the spec (§6) — "an OpenAI SDK script produces correct chat completions using the Claude subscription" — is evaluated end-to-end. If WS_04 and WS_05 passed their unit tests but WS_06 fails, the failure is a real signal about a contract gap, not a test gap. The workstream produces no new production code — if it fails, the fix lands in WS_04 or WS_05.

WS_06 sign-off is also the formal gate for Phase 1C. The tool-call path (WS_07) and the retry hardening (WS_08) must not begin until the no-tools path is proven live, end-to-end, without simulation. This ordering is not bureaucratic caution — it is the Phase 1 strategy: prove the skeleton before adding complexity.

---

## Locked Decisions

### WS_06-D1 — No Mocking of the Claude Adapter or Subprocess in E2E Tests ✅ LOCKED (Architect, 2026-06-08)

Inherits **WS_03-D1** (integration tests run against the real subscription).

**Decision**: The end-to-end tests in WS_06 invoke the real `claude --print` subprocess against the developer's live Claude subscription. The Fastify server is started with the real `ClaudeAdapter`. No mock adapter, no stub subprocess, no intercepted HTTP.

**Rationale**: The purpose of this workstream is to prove the Phase 1B stack end-to-end. Mocking the adapter proves only that the mocked adapter is wired into the HTTP layer — it does not prove the actual transport works. The risk of flaky tests from network/auth issues is managed by the `healthCheck()` guard (the server start-up in the test fixture calls `healthCheck()` and skips the suite if the CLI is unavailable), following the pattern established in WS_03-D2.

**Rejected alternative — mock `ClaudeAdapter.complete()` in the integration test**: Indistinguishable from the WS_05 stub-adapter unit test. It would pass even if the subprocess was broken, the constraint was wrong, or the JSON output could not be parsed — exactly the failure modes WS_06 is designed to catch.

### WS_06-D2 — Fastify Server Started in-process via `createServer` Factory; No Separate Process ✅ LOCKED (Architect, 2026-06-08)

**Decision**: The integration test uses Vitest's `beforeAll` / `afterAll` hooks to start and stop the Fastify server in-process via `createServer(config, adapter)`. The server binds to a port (127.0.0.1:8080 or a test-specific port if needed to avoid conflict). The `openai` npm SDK client is pointed at that address.

**Rationale**: Starting the server in-process gives the test full lifecycle control (clean start, clean teardown) without requiring a running background process before the test suite. It avoids port conflicts with a concurrently running dev server. The factory-based `createServer` design from WS_05 was specifically motivated by this use case.

**Rejected alternative — require `quotagate start` to be running before the integration tests**: Makes the integration tests dependent on an external process, complicates the test runner setup, and prevents deterministic start/stop in the Vitest lifecycle.

### WS_06-D3 — Integration Tests Tagged `integration`; Skippable in CI Without Claude Auth ✅ LOCKED (Architect, 2026-06-08)

Inherits **WS_03-D2** (integration test tag convention).

**Decision**: WS_06's integration tests follow the same tag/filename convention as WS_03: file path `tests/integration/e2e.*.test.ts`, guarded by a `healthCheck()` skip, tagged so `vitest run --reporter=verbose` can separate unit vs integration suites. The local green gate always runs them. CI may exclude them if no Claude subscription is present.

**Rationale**: Consistent with the convention established in WS_03. Integration tests that require a live subscription must not block every CI run until a CI-accessible subscription is wired (Phase 4 DX concern). The guard is `adapter.healthCheck()` — if the CLI is unavailable, tests skip cleanly rather than failing with a transport error.

**Rejected alternative — require integration tests to pass in CI from day one**: Established as incorrect in WS_03-D2; same reasoning applies here.

---

## Task Breakdown

| Task ID | Description                                                                                                                                                                                                                                                                                                                | Est. Duration | Status        | Task Tracker Link              |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ------------- | ------------------------------ |
| T1      | Author the test fixture: `beforeAll` starts the Fastify server in-process (calls `loadConfig` with a test config fixture, instantiates `ClaudeAdapter`, calls `createServer`; skips suite if `healthCheck()` returns false). `afterAll` closes the server. Confirm the server starts and binds without error on a dry run. | ~45 min       | ⬚ Not started | `../../active/TASK_WS06_T1.md` |
| T2      | Author the happy-path test: `client.chat.completions.create({ model: "claude-sonnet-4-6", messages:[...] })`. Assert all four success criteria from the Phase 1B spec (finish_reason, role, content non-empty, chatcmpl- id). Run against the real subscription.                                                           | ~1 hour       | ⬚ Not started | `../../active/TASK_WS06_T2.md` |
| T3      | Author the error-path tests: (a) `stream: true` error is surfaced by the SDK; assert message contains "Streaming is not supported". (b) Unknown model alias returns an SDK-surfaced error. Confirm both return non-2xx status codes that the SDK surfaces as thrown errors.                                                | ~45 min       | ⬚ Not started | `../../active/TASK_WS06_T3.md` |
| T4      | Green-gate close-out: run the full suite (`npm test`, `typecheck`, `lint`, `format`). Fix any issues exposed by the live run (constraint wording drift, content-type headers, SDK version quirks). Sign off Phase 1B and record the close-out note in CLAUDE.md Session State.                                             | ~1 hour       | ⬚ Not started | `../../active/TASK_WS06_T4.md` |

_Status: `✅ Completed` | `🔄 In Progress` | `⬚ Not started` | `❌ Blocked`_

_T1 is a prerequisite for T2 and T3 (fixture must exist). T2 and T3 are independent once T1 is working. T4 depends on T2 and T3 both passing cleanly._

---

## Cross-Task Contracts

### Test fixture lifecycle (owned by T1 → consumed by T2, T3)

T1's `beforeAll`/`afterAll` pattern is the shared fixture for T2. T3 lives in a separate file (`e2e.errorPaths.test.ts`) with its own identical `beforeAll`/`afterAll` — the error-path tests have a 10-second timeout versus T2's 60-second timeout, and collocating them would force the wrong timeout on both. T2 uses the `openai` SDK client from T1's `beforeAll`; T3 uses raw `fetch` with the bound port. Do not re-start the server per test within a `describe` block.

### `healthCheck()` guard pattern (inherited from WS_03-D2 → applied in T1)

T1 calls `adapter.healthCheck()` inside each `it()` callback. If it returns false, `ctx.skip()` is called (Vitest context parameter — the `ctx` object passed to the test callback). This is the established pattern in this repo — see `tests/integration/constraint.integration.test.ts`. Do not use `vi.skip()` or describe-level skipping. WS_09 will follow the same pattern for the acceptance suite.

### Phase 1B sign-off (produced by T4 → consumed by WS_07/WS_08 as the gate)

WS_06 T4 completion is the formal gate for Phase 1C. WS_07 and WS_08 must not begin until T4 is signed off. The dependency: no-tools path proven live end-to-end, green gate holding, `AdapterResponse` contract stable.

### `createServer` / `loadConfig` (inherited from WS_05 → consumed by T1)

T1 calls `createServer(config, adapter)` and `loadConfig("tests/fixtures/config.minimal.yaml")` directly. The fixture `tests/fixtures/config.minimal.yaml` already exists (created in WS_05) with `claude-sonnet-4-6 → {backend: "claude", priority: 1}` and `retry.max_attempts: 3`. T1 uses it as-is — no new fixture file is needed.

---

## Success & Evaluation Criteria

- **Functional requirements**:
  - [ ] `client.chat.completions.create({ model: "claude-sonnet-4-6", messages:[{role:"user",content:"Hello"}] })` returns a response where `response.choices[0].finish_reason === "stop"`.
  - [ ] `response.choices[0].message.role === "assistant"`.
  - [ ] `response.choices[0].message.content` is a non-empty string (not null, not `""`).
  - [ ] `response.id` matches `/^chatcmpl-/`.
  - [ ] `response.object === "chat.completion"` (required non-optional field on `ChatCompletion`; confirms the shape is complete, not just the choices array).
  - [ ] `response.usage` is `undefined` (field absent from response body; SDK does not throw).
  - [ ] A request with `stream: true` causes the `openai` SDK to throw (non-2xx response); the error message or body contains `"Streaming is not supported"`.
  - [ ] A request with `model: "not-a-real-model"` causes the SDK to throw (non-2xx); error is identifiable as a 400-class response.

- **Named tests that prove this workstream done**:
  - [ ] `tests/integration/e2e.noTools.test.ts` — happy path: all six assertions above (finish_reason, role, content, id, object, usage).
  - [ ] `tests/integration/e2e.errorPaths.test.ts` — `stream: true` surfaces SDK error with correct message; unknown model surfaces 400-class SDK error.

- **Quality gates**:
  - [ ] `npm test` green; integration tests counted in the suite; no test-count regression from WS_05 baseline
  - [ ] `npm run typecheck` clean
  - [ ] `npm run lint` clean; `npm run format` produces no diff
  - [ ] WS_06 sign-off recorded in CLAUDE.md Session State as the Phase 1B exit

---

## Known Pitfalls & Implementation Notes

**OpenAI SDK error handling for non-2xx**: The `openai` npm package throws `APIError` subclasses for non-2xx responses. The `stream: true` and unknown-model tests must catch these with `await expect(promise).rejects.toThrow()` or a `try/catch`. Check that the error object has the expected `status` or `message` field — the exact shape depends on the `openai` package version declared in `package.json` (from WS_01).

**`stream: true` test — use raw `fetch`, not the SDK**: `client.chat.completions.create({ stream: true, ... })` has a TypeScript overload that returns `APIPromise<Stream<ChatCompletionChunk>>`, not `APIPromise<ChatCompletion>`. Awaiting it in a test produces a TS overload resolution error when you try to assert on the result. Use a raw `fetch` call instead — POST `{ model, messages, stream: true }` to the server URL and assert the response status is 400 and the JSON body contains `"Streaming is not supported"`. This avoids the overload problem and is clearer in intent. At the HTTP level the behavior is the same: the server returns 400 before doing any work.

**Server port in tests**: `createServer(config, adapter)` returns an unbound `FastifyInstance` — there is no port parameter in the factory or in `QuotagateConfig`. The port is bound only when `server.listen()` is called. The correct pattern for the E2E test fixture is to call `await server.listen({ port: 0, host: '127.0.0.1' })` with port `0`; the OS assigns an ephemeral port and `listen()` returns the bound address string (e.g. `http://127.0.0.1:58310`). Parse the port from that string and use it as `baseURL` for the `OpenAI` client. This eliminates any collision with a running dev server and is strictly cleaner than a hardcoded port. Verified: Fastify v5 handles `port: 0` correctly.

**Response latency and Vitest timeout**: `claude --print` takes 5–7 seconds warm and can exceed 15 seconds cold-start (fresh process, first invocation). The full HTTP round-trip adds server start-up overhead on top. Use `{ timeout: 60_000 }` for single-call integration tests. This matches the empirically validated value from `tests/integration/constraint.integration.test.ts`. Do not use the default Vitest timeout of 5 seconds.

**Phase 1B exit sign-off content**: T4's green-gate close-out note in CLAUDE.md Session State should record: (a) the test run output summary, (b) the date of sign-off, (c) the WS_06 status update to Completed, and (d) confirmation that WS_07 and WS_08 are unblocked. This is a planning record, not a git commit — it is updated in CLAUDE.md by hand during T4 as part of the house-keeping protocol.

**`usage` field — assert `undefined`, not `null`**: `responseBuilder.ts` returns a `ChatCompletion` object with no `usage` key (the field is absent from the object entirely). The `openai` v6 `ChatCompletion` type declares `usage?: CompletionUsage` (optional), so the typecheck is clean. The SDK client deserializes the response JSON as-is and does not access `usage` unconditionally — it will not throw when the field is absent. T2 must include the assertion `expect(response.usage).toBeUndefined()` to confirm the field is absent and stable. Do not change `responseBuilder.ts` to emit `usage: null` unless T2 reveals the SDK actually throws — that would be a production code fix, not a test fix. Spec §7.4 confirms CLI agents return no token counts; the field must remain absent, never populated with invented values.

**If T2 fails on first run**: The most likely causes are (1) `build_constrained_prompt` constraint wording has drifted from the validated form in spec §5.2 (fix in `adapters/claude.ts`); (2) the `AdapterResponse.raw` field contains prose wrapping the JSON (fix in `validator.ts` — strip or handle fence-wrapped JSON); (3) the OpenAI SDK rejects the `chat.completion` shape from `buildChatCompletion` (fix in `responseBuilder.ts` — check required fields against the `openai` package TypeScript types). Do not adjust the test assertions to be more lenient — the test expresses the correct contract.
