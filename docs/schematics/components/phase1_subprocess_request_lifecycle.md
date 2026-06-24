# Phase 1 Subprocess Request Lifecycle

**Purpose**: Show, end-to-end, how a single POST /v1/chat/completions request flows through the
Phase 1 subprocess transport — from the OpenAI SDK client to the `claude --print` process and back
to a well-formed `chat.completion` response. This schematic covers the Phase-1-as-built path. The
spec's component overview (§3.3), data flows (§4.2–§4.5), and adapter transport logic (§3.8) all
depict the MCP-primary architecture that is the production end-state; this schematic draws the
**subprocess-primary Phase 1 view** that D-SEQ-01 establishes as the deliberate pre-production
proving step. Where the spec shows MCP, that is Phase 2; where it shows `--print` fallback, that
is Phase 1 primary.

Relevant spec sections: §3.3, §3.7, §3.8, §4.2, §4.3, §4.4, §4.5.
Relevant decision: D-SEQ-01 (subprocess-first MVP; MCP upgrade is the head of Phase 2) —
see `.claude/CLAUDE.md` Decision Log and `docs/plan/phases/01a_transport_and_constraint.md`.

---

## ASCII Diagram — Phase 1 Subprocess Request Lifecycle

```
OpenAI SDK client
  POST /v1/chat/completions
  { model, messages, [tools], [tool_choice], stream? }
        |
        |  HTTP request (localhost:8080 only — never 0.0.0.0)
        v
+-----------------------------------------------+
|  src/proxy.ts  [Phase 1B — WS_05]             |
|  Fastify v5, POST /v1/chat/completions         |
|                                                |
|  Zod parse: messages, model, tools,            |
|             tool_choice, stream                |
|                                                |
|  stream: true  ─────────────────────> HTTP 400 |
|  unknown alias ─────────────────────> HTTP 400 |
+-----------------------------------------------+
        |
        |  Phase 1B: inline alias lookup (config.models map)
        |  Phase 1C: call resolve() in router.ts [WS_08]
        v
+-----------------------------------------------+
|  src/router.ts  [Phase 1C — WS_08]            |
|  resolve(alias, config, adapters)              |
|    known Claude alias → ClaudeAdapter          |
|    unknown alias      → null → HTTP 400        |
|  No health checks, no multi-backend fallback   |
|  (those are Phase 2)                           |
+-----------------------------------------------+
        |
        |  CLIAdapter reference
        v
+-----------------------------------------------+
|  src/argumentBuilder.ts  [Phase 1B — WS_04]  |
|  buildAdapterRequest(body): AdapterRequest     |
|                                                |
|  Maps: messages (passed through UNMODIFIED),  |
|        tools (optional),                       |
|        toolChoice                              |
|                                                |
|  DOES NOT inject the constraint — the          |
|  constraint is owned exclusively by the        |
|  adapter's buildConstrainedPrompt()          |
|  (invariant #4: pipeline stays transport-      |
|  agnostic so the Phase 2 MCP upgrade does      |
|  not require pipeline changes)                 |
+-----------------------------------------------+
        |
        |  AdapterRequest { messages, tools, toolChoice }
        v
+-----------------------------------------------+
|  src/adapters/claude.ts  [Phase 1A — WS_02]  |
|  ClaudeAdapter.complete()                      |
|  → _completeViaSubprocess()                  |
|                                                |
|  Step 1 — buildConstrainedPrompt()           |
|    Serializes tools + conversation turns       |
|    into the stdin prompt string ONLY.          |
|    CONSTRAINT_INSTRUCTIONS are NOT in the      |
|    stdin payload — they are delivered via      |
|    --system-prompt (privileged channel).       |
|    (WS_03-T2-SYSTEM-PROMPT decision: stdin     |
|     injection triggered injection-detection    |
|     heuristics ~2-in-3 with tools present.     |
|     --system-prompt is the correct Mechanism A |
|     channel per spec §3.2 "constraint system   |
|     prompt on every request".)                 |
|                                                |
|  Step 2 — sanitisedEnv()  [D-1A-07]          |
|    Strips HOME, PWD, OLDPWD and other          |
|    filesystem-revealing vars to prevent the    |
|    Haiku path-leak class (spec §5.3).          |
|    Preserves vars claude --print needs for     |
|    subscription auth (allowlist determined     |
|    empirically in WS_02 and recorded in the    |
|    Decision Log).                              |
|                                                |
|  Step 3 — spawn `claude --print`               |
|    Args: ['--print',                           |
|           '--system-prompt',                   |
|           CONSTRAINT_INSTRUCTIONS]             |
|    Child process: fresh OS process, exits      |
|    after one response. Prompt (tools +         |
|    conversation) piped via stdin. Constraint   |
|    delivered via --system-prompt. stdout       |
|    collected and returned.                     |
|    (Statelessness by construction — see the    |
|    "Statelessness is free here" note below.)  |
|                                                |
|  Returns: AdapterResponse { raw, backend:      |
|           "claude-subprocess" }                |
+-----------------------------------------------+
        |
        |  AdapterResponse.raw (raw stdout string)
        v
+-----------------------------------------------+
|  src/validator.ts  [Phase 1B/1C — WS_04/07/08]|
|  parseAndValidate + retry-loop                 |
|                                                |
|  1. JSON.parse(raw)                            |
|     fails → retry (see retry loop below)       |
|                                                |
|  2. Zod parse: QuotagateCompleteResult         |
|     discriminated union:                       |
|       { type: "text",      content: string }   |
|       { type: "tool_call", name: string,       |
|         arguments: Record<string,unknown> }    |
|     fails → retry (see retry loop below)       |
|                                                |
|  RETRY LOOP (max N attempts; N = config.retry.max_attempts) [Phase 1C — WS_08]
|    On failure: re-invoke adapter.complete()    |
|    with a FORMATTING-ONLY correction note      |
|    appended to messages (WS_04-D3):            |
|    "The previous response was not valid JSON.  |
|     Please respond with a single raw JSON      |
|     object matching the schema: ..."           |
|    The note carries NO prior-turn content      |
|    (invariant #10 on the error path).          |
|    attempt 1, 2, 3 → attempts exhausted        |
|    → ValidationError → HTTP 500               |
+-----------------------------------------------+
        |
        |  QuotagateCompleteResult (validated)
        v
+-----------------------------------------------+
|  src/responseBuilder.ts  [Phase 1B/1C]        |
|  buildChatCompletion(result, model)            |
|                                                |
|  BRANCH A — { type: "text" }  [Phase 1B WS_04]|
|    finish_reason: "stop"                       |
|    choices[0].message.role: "assistant"        |
|    choices[0].message.content: <string>        |
|                                                |
|  BRANCH B — { type: "tool_call" } [Phase 1C   |
|              WS_07]                            |
|    finish_reason: "tool_calls"                 |
|    choices[0].message.content: null            |
|    choices[0].message.tool_calls: [{           |
|      id: "call_<uuid>",                        |
|      type: "function",                         |
|      function: {                               |
|        name: result.name,                      |
|        arguments: JSON.stringify(result.args)  |
|        ← MUST be a JSON string, not object     |
|           (WS_07-D2, OpenAI wire contract)     |
|      }                                         |
|    }]                                          |
|                                                |
|  *** INVARIANT #1: THE TOOL IS NEVER EXECUTED  |
|      BY THE PROXY. responseBuilder returns a   |
|      DECLARATION only. The caller executes the |
|      tool in its own runtime and sends the     |
|      result back as the next message turn.     |
|      There is no "execute tool" code path      |
|      inside Quotagate. ***                     |
|                                                |
|  id: "chatcmpl-<uuid>"                         |
|  object: "chat.completion"                     |
|  model: <alias from request>                   |
+-----------------------------------------------+
        |
        |  OpenAI ChatCompletion object (JSON)
        v
OpenAI SDK client  ←  HTTP 200 response
```

---

## Response Branch Summary

```
QuotagateCompleteResult.type
  |
  +── "text"
  |     finish_reason: "stop"
  |     content:       <non-empty string>
  |     tool_calls:    absent
  |     Introduced:    Phase 1B (WS_04 responseBuilder + WS_06 e2e)
  |
  +── "tool_call"
        finish_reason: "tool_calls"
        content:       null  ← required by OpenAI contract
        tool_calls:    [{id, type:"function", function:{name, arguments}}]
        arguments:     JSON.stringify(result.arguments)  ← string, not object
        Introduced:    Phase 1C (WS_07 validator + responseBuilder)
        INVARIANT #1:  proxy returns declaration; caller executes
```

---

## Phase-by-Phase Component Introduction

| Component / function                                                      | src/ module          | Introduced in | Workstream |
| ------------------------------------------------------------------------- | -------------------- | ------------- | ---------- |
| `CLIAdapter` interface                                                    | `adapters/base.ts`   | Phase 1A      | WS_02      |
| `ClaudeAdapter`, `_completeViaSubprocess`                               | `adapters/claude.ts` | Phase 1A      | WS_02      |
| `buildConstrainedPrompt`                                                | `adapters/claude.ts` | Phase 1A      | WS_02      |
| `sanitisedEnv`                                                           | `adapters/claude.ts` | Phase 1A      | WS_02      |
| `AdapterRequest`, `AdapterResponse`, `QuotagateCompleteResult` Zod schema | `types.ts`           | Phase 1A      | WS_01      |
| `OpenAIChatRequest` Zod schema (proxy parse target + builder input)       | `types.ts`           | Phase 1B      | WS_04      |
| `buildAdapterRequest`                                                     | `argumentBuilder.ts` | Phase 1B      | WS_04      |
| `parseAndValidate` (T2) + `validateWithRetry` (T3)                        | `validator.ts`       | Phase 1B      | WS_04      |
| `buildChatCompletion` (text branch)                                       | `responseBuilder.ts` | Phase 1B      | WS_04      |
| Fastify server, Zod body parse, `stream:true` guard                       | `proxy.ts`           | Phase 1B      | WS_05      |
| `loadConfig`                                                              | `config.ts`          | Phase 1B      | WS_05      |
| `main()`, `quotagate start` boot sequence (`loadConfig` → `healthCheck` → `createServer` → `listen`) | `index.ts` | Phase 1B | WS_05 |
| `buildChatCompletion` tool-call branch                                    | `responseBuilder.ts` | Phase 1C      | WS_07      |
| Retry loop fully exercised (live path, exhaustion → HTTP 500)             | `validator.ts`       | Phase 1C      | WS_08      |
| `resolve` (single-backend alias resolver)                                 | `router.ts`          | Phase 1C      | WS_08      |
| `proxy.ts` migrated to use `router.ts`                                    | `proxy.ts`           | Phase 1C      | WS_08      |

---

## Prose Contract Per Stage

### 1. `src/proxy.ts` — HTTP boundary and guard rail

Consumes: raw HTTP POST body.
Produces: either an early HTTP 400/500 error, or a validated OpenAI `chat.completion` object (HTTP 200).
Module owner: `proxy.ts` (Fastify v5, WS_05).
Invariants upheld: #5 (OpenAI output contract — error responses are OpenAI-format, never raw stack traces).

The proxy is the single point where structural request errors are rejected before any adapter work
begins. `stream: true` is rejected here (D-1B-04) because silently ignoring it would cause
client-side parse failures. An unknown model alias is rejected here because the router (inline in
1B, `router.ts` in 1C) has no adapter to dispatch to. No constraint text is injected here — the
proxy is constraint-agnostic.

### 2. `src/router.ts` (Phase 1C) — alias resolver

Consumes: model alias string, `QuotagateConfig`, adapter map.
Produces: the `CLIAdapter` instance for the alias, or `null` (→ HTTP 400 in `proxy.ts`).
Module owner: `router.ts` (WS_08).
Invariants upheld: #4 (every adapter implements the same interface — `router.ts` returns a
`CLIAdapter`, never a concrete type, so `proxy.ts` remains adapter-agnostic).

In Phase 1B this resolution is inlined in `proxy.ts` as a simple map lookup (D-1B-03 — a
router with one adapter is dead abstraction). In Phase 1C the extraction to `router.ts` creates
the seam Phase 2 extends to async health checks and multi-backend fallback without touching
`proxy.ts` (D-1C-01).

### 3. `src/argumentBuilder.ts` — OpenAI-to-adapter translation

Consumes: parsed OpenAI request body (`OpenAIChatRequest`).
Produces: `AdapterRequest { messages, tools, toolChoice }`.
Module owner: `argumentBuilder.ts` (WS_04).
Invariants upheld: #4 (transport-agnostic translation — no adapter-specific content injected).

The `messages` array passed to the adapter is **exactly** the caller's messages — no system
prompt, no constraint text. This is enforced by a named separation-of-concerns test
(WS_04 T1). The constraint lives one layer down, inside `buildConstrainedPrompt` in the
Claude adapter. If constraint text were injected here, Phase 2's Gemini adapter would require
`argumentBuilder.ts` to know which backend it is talking to, collapsing the clean pipeline
abstraction.

### 4. `src/adapters/claude.ts` — subprocess transport + Mechanism A constraint

Consumes: `AdapterRequest { messages, tools, toolChoice }`.
Produces: `AdapterResponse { raw: string, backend: "claude-subprocess" }`.
Module owner: `adapters/claude.ts` (WS_02).
Invariants upheld: #2 (no credentials — `claude --print` handles auth), #10 (stateless by
construction — see note below).

`buildConstrainedPrompt` serializes the caller's tools and conversation turns into the stdin
prompt. It does **not** include `CONSTRAINT_INSTRUCTIONS` — those are delivered as the
`--system-prompt` CLI flag argument on every spawn (decision WS_03-T2-SYSTEM-PROMPT). This
channel separation is load-bearing: the model's injection-detection heuristics treat user-turn
stdin content with adversarial suspicion when it contests an active tool-use path; the system
prompt channel is treated as a legitimate configuration directive. The unit tests T-1/T-8/T-13
in `buildConstrainedPrompt.test.ts` assert this separation as a regression guard (they assert
constraint phrases absent from the stdin payload). `sanitisedEnv` strips machine-context
environment variables before the child process is spawned, preventing the path-leak class
observed in the Haiku experiment (spec §5.3). The child process — `claude --print
--system-prompt <CONSTRAINT_INSTRUCTIONS>` — reads the serialized prompt from stdin, applies
the constraint from the system prompt channel, writes its response to stdout, and exits. Its
stdout string becomes `AdapterResponse.raw`.

### 5. `src/validator.ts` — JSON parse, Zod validation, retry loop

Consumes: `AdapterResponse.raw` (a raw stdout string), plus an `invoker` callback to re-invoke
the adapter on retry.
Produces: a validated `QuotagateCompleteResult` (either `{type:"text"}` or `{type:"tool_call"}`).
Module owner: `validator.ts` (WS_04 scaffolds; WS_07 adds tool-call branch; WS_08 fully exercises).
Invariants upheld: #5 (validates the model's output before it touches `responseBuilder`; malformed
output never reaches the response), #10 (correction note on retry carries no prior-turn content —
WS_04-D3).

The retry loop (up to `config.retry.max_attempts` attempts, default 3, spec §4.5) re-invokes `adapter.complete()` via the `invoker`
callback with a formatting-only correction note appended to messages. The note is a schema nudge,
not a content echo — echoing prior-turn content in the retry would be a contamination vector.
After 3 consecutive failures the loop throws `ValidationError`, which `proxy.ts` maps to HTTP 500
with a descriptive, non-leaking error body.

### 6. `src/responseBuilder.ts` — AdapterResponse to OpenAI chat.completion

Consumes: validated `QuotagateCompleteResult`.
Produces: a well-formed OpenAI `ChatCompletion` object.
Module owner: `responseBuilder.ts` (WS_04 adds text branch; WS_07 adds tool-call branch).
Invariants upheld: #1 (NEVER executes tools — returns declarations only), #5 (OpenAI output
contract — response is structurally indistinguishable from the real Anthropic API).

For `{type:"text"}`: `finish_reason: "stop"`, `content` non-null string.
For `{type:"tool_call"}`: `finish_reason: "tool_calls"`, `content: null`, `tool_calls[0].function.arguments`
is `JSON.stringify(result.arguments)` — a JSON string, not an object (WS_07-D2). The OpenAI SDK
expects a string; passing the raw object would silently violate the wire contract and break callers.

---

## Why Statelessness Is Free in Phase 1 (and Must Be Re-earned in Phase 2)

Each call to `_completeViaSubprocess()` spawns a fresh OS process. That process reads its input
from stdin, writes its output to stdout, and exits. There is no shared memory, no session buffer,
no accumulated context — each request is isolated by the OS process boundary. Invariants #10
("persist the process, never the conversation — each call runs in a fresh context seeded only by
its args") and #11 ("one request in flight per MCP session") are both satisfied by construction in
Phase 1 with zero machinery:

- No `_mcp_lock` is needed — there is no persistent session to serialize over.
- No `_reset_context_if_needed()` is needed — the process exits after each response.
- Concurrent requests are naturally isolated — each spawns its own independent child process.

**The Phase 2 MCP upgrade must RE-EARN this property.** When the persistent `quotagate_complete`
MCP tool server is introduced (Phase 2 head), the persistent process is stateful. Statelessness
must be re-established structurally via the `_mcp_lock` (serializing the whole
call → response → context-reset lifecycle as one atomic unit) and `_reset_context_if_needed()`
(spec §3.8, §3.1). The contamination tests authored in Phase 1C (WS_09) become the regression
guard that the Phase 2 MCP upgrade must pass to prove it has re-earned what subprocess provides
for free.

---

## Not in Phase 1 — Phase 2 Head (Deliberately Absent)

The following components and mechanisms are **not present in Phase 1** by design (D-SEQ-01). They
are the Phase 2 MCP upgrade deliverables:

| Absent in Phase 1                                                     | Phase 2 module / mechanism                |
| --------------------------------------------------------------------- | ----------------------------------------- |
| MCP client (persistent connection to Claude Code MCP server)          | `adapters/claude.ts` MCP path             |
| `quotagate_complete` MCP tool server                                  | `src/mcp/toolServer.ts`                   |
| Mechanism B structural constraint (tool definition)                   | `src/mcp/toolDefinition.ts`               |
| `~/.quotagate/CLAUDE.md` (session-level constraint)                   | `src/mcp/claudeMd.ts`                     |
| `installer.ts` + `claude mcp add` registration                        | `src/installer.ts`                        |
| `_mcp_lock` (serialization over the persistent MCP session)           | `adapters/claude.ts`                      |
| `_reset_context_if_needed()` (context reset between serialized calls) | `adapters/claude.ts`                      |
| MCP → subprocess fallback trigger (failure-rate threshold)            | `adapters/claude.ts`                      |
| Sharding (pool of N isolated MCP sessions)                            | Phase 2+                                  |
| Gemini CLI and Codex CLI adapters                                     | `adapters/gemini.ts`, `adapters/codex.ts` |
| `auto` model routing, multi-backend health checks                     | `router.ts` Phase 2 extension             |
| Anthropic-ecosystem feasibility investigation                         | Phase 2 pre-work                          |

In the spec's §3.3 component overview and §4.4 MCP-failure flow, MCP is drawn as the primary
transport. That diagram reflects the production end-state. This schematic reflects the Phase 1
pre-production MVP. The relationship is sequential, not contradictory: Phase 1 proves the product
on the proven transport; Phase 2 upgrades to the production transport without touching the
translation pipeline. Both are correct views at their respective phases.
