# Phase 1B: OpenAI Translation Pipeline

> A phase scopes ~1 week of work to a coherent goal. It sets goals, records phase-level architecture
> decisions, and maps to a set of workstreams. Keep it goal-level — the detail lives in the
> workstreams it points to.

## Phase Overview

- **Objective**: Wrap the proven Claude **subprocess** adapter from Phase 1A in the
  request-to-response translation machinery and expose it over HTTP — for the simple no-tools
  text-completion path only. By the end of this phase, an OpenAI SDK client pointed at
  `http://localhost:8080/v1` with `api_key="quotagate"` receives a structurally correct
  `chat.completion` response (finish_reason `"stop"`) for a no-tools request. The transport
  (`claude --print`) and constraint (Mechanism A prompt-engineering, owned by the adapter) are
  already settled in 1A; this phase is entirely about the translation pipeline and the HTTP boundary.
- **Target Timeline**: ~1 week (WS_04 → WS_06)
- **Status**: ✅ **Completed** (Phase 1 closed, 2026-08-24 — WS_09 T4 sign-off)
- **Depends on**: [Phase 1A — Claude Subprocess Adapter & Constraint](./01a_transport_and_constraint.md)
  (WS_03 signed off; `adapter.complete()` proven against the real subscription; `AdapterResponse`
  contract established)

---

## Goals

### Proxy / Server

- [ ] `src/proxy.ts` — Fastify v5 server, `POST /v1/chat/completions`. Parses the incoming OpenAI
      request body with Zod (messages, model, tools, tool_choice, stream). Returns an OpenAI-shaped
      `chat.completion` object on success; maps `QuotagateError` subclasses to appropriate HTTP error
      responses (never raw stack traces — CLAUDE.md error-handling convention). Bound to
      `localhost:8080` only.
- [ ] `src/config.ts` — loads `config.yaml` (model aliases, retry settings per spec §3.9). Provides
      a typed, Zod-validated config object consumed by the proxy and adapter. (MCP-specific config keys
      from spec §3.9 are Phase 2.)
- [ ] `src/index.ts` — flesh out the no-op stub from Phase 1A WS_01 (D-1A-06): `quotagate start`
      boots the Fastify server and runs the adapter `healthCheck()` (confirms `claude` is installed +
      authenticated) before listening. **No installer step in Phase 1** — installer (MCP registration)
      is Phase 2. `quotagate status` / `quotagate backends` are stubs (full CLI is Phase 4).

### Adapters / Transport

- [ ] `src/argumentBuilder.ts` — serializes an OpenAI-format request (messages, optional tools,
      tool_choice) into the adapter's `AdapterRequest` shape (spec §3.3; data flow §4.2 steps 2–4).
      Pure function: `(request) => AdapterRequest`. **It does not inject the constraint** — the
      constraint prompt is owned by the adapter's `build_constrained_prompt` (1A, Mechanism A).
      argumentBuilder stays a clean OpenAI→AdapterRequest mapping (separation of concerns).
- [ ] `src/responseBuilder.ts` — converts an `AdapterResponse` (`type:"text"` branch only this
      phase) into a well-formed OpenAI `chat.completion`: deterministic `id` (`chatcmpl-<uuid>`),
      `finish_reason:"stop"`, `choices[0].message` with `role:"assistant"` + content (spec §4.2 steps 7–8).
- [ ] `src/validator.ts` — JSON parse + Zod validation of the raw string returned by
      `adapter.complete()`. Handles the `{type:"text"}` branch this phase. Retry loop **scaffolded**
      (attempt counter, re-invoke, max 3) but its full exercise — including retry-path isolation — is
      Phase 1C.

### Constraint Mechanism (prompt-engineering / Mechanism A)

- [ ] No new constraint code this phase — the constraint landed in 1A (`build_constrained_prompt`
      inside the adapter). This phase's constraint goal is **separation verification**: confirm the
      translation layer (`argumentBuilder` → adapter → `validator` → `responseBuilder`) does not itself
      inject, duplicate, or interfere with the adapter-owned constraint.
- [ ] **Separation-of-concerns test**: a unit test asserts that `argumentBuilder.ts` produces an
      `AdapterRequest` whose `messages` are exactly the caller's messages — no constraint text added at
      the translation layer. (The constraint lives one layer down, in the adapter's prompt builder; the
      translation layer must remain constraint-free so the two concerns don't drift.)

> Note on invariant #7: the spec's "zero prompt engineering in the hot path" property is a feature
> of the **MCP/Mechanism B** transport (Phase 2), where the constraint is structural (tool
> definition). In the Phase 1 subprocess MVP the constraint _is_ a per-request prompt (Mechanism A),
> by design — so it lives in the adapter, deliberately, not in the translation layer. See 1A D-SEQ-01.

### Testing & Quality

- [ ] Green gate maintained throughout: `npm test` · `typecheck` · `lint` · `format` all clean.
- [ ] Unit tests: `argumentBuilder.ts` (OpenAI request → `AdapterRequest`; messages passed through
      unmodified); `responseBuilder.ts` (`{type:"text"}` → valid OpenAI completion — assert `id` format,
      `finish_reason:"stop"`, `choices[0]` shape); `validator.ts` (Zod fixtures: valid text, malformed
      JSON, wrong type field, missing content).
- [ ] Integration test (no-tools end-to-end): OpenAI SDK (`openai` npm package) at
      `http://localhost:8080/v1`, `api_key="quotagate"`, calls `client.chat.completions.create()` with a
      simple user message; assert a valid `ChatCompletion` with `finish_reason:"stop"` and non-empty
      `choices[0].message.content`. No mocking — hits the real Claude subscription via `claude --print`.
- [ ] `config.ts` unit test: Zod validation rejects a config with missing required fields; passes a minimal valid fixture.

---

## Architecture & Design Decisions

### D-1B-01 — Pipeline Is Transport-Agnostic; It Sits on the 1A Subprocess Adapter

- **Problem**: 1B's HTTP pipeline wraps the adapter. The transport (`claude --print` subprocess,
  proven in 1A) lives entirely inside `adapters/claude.ts`. The pipeline must not couple to it.
- **Selected Approach**: `argumentBuilder` / `validator` / `responseBuilder` operate only on
  `AdapterRequest` / `AdapterResponse` — never on raw transport output. This keeps the pipeline
  identical regardless of transport, so the Phase 2 MCP upgrade swaps the adapter internals without
  touching the translation layer.
- **Rejected Alternative — bake subprocess specifics into the pipeline**: Rejected — it would force
  a pipeline rewrite when MCP lands in Phase 2; the adapter interface already abstracts transport.

### D-1B-02 — `validator.ts` Retry Loop Scaffolded but Not Fully Exercised in 1B

- **Problem**: The retry loop (spec §4.5) is a correctness requirement, but fully exercising it
  needs a forced malformed response, and the retry-path isolation proof belongs with 1C's acceptance.
- **Selected Approach**: In 1B, the retry logic is written and unit-tested against synthetic
  malformed-response fixtures (loop increment, re-invoke, max-attempt termination, in isolation).
  The live forced-retry path is 1C.
- **Rejected Alternative — defer all of `validator.ts` to 1C**: Rejected — the validator sits in the
  hot path of the no-tools integration test (a well-formed response still passes through it).

### D-1B-03 — `router.ts` Not Built in 1B; Single-Adapter Inline Resolution Suffices

- **Problem**: The full router (spec §3.3 — alias registry, health checks, fallback) is premature
  with one adapter.
- **Selected Approach**: In `proxy.ts`, resolve the model alias with a minimal inline check against
  `config.ts`: known Claude alias → Claude adapter; otherwise HTTP 400 "model not supported". No
  `router.ts` file yet. (1C introduces `router.ts` for single-backend resolution; full multi-backend
  router is Phase 2.)
- **Rejected Alternative — build `router.ts` now**: Rejected on anti-overengineering grounds — a
  router that only ever resolves to one adapter is dead abstraction.

### D-1B-04 — No Streaming in 1B; `stream: true` Returns HTTP 400

- **Problem**: Clients may pass `stream: true`. Silently returning a non-streaming response would
  cause a client-side parse error.
- **Selected Approach**: `proxy.ts` checks for `stream: true` and returns HTTP 400 with
  `{"error":{"message":"Streaming is not supported in this version of Quotagate.","type":"invalid_request_error"}}`.
  Fastify's SSE support (the reason it was chosen) is wired in Phase 3.
- **Rejected Alternative — silently ignore `stream: true`**: Rejected — SDK clients expecting a
  stream will fail to parse a non-streaming body.

---

## Assumptions This Phase Rests On

| Assumption                                                                                                                                         | Risk if false                                                                  | De-risked by                                                                                                                      | Status |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Phase 1A WS_03 is signed off: `adapter.complete()` returns a Zod-validated `AdapterResponse` for a no-tools text completion via `claude --print`   | 1B cannot start; 1A must complete first                                        | Phase 1A sign-off gate (WS_03 ✅)                                                                                                 | ⬚      |
| The `claude --print` subprocess transport proven in 1A is stable for the duration of 1B                                                            | Integration test fails intermittently, slowing sign-off                        | `adapter.complete()` uses the same path proven in 1A; transport stability is inherited                                            | ⬚      |
| The `AdapterResponse` contract (type field, content/arguments shape, Zod schema in `src/types.ts`) from 1A is stable through 1B                    | `responseBuilder.ts` / `validator.ts` break if the shape changes               | `src/types.ts` locked at 1A WS_01; changes are a breaking contract revision, flagged in the Decision Log                          | ⬚      |
| The OpenAI `chat.completions.create()` response shape for a no-tools completion matches the `chat.completion` object built by `responseBuilder.ts` | The SDK client rejects the response; integration test fails                    | `responseBuilder.ts` unit tests validate against the `openai` package's TypeScript types, not just a hand-rolled fixture          | ⬚      |
| Fastify v5 (locked in 1A D-1A-05) bootstraps a minimal `POST /v1/chat/completions` route with Zod body parsing on the ESM / Node 20 setup          | Server fails to start; revisiting D-1A-05 needed with documented justification | WS_05 first task: a minimal `POST` handler returning 200 before building the full route; v5 already declared in 1A `package.json` | ⬚      |
| `config.yaml` model-alias structure (spec §3.9) supports single-adapter inline resolution without a full router                                    | Alias resolution is more complex than a map lookup                             | The config schema is simple (model name → backend string); a `Map` lookup is correct                                              | ⬚      |

---

## Out of Scope (anti-overengineering fence)

- **Tool-calling path (`{type:"tool_call"}` branch)** — Phase 1C. `responseBuilder.ts` /
  `validator.ts` handle `{type:"text"}` only this phase.
- **Validator retry loop live exercise** — Phase 1C. The loop is written and unit-tested against
  synthetic fixtures in 1B; a live forced retry and the retry-path isolation check are 1C.
- **`router.ts` as a standalone file** — Phase 1C (single-backend resolution) and Phase 2 (full router).
- **All MCP work** — Phase 2 (head): tool server, Mechanism B constraint, installer, MCP client,
  `_mcp_lock`. In Phase 1 the adapter speaks `claude --print` only (D-SEQ-01).
- **SSE streaming** — Phase 3. `stream: true` returns HTTP 400 in 1B.
- **`quotagate status` / `quotagate backends` CLI commands** — Phase 4. Stubs only.
- **Gemini CLI and Codex CLI adapters** — Phase 2.
- **Concurrency control** — not needed: each `claude --print` request is an isolated process, so
  concurrent requests are naturally safe. Any concurrency cap / pooling is Phase 2+.
- **Marketplace** — spec §7; not built.
- **`config.yaml` hot-reload** — Phase 4. Config is loaded once at startup.
- **Health-check endpoint (`GET /health`)** — Phase 4. The proxy either starts or it does not.

---

## Workstreams Mapping

| Workstream ID | Workstream Name                                | Timeframe | Status        | Plan Link                                                                           |
| ------------- | ---------------------------------------------- | --------- | ------------- | ----------------------------------------------------------------------------------- |
| WS_04         | Argument Builder, Validator & Response Builder | ~2 days   | ⬚ Not started | [ws04_translation_pipeline.md](../workstreams/ws04_translation_pipeline.md)         |
| WS_05         | Fastify Proxy & Config                         | ~2 days   | ⬚ Not started | [ws05_fastify_proxy_and_config.md](../workstreams/ws05_fastify_proxy_and_config.md) |
| WS_06         | No-Tools End-to-End Integration Test           | ~1 day    | ⬚ Not started | [ws06_e2e_no_tools.md](../workstreams/ws06_e2e_no_tools.md)                         |

**Dependency ordering within 1B:**
WS_04 and WS_05 can overlap (different files; both depend only on `src/types.ts` from 1A WS_01, not
on each other). WS_06 depends on both being signed off — it is the integration proof, not a
development workstream.

**Dependency on 1C:** Phase 1C (WS_07–WS_09) requires WS_06 passing (the no-tools path must be green
before adding the tool-call branch and robustness on top).

_Status: `✅ Completed` | `🔄 In Progress` | `⬚ Not started` | `❌ Blocked`_

---

## Success Criteria (phase-level)

- [ ] An OpenAI SDK script (`openai` npm package, `baseURL:"http://localhost:8080/v1"`,
      `apiKey:"quotagate"`) calls `client.chat.completions.create({ model:"claude-sonnet-4-6",
messages:[{role:"user", content:"Hello"}] })` and receives a response where:
  - `response.choices[0].finish_reason === "stop"`
  - `response.choices[0].message.role === "assistant"`
  - `response.choices[0].message.content` is a non-empty string
  - `response.id` matches the `chatcmpl-` prefix format
- [ ] `proxy.ts` rejects `stream: true` with HTTP 400 and a parseable OpenAI-format error body.
- [ ] `proxy.ts` rejects an unknown model alias with HTTP 400.
- [ ] `argumentBuilder.ts` adds no constraint text at the translation layer — the `messages` it
      passes to the adapter are exactly the caller's messages (separation-of-concerns test; the
      constraint is owned by the adapter's `build_constrained_prompt`).
- [ ] Green gate: `npm test` green · `npm run typecheck` clean · `npm run lint` clean · `npm run format` no diff.

---

## Future Enhancements & Roadmap

- **Next Phase**: [Phase 1C — Tool Calling & Acceptance](./01c_tool_calling_and_acceptance.md)
- **Previous Phase**: [Phase 1A — Claude Subprocess Adapter & Constraint](./01a_transport_and_constraint.md)
- **Deferred features**: Tracked in `../workstreams/deferments.md`
