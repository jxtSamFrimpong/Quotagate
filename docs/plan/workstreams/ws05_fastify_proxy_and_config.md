# Workstream WS_05: Fastify Proxy & Config

> A workstream scopes ~1 day of work and is more detailed than its parent phase: concrete goals +
> deliverables, locked decisions (with rejected alternatives), a task breakdown, cross-task
> contracts, and success/quality gates. It is the bridge from phase goals to hour-sized tasks.

## Workstream Overview
- **Parent Phase**: [Phase 1B — OpenAI Translation Pipeline](../phases/01b_openai_translation_pipeline.md)
- **Timeframe**: ~2 days
- **Status**: Proposed
- **Dependencies**: WS_03 signed off — `CLIAdapter`, `ClaudeAdapter`, `AdapterResponse`, and the green gate must be in place. WS_04 can proceed in parallel with this workstream; WS_05 does not depend on WS_04 being complete, only on the `AdapterRequest` / `AdapterResponse` type contracts from WS_01.

---

## Goals & Deliverables

- **Goal 1**: A Zod-validated config loader that types the `config.yaml` model-alias map and retry settings.
  - Deliverable: `src/config.ts` — `loadConfig(path?: string): QuotagateConfig`. Reads `config.yaml` from a default path (or the supplied override); validates with a Zod schema covering `models` (alias → `{backend: string}`), `retry.max_attempts` (number), and any stub MCP keys that must not fail validation when present. Typed `QuotagateConfig` exported for use by proxy and router. Unit tests: valid minimal fixture parses; missing required fields throw; extra unknown fields are stripped (Zod `.strip()`). MCP-specific config keys (spec §3.9) are present in the schema but reserved; they are Phase 2.

- **Goal 2**: A Fastify v5 HTTP server exposing `POST /v1/chat/completions` with full request validation, inline single-adapter alias resolution, and `QuotagateError`-to-HTTP mapping.
  - Deliverable: `src/proxy.ts` — `createServer(config: QuotagateConfig, adapter: CLIAdapter): FastifyInstance`. Single route: `POST /v1/chat/completions`. Behavior:
    - Parses request body with Zod (messages, model, tools, tool_choice, stream fields).
    - Rejects `stream: true` → HTTP 400, OpenAI-format error body (D-1B-04).
    - Resolves model alias via an inline lookup against `config.models`; unknown alias → HTTP 400 (D-1B-03).
    - Calls `buildAdapterRequest` → `adapter.complete()` → `validate()` → `buildChatCompletion()`.
    - Maps `QuotagateError` subclasses to appropriate HTTP status codes — never raw stack traces.
    - Bound to `localhost:8080` only (no `0.0.0.0`).

- **Goal 3**: A fleshed-out `src/index.ts` CLI entrypoint that boots Fastify and runs `healthCheck()` before listening.
  - Deliverable: `src/index.ts` — `quotagate start` subcommand: calls `loadConfig()`, instantiates `ClaudeAdapter`, calls `adapter.healthCheck()` (exits with a clear error message if false), then starts the Fastify server on `localhost:8080`. No installer step in Phase 1 (D-SEQ-01). `quotagate status` and `quotagate backends` remain stubs (Phase 4 per out-of-scope fence in 1B). Log line on ready: `"Quotagate running on localhost:8080. Backend: claude"`.

---

## Why This Workstream Matters

`proxy.ts` is the HTTP boundary — the single point where malformed requests are rejected, where `QuotagateError` is translated to HTTP, and where the `stream: true` guard prevents a class of silent client-side failures. Getting this right in WS_05 means WS_06's integration test is a clean end-to-end proof, not a debugging session that is half about HTTP edge cases.

`config.ts` also establishes the first point where the system can be misconfigured at startup rather than at runtime. A Zod-validated config loader that rejects bad configs at boot is the simplest form of the "fail fast, fail loud" principle — it is far cheaper to get a clear error on `quotagate start` than to get a cryptic `undefined is not iterable` when the first real request arrives.

`index.ts`'s health-check-before-listen gate is specifically what prevents Quotagate from appearing to start successfully while the adapter is unusable. Without it, a developer with an expired Claude subscription would see the server start fine, then get a confusing `TransportError` on their first request with no pointer toward the actual problem.

WS_04 and WS_05 can run in parallel since they touch different files. WS_06 depends on both.

---

## Locked Decisions

### WS_05-D1 — Fastify v5, ESM, `localhost:8080` Only ✅ LOCKED (Architect, 2026-06-08)
Inherits **D-1A-05** (Fastify v5 declared in WS_01) from Phase 1A.

**Decision**: `proxy.ts` uses `import Fastify from "fastify"` (ESM, v5). The server is created with `{ logger: true }` for structured logs. `listen` is called with `{ port: 8080, host: "127.0.0.1" }` — never `0.0.0.0`. The port is not configurable in Phase 1 (config key reserved for Phase 4).

**Rationale**: Fastify v5 is native ESM and TypeScript-first. Binding to `127.0.0.1` enforces the localhost-only constraint from CLAUDE.md and the spec (the proxy is a local developer tool, not a networked service). Exposing it on `0.0.0.0` in Phase 1 would be a premature security surface.

**Rejected alternative — `0.0.0.0` with a config flag**: Deferred to Phase 4. In Phase 1 there is no access-control layer, so `0.0.0.0` would expose the proxy to the local network with no authentication. The Phase 1 threat model is a single developer on a local machine.

### WS_05-D2 — `stream: true` Returns HTTP 400 With OpenAI-Format Error Body ✅ LOCKED (Architect, 2026-06-08)
Inherits **D-1B-04** from the parent phase plan.

**Decision**: If the parsed request body contains `stream: true`, `proxy.ts` returns HTTP 400 with:
```json
{
  "error": {
    "message": "Streaming is not supported in this version of Quotagate.",
    "type": "invalid_request_error",
    "code": "streaming_not_supported"
  }
}
```
The response header is `Content-Type: application/json`. No OpenAI SDK client parsing a stream will succeed on this body — the error is explicit and human-readable.

**Rationale**: Silently ignoring `stream: true` and returning a non-streaming body causes the OpenAI SDK to attempt to parse a JSON object as an SSE stream, producing an opaque client-side error. An explicit HTTP 400 with a readable message tells the developer exactly what happened and what to fix. Phase 3 wires SSE properly; the HTTP 400 is the correct behavior until then.

**Rejected alternative — silently ignore `stream: true` and return a non-streaming body**: SDK clients expecting an SSE stream will fail to parse a JSON object. The error surface is the client, not the proxy, and the message will be unhelpful.

### WS_05-D3 — Inline Model-Alias Resolution in `proxy.ts` for Phase 1B; `router.ts` Is Phase 1C ✅ LOCKED (Architect, 2026-06-08)
Inherits **D-1B-03** from the parent phase plan.

**Decision**: In `proxy.ts`, model alias resolution is a single inline check: look up `request.model` in `config.models`; if found and `backend === "claude"`, use the injected `ClaudeAdapter`; otherwise return HTTP 400 `"model not supported"`. No `router.ts` file is created in WS_05.

**Rationale**: A router that only ever resolves to one adapter is dead abstraction. The inline lookup is three lines. The full `router.ts` (WS_08, Phase 1C) is motivated by the existence of a clean seam to test — `resolve(alias) → CLIAdapter | null` — which only becomes meaningful when the routing decision is non-trivial. Adding it in 1B would create a file with one code path and zero decisions to make.

**Rejected alternative — introduce `router.ts` in WS_05**: Anti-overengineering. The router has no value until the Phase 2 Gemini/Codex adapters exist, at which point health-check and fallback logic also arrive. Introducing it now creates a file that will be rewritten wholesale in Phase 2.

### WS_05-D4 — `QuotagateError` Subclass → HTTP Status Code Mapping Is Exhaustive and Centralized in `proxy.ts` ✅ LOCKED (Architect, 2026-06-08)
**Decision**: `proxy.ts` contains the definitive mapping from `QuotagateError` subclasses to HTTP status codes:
- `ValidationError` (retry exhausted) → 500, OpenAI-format error body, no raw stack trace.
- `TransportError` (subprocess failed) → 500, same shape.
- `QuotagateError` (base, catch-all) → 500, generic message.
- Unhandled `Error` → 500, generic message (no stack trace leaked).
Fastify's `setErrorHandler` is used to centralize this mapping. Individual route handlers throw typed errors; they do not set HTTP status codes directly.

**Rationale**: CLAUDE.md error-handling convention: "Boundary errors map to OpenAI-shaped error responses (`proxy.ts`), never raw stack traces to the caller." Centralizing in `setErrorHandler` means adding a new `QuotagateError` subclass in the future requires one map entry, not changes across multiple route handlers.

**Rejected alternative — set `reply.status(500)` inline per route handler**: Scatters the mapping; different handlers may produce inconsistent error shapes; a new error subclass requires hunting down every handler.

---

## Task Breakdown

| Task ID | Description | Est. Duration | Status | Task Tracker Link |
|---------|-------------|---------------|--------|-------------------|
| T1 | Author `src/config.ts`: Zod schema for `QuotagateConfig` (models alias map, retry settings, MCP stubs). `loadConfig(path?)` reads and parses `config.yaml`. Unit tests: valid minimal fixture passes; missing `models` throws; extra unknown fields stripped; retry defaults applied. | ~1 hour | ⬚ Not started | `../../active/TASK_WS05_T1.md` |
| T2 | Author `src/proxy.ts` skeleton: Fastify v5 instance creation, `setErrorHandler` with `QuotagateError` mapping (no raw stack traces), `POST /v1/chat/completions` route with Zod body parse and `stream: true` guard. Unit tests: `stream: true` → 400; unknown model → 400; malformed body → 400. | ~1 hour | ⬚ Not started | `../../active/TASK_WS05_T2.md` |
| T3 | Wire the full request pipeline into `proxy.ts`: inline alias resolution → `buildAdapterRequest` → `adapter.complete()` → `validate()` → `buildChatCompletion()` → `reply.send()`. Inject adapter via `createServer(config, adapter)` factory. Unit tests (Fastify `inject`, stub adapter): success path returns 200 with valid `ChatCompletion` shape; `TransportError` returns 500 with OpenAI-format error body. | ~1 hour | ⬚ Not started | `../../active/TASK_WS05_T3.md` |
| T4 | Flesh out `src/index.ts`: parse `quotagate start` subcommand with a minimal arg-parser (no external dep needed in Phase 1); call `loadConfig()`, instantiate `ClaudeAdapter`, call `adapter.healthCheck()` (exit 1 with clear message if false); call `createServer()` and listen on `127.0.0.1:8080`. `quotagate status` / `quotagate backends` stubs throw `"not implemented in Phase 1"`. Green gate passes. | ~45 min | ⬚ Not started | `../../active/TASK_WS05_T4.md` |

*Status: `✅ Completed` | `🔄 In Progress` | `⬚ Not started` | `❌ Blocked`*

*T1 can start immediately (no dependencies beyond WS_01 types). T2 depends on T1 for the `QuotagateConfig` type. T3 depends on T2 and requires `buildAdapterRequest` / `validate` / `buildChatCompletion` from WS_04 to be present (or stubbed) — coordinate with WS_04. T4 depends on T2 and T3.*

---

## Cross-Task Contracts

### `QuotagateConfig` type (owned by T1 → consumed by T2, T3, T4, WS_08)
Defined in `src/config.ts`. Shape:
```typescript
interface QuotagateConfig {
  models: Record<string, { backend: string }>;
  retry: { max_attempts: number };
  mcp?: Record<string, unknown>; // Phase 2 keys — present but not read in Phase 1
}
```
`proxy.ts` reads `config.models` for inline alias resolution. `ClaudeAdapter` does not consume config directly in Phase 1 — the adapter is wired at the `index.ts` level. WS_08's `router.ts` will read `config.models`; the shape must not change without a Decision Log entry.

### `createServer(config, adapter)` factory signature (owned by T2/T3 → consumed by T4, WS_06)
Defined in `src/proxy.ts`. Signature:
```typescript
function createServer(config: QuotagateConfig, adapter: CLIAdapter): FastifyInstance
```
`index.ts` calls this to boot the server. WS_06's integration test also calls it with a real adapter and a real config. The factory takes the adapter as a parameter (dependency injection) so tests can pass a stub adapter — this is the seam WS_05-T3 uses for the stub-adapter unit test.

### `setErrorHandler` mapping (owned by T2 → consumed by T3, T4, WS_06)
The error handler is registered in T2 and applies to all routes registered in T3. T3 must throw typed `QuotagateError` subclasses, not manually set reply status codes. The error body shape is:
```json
{ "error": { "message": "...", "type": "...", "code": "..." } }
```
This shape is what WS_06's integration test asserts when an error path is triggered. Do not change the error body structure without updating WS_06.

### `loadConfig` (owned by T1 → consumed by T4, WS_06)
`index.ts` calls `loadConfig()` with no argument to read from the default `config.yaml` path. WS_06's integration test may call `loadConfig("tests/fixtures/config.minimal.yaml")` with a test fixture. The function must accept an optional path override.

---

## Success & Evaluation Criteria

- **Functional requirements**:
  - [ ] `loadConfig` parses a valid `config.yaml` fixture into a typed `QuotagateConfig` with zero Zod errors.
  - [ ] `loadConfig` throws a descriptive `QuotagateError` on a config with missing `models` field.
  - [ ] `POST /v1/chat/completions` with `stream: true` returns HTTP 400 with `error.type === "invalid_request_error"`.
  - [ ] `POST /v1/chat/completions` with an unknown model alias returns HTTP 400.
  - [ ] `POST /v1/chat/completions` with a malformed body (non-JSON or missing `messages`) returns HTTP 400.
  - [ ] A successful request through a stub adapter returns HTTP 200 with `finish_reason: "stop"` and a `chatcmpl-` id.
  - [ ] `TransportError` from the adapter returns HTTP 500 with an OpenAI-format error body and no stack trace in the response body.
  - [ ] Server binds to `127.0.0.1:8080`, not `0.0.0.0`.
  - [ ] `quotagate start` exits with code 1 and a human-readable message if `healthCheck()` returns false.

- **Named tests that prove this workstream done**:
  - [ ] `tests/config.test.ts` — valid fixture parses; missing `models` throws; unknown fields stripped; defaults applied.
  - [ ] `tests/proxy.test.ts` — `stream: true` → 400; unknown model → 400; malformed body → 400; stub-adapter success path → 200 with valid completion shape; `TransportError` → 500 OpenAI-format error; no stack trace in error body.

- **Quality gates**:
  - [ ] `npm test` green; no test-count regression from WS_04 baseline
  - [ ] `npm run typecheck` clean
  - [ ] `npm run lint` clean; `npm run format` produces no diff
  - [ ] Coverage: `config.ts` Zod validation branches at 100%; `proxy.ts` error-mapping branches fully covered by the stub-adapter unit tests

---

## Known Pitfalls & Implementation Notes

**Fastify v5 `inject` for unit testing routes**: Fastify's `inject()` method fires a synthetic HTTP request without binding a port. Use it in `tests/proxy.test.ts` to test routes without a real network socket. The pattern is `await server.inject({ method: "POST", url: "/v1/chat/completions", payload: {...} })`. This avoids port conflicts in the test runner and is the correct Fastify unit-test pattern.

**Fastify v5 `setErrorHandler` and typed errors**: In Fastify v5, `setErrorHandler` receives the error, request, and reply. The handler must call `reply.send(body)` — returning a value is not sufficient. Check whether Fastify v5 has changed this from v4 before implementing.

**`createServer` factory vs top-level instance**: Do not create the Fastify instance at module load time. Use a factory function (`createServer`) so that multiple test runs can create isolated instances without port conflicts. This is the standard Fastify testing pattern and is required for WS_06 to start and stop the server cleanly within the Vitest test lifecycle.

**Zod body parsing in Fastify v5**: Fastify's built-in JSON schema validation uses `fast-json-stringify` / `ajv`, not Zod. To use Zod, parse `request.body` manually inside the route handler: `const parsed = OpenAIChatRequestSchema.safeParse(request.body)`. If `!parsed.success`, return the 400 immediately. Do not wire Zod as a Fastify validator plugin in Phase 1 — it is unnecessary complexity.

**`config.yaml` default path**: The default path for `loadConfig()` should be `process.cwd() + "/config.yaml"` — consistent with running `quotagate start` from the project root. Do not hardcode an absolute path. The test fixture override (optional `path` parameter) is the escape hatch for tests.

**`index.ts` CLI argument parsing**: In Phase 1, with only one real subcommand (`start`) and two stubs, a full CLI framework (yargs, commander) is premature. `process.argv[2] === "start"` is sufficient. Record this as an explicit deferment in WS_05 — Phase 4's CLI work will introduce a proper argument parser when `status`, `backends`, and config flags arrive.

**Health-check exit behavior**: `quotagate start` must print a human-readable error and exit with code 1 if `healthCheck()` returns false — not throw an unhandled exception. The developer reading the terminal output should immediately understand what is wrong ("Claude CLI is not installed or not authenticated. Run `claude whoami` to verify."). Do not print a stack trace.

**`mcp` config keys**: The `QuotagateConfig.mcp` field accepts `unknown` values and is not read in Phase 1. Define it in the Zod schema as `z.record(z.unknown()).optional()` so that a config file with MCP keys does not fail validation when a developer is testing with a Phase 2 config. Phase 2 will narrow this schema to the actual MCP fields.
