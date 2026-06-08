# Deferments

Settled "not now" decisions — work deliberately pushed to a later phase. Each entry records **what**
is deferred, **why now is not the time**, the **mechanism** (how it will be done when revisited), and
the **revisit trigger** (the condition that brings it back). A deferment is a decision: it has a
rationale and a rejected alternative ("do it now").

> Distinct from `docs/archive/decisions.md` (settled *architectural* decisions) and from **Open
> decisions for user** in CLAUDE.md (unresolved, blocking). Deferments are resolved as "later".

---

## Seeded from the spec's staged plan

These are inherent to the spec's phasing (spec §6) — listed so they are not accidentally pulled forward.

- **The MCP transport upgrade (Mechanism B)** — deferred to the **head of Phase 2** (D-SEQ-01).
  *Why now is not the time:* MCP-server mode for Claude Code is unproven; Phase 1 ships on the proven
  `claude --print` subprocess transport (Mechanism A) to validate the product first. *Mechanism:*
  build the persistent `quotagate_complete` tool server, Mechanism-B constraint (tool def +
  `~/.quotagate/CLAUDE.md`), `installer.ts` + `claude mcp add`, the MCP client, and the `_mcp_lock`
  serialization (re-earning invariants #10/#11 on the persistent session), preceded by the
  Anthropic-ecosystem feasibility investigation. *Revisit trigger:* Phase 1 (1A/1B/1C) signed off.
  *Note:* invariant #6 requires this for the production end-state — Phase 1 subprocess-only is a
  pre-production MVP, not the shipping config.

- **Multi-backend (Gemini CLI, Codex CLI adapters)** — deferred to **Phase 2** (after the MCP-upgrade head).
  *Why now is not the time:* Phase 1 proves the model on one backend (Claude) end-to-end first; the
  Gemini/Codex MCP surfaces need empirical testing before adapter work (spec §6 Phase 2).
  *Mechanism:* one new file per provider in `src/adapters/`, behind the shared `CLIAdapter` interface.
  *Revisit trigger:* Phase 1 success criteria met (incl. the contamination test).

- **SSE streaming + streaming tool calls** — deferred to **Phase 3**.
  *Why:* streaming via MCP responses is additive over a working non-streaming path; correctness first.
  *Mechanism:* Fastify SSE on `/v1/chat/completions` + MCP streaming responses.
  *Revisit trigger:* Phase 2 multi-backend complete.

- **Structured output (JSON-schema enforcement) + full LangChain/LlamaIndex compatibility** —
  deferred to **Phase 3**. *Revisit trigger:* streaming path landed.

- **Sharding (pool of isolated MCP sessions) for concurrency** — deferred to **Phase 2+**, after the
  MCP upgrade. *Why:* it is only meaningful once the persistent MCP session exists. In **Phase 1**
  there is no shared session — each `claude --print` request is an isolated process, so concurrency
  is naturally safe and there is nothing to serialize or shard. Once MCP lands (Phase 2 head), the
  `_mcp_lock` serializes one request per session (invariant #11); sharding is the next step if serial
  throughput becomes a bottleneck. *Mechanism:* a small pool of independent sessions, one in-flight each.
  *Revisit trigger:* serial throughput on the MCP transport becomes a real constraint.

- **Marketplace (spec §7) in its entirety** — out of scope, not merely deferred. Do not implement.
  Phase 1 decisions must not *foreclose* it (stateless-per-request already satisfies this), but no
  marketplace code is written. *Revisit trigger:* explicit provider partnership + product decision —
  far beyond current scope.

---

*(Add new deferments below as they are decided, newest at the bottom, with date.)*
