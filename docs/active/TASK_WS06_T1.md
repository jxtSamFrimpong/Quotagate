# TASK_WS06_T1: E2E Test Fixture — Server Lifecycle + Fixture Config

## Context

- **Workstream**: WS_06 (No-Tools End-to-End Integration Test)
- **Plan reference**: `docs/plan/workstreams/ws06_e2e_no_tools.md`
- **Phase plan**: `docs/plan/phases/01b_openai_translation_pipeline.md`
- **Depends on**: WS_04 signed off + WS_05 signed off (both green-gate-clean). `tests/fixtures/config.minimal.yaml` exists.
- **Blocks**: TASK_WS06_T2 and TASK_WS06_T3 (both depend on this fixture)

---

## Goal & Why

- **Goal**: Create `tests/integration/e2e.noTools.test.ts` with a `beforeAll`/`afterAll` fixture that (a) loads the existing minimal config fixture, (b) instantiates `ClaudeAdapter`, (c) calls `healthCheck()` and skips if unavailable, (d) starts the Fastify server via `createServer` bound to an OS-assigned ephemeral port, (e) instantiates an `OpenAI` SDK client pointed at that port, and (f) tears down the server cleanly in `afterAll`. The fixture must confirm the server starts and responds to an inject-level probe without error.
- **Why**: T2 and T3 both need a live, bound Fastify server and a configured `OpenAI` SDK client. This fixture is their shared scaffolding. The design decision (WS_06-D2) to start the server in-process via `createServer` was motivated precisely by this use case — deterministic lifecycle, no external process, clean teardown. Getting this right in T1 means T2 and T3 can focus entirely on assertion logic.

---

## Assumptions to Test

| #  | Assumption | Why we believe it | How this task tests it | If false → |
|----|------------|-------------------|------------------------|------------|
| A1 | Fastify v5 `server.listen({ port: 0, host: '127.0.0.1' })` assigns an ephemeral port and returns the bound URL string | Verified empirically in Node.js REPL against the installed package | Call `listen({ port: 0 })` and assert the returned string is a valid `http://127.0.0.1:<port>` URL | Use `server.addresses()[0].port` as the fallback — also verified to work |
| A2 | `loadConfig("tests/fixtures/config.minimal.yaml")` resolves the path correctly when called from a Vitest test | `loadConfig` calls `fs.readFileSync(resolvedPath)` where `resolvedPath` is the argument verbatim; Vitest runs from the repo root | Call `loadConfig` with the relative path in the test; assert no `QuotagateError` is thrown | Use `path.resolve` + `import.meta.url` to get an absolute path |
| A3 | `ClaudeAdapter.healthCheck()` is the correct skip signal — returning false means skip, not fail | Established in WS_03-D2 and used in all three existing integration tests | Check `healthCheck()` result in `beforeAll`; if false, call `ctx.skip()` in each test | N/A — this is the locked pattern |
| A4 | `server.close()` in `afterAll` completes without error and frees the port | Fastify v5 `close()` returns a Promise | `await server.close()` in `afterAll`; if it throws, the afterAll will surface it | Log and continue — port:0 means no residual collision risk |

---

## Expected Failures

- **[EF1]** `loadConfig` receives a relative path and `fs.readFileSync` resolves it relative to `process.cwd()` (repo root in Vitest). If Vitest changes its working directory, the path breaks. Handle by using an absolute path via `new URL('../../tests/fixtures/config.minimal.yaml', import.meta.url)` as a fallback if the relative path approach is unreliable.
- **[EF2]** `server.listen({ port: 0 })` — the return value is a `string` in Fastify v5, not a number. Parse the port out of the URL string: `new URL(addr).port` or `parseInt(new URL(addr).port, 10)`.
- **[EF3]** `healthCheck()` throws (non-ENOENT spawn error) rather than returning false. This is a bug in the adapter; per `index.ts` comments it is an unhandled rejection in Phase 1. In the test context, do not catch it — let it propagate as a test failure so the bug is visible.
- **[EF4]** `server.close()` in `afterAll` emits a Fastify warning about closing a server that was never fully initialized (e.g., if `beforeAll` failed before `listen()`). Guard `afterAll` with a null check on the server variable.

---

## Test Strategy

- **Integration only**: This task does not add unit tests. The fixture IS the deliverable. Its correctness is proven by T2 and T3 running successfully on top of it.
- **Dry-run smoke check**: After writing the fixture, add a temporary `it('fixture smoke: server is reachable', ...)` that sends a raw `fetch` to `${baseURL}/v1/chat/completions` with a valid minimal payload and asserts the response status is not a network error (any HTTP status code is acceptable — the point is the TCP connection succeeded and a JSON body came back). This test is kept permanently as T-1 (the fixture health check).
- **No mocking**: Per WS_06-D1, no mock adapter and no stubbed subprocess. The `ClaudeAdapter` is real.

---

## Contract: What This Task Inherits

| Symbol / Artifact | Source | Role in This Task |
|-------------------|--------|-------------------|
| `loadConfig(path?: string): QuotagateConfig` | `src/config.ts` | Loads the YAML fixture into a typed config |
| `createServer(config: QuotagateConfig, adapter: CLIAdapter): FastifyInstance` | `src/proxy.ts` | Creates the Fastify instance; called in `beforeAll` |
| `ClaudeAdapter` (implements `CLIAdapter`) | `src/adapters/claude.ts` | The real adapter passed to `createServer` |
| `adapter.healthCheck(): Promise<boolean>` | `src/adapters/claude.ts` | Skip guard — false → `ctx.skip()` |
| `tests/fixtures/config.minimal.yaml` | Exists from WS_05 | `models: { claude-sonnet-4-6: { backend: claude, priority: 1 } }, retry: { max_attempts: 3 }` |
| `FastifyInstance.listen({ port: 0, host: '127.0.0.1' }): Promise<string>` | Fastify v5 | Binds to OS-assigned port; return value is the bound URL string |
| `new OpenAI({ baseURL: '...', apiKey: 'quotagate' })` | `openai` npm package (devDep) | SDK client; `baseURL` is `${boundAddr}/v1` |

---

## Subtask Progress Table

| #  | Subtask | Status | Iteration | Notes |
|----|---------|--------|-----------|-------|
| 1  | Create `tests/integration/e2e.noTools.test.ts` with imports: `vitest` lifecycle hooks + `OpenAI` + `loadConfig` + `ClaudeAdapter` + `createServer` + `FastifyInstance` type | ⬚ Not started | — | |
| 2  | Write `beforeAll`: call `loadConfig('tests/fixtures/config.minimal.yaml')`, instantiate `ClaudeAdapter`, call `createServer(config, adapter)`, call `server.listen({ port: 0, host: '127.0.0.1' })`, extract port from returned URL string, instantiate `OpenAI({ baseURL: \`http://127.0.0.1:${port}/v1\`, apiKey: 'quotagate' })` | ⬚ Not started | — | |
| 3  | Write `afterAll`: `await server.close()` | ⬚ Not started | — | |
| 4  | Write T-1 fixture smoke test: raw `fetch` to `${baseURL}/v1/chat/completions` with a valid minimal payload; assert the TCP connection succeeds and a JSON body is returned (any HTTP status is acceptable) | ⬚ Not started | — | |
| 5  | Implement `healthCheck()` guard inside T-1: call `adapter.healthCheck()` at top of test; `ctx.skip()` if false | ⬚ Not started | — | |
| 6  | Run `npm test` and confirm the new test file is picked up by Vitest; if `healthCheck()` passes, confirm T-1 passes; if it skips, confirm the skip is clean (not a failure) | ⬚ Not started | — | |
| 7  | Run `npm run typecheck` — zero errors | ⬚ Not started | — | |
| 8  | Run `npm run lint` and `npm run format` — zero issues and no diff | ⬚ Not started | — | |

_Status icons: `✅ Done` | `🔄 In progress` | `⬚ Not started` | `❌ Blocked`_

---

## Current Subtask Detail

### Subtask 1: Create the test file with correct imports

**Approach iteration plan**:
1. Create the file with imports only; no test body. Confirm `typecheck` passes.
2. Add `beforeAll`/`afterAll` with the server lifecycle.
3. Add the smoke test (T-1).

- **Current iteration**: 1 of 3
- **Verifiability**: `npm run typecheck` exits zero; `npm test` picks up the new file.
- **Challenges**: `openai` is a devDependency — it is importable in test files. ESM import of `OpenAI` from `openai` in a `.ts` test file compiled with `"module": "ESNext"` should work given the existing test patterns.

---

## Decisions Made

### D1 — Ephemeral port (port: 0) over hardcoded port ✅ LOCKED (Architect, 2026-06-12)

**Decision**: Use `server.listen({ port: 0, host: '127.0.0.1' })`. Extract the bound port from the return value of `listen()` (a URL string in Fastify v5).

**Rationale**: Eliminates all port-collision risk — both with a running dev server on 8080 and with any other test using a hardcoded port. The OS guarantees uniqueness. Fastify v5 + port:0 is verified to work correctly and to return the bound URL.

**Rejected alternative — hardcoded port 18080**: Marginally cleaner to read in the test source but introduces a latent collision risk if 18080 is in use (e.g., another service or a parallel test run). The ephemeral approach is strictly superior at zero cost.

### D2 — `ctx.skip()` pattern, not `vi.skip()` ✅ LOCKED (Architect, 2026-06-12)

**Decision**: The `healthCheck()` guard calls `ctx.skip()` inside each `it()` callback, using the Vitest test context parameter. This is the established pattern from `tests/integration/constraint.integration.test.ts` and `executionSuppression.integration.test.ts`.

**Rationale**: `vi.skip()` is not the correct API for runtime skip decisions inside a test body in Vitest. `ctx.skip()` is. Consistency with the existing integration tests is non-negotiable.

**Rejected alternative — skip at describe level with a `beforeAll` flag**: More complex, requires a boolean variable shared between `beforeAll` and `it()` callbacks. The per-test `ctx.skip()` pattern is already proven in this codebase.

### D3 — Anti-overengineering scope fence ✅ LOCKED

**This task explicitly does NOT include**:
- The happy-path chat completion test (T2's responsibility).
- The error-path tests (T3's responsibility).
- Any modifications to production source files (`src/`).
- Creating new fixture YAML files — `tests/fixtures/config.minimal.yaml` already exists and is used as-is.

---

## Cross-Task Contracts (Downstream Dependencies)

### TASK_WS06_T2 and TASK_WS06_T3 will depend on:

- `server` — a bound `FastifyInstance`; must be started before T2/T3 `it()` blocks run.
- `client` — an `OpenAI` instance with `baseURL` pointing at the bound server port.
- `baseURL` — the full `http://127.0.0.1:<port>/v1` string; needed by T3's raw `fetch` calls.
- `adapter` — the live `ClaudeAdapter` instance; needed by T2/T3 for the `healthCheck()` guard.
- These four values are module-scoped variables set in `beforeAll` and consumed in `it()` bodies.
- Do NOT re-start the server per test. One server per `describe` block.

---

## Files Modified / Created

- `tests/integration/e2e.noTools.test.ts` — **create new** (fixture + smoke test T-1)

---

## Success Criteria / Verifiability

| #    | Criterion | How to verify |
|------|-----------|---------------|
| SC-1 | `tests/integration/e2e.noTools.test.ts` is created and Vitest picks it up | `npm test` output lists the file |
| SC-2 | When `healthCheck()` returns true: T-1 fixture smoke test passes (server starts, port:0 resolves, raw fetch returns a JSON body) | `npm test` output shows T-1 passing |
| SC-3 | When `healthCheck()` returns false: all tests in the file skip cleanly (no failure, no timeout) | Skip output visible in `npm test --reporter=verbose` |
| SC-4 | `afterAll` closes the server without error | No Fastify lifecycle error in test output |
| SC-5 | `npm run typecheck` exits zero — no new type errors | Zero errors |
| SC-6 | `npm run lint` and `npm run format` clean | Zero issues, no diff |
| SC-7 | Test count from WS_05 baseline (80) is not regressed — new test is additive | `npm test` shows ≥ 81 tests |

---

## Required Test Cases

File: `tests/integration/e2e.noTools.test.ts`

### T-1: fixture smoke — server starts and is TCP-reachable (covers SC-1, SC-2)

In `beforeAll`: call `loadConfig`, instantiate `ClaudeAdapter`, call `createServer`, call `server.listen({ port: 0, host: '127.0.0.1' })`, extract port, instantiate `OpenAI` client. In the `it()` body: call `adapter.healthCheck()`; `ctx.skip()` if false. Send a raw `fetch` POST to `http://127.0.0.1:${port}/v1/chat/completions` with `{ model: 'claude-sonnet-4-6', messages: [{ role: 'user', content: 'ping' }] }` and `Content-Type: application/json`. Assert the response is not a `TypeError` (i.e., the TCP connection succeeded). Assert `response.headers.get('content-type')` includes `application/json`. The HTTP status code is not asserted — any status (200 or 500 if the adapter fails) confirms the server is up and routing.

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
