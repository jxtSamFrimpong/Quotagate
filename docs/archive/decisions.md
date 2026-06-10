# Decision Archive

Settled decisions and locked principles moved out of `.claude/CLAUDE.md` by `/house-keeping`, **oldest
first**. Each entry preserves its **date, the choice, the rationale, and any rejected alternative** —
so a decision is never lost to compaction and never silently re-litigated.

This file grows append-only. It is the long-term companion to the ≤2 dated decision blocks kept inline
in CLAUDE.md's Session State, and to the **Inherited DECIDED architecture** that lives in
`docs/schematics/quotagate-spec.md` (§3.1, §3.2, §8).

---

## 2026-06-08

### D-STATELESS — Persist the Process, Never the Conversation [LOCKED]

**Choice**: MCP persistence reuses the _process/connection_ only; each `quotagate_complete` call runs in a fresh context seeded solely by its args (`adapter.complete()` is a pure function of its inputs). Concurrency is handled by serializing one request per session (a lock wrapping call→response→reset); shard a pool to scale; never interleave. `/clear`-between-requests is a serialized best-effort fallback only, not the contract.

**Rationale**: The persistent MCP process is stateful; statelessness (invariant #3) must be re-earned structurally, not cleaned up after the fact. The `--print` fallback is stateless by construction.

**Rejected — rely on `/clear` after each response as the primary guarantee**: Reactive, races concurrency, may be unreachable in MCP-server mode.

_(Spec invariants #10/#11; §3.1/§3.8. Archived from inline Session State by BSE, 2026-06-09.)_

---

### D-LANG — Node/TypeScript [LOCKED, user]

**Choice**: Build Quotagate in Node/TypeScript, not Python.

**Rationale**: The wrapped CLIs (Claude Code, Gemini CLI, Codex CLI) are all Node, so Node is a guaranteed-present runtime and the same `npm`/`npx` distribution channel as the tools being proxied; the MCP SDK is most mature in TypeScript; one runtime for the user to install.

**Rejected — Python**: Mature MCP SDK and FastAPI exist, but forces a Python-**and**-Node dual runtime on users and fiddlier async-subprocess handling.

**Rejected — Go/Rust**: Single-binary advantage is half-mooted (Node is required anyway) and MCP SDKs are less mature.

---

## 2026-06-09

### WS_02-D3 — `install()` Is a No-Op Stub in Phase 1 [LOCKED]

**Choice**: `ClaudeAdapter.install()` throws `new Error("install() not implemented in Phase 1 — MCP registration is Phase 2")` from inside an `async` method body (so the throw wraps into a rejected Promise automatically — not `Promise.reject()`).

**Rationale**: `install()` in the full design writes `~/.quotagate/CLAUDE.md` and runs `claude mcp add` — both Phase 2 MCP concerns (D-SEQ-01). The stub makes the omission explicit and loud. If `proxy.ts` or any Phase 2 caller accidentally invokes `install()` before the Phase 2 implementation lands, they get a clear error rather than a silent pass.

**Rejected — `install()` returns `Promise.resolve()` silently**: Silent no-op hides that MCP registration has not occurred; a WS_05 startup path calling `install()` would incorrectly conclude the installation succeeded.

**Rejected — omit `install()` from `CLIAdapter` until Phase 2**: Breaks invariant #4. All adapters must share the same interface; retrofitting a required method mid-phase forces changes to every existing implementor.

_(Locked by Principal Architect in TASK_WS02_T4 planning, 2026-06-08. Implemented in TASK_WS02_T4, 2026-06-09.)_

---

### WS_02-D-T2-02 — Null `content` on Assistant Messages Rendered as `[tool call]` Sentinel [LOCKED]

**Choice**: When an `OpenAIMessage` has `role: 'assistant'` and `content: null` (indicating a prior tool-call step with no text), `buildConstrainedPrompt` serializes it as `assistant: [tool call]` — not `assistant: null`, not an empty string, and not omitted.

**Rationale**: The literal string `"null"` in the prompt would be ambiguous (the model could interpret it as a keyword or a missing value). Omitting the message breaks conversation history integrity — the model would receive a gap in the turn sequence. The `[tool call]` sentinel is a recognizable, explicit placeholder that preserves turn order and signals "an action was declared here" without leaking content.

**Rejected — serialize as `assistant: null`**: Injects the literal string "null" into the prompt; ambiguous and potentially confusing to the model.

**Rejected — omit null-content messages**: Breaks the conversation history structure; the model sees a gap in the dialogue.

_(Decision ID WS_02-D-T2-02. Implemented in TASK_WS02_T2, 2026-06-09. Confirmed by T-7 in `tests/adapters/buildConstrainedPrompt.test.ts`. Archived from Session State by /house-keeping, 2026-06-10.)_
