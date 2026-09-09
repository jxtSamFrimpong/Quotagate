# Decision Archive

Settled decisions and locked principles moved out of `.claude/CLAUDE.md` by `/house-keeping`, **oldest
first**. Each entry preserves its **date, the choice, the rationale, and any rejected alternative** —
so a decision is never lost to compaction and never silently re-litigated.

This file grows append-only. It is the long-term companion to the ≤2 dated decision blocks kept inline
in CLAUDE.md's Session State, and to the **Inherited DECIDED architecture** that lives in
`docs/schematics/quotagate-spec.md` (§3.1, §3.2, §8).

---

## 2026-06-08

### D-SEQ-01 — Subprocess-First MVP; MCP Upgrade Is the Head of Phase 2 [LOCKED, user]

**Choice**: Build all of Phase 1 on the proven `claude --print` subprocess transport with the Mechanism-A prompt-engineering constraint (validated by spec §5.2/§5.3), to prove the product end-to-end. The entire MCP stack — persistent `quotagate_complete` tool server, Mechanism-B constraint (tool def + `~/.quotagate/CLAUDE.md`), `installer.ts` + `claude mcp add`, MCP client, `_mcp_lock`, and the Anthropic-ecosystem feasibility investigation — becomes the head of Phase 2, ahead of Gemini/Codex.

**Rationale**: Subprocess is proven; MCP-server mode is unproven, so front-loading it bet the whole phase on an unknown. On subprocess, statelessness + concurrency-isolation are FREE (fresh process per request), so invariants #10/#11 need no machinery in Phase 1. Reconciles invariant #6 ("never subprocess-only in production"): Phase 1 is an explicit pre-production validation MVP, not the production end-state — Phase 2's MCP upgrade is the end-state.

**Rejected — MCP-first / front-loaded feasibility spike**: Bets the phase on an unproven capability and forces a transport rework if it fails.

_(Recorded in `docs/plan/phases/01a_*.md` as D-SEQ-01. Archived from inline Session State by /house-keeping, 2026-06-10.)_

---

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

### WS_02-D2-allowlist — `sanitisedEnv()` Minimum Env Allowlist `{PATH, USER}` [LOCKED, empirical spike, 2026-06-09]

**Choice**: `sanitisedEnv()` passes only `{PATH, USER}` to the `claude --print` subprocess. Empirical spike on macOS (darwin 25.5.0, claude 2.1.170) confirmed this minimum allowlist.

- `PATH`: required for OS subprocess binary resolution.
- `USER`: required for `claude` subscription auth — the auth token lookup path requires USER identity. Removing USER while keeping HOME causes auth failure ("Not logged in").
- `HOME`: NOT required — Node's `os.homedir()` resolves from `/etc/passwd` via UID lookup when `$HOME` is absent, so `claude`'s config path works without it. Intentionally excluded to avoid leaking a filesystem path.
- **healthCheck probe command**: `claude auth status` — exits 0 and returns a structured JSON object (`{ loggedIn, authMethod, apiProvider, email, ... }`) when authenticated; exits non-zero otherwise. Confirmed working under stripped env (`{PATH, USER}` only).
- **Haiku path-leak class vars confirmed absent**: `PWD`, `OLDPWD`, `HOME`, `SHELL`, `SHLVL`, `TERM`, `TERM_PROGRAM`, `ITERM_SESSION_ID`, `COLORTERM`, `NVM_DIR`, `JAVA_HOME`, `GOPATH`, `CARGO_HOME`, `npm_config_prefix` — none required; all safely stripped.
- **macOS-specific note** (EF4): spike run on macOS only. The `/etc/passwd` UID fallback for `os.homedir()` is POSIX-standard; Linux should behave identically, but the confirmed allowlist is macOS-empirical — a Linux CI run should re-validate before production.

**Rejected — include HOME**: unnecessary on macOS/Linux (passwd UID fallback); reveals a filesystem path to the subprocess environment.

**Rejected — include all common CI vars**: speculative; not confirmed by spike.

_(Decision ID WS_02-D2-allowlist. Confirmed by empirical spike, 2026-06-09. Archived from `.claude/CLAUDE.md` Session State by /house-keeping, 2026-06-10.)_

---

## 2026-06-10

### WS_03-D4 — `vitest.config.ts` CI-Gated Integration Test Exclusion [LOCKED, Architect, 2026-06-09]

**Choice**: Add `exclude: process.env['CI'] ? ['tests/integration/**'] : []` to `vitest.config.ts`. Bracket notation (`process.env['CI']`) required for TypeScript strict mode. The `*.integration.test.ts` naming convention is preserved regardless — it is the human-readable signal; the `exclude` is a belt-and-suspenders CI guard.

**Rationale**: The `include: ['tests/**/*.test.ts']` glob matches `*.integration.test.ts` files (filename ends in `.test.ts`). Without the `exclude`, every CI `npm test` run attempts integration tests and fails on missing auth. The `CI` env var is the conventional signal set by GitHub Actions, CircleCI, etc. Local runs (CI unset) include integration tests — they pass when a live subscription is available and skip gracefully otherwise; CI runs always exclude them.

**Rejected — Vitest workspace / separate `vitest.integration.config.ts`**: Adds a second config file and a second `npm run test:integration` script; requires remembering to run both. Overkill for a naming problem.

**Rejected — rename integration tests to `*.e2e.ts` (no `.test.ts` suffix)**: Vitest's `include` glob would not pick them up at all, breaking `npx vitest run tests/integration/`. Naming convention must preserve `.test.ts` suffix.

**Rejected — require integration tests to pass in CI from day one**: Blocks every CI run on auth secrets. Phase 4 DX concern, not Phase 1A.

_(Locked in TASK_WS03_T4 planning by Principal Architect, 2026-06-09. Implemented in TASK_WS03_T4 by BSE, 2026-06-10. Archived from task tracker by /house-keeping, 2026-06-10.)_

---

### WS_03-T2-SYSTEM-PROMPT — `CONSTRAINT_INSTRUCTIONS` delivered via `--system-prompt`, not stdin [LOCKED]

**Choice**: `_completeViaSubprocess()` spawns `claude ['--print', '--system-prompt', CONSTRAINT_INSTRUCTIONS]`. `buildConstrainedPrompt()` serializes tools + conversation only — `CONSTRAINT_INSTRUCTIONS` is absent from the stdin payload.

**Rationale**: sending constraint text via stdin (user-turn channel) triggers Claude's injection-detection safety heuristics ~2-in-3 when a `tools` array is present — the model correctly identifies user-turn behavioral overrides as adversarial. The `--system-prompt` flag delivers the constraint through the privileged system prompt channel, where the model treats it as a legitimate configuration directive. This is also a more faithful realization of spec §3.2's "constraint system prompt on every request." Unit tests T-1/T-8/T-13 in `buildConstrainedPrompt.test.ts` assert the inverse contract (constraint phrases absent from stdin payload) as a regression guard.

**Rejected — stdin injection with rewording**: probabilistic failure rate persists regardless of phrasing because the issue is structural (channel), not lexical (words). **Rejected — early Mechanism B upgrade**: D-SEQ-01 is locked; Phase 2 is the correct home for MCP transport.

_(Decision ID WS_03-T2-SYSTEM-PROMPT. Locked 2026-06-10. Archived from `.claude/CLAUDE.md` Session State by /house-keeping, 2026-06-11.)_

---

## 2026-06-10

### WS_04-D5 — OpenAI Translation-Pipeline Open Decisions Resolved (OD-1…OD-7) [LOCKED]

**Choice**: WS_04 elevation locked 7 decisions. Load-bearing: **OD-5 — validator split:** pure `parseAndValidate(raw)` (T2) + `validateWithRetry(raw, messages, invoker)` orchestrator (T3), both in `validator.ts`; the `invoker` callback is the seam the Phase-2 MCP transport substitutes into (neither function changes). **OD-1 — `toolChoice`:** the builder passes `tool_choice` through verbatim; the adapter's `?? 'auto'` (claude.ts:90) is the sole default (honors WS_04-D1). **OD-7 — `tool_call`:** the validator returns a schema-valid `tool_call` faithfully; `responseBuilder` is the single loud rejection point. Supporting: **OD-2** add `openai` dep (pinned major, `import type` only); **OD-3** hand-rolled `OpenAIChatRequest` Zod schema in `types.ts`; **OD-4** `tool_call` stub throws base `QuotagateError`; **OD-6** validator does not strip markdown fences (fenced → retry, never silently normalized). Full dated blocks + rejected alternatives in `docs/plan/workstreams/ws04_translation_pipeline.md` §Locked Decisions.

**Rejected (OD-5)**: single inline `validate(raw, invoker, attempt)` — fuses parse/validate to re-invocation, untestable in isolation.

**Rejected (OD-1)**: inject `"auto"` at the builder — duplicates the default and binds all future backends to it.

_(Locked 2026-06-10. Archived from `.claude/CLAUDE.md` Session State by /house-keeping, 2026-06-21.)_

---

## 2026-06-11

### WS_05-D5…D8 — Fastify proxy & config open decisions resolved (OD-1/OD-2/OD-3 + DD-1) [LOCKED]

**Choice**: WS_05 elevation locked 4 decisions. **D5 (OD-1):** add `yaml` as a runtime dep (`import { parse }`) — pure-JS, zero-dep, spec §3.9-aligned. **D6 (OD-2):** default config path `~/.quotagate/config.yaml` via `os.homedir()` (never `process.cwd()` / literal `~`) — the spec-canonical location (spec line 798), pulled forward from Phase-4 DX and co-located with invariant-#9's `~/.quotagate/` home. **D7 (OD-3):** `QuotagateConfig.models` entry is `{ backend; priority? }` — matches spec §3.9, zero migration when `router.ts` arrives. **D8 (DD-1):** absent config is fail-loud (throw create-it `QuotagateError` → `process.exit(1)`); no auto-write, honoring D-SEQ-01's no-installer fence. Full dated blocks + rejected alternatives in `docs/plan/workstreams/ws05_fastify_proxy_and_config.md` §Locked Decisions.

**Rejected (OD-2) — `process.cwd()`:** spec names no project-local path; misses config when run from a subdirectory. **Rejected (DD-1) — auto-write a default config:** installer-class disk write deferred by D-SEQ-01.

_(Locked 2026-06-11. Archived from `.claude/CLAUDE.md` Session State by /house-keeping, 2026-09-08.)_

---

## 2026-09-08

### WS_10 B-T4-3 — reset+lock is the atomic unit for shared-context outcomes [ENDORSED]

**Choice**: any second-sees-first-context outcome routes to OD-3 with reset+lock covering call → response → reset as one atomic unit (spec §3.1/§3.8) — never "serialization alone." Endorsed by the user when authorizing the T3/T4 re-probe.

**Rationale**: a lock alone serializes access but does not clear shared history; the observed T4-concurrent pattern (had it been real) would have required the reset half, not just the mutex half.

**Rejected — "standard mutex, Risk MEDIUM"** (the 08-30 exp04 verdict language): mis-prescribed even on its own terms; superseded.

### WS_10 S-R6 — spike evidence logs stay committed via scoped gitignore exception [LOCKED]

**Choice**: `*.log` gitignore carries a `spikes/mcp_feasibility/artifacts/exp05-*.log` exception; the three exp05 logs are committed as the primary A4/A5 record (PA first-hand verified 2026-09-08).

**Rationale**: the record T7 adjudicates on must survive in the repo; a review-as-record-only convention is fragile across sessions.

**Rejected — accept the PA review as the sole record**: leaves the evidence one lost file away from anecdote.
