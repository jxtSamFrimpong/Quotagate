# Phase 1A: Claude Subprocess Adapter & Constraint

> A phase scopes ~1 week of work to a coherent goal. It sets goals, records phase-level architecture
> decisions, and maps to a set of workstreams. Keep it goal-level — the detail lives in the
> workstreams it points to.

## Phase Overview

- **Objective**: Stand up the Node/TypeScript project and build the **Claude `--print` subprocess
  adapter** with the **prompt-engineering constraint** (spec §3.2 Mechanism A) — the transport and
  constraint already _proven_ by the spec experiments (§5.2/§5.3). By the end of this phase a
  standalone script (no HTTP) calls `adapter.complete({ messages:[...] })` and receives a
  Zod-validated `AdapterResponse` of `type:"text"` from the **real Claude subscription** via
  `claude --print`, with execution suppression re-confirmed and a sequential contamination probe
  passing. This is the walking skeleton on a transport that is known to work — no MCP, no feasibility
  gamble. The MCP upgrade is Phase 2 (see D-SEQ-01).
- **Target Timeline**: ~1 week (WS_01 → WS_03)
- **Status**: Proposed
- **Depends on**: None (first phase; prerequisite for 1B and 1C)

---

## Goals

### Proxy / Server (bootstrap only — no server in 1A)

- [ ] Node/TypeScript project bootstrap: `package.json` (ESM, `"type":"module"`), `tsconfig.json`
      (`strict: true`), ESLint + Prettier config, Vitest config, **Fastify v5 declared as a dependency**
      (D-1A-05; server not started until 1B), and the full `npm run` script table from CLAUDE.md. Must
      reach the green gate (`npm test` · `typecheck` · `lint` · `format`) from the start.
- [ ] `src/errors.ts` — `QuotagateError` base + `TransportError` and `ValidationError` subclasses
      (the minimum the adapter throws). Class hierarchy only; no logic (D-1A-04).
- [ ] `src/index.ts` — no-op entry-point stub so `tsup`/`tsc` have a build target (D-1A-06). Fleshed
      out in 1B.
- [ ] `src/types.ts` — shared types: `AdapterRequest`, `AdapterResponse`, and the Zod schema for
      `QuotagateCompleteResult` (`{type:"text"}` and `{type:"tool_call"}` shapes, spec §3.5). No HTTP.

### Adapters / Transport

- [ ] `src/adapters/base.ts` — the `CLIAdapter` interface: `complete()`, `healthCheck()`,
      `install()` (spec §3.7). Every adapter implements this; adding a backend = one new file (invariant #4).
- [ ] `src/adapters/claude.ts` — the Claude **subprocess** adapter: `_complete_via_subprocess()`
      spawns `claude --print` (stdin = constrained prompt, reads stdout), with `sanitised_env()`
      applied (D-1A-07). `complete()` delegates to the subprocess path — it is the only transport in
      Phase 1. `healthCheck()` verifies `claude` is installed and authenticated. `install()` is a no-op
      stub in Phase 1 (real install — MCP registration — is Phase 2).
- [ ] `src/adapters/claude.ts` — `build_constrained_prompt(messages, tools, tool_choice)`: the
      per-request constraint (spec §3.2 Mechanism A). Serializes the conversation + the constraint
      instructions (return raw JSON only; never execute tools; declare don't act) into the stdin prompt.
      This is the **primary** constraint mechanism for Phase 1 (Mechanism B / MCP is Phase 2).
- [ ] `sanitised_env()` utility: strips ambient machine-context vars (HOME, PWD, OLDPWD,
      filesystem-revealing vars — the spec §5.3 Haiku path-leak class) while preserving the vars
      `claude --print` needs to authenticate against the subscription. The exact allowlist is determined
      empirically in WS_02 (D-1A-07).

### Constraint Mechanism (prompt-engineering / Mechanism A)

- [ ] Re-validate clean-JSON output (spec §5.2) over `claude --print` as driven by Quotagate's own
      `build_constrained_prompt`: the model returns a raw JSON object, no prose, no markdown fences.
      Captured as a passing integration test, not just a manual probe.
- [ ] Re-validate execution suppression (spec §5.3): a request whose `tools` include a
      side-effecting name (e.g. `read_file`) returns `{type:"tool_call", ...}` and the file is **not**
      read. `--print` suppresses the agent execution loop — confirm it holds via Quotagate's prompt.
- [ ] Sequential contamination probe: two sequential `complete()` calls (A with a distinctive token,
      B asking about it); assert B has zero knowledge of A. On the subprocess transport this passes
      **by construction** (fresh process per request, exits after one response — invariants #10/#11 are
      satisfied with no machinery), but it is asserted as a test so 1B/1C inherit the guarantee.

### Testing & Quality

- [ ] Green gate from day one: `npm test` · `typecheck` · `lint` · `format` clean; no test-count regression.
- [ ] Unit tests: `src/types.ts` (Zod parses valid/invalid `QuotagateCompleteResult` fixtures);
      `build_constrained_prompt` (constraint text present; messages serialized faithfully);
      `sanitised_env` (machine-context vars stripped; auth vars preserved).
- [ ] Integration test: `adapter.complete({ messages:[{role:"user",content:"Hello"}] })` returns a
      Zod-validated `AdapterResponse` with `type:"text"` and non-empty content, against the real Claude
      subscription via `claude --print`.
- [ ] Contamination probe test (sequential sub-case) and execution-suppression test, both passing.

---

## Architecture & Design Decisions

### D-SEQ-01 — Subprocess-First MVP; MCP Upgrade Is the Head of Phase 2 ✅ DECIDED (user)

- **Problem**: The spec's DECIDED architecture (§3.1) makes the persistent **MCP server** the
  primary transport and `--print` subprocess the fallback. But MCP-server mode for Claude Code is
  _unproven_ (the BLOCKING feasibility check), whereas the `--print` subprocess transport is already
  validated by the spec's own experiments (§5.2/§5.3). Front-loading the unproven transport puts the
  riskiest unknown under the entire Phase 1 build.
- **Selected Approach**: Build **all of Phase 1 on the proven `claude --print` subprocess transport**
  with the **prompt-engineering constraint** (Mechanism A) to prove the product end-to-end. The
  entire MCP stack — persistent MCP tool server (`quotagate_complete`), Mechanism B constraint
  (tool definition + `~/.quotagate/CLAUDE.md`), `installer.ts` + `claude mcp add` registration, the
  MCP client, the `_mcp_lock` serialization, and the Anthropic-ecosystem feasibility investigation —
  becomes the **head of Phase 2**, ahead of the Gemini/Codex adapters. Phase 1 ships a working,
  shippable subprocess-only MVP.
- **Rejected Alternative — MCP-first (front-loaded feasibility spike)**: Rejected because it bets
  the whole phase on an unproven capability and would force a transport rework if the spike failed.
  Subprocess-first builds on solid ground; MCP becomes a clean, well-scoped _upgrade_ with its own
  phase rather than a Phase 1 gamble.
- **Invariant #6 reconciliation (does NOT violate it)**: Invariant #6 says "MCP is primary,
  subprocess is fallback — never subprocess-only **in production**." Phase 1 is an explicit
  **pre-production validation MVP / early-access**, not the production end-state. #6 governs the
  production end-state, which **Phase 2 delivers via the MCP upgrade**. The subprocess-only stage is
  a deliberate, time-boxed proving step — not the shipping configuration. (The spec file is
  unchanged; this reconciliation lives here in the Decision Log per the Decision Log Protocol.)

### D-1A-01 — Node Bootstrap Belongs in Phase 1A (WS_01)

- **Problem**: The Node/TS project must exist before any code is testable. Bootstrap in 1A or 1B?
- **Selected Approach**: Bootstrap in 1A. The adapter and its proving tests (1A's core deliverable)
  need a compilable, testable project; the green gate is a first-class requirement from day one.
- **Rejected Alternative — bootstrap in 1B**: Rejected — doing the adapter work in an untyped
  scratch file then migrating adds churn and loses the coverage that proves the result.

### D-1A-04 — `src/errors.ts` Created in 1A as a Zero-Logic Stub

- **Problem**: CLAUDE.md mandates all custom errors subclass a single `QuotagateError` base in
  `src/errors.ts`. The adapter references it from day one.
- **Selected Approach**: Create `src/errors.ts` in WS_01 with `QuotagateError`, `TransportError`,
  `ValidationError`. Class hierarchy only. Later phases extend it without restructuring.
- **Rejected Alternative — defer to 1B**: Rejected — the adapter's `complete()` throws
  `TransportError` in 1A; without the file, typecheck fails.

### D-1A-05 — Fastify v5 (not v4) for the HTTP Server

- **Problem**: The project is strict ESM (`"type":"module"`, Node 20). Fastify v4 carries residual
  CommonJS shims that create ESM edge cases; v5 is ESM-first. The version must be pinned at WS_01
  bootstrap so it is consistent from day one.
- **Selected Approach**: Pin **Fastify v5** (native ESM, Node 20, aligns with the Zod-at-boundaries
  style). The server is not started until 1B (WS_05), but the dependency is declared in WS_01 so
  typecheck/build are clean from the start.
- **Rejected Alternative — Fastify v4**: Rejected — its ESM workarounds (`.cjs` wrappers,
  experimental flags) add toolchain noise and conflict with `"type":"module"`.

### D-1A-06 — `src/index.ts` Entry-Point Stub Created in 1A WS_01

- **Problem**: `tsup`/`tsc` need an entry file to type-check and build from day one.
- **Selected Approach**: Create `src/index.ts` as a minimal no-op stub in WS_01. 1B replaces it with
  the real `quotagate start` implementation.
- **Rejected Alternative — leave to 1B**: Rejected — a build with no entry point cannot verify the
  full typechain; import errors would surface late in 1B instead of immediately in 1A.

### D-1A-07 — `sanitised_env()` Is a First-Class 1A Concern (the Only Transport)

- **Problem**: The Haiku path-leak (spec §5.3) shows ambient env / cwd can bleed into tool-call
  arguments. Because `claude --print` is the _only_ transport in Phase 1, sanitising the subprocess
  environment is core, not a deferred hardening item. The risk: stripping _all_ env vars may break
  `claude --print` subscription authentication.
- **Selected Approach**: `sanitised_env()` strips ambient machine-context vars (HOME, PWD, OLDPWD,
  filesystem-revealing vars) while **preserving** the vars `claude --print` needs to authenticate.
  The exact allowlist is determined empirically in WS_02 by running `claude --print` with
  progressively stripped environments and confirming auth holds; the allowlist is recorded in the
  Decision Log. The marketplace full-sandbox (`--cwd /tmp/sandbox-{id}` + full strip + path-pattern
  validation) is spec §7.3 and remains out of scope.
- **Rejected Alternative — strip all env vars**: Rejected — risks silently breaking CLI auth, making
  the only transport unusable.

---

## Assumptions This Phase Rests On

| Assumption                                                                                                                                                 | Risk if false                                                                             | De-risked by                                                                                                       | Status |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------ |
| `claude --print` is installed and authenticated on the dev machine, and is invokable as a child process from Node                                          | No transport at all; Phase 1 cannot proceed until the developer authenticates Claude Code | WS_01 `healthCheck()` + a first manual `echo '...' \| claude --print` probe before WS_02 implementation            | ⬚      |
| A constraint _prompt_ (Mechanism A) reliably makes `claude --print` return raw JSON with no prose/markdown — already shown in spec §5.2 across model sizes | Validator retry rate climbs; constraint wording must be tuned                             | Re-validation integration test in WS_02 (low risk — already empirically proven in §5.2)                            | ⬚      |
| `claude --print` suppresses the agent execution loop (declares tool calls, does not execute) — shown in spec §5.3                                          | Proxy could trigger real side-effects via the agent                                       | Execution-suppression test in WS_02 (low risk — proven in §5.3)                                                    | ⬚      |
| `sanitised_env()` can preserve the auth-relevant env vars `claude --print` needs while stripping machine-context vars (spec §5.3)                          | CLI auth breaks under a stripped env; the only transport becomes unusable                 | Empirical allowlist determination in WS_02 (progressively strip; confirm auth); recorded in Decision Log (D-1A-07) | ⬚      |
| The Node/TS green gate (Node 20, TS 5.x, Vitest, ESLint flat config, Fastify v5 per D-1A-05) is achievable from the start                                  | Toolchain friction delays every later workstream                                          | WS_01 is entirely dedicated to this and blocks all other WS                                                        | ⬚      |

_Note: the MCP-server feasibility assumptions (can Claude Code run as an MCP server; fresh-context
mechanism; `claude mcp add` scriptability; dual client/server in one process) are NO LONGER Phase 1
assumptions — they move to the Phase 2 MCP-upgrade investigation (see Future Enhancements & Roadmap)._

---

## Out of Scope (anti-overengineering fence)

_Items deliberately pulled into 1A scope (not deferred):_ `src/errors.ts` base hierarchy (typecheck
from day one — D-1A-04); `src/index.ts` no-op stub (build target — D-1A-06); Fastify v5 declared in
`package.json` (D-1A-05, server not started); `sanitised_env()` (core to the only transport — D-1A-07).

- **All MCP work** — **Phase 2 (its head, ahead of Gemini/Codex)**: the persistent
  `quotagate_complete` MCP tool server (`mcp/toolServer.ts`), `mcp/toolDefinition.ts`,
  `mcp/claudeMd.ts`, `installer.ts` + `claude mcp add` registration, the MCP client, the `_mcp_lock`
  serialization, the MCP-path contamination tests, and the **Anthropic-ecosystem feasibility
  investigation** (can Claude Code run as an MCP server exposing a custom inference tool; reachable
  fresh-context/`/clear` mechanism; whether the Claude Agent SDK is a cleaner surface than the CLI).
  None of this is built in Phase 1 (D-SEQ-01).
- **HTTP server / Fastify endpoint** — Phase 1B. Fastify v5 is declared here but no server starts.
- **OpenAI request parsing / response building** — Phase 1B. 1A operates at the
  `AdapterRequest`/`AdapterResponse` level only, not the OpenAI wire format.
- **Tool-call response path (`{type:"tool_call"}` → OpenAI `tool_calls`)** — Phase 1C. 1A validates
  only the `{type:"text"}` shape (the `tools` arg is exercised in the execution-suppression probe).
- **Validator retry loop** — Phase 1B (scaffold) / Phase 1C (full exercise).
- **`router.ts` / `argumentBuilder.ts` / `responseBuilder.ts`** — Phase 1B. 1A calls the adapter
  directly with raw `messages`/`tools`.
- **Gemini CLI and Codex CLI adapters** — Phase 2.
- **Streaming (SSE)** — Phase 3.
- **Marketplace** — spec §7; never built in Phase 1.
- **Concurrency cap / sharding** — not needed in Phase 1: each `claude --print` request is an
  isolated process, so concurrency is naturally safe. Any resource-bound concurrency cap is Phase 2+.

---

## Workstreams Mapping

| Workstream ID | Workstream Name                        | Timeframe | Status        | Plan Link                                                                                             |
| ------------- | -------------------------------------- | --------- | ------------- | ----------------------------------------------------------------------------------------------------- |
| WS_01         | Node/TS Project Bootstrap              | ~1 day    | ⬚ Not started | [ws01_project_bootstrap.md](../workstreams/ws01_project_bootstrap.md)                                 |
| WS_02         | Claude Subprocess Adapter & Constraint | ~2 days   | ⬚ Not started | [ws02_subprocess_adapter_and_constraint.md](../workstreams/ws02_subprocess_adapter_and_constraint.md) |
| WS_03         | Adapter Proving & Contamination Probe  | ~1 day    | ⬚ Not started | [ws03_adapter_proving.md](../workstreams/ws03_adapter_proving.md)                                     |

**Dependency ordering within 1A:**
WS_01 first (project must compile before code is testable). WS_02 depends on WS_01 — it builds the
subprocess adapter, `build_constrained_prompt`, and `sanitised_env()`, and empirically determines the
env allowlist + re-validates §5.2/§5.3. WS_03 depends on WS_02 — the integration test against the real
subscription, the sequential contamination probe, and the green-gate close-out.

**Dependency on 1B/1C:** Phase 1B (WS_04+) begins after WS_03 sign-off (the `AdapterResponse`
contract and a proven `adapter.complete()` are in place).

_Status: `✅ Completed` | `🔄 In Progress` | `⬚ Not started` | `❌ Blocked`_

---

## Success Criteria (phase-level)

- [ ] A standalone Node/TS script (no HTTP, no OpenAI SDK) calls
      `adapter.complete({ messages:[{role:"user", content:"Hello"}] })` and receives a Zod-validated
      `AdapterResponse` where `result.type === "text"` and `result.content` is a non-empty string —
      against the real Claude subscription via `claude --print`.
- [ ] The execution-suppression probe passes: a call whose `tools` include `read_file` returns
      `{type:"tool_call", name:"read_file", arguments:{...}}` and the file was **not** read (re-confirming spec §5.3).
- [ ] The sequential contamination probe passes: call A (distinctive token) → call B ("what did I
      just say?") → B's content contains no trace of A's token (satisfied by fresh-process isolation;
      asserted as a test).
- [ ] The `sanitised_env()` allowlist is recorded in the Decision Log: which vars are stripped, which
      preserved, and the evidence that `claude --print` auth still works.
- [ ] Green gate: `npm test` green · `npm run typecheck` clean · `npm run lint` clean · `npm run format` no diff.

---

## Future Enhancements & Roadmap

- **Next Phase**: [Phase 1B — OpenAI Translation Pipeline](./01b_openai_translation_pipeline.md)
- **Sibling Phase**: [Phase 1C — Tool Calling & Acceptance](./01c_tool_calling_and_acceptance.md)
- **The MCP upgrade** (Mechanism B, persistent tool server, installer, `_mcp_lock`, feasibility
  investigation) is the **head of Phase 2** per D-SEQ-01 — ahead of the Gemini/Codex adapters.
- **Deferred features**: Tracked in `../workstreams/deferments.md`
