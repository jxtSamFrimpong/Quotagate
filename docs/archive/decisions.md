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
