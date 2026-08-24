# Phase 1C: Tool Calling & Acceptance

> A phase scopes ~1 week of work to a coherent goal. It sets goals, records phase-level architecture
> decisions, and maps to a set of workstreams. Keep it goal-level — the detail lives in the
> workstreams it points to.

## Phase Overview

- **Objective**: Complete Phase 1 by adding the tool/function-call response path and hardening the
  validator retry loop, then sign off the full Phase-1 acceptance criteria achievable on the
  subprocess transport (spec §6). By the end of this phase the proxy handles both text completions
  and tool-call declarations (never executing them — invariant #1), the retry loop is exercised
  end-to-end, single-backend alias resolution lives in `router.ts`, and all three contamination
  sub-cases (sequential, concurrent, retry-path) pass — satisfied on `claude --print` by
  fresh-process isolation. The green gate is the formal exit condition, and WS_09 sign-off **is** the
  Phase 1 sign-off.
- **Target Timeline**: ~1 week (WS_07 → WS_09)
- **Status**: ✅ **Completed** (Phase 1 closed, 2026-08-24 — WS_09 T4 sign-off)
- **Depends on**: [Phase 1B — OpenAI Translation Pipeline](./01b_openai_translation_pipeline.md)
  (WS_06 signed off; no-tools end-to-end integration test passing; green gate held)

---

## Goals

### Proxy / Server

- [ ] `src/router.ts` — single-backend alias resolution only: reads model aliases from `config.ts`
      and returns the correct adapter. No health checks, no multi-backend fallback (Phase 2). Replaces
      the inline map lookup from 1B. Interface designed so Phase 2 can extend it to multi-backend
      without changing the `proxy.ts` call site.
- [ ] `src/proxy.ts` updated to use `router.ts` instead of the inline lookup from 1B. No other proxy
      changes — routing logic moves to `router.ts`.

### Adapters / Transport

- [ ] No new transport work — the Claude subprocess adapter (`_complete_via_subprocess` +
      `build_constrained_prompt` + `sanitised_env`) was built and proven in Phase 1A, and the same path
      serves both the text and tool-call branches (the model decides which to return). 1C exercises the
      tool-call branch through the existing adapter; it does not add a transport.

### Constraint Mechanism (prompt-engineering / Mechanism A)

- [ ] `src/validator.ts` retry loop fully exercised: a forced-malformed response (test double
      injecting a malformed raw string) causes the loop to re-invoke `adapter.complete()` with a
      correction note appended to messages, up to 3 attempts, then HTTP 500 if all fail. The correction
      note is a formatting instruction only — it carries no prior-turn content.
- [ ] Tool/function-call validation in `src/validator.ts`: Zod parsing of `{type:"tool_call",
name:"...", arguments:{...}}` — `name` is a string, `arguments` is a parseable JSON object, `type`
      is exactly `"tool_call"`. Malformed tool-call shapes hit the same retry logic as malformed text.
- [ ] Tool/function-call response in `src/responseBuilder.ts`: converts `AdapterResponse` with
      `type:"tool_call"` into an OpenAI `chat.completion` with `finish_reason:"tool_calls"`,
      `choices[0].message.content: null`, and a well-formed `tool_calls` array (spec §4.3 steps 5–6).
      **The tool is NEVER executed — invariant #1 is a hard constraint.** `responseBuilder.ts` returns a
      declaration only.

### Testing & Quality

- [ ] Green gate maintained: `npm test` · `typecheck` · `lint` · `format` all clean.
- [ ] **Full contamination test suite — all three sub-cases** (spec §6). The machine-readable proof
      that **invariant #10** ("persist the process, never the conversation — each call runs in a fresh
      context seeded solely by its args") holds. On `claude --print` this is satisfied **by construction**
      (a fresh OS process per request, which exits after one response), but it is asserted as a test so
      the guarantee is enforced and carried into the Phase 2 MCP upgrade — where it must be _re-earned_
      by the `_mcp_lock` (invariant #11):
  - _Sequential_: Call A with a distinctive secret token, call B "what did I just say?". Assert B's
    response contains no trace of the token. (Invariant #10, serial path.)
  - _Concurrent_: Fire A and B in parallel (two simultaneous `client.chat.completions.create()` calls
    via the OpenAI SDK). Assert neither response contains content from the other. On subprocess this
    holds because each request is an isolated process; the test proves request isolation under real
    HTTP-level concurrency — the same property invariant #11 will protect once MCP sessions exist.
  - _Retry-path_: Force a validator retry on call A (inject a malformed first response per D-1C-02),
    then send call B. Assert the correction context did not bleed into B. (On subprocess, A's retry
    re-spawns a fresh process carrying the correction note in _that_ request's prompt only; B gets
    its own fresh process. Invariant #10 on the error path.)
- [ ] Tool-call integration test: OpenAI SDK call with a `tools` array (e.g. `get_weather`) produces
      a response with `finish_reason:"tool_calls"` and a `tool_calls[0]` with the correct function name
      and parseable arguments. Assert the tool was NOT executed (no side-effect; no file read; no network
      call from within the proxy process).
- [ ] Retry-exhaustion test: three consecutive malformed responses (test double) cause `proxy.ts` to
      return HTTP 500 with a descriptive, non-leaking error body (no stack trace, no raw model output).
- [ ] Unit tests for `router.ts`: known model aliases resolve to the Claude adapter; unknown alias
      returns null / triggers the HTTP 400 path.
- [ ] Unit tests for `responseBuilder.ts` tool-call branch: `{type:"tool_call"}` produces the correct
      `tool_calls` array shape; `finish_reason:"tool_calls"`; `content: null`.

---

## Architecture & Design Decisions

### D-1C-01 — `router.ts` Scoped to Single-Backend Alias Resolution; Phase 2 Extends It

- **Problem**: The full router (spec §3.3) includes health checks and multi-backend fallback — both
  Phase 2 concerns. Implementing them now means dead code that cannot be integration-tested until
  the Gemini/Codex adapters exist.
- **Selected Approach**: `router.ts` in 1C is a thin resolver: `resolve(modelAlias) → CLIAdapter |
null`. Reads the config alias map, returns the Claude adapter for any Claude alias, returns `null`
  for unknown aliases (→ HTTP 400 in `proxy.ts`). The signature is designed so Phase 2 can extend it
  to `Promise<CLIAdapter | null>` (async health check) without changing the call site beyond awaiting.
- **Rejected Alternative — build the full health-check/multi-backend router now**: Rejected on
  anti-overengineering grounds — those paths cannot be tested until Phase 2 adapters exist.

### D-1C-02 — Retry Tests Use a Test Double; Retry-Path Isolation Is a Distinct Integration Test

- **Problem**: The retry loop must be exercised on a live path, but reliably forcing a real malformed
  model response is non-deterministic.
- **Selected Approach**: Two distinct tests:
  (a) **Retry logic unit test** — a Vitest `vi.fn()` double wraps `adapter.complete()` at the
  validator boundary; returns a malformed raw string on the first call, a well-formed result on the
  second. Exercises loop increment, re-invoke, and max-attempt termination in isolation from network
  conditions.
  (b) **Retry-path contamination integration test** — confirms that after request A's retry completes
  (correction note appended to A's messages, second call made), an independent request B starts with
  a completely clean context. Runs the full HTTP path (OpenAI SDK → Fastify → adapter → subprocess)
  with a double injecting A's malformed first response, then asserts B's real response has zero
  knowledge of A's correction context. The contamination assertion is what separates it from the
  unit test.
- **Rejected Alternative — simulate by calling `validator.ts` directly with a synthetic bad input
  then calling `adapter.complete()` for B**: Rejected — it skips the full request lifecycle; the
  contamination risk lives in the messages array flowing back through `complete()`, which a
  validator-level test cannot observe.

### D-1C-03 — Execution Suppression Is Asserted via Absence-of-Side-Effect, Not a Spy

- **Problem**: Proving `responseBuilder.ts` "never executes a tool" (invariant #1) needs either a spy
  on an execute function or an absence-of-side-effect assertion. There is no "execute tool" function
  inside Quotagate — the proxy never calls one.
- **Selected Approach**: The tool-call integration test asserts invariant #1 two ways: (a)
  `responseBuilder.ts` returns `finish_reason:"tool_calls"` with the declared function name and no
  execution within the proxy process; (b) the test invokes a call with a side-effecting tool name
  (`write_file`), verifies the response is `{type:"tool_call"}`, and asserts no file was created at
  the path in the arguments. Absence-of-side-effect is the correct contract for invariant #1.
- **Rejected Alternative — mock the tool-execution layer and assert not-called**: Rejected — there is
  no tool-execution layer inside Quotagate to mock; invariant #1 means that code path literally does
  not exist. The test should reflect that reality.

### D-1C-04 — Concurrent Contamination Test Uses Real OpenAI SDK Concurrency

- **Problem**: The concurrent sub-case (spec §6) must prove request isolation under the kind of
  concurrency real OpenAI SDK clients produce, not just `Promise.all` at the adapter level.
- **Selected Approach**: Fire two simultaneous `client.chat.completions.create()` calls from the
  OpenAI SDK against the running Fastify server (test-managed process or Fastify `inject`). Both are
  in flight at the HTTP level; assert neither response contains the other's content. On the
  subprocess transport, isolation holds because each request is a separate OS process — this test
  proves the property end-to-end and is the regression guard that invariant #11 must keep satisfying
  once MCP sessions are introduced in Phase 2.
- **Rejected Alternative — test only at the adapter layer with `Promise.all`**: Rejected — it skips
  the Fastify request-handling layer; the spec frames the test as "fire A and B in parallel as an
  OpenAI SDK client would" (spec §6), and the test must honor that framing.

> **Note — `_mcp_lock` and invariant #11 are not in Phase 1.** There is no shared session on the
> subprocess transport, so there is nothing to serialize and no lock to build. Invariant #11 and the
> `_mcp_lock` become live work in the **Phase 2 MCP upgrade**, where the persistent session
> re-introduces the interleaving risk these contamination tests guard against. (`sanitised_env()` for
> `claude --print` was built in Phase 1A D-1A-07 and is inherited here — it is not a 1C deliverable.)

---

## Assumptions This Phase Rests On

| Assumption                                                                                                                                                                                                                                                 | Risk if false                                                                                          | De-risked by                                                                                                                                                | Status |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Phase 1B WS_06 is signed off: no-tools end-to-end integration test passing; green gate held                                                                                                                                                                | 1C cannot start — the tool-call path builds on a working no-tools path                                 | Phase 1B sign-off gate (WS_06 ✅)                                                                                                                           | ⬚      |
| The model consistently returns `{type:"tool_call", name:"...", arguments:{...}}` when `tools` are present and the request calls for a function — i.e. the prompt-engineering constraint (Mechanism A) is effective for the tool-call branch, not just text | High validator retry rate on the tool-call path; constraint wording must be tuned for tool calls       | Tool-call integration test in WS_07; constraint prompt iterated if retry rate is high (the constraint is Quotagate's own prompt, so it is directly tunable) | ⬚      |
| Each `claude --print` request is an isolated OS process, so concurrent requests cannot share context                                                                                                                                                       | Concurrent contamination test fails — would indicate an unexpected shared-state leak in the spawn path | Concurrent contamination sub-case in WS_09; de-risked early by the sequential probe from 1A                                                                 | ⬚      |
| The retry-path contamination sub-case is testable without a real malformed model response — a malformed raw string can be injected at the `complete()` boundary without breaking the live subprocess call                                                  | Retry-path contamination cannot be tested deterministically; the sub-case must be labeled "manual"     | Test double approach (D-1C-02); the adapter interface supports injection at the `complete()` boundary                                                       | ⬚      |

_Note: the MCP-fallback, `_mcp_lock`, and "make MCP unhealthy" assumptions from the prior MCP-first
draft are removed — there is no MCP in Phase 1 (D-SEQ-01). They move to the Phase 2 MCP-upgrade plan._

---

## Out of Scope (anti-overengineering fence)

- **All MCP work** — Phase 2 (head): persistent `quotagate_complete` tool server, Mechanism B
  constraint (tool definition + `~/.quotagate/CLAUDE.md`), installer + `claude mcp add`, MCP client,
  `_mcp_lock` serialization, MCP-path contamination tests, and the Anthropic-ecosystem feasibility
  investigation. There is no MCP transport — and therefore no MCP→subprocess fallback — in Phase 1.
- **Multi-backend routing (Gemini, Codex adapters)** — Phase 2. `router.ts` resolves Claude aliases only.
- **Health-check loop and `auto` model routing** — Phase 2.
- **SSE streaming** — Phase 3. `stream: true` continues to return HTTP 400.
- **Full marketplace security sandbox** (isolated `--cwd`, full env strip, path-pattern validation on
  response arguments) — spec §7.3; not built. `sanitised_env()` (1A) is the targeted partial mitigation.
- **Structured output / JSON-schema enforcement** — Phase 3.
- **LangChain / LlamaIndex compatibility testing** — Phase 3.
- **`quotagate status` / `quotagate backends` CLI commands** — Phase 4. Stubs from 1B remain.
- **`npm install -g` / `brew` packaging** — Phase 4.
- **Dashboard (backend health, request log, token estimates)** — Phase 4.
- **Concurrency cap / throughput benchmarking** — the isolated-process model is correct for Phase 1;
  any cap or pooling is Phase 2+.

---

## Workstreams Mapping

| Workstream ID | Workstream Name                                        | Timeframe | Status        | Plan Link                                                                             |
| ------------- | ------------------------------------------------------ | --------- | ------------- | ------------------------------------------------------------------------------------- |
| WS_07         | Tool-Call Response Path (Validator + Response Builder) | ~2 days   | ⬚ Not started | [ws07_tool_call_response_path.md](../workstreams/ws07_tool_call_response_path.md)     |
| WS_08         | Validator Retry Loop & Single-Backend Router           | ~2 days   | ⬚ Not started | [ws08_retry_and_router.md](../workstreams/ws08_retry_and_router.md)                   |
| WS_09         | Full Contamination Test Suite & Phase-1 Sign-Off       | ~1 day    | ⬚ Not started | [ws09_contamination_and_signoff.md](../workstreams/ws09_contamination_and_signoff.md) |

**Dependency ordering within 1C:**
WS_07 (tool-call path in validator + responseBuilder) and WS_08 (retry loop + `router.ts`) are
largely independent and can run in parallel or sequentially. WS_09 is a hard dependency on both: it
is the acceptance gate, not a development workstream, and runs only when WS_07 and WS_08 are both
signed off.

**This phase is the Phase-1 exit:** WS_09 sign-off IS the Phase 1 sign-off. Phases 1A, 1B, and 1C are
collectively "Phase 1 — Core Proxy" from the spec (spec §6), delivered on the subprocess transport.
Phase 2 (head: the MCP upgrade; then Multi-Backend and Routing) depends on WS_09 ✅.

_Status: `✅ Completed` | `🔄 In Progress` | `⬚ Not started` | `❌ Blocked`_

---

## Success Criteria (phase-level)

These are the Phase-1 success criteria from the spec (spec §6) achievable on the subprocess
transport, validated here in their entirety. _(The spec's "zero prompt engineering in the hot path"
property is a feature of the MCP/Mechanism B upgrade — Phase 2 — not the subprocess MVP, which uses
per-request prompt-engineering by design; see 1A D-SEQ-01.)_

**Functional — no-tools path (inherited from 1B, re-confirmed in the acceptance run):**

- [ ] OpenAI SDK against `localhost:8080/v1`, `api_key="quotagate"`, no `tools`: response has
      `finish_reason:"stop"`, non-empty `choices[0].message.content`, correct `id` prefix.

**Functional — tool-call path (new in 1C):**

- [ ] OpenAI SDK call with a `tools` array produces `finish_reason:"tool_calls"`, a `tool_calls`
      array with the correct function name and parseable `arguments` JSON, and `content: null`.
- [ ] The declared tool was NOT executed — no side-effect from within the proxy (invariant #1).

**Functional — retry path (new in 1C):**

- [ ] Three consecutive malformed responses (test double) cause the proxy to return HTTP 500 with a
      descriptive non-leaking error body. A single malformed response followed by a good one returns the
      good response.

**Contamination test — all three sub-cases (spec §6; validates invariant #10 "persist process not
conversation"; satisfied on subprocess by fresh-process isolation):**

- [ ] _Sequential_: Call A (distinctive secret token) → Call B ("what did I just say?"). B's response
      contains no trace of the token. (Invariant #10.)
- [ ] _Concurrent_: Two simultaneous OpenAI SDK calls (A and B in parallel). Neither response contains
      the other's content. Request isolation proven under real HTTP-level concurrency. (The property
      invariant #11 will protect once MCP sessions exist in Phase 2.)
- [ ] _Retry-path_: Forced retry on Call A (per D-1C-02 test double) does not bleed correction context
      into Call B. (Invariant #10 on the error path.)

**Green gate (the formal exit condition):**

- [ ] `npm test` green (all Vitest suites pass, no regression in test count).
- [ ] `npm run typecheck` clean (zero TypeScript errors).
- [ ] `npm run lint` clean (zero ESLint violations).
- [ ] `npm run format` produces no diff (Prettier).

---

## Future Enhancements & Roadmap

- **Next Phase**: Phase 2 — **MCP upgrade (head)** then Multi-Backend and Routing. The MCP upgrade
  builds the persistent `quotagate_complete` tool server, Mechanism B constraint, installer +
  `claude mcp add`, MCP client, and `_mcp_lock` (re-earning invariants #10/#11 on the persistent
  session), plus the Anthropic-ecosystem feasibility investigation — then the Gemini CLI and Codex
  CLI adapters and the full `router.ts` with health checks and `auto` routing (spec §6 Phase 2).
- **Previous Phase**: [Phase 1B — OpenAI Translation Pipeline](./01b_openai_translation_pipeline.md)
- **Prior Phase (first in sequence)**: [Phase 1A — Claude Subprocess Adapter & Constraint](./01a_transport_and_constraint.md)
- **Deferred features**: Tracked in `../workstreams/deferments.md`
