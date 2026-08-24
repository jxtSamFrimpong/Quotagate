# Workstream WS_05: Fastify Proxy & Config

> A workstream scopes ~1 day of work and is more detailed than its parent phase: concrete goals +
> deliverables, locked decisions (with rejected alternatives), a task breakdown, cross-task
> contracts, and success/quality gates. It is the bridge from phase goals to hour-sized tasks.

## Workstream Overview

- **Parent Phase**: [Phase 1B — OpenAI Translation Pipeline](../phases/01b_openai_translation_pipeline.md)
- **Timeframe**: ~2 days
- **Status**: ✅ **Completed** (Phase 1 closed, 2026-08-24 — WS_09 T4 sign-off)
- **Dependencies**: WS_03 signed off — `CLIAdapter`, `ClaudeAdapter`, `AdapterResponse`, and the
  green gate must be in place. WS_04 must also be signed off before T3 is implemented (T3 wires
  `buildAdapterRequest`, `validateWithRetry`, and `buildChatCompletion` — all live in WS_04's
  output). WS_05-T1 and T2 may proceed in parallel with WS_04 since they touch different files and
  depend only on the `AdapterRequest`/`AdapterResponse` type contracts from WS_01; T3 and T4 are
  blocked until WS_04 is signed off.

> **Note on dependency correction:** The original plan stated WS_05 does not depend on WS_04 being
> complete. That is true for T1 and T2. It is FALSE for T3, which must wire `validateWithRetry` and
> `buildAdapterRequest` — both are WS_04 deliverables. T3 must not stub those; it must wire the
> real signatures. This is now reflected in the task table and T3 tracker.

---

## Resolved Decisions (elevation → locked 2026-06-11)

The three open decisions raised during elevation, plus the derived first-run decision, are resolved
and recorded as dated blocks **WS_05-D5…D8** in the Locked Decisions section below (each with choice,
rationale, and rejected alternatives). Summary:

- **OD-1 → `yaml` package** → **WS_05-D5**. Runtime dep for `config.ts`; `import { parse } from "yaml"`.
- **OD-2 → `~/.quotagate/config.yaml`** → **WS_05-D6**. Default config path, co-located with
  Quotagate's runtime home (invariant #9) — chosen over the elevation's `process.cwd()` recommendation.
- **OD-3 → include `priority?: number`** → **WS_05-D7**. `QuotagateConfig.models` matches spec §3.9.
- **DD-1 → fail loud, no auto-write** → **WS_05-D8**. Derived from OD-2: when `~/.quotagate/config.yaml`
  is absent, `quotagate start` errors with create-it guidance and exits 1; Quotagate writes nothing.

---

## Goals & Deliverables

- **Goal 1**: A Zod-validated config loader that types the `config.yaml` model-alias map and retry settings.
  - Deliverable: `src/config.ts` — `loadConfig(path?: string): QuotagateConfig`. Reads `config.yaml` from a
    default path (or the supplied override); validates with a Zod schema covering `models` (alias →
    `{backend: string, priority?: number}` — per WS_05-D7), `retry.max_attempts` (number), and an MCP stub
    key that must not fail validation when present. Typed `QuotagateConfig` exported for use by proxy
    and router. Throws a descriptive `QuotagateError` (not a raw Zod or fs error) on missing required
    fields or file-not-found. Unit tests: valid minimal fixture parses; missing `models` throws; extra
    unknown fields stripped; `retry` defaults applied; MCP keys present in fixture do not fail
    validation. MCP-specific config keys (spec §3.9) are present in the schema but not read in Phase 1.

- **Goal 2**: A Fastify v5 HTTP server exposing `POST /v1/chat/completions` with full request
  validation, inline single-adapter alias resolution, and `QuotagateError`-to-HTTP mapping.
  - Deliverable: `src/proxy.ts` — `createServer(config: QuotagateConfig, adapter: CLIAdapter): FastifyInstance`.
    Single route: `POST /v1/chat/completions`. Behavior:
    - Parses request body with Zod using `OpenAIChatRequestSchema` imported from `src/types.ts` (OD-3
      from WS_04 — the schema is already implemented; do not re-define it).
    - Rejects `stream: true` → HTTP 400, OpenAI-format error body (WS_05-D2).
    - Resolves model alias via an inline lookup against `config.models`; unknown alias → HTTP 400 (WS_05-D3).
    - Calls `buildAdapterRequest` → `adapter.complete()` → `validateWithRetry(raw, messages, invoker)`
      → `buildChatCompletion()` → `reply.send()`. (Wires `validateWithRetry`, not `parseAndValidate`
      directly — see "Validator wiring" section below.)
    - Maps `QuotagateError` subclasses to HTTP status codes via `setErrorHandler` — never raw stack
      traces (WS_05-D4). Individual route handlers throw typed errors; they do not set status codes.
    - Created via a factory function (`createServer`) so tests can construct isolated instances.
    - Bound to `127.0.0.1` only (no `0.0.0.0`).

- **Goal 3**: A fleshed-out `src/index.ts` CLI entrypoint that boots Fastify and runs `healthCheck()` before listening.
  - Deliverable: `src/index.ts` — `quotagate start` subcommand: calls `loadConfig()`, instantiates
    `ClaudeAdapter`, calls `adapter.healthCheck()` (exits with code 1 and a clear error message if
    false), then calls `createServer()` and listens on `127.0.0.1:8080`. No installer step in Phase 1
    (D-SEQ-01). `quotagate status` and `quotagate backends` remain stubs (Phase 4 per out-of-scope fence
    in 1B). Log line on ready: `"Quotagate running on localhost:8080. Backend: claude"`.

---

## Why This Workstream Matters

`proxy.ts` is the HTTP boundary — the single point where malformed requests are rejected, where
`QuotagateError` is translated to HTTP, and where the `stream: true` guard prevents a class of
silent client-side failures. Getting this right in WS_05 means WS_06's integration test is a clean
end-to-end proof, not a debugging session that is half about HTTP edge cases.

`config.ts` establishes the first point where the system can be misconfigured at startup rather
than at runtime. A Zod-validated config loader that rejects bad configs at boot is the simplest
form of the "fail fast, fail loud" principle — it is far cheaper to get a clear error on
`quotagate start` than a cryptic runtime failure on the first request.

`index.ts`'s health-check-before-listen gate specifically prevents Quotagate from appearing to
start successfully while the adapter is unusable. Without it, a developer with an expired Claude
subscription would see the server start fine, then get a confusing `TransportError` on their first
request with no pointer toward the actual problem.

WS_04 and WS_05 can partially overlap (T1 and T2 touch different files from WS_04). WS_05-T3 and
T4 require WS_04 to be signed off. WS_06 depends on both being fully signed off.

---

## Validator Wiring — Critical Implementation Detail

The WS_05 plan previously called `validate()` in the pipeline. WS_04 OD-5 split this into two
distinct exports from `src/validator.ts`:

- `parseAndValidate(raw: string): QuotagateCompleteResult` — pure, synchronous, no adapter
  knowledge. Suitable for testing the parse/validate path in isolation.
- `validateWithRetry(raw: string, messages: OpenAIMessage[], invoker: (messages: OpenAIMessage[]) => Promise<AdapterResponse>): Promise<QuotagateCompleteResult>` — the retry orchestrator;
  wraps `parseAndValidate`; calls the invoker on `ValidationError`; max 3 attempts.

**`proxy.ts` must wire `validateWithRetry`, not `parseAndValidate` directly.** The reason: in
production, a malformed first response must trigger the retry loop, not fail the request
immediately. The `invoker` callback that `proxy.ts` passes is:

```typescript
(msgs: OpenAIMessage[]) =>
  adapter.complete(buildAdapterRequest({ ...body, messages: msgs }))
```

This is the Phase 2 seam: when the MCP transport arrives, the MCP adapter implements the same
`CLIAdapter.complete()` interface, and the invoker callback does not change. The seam is clean
because the invoker is a function, not a hard reference to the subprocess.

T3's unit tests must assert both that `validateWithRetry` is called (not `parseAndValidate`) and
that the invoker closure is wired correctly — specifically that on a retry the corrected messages
array is passed to `adapter.complete`, not the original messages.

---

## Locked Decisions

### WS_05-D1 — Fastify v5, ESM, `127.0.0.1:8080` Only ✅ LOCKED (Architect, 2026-06-08)

Inherits **D-1A-05** (Fastify v5 declared in WS_01) from Phase 1A. Confirmed installed: Fastify
5.8.5.

**Decision**: `proxy.ts` uses `import Fastify from "fastify"` (ESM, v5). The server is created with
`{ logger: true }` for structured logs. `listen` is called with `{ port: 8080, host: "127.0.0.1" }` —
never `0.0.0.0`. The port is not configurable in Phase 1 (config key reserved for Phase 4).

**Rationale**: Fastify v5 is native ESM and TypeScript-first. Binding to `127.0.0.1` enforces the
localhost-only constraint from CLAUDE.md and the spec — the proxy is a local developer tool, not a
networked service. Exposing it on `0.0.0.0` in Phase 1 would create a premature security surface
with no access-control layer.

**Rejected alternative — `0.0.0.0` with a config flag**: Deferred to Phase 4. In Phase 1 there is
no access-control layer, so `0.0.0.0` would expose the proxy to the local network with no
authentication. The Phase 1 threat model is a single developer on a local machine.

---

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

The response header is `Content-Type: application/json`. The error is thrown from the route
handler as a typed error and mapped by `setErrorHandler`, or returned directly with
`reply.status(400).send(...)` before throwing — the implementer must pick the pattern that keeps
the streaming guard consistent with the general error-mapping structure (see T2 tracker for the
deliberate choice to make this decision at implementation time with documented justification).

**Rationale**: Silently ignoring `stream: true` and returning a non-streaming body causes the
OpenAI SDK to attempt to parse a JSON object as an SSE stream, producing an opaque client-side
error. An explicit HTTP 400 with a readable message tells the developer exactly what happened.
Phase 3 wires SSE properly.

**Rejected alternative — silently ignore `stream: true` and return a non-streaming body**: SDK
clients expecting an SSE stream will fail to parse a JSON object. The error surface is the client,
not the proxy, and the message will be unhelpful.

---

### WS_05-D3 — Inline Model-Alias Resolution in `proxy.ts` for Phase 1B; `router.ts` Is Phase 1C ✅ LOCKED (Architect, 2026-06-08)

Inherits **D-1B-03** from the parent phase plan.

**Decision**: In `proxy.ts`, model alias resolution is a single inline check: look up `request.model`
in `config.models`; if found and `backend === "claude"`, use the injected `CLIAdapter`; otherwise
return HTTP 400 with `{ "error": { "message": "Model not supported", "type": "invalid_request_error",
"code": "model_not_supported" } }`. No `router.ts` file is created in WS_05.

**Rationale**: A router that only ever resolves to one adapter is dead abstraction. The inline lookup
is three lines. The full `router.ts` (WS_08, Phase 1C) is motivated by the existence of a clean seam
to test — `resolve(alias) → CLIAdapter | null` — which only becomes meaningful when the routing
decision is non-trivial.

**Rejected alternative — introduce `router.ts` in WS_05**: Anti-overengineering. The router has no
value until the Phase 2 Gemini/Codex adapters exist.

---

### WS_05-D4 — `QuotagateError` Subclass → HTTP Status Code Mapping Is Exhaustive and Centralized in `proxy.ts` ✅ LOCKED (Architect, 2026-06-08)

**Decision**: `proxy.ts`'s `setErrorHandler` contains the definitive mapping from `QuotagateError`
subclasses to HTTP status codes. The mapping is exhaustive for the errors currently defined in
`src/errors.ts`:

- `ValidationError` (retry exhausted after max 3 attempts, WS_04 OD-5) → HTTP 500, OpenAI-format
  error body, no stack trace.
- `TransportError` (subprocess failed: spawn error, non-zero exit with empty stdout) → HTTP 500,
  same shape.
- `QuotagateError` (base, catch-all for any subclass not listed above) → HTTP 500, generic message.
- Unhandled `Error` (unexpected throw not from Quotagate code) → HTTP 500, generic message, no
  stack trace leaked.

**Fastify v5 `setErrorHandler` contract** (confirmed from Fastify 5.8.5 source): The handler
signature is `(error: TError, request: FastifyRequest, reply: FastifyReply) => any | Promise<any>`.
The handler must call `reply.status(code).send(body)` explicitly — returning a value from the
handler is NOT sufficient to send the response (this is unchanged from v4). The handler must set
the status code; it is not derived from the error type automatically.

**Rationale**: CLAUDE.md error-handling convention: "Boundary errors map to OpenAI-shaped error
responses (`proxy.ts`), never raw stack traces to the caller." Centralizing in `setErrorHandler`
means adding a new `QuotagateError` subclass requires one map entry, not changes across route
handlers.

**Rejected alternative — set `reply.status(500)` inline per route handler**: Scatters the mapping;
different handlers may produce inconsistent error shapes; a new subclass requires hunting every handler.

---

### WS_05-D5 — Config Parser: `yaml` Package (OD-1 resolved) ✅ LOCKED (User, 2026-06-11)

**Decision**: Add `yaml` (eemeli/yaml) as a pinned-major **runtime** dependency in `package.json`
`dependencies` (not `devDependencies`). `config.ts` imports `{ parse } from "yaml"` to parse `config.yaml`.

**Rationale**: Pure-JS, zero transitive dependencies, full YAML 1.2, first-class TypeScript types. It
mirrors the deliberate pinned-dependency discipline of WS_04 OD-2 (`openai`), and keeps the config
file human-friendly as spec §3.9 intends.

**Rejected — `js-yaml` + `@types/js-yaml`**: battle-tested but needs a separate `@types` devDep and
offers no material advantage for this use. **Rejected — JSON config (`JSON.parse`, no dep)**: diverges
from spec §3.9 and every doc that references `config.yaml`; the saved dependency does not justify the drift.

---

### WS_05-D6 — Default Config Path: `~/.quotagate/config.yaml` (OD-2 resolved) ✅ LOCKED (User, 2026-06-11)

**Decision**: `loadConfig()` with no argument resolves the default path as
`path.join(os.homedir(), ".quotagate", "config.yaml")`. Use `os.homedir()` — **never** a literal `~`
(Node does not expand tilde) and **never** `process.cwd()`. The optional `path` override is unchanged:
tests pass an explicit fixture path.

**Rationale**: This is the spec's **canonical** config location. Spec §6 (Phase 4 — Developer
Experience), line 798, states "Config at `~/.quotagate/config.yaml`". Adopting it now pulls the spec's
end-state location forward into Phase 1, so the path never has to migrate when the rest of the Phase-4
DX bundle (dashboard, `brew install`) lands — the path alone carries no Phase-4 dependency, so early
adoption is cheap and clean. It also co-locates config with Quotagate's established runtime home
`~/.quotagate/` — the same directory invariant #9 reserves for `~/.quotagate/CLAUDE.md` — giving
Quotagate one machine-stable home for all its artifacts, independent of the launch directory.
**Correction to the elevation analysis**: the elevation recommended `process.cwd()`, a location the
spec never names, and its OD-2 note misattributed the `~/.quotagate/` option to spec §4.1 (§4.1 names
no path). The user's choice is the spec-aligned one; the recommendation was the divergent one. The
01b phase plan is path-agnostic ("loads `config.yaml`", line 33) and scopes only config *hot-reload*
to Phase 4 — so there is no plan conflict.

**Rejected — `process.cwd() + "/config.yaml"` (elevation recommendation)**: the spec never designates
a project-local config path; this also ties config discovery to the launch directory, so `quotagate
start` from a subdirectory would silently miss the config. **Rejected — `import.meta.url`-relative**:
correct for a distributed binary but premature in Phase 1. **Note**: the spec's source-tree sketch
(line 303) shows a project-local `config.yaml`, but that is the code-layout illustration, not the
runtime read-path; line 798 is the authoritative runtime location. **Consequence**: defines the
first-run behavior locked in WS_05-D8.

---

### WS_05-D7 — `QuotagateConfig.models` Includes `priority?: number` (OD-3 resolved) ✅ LOCKED (User, 2026-06-11)

**Decision**: Each model entry's Zod schema is `{ backend: string; priority?: number }`. `priority` is
validated but unread in Phase 1 (inline resolution keys only on `backend === "claude"`); `router.ts`
(Phase 1C/2) consumes it.

**Rationale**: Matches the spec §3.9 fixture (`{ backend: claude, priority: 1 }`); zero schema-migration
friction when routing arrives. Cost is one optional field.

**Rejected — omit until Phase 1C**: a real `config.yaml` carrying `priority` would have the field
silently stripped by Zod `.strip()`, and adding it later is itself a schema change requiring a
Decision-log entry. Including it now is strictly cheaper and spec-aligned.

---

### WS_05-D8 — Absent Config Is Fail-Loud, No Auto-Write (DD-1 resolved) ✅ LOCKED (User, 2026-06-11)

**Decision**: When the default `~/.quotagate/config.yaml` does not exist, `loadConfig` throws a
`QuotagateError` whose message names the resolved path and shows the minimal config to create.
`quotagate start` catches it, prints to stderr, and `process.exit(1)`. Quotagate does **not** create
`~/.quotagate/` or write a default config in Phase 1.

**Rationale**: Honors D-SEQ-01 ("no installer step in Phase 1") and the "fail fast, fail loud" startup
principle — bootstrapping config by writing to disk is installer-class behavior deferred to a later
phase. The error is fully actionable (it shows exactly what to create and where), so the one-time
manual step costs the developer nothing in clarity.

**Rejected — auto-write a default `~/.quotagate/config.yaml` on first run**: smoother first-run UX, but
introduces an installer-class disk write that D-SEQ-01 explicitly defers; doing it now would blur the
Phase-1/Phase-2 scope boundary that the sequencing decision draws.

---

## Task Breakdown

| Task ID | Description                                                                                                                                                                                                                                                                                                                                                                                                | Est. Duration | Status        | Task Tracker Link              |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ------------- | ------------------------------ |
| T1      | Author `src/config.ts`: Zod schema for `QuotagateConfig` (models alias map with `priority?`, retry settings, MCP stubs). `loadConfig(path?)` reads and parses `config.yaml` using `yaml` (WS_05-D5); default path `~/.quotagate/config.yaml` via `os.homedir()` (WS_05-D6). Throws descriptive `QuotagateError` on missing `models`, malformed YAML, or absent file (fail-loud with create-it guidance, WS_05-D8). Unit tests: valid minimal fixture parses; missing `models` throws `QuotagateError`; extra unknown fields stripped; MCP keys in fixture pass validation. | ~1 hour       | ⬚ Not started | `../../active/TASK_WS05_T1.md` |
| T2      | Author `src/proxy.ts` skeleton: Fastify v5 factory (`createServer`), `setErrorHandler` with exhaustive `QuotagateError` mapping (no raw stack traces), `POST /v1/chat/completions` route with `OpenAIChatRequestSchema` body parse and `stream: true` guard. Unit tests: `stream: true` → 400; unknown model → 400; malformed body (missing `messages`) → 400; `ValidationError` thrown in route → 500 OpenAI-format error; unhandled `Error` → 500 no stack trace. | ~1 hour       | ⬚ Not started | `../../active/TASK_WS05_T2.md` |
| T3      | Wire the full request pipeline into `proxy.ts`: inline alias resolution → `buildAdapterRequest` → `adapter.complete()` → `validateWithRetry(raw, messages, invoker)` → `buildChatCompletion()` → `reply.send()`. Invoker closure: `(msgs) => adapter.complete(buildAdapterRequest({ ...body, messages: msgs }))`. Unit tests (Fastify `inject`, stub adapter via `vi.fn()`): success path → 200 with valid `ChatCompletion` shape; `TransportError` from adapter → 500 OpenAI-format error; retry path wired correctly (stub returns malformed then valid). **Depends on WS_04 being signed off.** | ~1 hour       | ⬚ Not started | `../../active/TASK_WS05_T3.md` |
| T4      | Flesh out `src/index.ts`: parse `quotagate start` subcommand with `process.argv[2]` check (no external CLI framework in Phase 1); call `loadConfig()`, instantiate `ClaudeAdapter`, call `adapter.healthCheck()` (exit 1 with clear message if false); call `createServer()` and listen on `127.0.0.1:8080`. `quotagate status` / `quotagate backends` stubs log `"not implemented in Phase 1"` and exit 0. Green gate passes. **Depends on T2 and T3.** | ~45 min       | ⬚ Not started | `../../active/TASK_WS05_T4.md` |

_Status: `✅ Completed` | `🔄 In Progress` | `⬚ Not started` | `❌ Blocked`_

_OD-1/OD-2/OD-3 + DD-1 are resolved (WS_05-D5…D8) — T1 is unblocked and may start immediately. T2
depends on T1 for the `QuotagateConfig` type. T3 depends on T2 AND requires WS_04 to be signed
off (wires `buildAdapterRequest`, `validateWithRetry`, `buildChatCompletion` — all WS_04
deliverables; WS_04 is signed off as of 2026-06-11). T4 depends on T2 and T3._

---

## Cross-Task Contracts

### `QuotagateConfig` type (owned by T1 → consumed by T2, T3, T4, WS_08)

Defined in `src/config.ts`. Shape (OD-3 resolved — `priority?` included, WS_05-D7):

```typescript
interface QuotagateConfig {
  models: Record<string, { backend: string; priority?: number }>;
  retry: { max_attempts: number };
  mcp?: Record<string, unknown>; // Phase 2 keys — present but not read in Phase 1
}
```

`proxy.ts` reads `config.models` for inline alias resolution (only `backend` is examined in Phase 1).
`ClaudeAdapter` does not consume config directly in Phase 1 — the adapter is wired at the `index.ts`
level. WS_08's `router.ts` will read `config.models`; the shape must not change without a Decision
Log entry.

### `createServer(config, adapter)` factory signature (owned by T2/T3 → consumed by T4, WS_06)

Defined in `src/proxy.ts`. Signature:

```typescript
function createServer(
  config: QuotagateConfig,
  adapter: CLIAdapter,
): FastifyInstance;
```

`index.ts` calls this to boot the server. WS_06's integration test also calls it with a real adapter
and a real config. The factory pattern (rather than a top-level singleton) is mandatory: Fastify
instances are not safely reusable across test runs without explicit `close()`, and multiple test
suites create fresh instances. This is the seam WS_05-T3 uses for the stub-adapter unit test.

### `setErrorHandler` mapping (owned by T2 → consumed by T3, T4, WS_06)

The error handler is registered in T2 and applies to all routes registered in T3. T3 must throw
typed `QuotagateError` subclasses (or let them propagate from the pipeline functions), not manually
set reply status codes. The error body shape is:

```json
{ "error": { "message": "...", "type": "...", "code": "..." } }
```

This shape is what WS_06's integration test asserts when an error path is triggered. Do not change
the error body structure without updating WS_06. The `stream: true` guard and unknown-alias guard
in T2 may send their 400 responses directly (via `reply.status(400).send(...)`) rather than
through `setErrorHandler` — this is an implementation-time decision T2 documents in code and is
consistent about (see T2 tracker §Implementation-Time Decision; recommendation: direct send).

### `loadConfig` (owned by T1 → consumed by T4, WS_06)

`index.ts` calls `loadConfig()` with no argument to read from the default `config.yaml` path.
WS_06's integration test calls `loadConfig("tests/fixtures/config.minimal.yaml")` with a test
fixture. The function must accept an optional path override. On file-not-found, it must throw a
`QuotagateError` with the resolved path in the message (not a raw `fs` error).

### `validateWithRetry` invoker closure (owned by T3 → seam for Phase 2)

The invoker passed to `validateWithRetry` in `proxy.ts` is:

```typescript
const invoker = (msgs: OpenAIMessage[]) =>
  adapter.complete(buildAdapterRequest({ ...body, messages: msgs }));
```

This is the transport seam: in Phase 2, the MCP adapter implements the same `CLIAdapter.complete()`
interface, and this closure does not change. T3 must not inline the subprocess-specific behavior
here; the adapter interface owns the transport.

---

## Success & Evaluation Criteria

- **Functional requirements**:
  - [ ] `loadConfig` parses a valid `config.yaml` fixture into a typed `QuotagateConfig` with zero Zod errors.
  - [ ] `loadConfig` throws a `QuotagateError` (not a raw Zod/fs error) on a config with missing `models` field.
  - [ ] `loadConfig` throws a `QuotagateError` with the resolved path in the message on file-not-found.
  - [ ] `POST /v1/chat/completions` with `stream: true` returns HTTP 400 with `error.type === "invalid_request_error"` and `error.code === "streaming_not_supported"`.
  - [ ] `POST /v1/chat/completions` with an unknown model alias returns HTTP 400 with `error.code === "model_not_supported"`.
  - [ ] `POST /v1/chat/completions` with a malformed body (missing `messages`) returns HTTP 400.
  - [ ] A successful request through a stub adapter returns HTTP 200 with `finish_reason: "stop"`, a `chatcmpl-` id, and `choices[0].message.role === "assistant"`.
  - [ ] `TransportError` from the adapter returns HTTP 500 with an OpenAI-format error body and no stack trace in the response body.
  - [ ] `ValidationError` (retry exhausted) returns HTTP 500 with an OpenAI-format error body.
  - [ ] Server binds to `127.0.0.1:8080`, not `0.0.0.0`.
  - [ ] `quotagate start` exits with code 1 and a human-readable message if `healthCheck()` returns false.
  - [ ] `validateWithRetry` is used in the pipeline (not `parseAndValidate` directly); the invoker closure correctly threads the messages array on retry.

- **Named tests that prove this workstream done**:
  - [ ] `tests/config.test.ts` — valid fixture parses; missing `models` throws `QuotagateError`; unknown fields stripped; defaults applied; MCP keys in fixture pass.
  - [ ] `tests/proxy.test.ts` — `stream: true` → 400; unknown model → 400; malformed body → 400; stub-adapter success path → 200 with valid completion shape; `TransportError` → 500 OpenAI-format error; `ValidationError` → 500 OpenAI-format error; no stack trace in error body; retry path wired (stub returning malformed then valid resolves correctly).

- **Quality gates** (56-test baseline from WS_04):
  - [ ] `npm test` green; no test-count regression from 56-test WS_04 baseline
  - [ ] `npm run typecheck` clean
  - [ ] `npm run lint` clean; `npm run format` produces no diff
  - [ ] Coverage: `config.ts` Zod validation branches at 100%; `proxy.ts` error-mapping branches fully covered by stub-adapter unit tests

---

## Known Pitfalls & Implementation Notes

**Fastify v5 `inject` for unit testing routes**: Fastify's `inject()` method fires a synthetic HTTP
request without binding a port. Use it in `tests/proxy.test.ts` to test routes without a real network
socket. The pattern is `await server.inject({ method: "POST", url: "/v1/chat/completions", payload: {...} })`.
This avoids port conflicts in the test runner and is the correct Fastify unit-test pattern.

**Fastify v5 `setErrorHandler` contract**: In Fastify v5 (confirmed: 5.8.5), `setErrorHandler` receives
`(error, request, reply)`. The handler must call `reply.status(code).send(body)` explicitly — returning a
value is NOT sufficient to send the response. The handler must set the status code explicitly (e.g.,
`reply.status(500).send(errorBody)`). This is the same contract as v4 on this point.

**`createServer` factory vs top-level instance**: Do not create the Fastify instance at module load time.
Use a factory function (`createServer`) so that multiple test runs can create isolated instances without
port conflicts and without leftover state. Call `server.close()` in `afterEach`/`afterAll` in tests.

**Zod body parsing in Fastify v5**: Fastify's built-in validation uses `ajv`, not Zod. Parse
`request.body` manually inside the route handler using the already-implemented `OpenAIChatRequestSchema`
from `src/types.ts` (WS_04 OD-3): `const parsed = OpenAIChatRequestSchema.safeParse(request.body)`.
If `!parsed.success`, return HTTP 400 immediately. Do not wire Zod as a Fastify validator plugin.

**`OpenAIChatRequestSchema` is already implemented — do not re-define it**: `src/types.ts` exports
`OpenAIChatRequestSchema` and the inferred `OpenAIChatRequest` type (WS_04 OD-3 LOCKED). T2/T3 must
import from there. Any re-definition is a contract violation.

**`config.yaml` default path** (WS_05-D6): The default path is
`path.join(os.homedir(), ".quotagate", "config.yaml")` — use `os.homedir()`, never a literal `~`
(Node does not expand tilde) and never `process.cwd()`. On absence (the common first-run case, since
`~/.quotagate/` is not created in Phase 1), the `ENOENT` must be caught and re-thrown as a
`QuotagateError` whose message names the resolved path and shows the minimal config to create
(WS_05-D8, fail-loud — no auto-write). A raw `fs.readFileSync` `ENOENT` is not an acceptable public
error surface.

**`index.ts` CLI argument parsing**: In Phase 1, with only one real subcommand (`start`) and two stubs,
a full CLI framework is premature. `process.argv[2] === "start"` is sufficient. This is an explicit
deferment — Phase 4's CLI work introduces a proper argument parser when `status`, `backends`, and
config flags arrive.

**Health-check exit behavior**: `quotagate start` must print a human-readable error and call
`process.exit(1)` if `healthCheck()` returns false — not throw an unhandled exception. The message
should clearly point to the fix: `"Claude CLI is not installed or not authenticated. Run 'claude auth status' to verify."`.

**`mcp` config keys**: Define as `z.record(z.unknown()).optional()` in the Zod schema. A config file
with MCP keys (from a Phase 2 environment) must not fail Phase 1 validation. Phase 2 will narrow this
schema to the actual MCP fields when it reads them.

**`QuotagateError` wrapping for config errors**: `loadConfig` must catch both `fs` errors (file not
found, permission denied) and `ZodError` and re-throw them as `QuotagateError` with a clear, non-leaking
message. The raw Zod path array or node `errno` must not be the user-visible error surface.

**Fastify v5 `{ logger: true }` in tests**: Creating a server with `{ logger: true }` in tests will emit
log lines to stdout during test runs. Either pass `{ logger: false }` in test fixtures, or suppress with
Fastify's logger configuration. Keep the production `createServer` call using `{ logger: true }`.
