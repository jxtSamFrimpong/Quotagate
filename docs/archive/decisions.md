# Decision Archive

Settled decisions and locked principles moved out of `.claude/CLAUDE.md` by `/house-keeping`, **oldest
first**. Each entry preserves its **date, the choice, the rationale, and any rejected alternative** —
so a decision is never lost to compaction and never silently re-litigated.

This file grows append-only. It is the long-term companion to the ≤2 dated decision blocks kept inline
in CLAUDE.md's Session State, and to the **Inherited DECIDED architecture** that lives in
`docs/schematics/quotagate-spec.md` (§3.1, §3.2, §8).

---

## 2026-06-08

### D-LANG — Node/TypeScript [LOCKED, user]

**Choice**: Build Quotagate in Node/TypeScript, not Python.

**Rationale**: The wrapped CLIs (Claude Code, Gemini CLI, Codex CLI) are all Node, so Node is a guaranteed-present runtime and the same `npm`/`npx` distribution channel as the tools being proxied; the MCP SDK is most mature in TypeScript; one runtime for the user to install.

**Rejected — Python**: Mature MCP SDK and FastAPI exist, but forces a Python-**and**-Node dual runtime on users and fiddlier async-subprocess handling.

**Rejected — Go/Rust**: Single-binary advantage is half-mooted (Node is required anyway) and MCP SDKs are less mature.
