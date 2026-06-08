# Workstream WS_02: Claude Subprocess Adapter & Constraint

> A workstream scopes ~1 day of work and is more detailed than its parent phase: concrete goals +
> deliverables, locked decisions (with rejected alternatives), a task breakdown, cross-task
> contracts, and success/quality gates. It is the bridge from phase goals to hour-sized tasks.

## Workstream Overview
- **Parent Phase**: [Phase 1A — Claude Subprocess Adapter & Constraint](../phases/01a_transport_and_constraint.md)
- **Timeframe**: ~2 days
- **Status**: Proposed
- **Dependencies**: WS_01 signed off — `src/types.ts`, `src/errors.ts`, and the green gate must be in place before this workstream begins.

---

## Goals & Deliverables

- **Goal 1**: The `CLIAdapter` interface — the single seam every adapter (current and future) satisfies.
  - Deliverable: `src/adapters/base.ts` — TypeScript `interface CLIAdapter` with `complete()`, `healthCheck()`, and `install()` signatures (spec §3.7). This is the contract that keeps `router.ts` and `proxy.ts` adapter-agnostic (invariant #4).

- **Goal 2**: The Claude subprocess adapter — the only transport in Phase 1.
  - Deliverable: `src/adapters/claude.ts` — `ClaudeAdapter` implementing `CLIAdapter`. `complete()` delegates to `_complete_via_subprocess()`. `healthCheck()` verifies `claude` is on `PATH` and authenticated. `install()` is a no-op stub (real install is Phase 2 MCP work).

- **Goal 3**: The Mechanism A prompt-engineering constraint.
  - Deliverable: `build_constrained_prompt(messages, tools, toolChoice)` inside `src/adapters/claude.ts`. Serializes the conversation and injects the constraint instructions (return raw JSON only; never execute tools; declare, do not act). This is the **only** constraint mechanism in Phase 1 (Mechanism B / MCP is Phase 2 per D-SEQ-01).

- **Goal 4**: A clean subprocess environment — the `sanitised_env()` utility.
  - Deliverable: `sanitised_env()` inside `src/adapters/claude.ts`. Strips ambient machine-context environment variables (HOME, PWD, OLDPWD, and filesystem-revealing vars per spec §5.3 Haiku path-leak class) while preserving the vars `claude --print` requires for subscription authentication. The exact allowlist is determined empirically in this workstream (D-1A-07) and recorded in the Decision Log.

---

## Why This Workstream Matters

WS_02 is the core mechanism of Phase 1. Every request that flows through Quotagate in Phase 1 goes through `_complete_via_subprocess()` and `build_constrained_prompt()`. If the constraint is weak, the validator retry rate climbs and the acceptance tests in WS_03 fail noisily. If `sanitised_env()` strips too aggressively, the only transport becomes unusable. If `sanitised_env()` strips too little, the Haiku path-leak class (spec §5.3) bleeds machine context into tool-call arguments.

WS_03 depends entirely on this workstream's output — it cannot run integration tests against a real Claude subscription until `adapter.complete()` exists and is stable. Getting the constraint wording and env allowlist right here means WS_03 is a confirmation pass, not a debugging session.

---

## Locked Decisions

### WS_02-D1 — `build_constrained_prompt` Lives Inside the Adapter, Not the Translation Layer ✅ LOCKED (Architect, 2026-06-08)
Inherits **D-1B-01** from the Phase 1B plan (stated here because the implementation lives in this workstream).

**Decision**: `build_constrained_prompt` is a private function of `src/adapters/claude.ts`. The translation pipeline (`argumentBuilder.ts`, `validator.ts`, `responseBuilder.ts`) never injects constraint text. The adapter owns the constraint entirely.

**Rationale**: Separation of concerns. The translation pipeline must remain transport-agnostic (invariant #4) — it maps OpenAI shapes to adapter shapes and back. If constraint text leaked into the pipeline, adding a Gemini adapter in Phase 2 would require the pipeline to know which backend it is talking to. The adapter is the right owner because the constraint is specific to how `claude --print` needs to be invoked.

**Rejected alternative — inject constraint in `argumentBuilder.ts`**: Forces `argumentBuilder` to be adapter-aware, breaking the clean pipeline abstraction and requiring a rework when Phase 2 adds Gemini/Codex adapters.

### WS_02-D2 — `sanitised_env()` Allowlist Determined Empirically; Recorded in Decision Log ✅ LOCKED (Architect, 2026-06-08)
Inherits **D-1A-07** from the parent phase plan.

**Decision**: The allowlist for `sanitised_env()` is not assumed from documentation — it is determined by running `claude --print` with progressively stripped environments and confirming that subscription authentication still holds. The resulting allowlist is recorded as a resolved decision (WS_02-D2-allowlist) in the CLAUDE.md Decision Log before WS_02 is signed off.

**Rationale**: Stripping too much silently breaks the only transport in Phase 1. Stripping too little defeats the purpose of the function. The risk is asymmetric: a broken transport is immediately visible (healthCheck fails); a path-leaking transport is subtle and only caught by the WS_03 contamination probe. Empirical determination eliminates the assumption risk.

**Rejected alternative — strip all env vars**: Risks silently breaking `claude --print` subscription auth, making Phase 1 transport unusable with no obvious root cause.

### WS_02-D3 — `install()` Is a No-Op Stub in Phase 1 ✅ LOCKED (Architect, 2026-06-08)
**Decision**: `ClaudeAdapter.install()` throws `new Error("install() not implemented in Phase 1 — MCP registration is Phase 2")` or returns immediately with a log line. It satisfies the `CLIAdapter` interface without doing any real work.

**Rationale**: `install()` in the full design (spec §3.7) writes `~/.quotagate/CLAUDE.md` and runs `claude mcp add` — both Phase 2 MCP concerns (D-SEQ-01). The interface requires the method; the stub makes the omission explicit and loud rather than silently missing.

**Rejected alternative — omit `install()` from the interface until Phase 2**: Breaks invariant #4 — every adapter implements the same interface. If Phase 2 adds `install()` to the interface, every adapter file must be touched. Better to stub now.

---

## Task Breakdown

| Task ID | Description | Est. Duration | Status | Task Tracker Link |
|---------|-------------|---------------|--------|-------------------|
| T1 | Author `src/adapters/base.ts`: `CLIAdapter` interface with typed `complete()`, `healthCheck()`, `install()` signatures. Unit test: a minimal stub class satisfies the interface (TypeScript structural check). | ~45 min | ⬚ Not started | `../../active/TASK_WS02_T1.md` |
| T2 | Author `build_constrained_prompt(messages, tools, toolChoice)` in `src/adapters/claude.ts`. Unit tests: constraint instructions present in output; caller messages serialized faithfully (no mutation, no reordering); `tools: undefined` produces a valid prompt; `tools: [...]` serializes schemas into the prompt. | ~1.5 hours | ⬚ Not started | `../../active/TASK_WS02_T2.md` |
| T3 | Empirically determine `sanitised_env()` allowlist: run `claude --print` with progressively stripped environments; record which vars are required for auth. Author `sanitised_env()` with the confirmed allowlist. Unit tests: stripped vars absent; required auth vars present; output is a plain `Record<string,string>`. Record the allowlist as WS_02-D2-allowlist in the Decision Log. | ~1.5 hours | ⬚ Not started | `../../active/TASK_WS02_T3.md` |
| T4 | Author `ClaudeAdapter` class: `_complete_via_subprocess()` (spawns `claude --print`, passes constrained prompt via stdin, reads stdout, returns `AdapterResponse`), `healthCheck()` (verifies `claude` on PATH + authenticated), `install()` stub. Wire `complete()` to delegate to `_complete_via_subprocess()`. Green gate passes. | ~1.5 hours | ⬚ Not started | `../../active/TASK_WS02_T4.md` |

*Status: `✅ Completed` | `🔄 In Progress` | `⬚ Not started` | `❌ Blocked`*

*T1 is a prerequisite for T4 (interface must exist before the class implements it). T2 and T3 are independent of each other and can run in parallel. T4 depends on T2 and T3 (it consumes `build_constrained_prompt` and `sanitised_env`).*

---

## Cross-Task Contracts

### `CLIAdapter` interface (owned by T1 → consumed by T4, WS_05, WS_08)
Defined in `src/adapters/base.ts`. Signature:
```typescript
interface CLIAdapter {
  readonly name: string;
  complete(req: AdapterRequest): Promise<AdapterResponse>;
  healthCheck(): Promise<boolean>;
  install(): Promise<void>;
}
```
`proxy.ts` and `router.ts` hold a `CLIAdapter` reference — they never import `ClaudeAdapter` directly. This is the adapter-agnosticism invariant (#4). Consumers must not narrow the type to `ClaudeAdapter`.

### `build_constrained_prompt` (owned by T2 → consumed by T4)
Private to `src/adapters/claude.ts`. Signature:
```typescript
function buildConstrainedPrompt(
  messages: OpenAIMessage[],
  tools: OpenAITool[] | undefined,
  toolChoice: string
): string
```
T4's `_complete_via_subprocess()` calls this to produce the stdin string. The constraint text is part of this function's output — T4 must not add additional constraint instructions at the call site (that would duplicate the constraint and make it harder to tune).

### `sanitised_env()` (owned by T3 → consumed by T4)
Private to `src/adapters/claude.ts`. Signature:
```typescript
function sanitisedEnv(): NodeJS.ProcessEnv
```
Returns a `Record<string, string>` safe to pass as `env` to `child_process.spawn`. T4 passes this directly to the subprocess spawn options — it does not further modify the returned object.

### `AdapterResponse` (inherited from WS_01 T3 → produced by T4, consumed by WS_03, WS_04)
`{ raw: string, backend: "claude-subprocess" }`. T4's `_complete_via_subprocess()` sets `backend: "claude-subprocess"`. WS_04's `validator.ts` reads `raw` and ignores `backend` (transport-agnostic). Do not add fields to `AdapterResponse` without a Decision Log entry — it is a cross-phase contract.

---

## Success & Evaluation Criteria

- **Functional requirements**:
  - [ ] `ClaudeAdapter` satisfies `CLIAdapter` — TypeScript structural check passes with zero `any`.
  - [ ] `buildConstrainedPrompt` output contains the constraint instructions verbatim (assert substring match in unit test).
  - [ ] `buildConstrainedPrompt` output contains each caller message serialized faithfully (assert content appears in output).
  - [ ] `sanitisedEnv()` strips `HOME`, `PWD`, `OLDPWD`, and the filesystem-revealing vars identified empirically.
  - [ ] `sanitisedEnv()` preserves the auth-required vars confirmed empirically (recorded in Decision Log).
  - [ ] `ClaudeAdapter.healthCheck()` returns `true` on the dev machine with `claude` installed and authenticated.
  - [ ] `ClaudeAdapter.complete()` returns an `AdapterResponse` with a non-empty `raw` string when called with `messages:[{role:"user",content:"Hello"}]` — verified manually or in the WS_03 integration test (not required as an automated test in WS_02 itself, which avoids network dependency in the unit suite).

- **Named tests that prove this workstream done**:
  - [ ] `tests/adapters/base.test.ts` — a minimal stub class satisfies `CLIAdapter` (structural type test via TypeScript; no assertions needed beyond compile success).
  - [ ] `tests/adapters/buildConstrainedPrompt.test.ts` — constraint instructions present; messages serialized; `tools: undefined` path; `tools: [...]` path; no mutation of input arrays.
  - [ ] `tests/adapters/sanitisedEnv.test.ts` — each stripped var is absent from the returned object; each required auth var is present; returned type is `Record<string,string>`.
  - [ ] `tests/adapters/claudeAdapter.healthCheck.test.ts` — mocked `which`/`exec` path returns `true` for installed+auth case, `false` for missing `claude` case.

- **Quality gates**:
  - [ ] `npm test` green; no test-count regression from WS_01 baseline
  - [ ] `npm run typecheck` clean — zero `any`, no implicit `any`
  - [ ] `npm run lint` clean; `npm run format` produces no diff
  - [ ] Coverage: `build_constrained_prompt` and `sanitised_env` at 100% branch coverage (pure functions, no I/O — no excuse for gaps)

---

## Known Pitfalls & Implementation Notes

**`child_process.spawn` vs `exec` vs `spawnSync`**: Use `child_process.spawn` with `stdio: ['pipe','pipe','pipe']` and collect stdout via a `data` event or `async/await` with `util.promisify` is not an option for spawn directly — use the `child_process` promise wrapper pattern or `execa` (a well-maintained thin wrapper). Do not use `execSync` or `spawnSync` — they block the Node event loop (CLAUDE.md: "never block the event loop"). If `execa` is added as a dependency, note it in T4's tracker.

**Stdin encoding for `claude --print`**: The constrained prompt is passed via stdin. Confirm that `claude --print` reads from stdin (vs requiring a file argument) by manual probe in T3's empirical work. The spec §3.8 and experiments §5.1 use `echo '<prompt>' | claude --print` — this is the confirmed pattern.

**`claude --print` exit codes**: A non-zero exit code does not necessarily mean the response is malformed — it may mean an auth failure or a timeout. `_complete_via_subprocess()` must inspect both the exit code and stdout. If exit code is non-zero and stdout is empty, throw `TransportError`. If exit code is non-zero but stdout is non-empty JSON, let the validator decide.

**`healthCheck()` authentication probe**: `claude whoami` or an equivalent command may be the right probe. Determine the exact command empirically in T3 alongside the env allowlist work — they are related (the auth probe uses the same env).

**Constraint wording**: The constraint in `build_constrained_prompt` should mirror the language from spec §3.5 and §3.6 as closely as possible. The experiments (§5.2) confirmed it works; do not drift from the validated wording without a documented reason and a re-run of the WS_03 execution-suppression test.

**`tools: undefined` vs `tools: []`**: These should behave identically in `build_constrained_prompt` — no tool schemas injected. Make this explicit in the unit test to avoid a subtle bug where an empty array serializes as `"tools: []"` in the prompt and confuses the model.
