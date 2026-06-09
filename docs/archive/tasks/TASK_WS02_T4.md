# TASK_WS02_T4: Author `ClaudeAdapter` — Subprocess Implementation

## Context

- **Workstream**: WS_02 (Claude Subprocess Adapter & Constraint)
- **Plan reference**: `docs/plan/workstreams/ws02_subprocess_adapter_and_constraint.md`
- **Phase plan**: `docs/plan/phases/01a_transport_and_constraint.md`
- **Depends on**: TASK_WS02_T1 (`CLIAdapter` interface in `src/adapters/base.ts`); TASK_WS02_T2 (`buildConstrainedPrompt` in `src/adapters/claude.ts`); TASK_WS02_T3 (`sanitisedEnv()` in `src/adapters/claude.ts` and WS_02-D2-allowlist confirmed).
- **Blocks**: WS_03 (adapter proving — cannot run integration tests against a real Claude subscription until `adapter.complete()` exists and is stable). Also unblocks WS_05 (the proxy server holds a `CLIAdapter` reference and calls `adapter.complete()`).

---

## Goal & Why

- **Goal**: Author the `ClaudeAdapter` class in `src/adapters/claude.ts` that implements `CLIAdapter`. Specifically: `complete(req)` delegates entirely to `_complete_via_subprocess(req)`; `_complete_via_subprocess(req)` spawns `claude --print`, passes `buildConstrainedPrompt(...)` via stdin, reads stdout, and returns `AdapterResponse`; `healthCheck()` uses the probe command confirmed in T3 and returns `true`/`false` without throwing; `install()` is a no-op stub that throws with a descriptive Phase 2 message. Author `tests/adapters/claudeAdapter.healthCheck.test.ts` with mocked healthCheck path tests. Document the manual smoke test but do not automate it (WS_03 owns the real subprocess integration tests).
- **Why**: This is the integration task that wires T1, T2, and T3 into a functional adapter. Every request in Phase 1 flows through `_complete_via_subprocess()`. Getting the subprocess lifecycle correct here — stdin encoding, stdout collection, exit code semantics, error surfacing — is the foundational quality gate for the entire Phase 1 product. A broken subprocess path means nothing works end-to-end; a subprocess path with incorrect error handling means failures are silent or misattributed.

---

## Assumptions to Test

| # | Assumption | Why we believe it | How this task tests it | If false → |
|---|---|---|---|---|
| A1 | `claude --print` reads its prompt from stdin when stdin is piped to it (vs. requiring a file argument or a CLI flag) | Spec §3.8 and experiments §5.1 confirm `echo '<prompt>' \| claude --print` is the correct invocation pattern | Manual smoke test (documented in Test Strategy) confirms stdin is the correct input channel | If `claude --print` does not read stdin: investigate whether a `--message` flag or a temp file is required; file an issue and do not ship a workaround without a Decision Log entry — this would change the subprocess invocation contract for WS_03 and beyond |
| A2 | Non-zero exit code from `claude --print` always means a transport-level failure (auth, network, timeout), never a content-level issue | `claude --print` exits 0 on a successful response (even if the response JSON is invalid from our perspective) | Smoke test: send a malformed prompt and observe exit code and stdout; send a valid prompt and observe success | If a non-zero exit code can accompany a valid JSON response: update the exit-code handling logic in `_complete_via_subprocess()` to treat non-zero + non-empty stdout as a "let the validator decide" case (this is already the documented fallback — confirm empirically) |
| A3 | `child_process.spawn` with `stdio: ['pipe', 'pipe', 'pipe']` correctly captures all stdout before the process exits (no buffering truncation) | Standard Node.js subprocess pattern; no known truncation issue for CLI-scale responses | Manual smoke test with a large response (>4 KB) to confirm full capture | If stdout is truncated: switch to `execa` which wraps `spawn` with robust buffering; note the dependency addition and add `execa` to `package.json` |
| A4 | `healthCheck()` using the probe command confirmed in T3 correctly distinguishes "installed + authenticated" (`true`) from "claude binary missing" (`false`) without throwing | T3's spike step 2 confirmed the probe command | Mocked unit tests in `claudeAdapter.healthCheck.test.ts`; real confirmation in WS_03 integration test | If the probe command returns ambiguous results: fallback to `claude --version` (proves installed, not authenticated); document the limitation in WS_02-D2-allowlist and in `ClaudeAdapter.healthCheck()` inline |

---

## Expected Failures

- **EF1** `child_process.spawn` under `"type":"module"` (ESM) requires importing from `'node:child_process'` (with the `node:` protocol prefix) rather than `'child_process'`. Under the project's TypeScript config (`"moduleResolution":"bundler"`), both forms typically work — but use `'node:child_process'` explicitly to follow ESM best practices and to avoid a potential module resolution surprise. Same for `'node:process'`.
- **EF2** Writing to `stdin` after the subprocess starts requires calling `subprocess.stdin.end()` after writing the prompt. If `stdin.end()` is not called, `claude --print` will wait indefinitely for more input — hanging the entire Node event loop. This is a common subprocess gotcha. The pattern must be: `subprocess.stdin.write(prompt); subprocess.stdin.end();`.
- **EF3** If `execa` is used as the subprocess helper, it must be added to `dependencies` (not `devDependencies`) because `_complete_via_subprocess()` is runtime code, not test infrastructure. If the BSE decides to use `child_process.spawn` directly, no new dependency is needed — but the stdout collection must use a `Promise` wrapper around the `data` and `close` events. Never use `spawn` with synchronous `.pid` checks or `spawnSync`. Document whichever path is chosen in this tracker's Files Modified section.
- **EF4** The `TransportError` thrown on non-zero exit + empty stdout must include the exit code and any stderr output in its message to aid debugging. `new TransportError(\`claude --print exited with code \${code}; stderr: \${stderrContent}\`)`. Stderr content must be captured alongside stdout — `stdio: ['pipe', 'pipe', 'pipe']` enables this.
- **EF5** `ClaudeAdapter` must use `implements CLIAdapter` explicitly in its class declaration — not just structurally satisfy the interface. This gives TypeScript compile-time enforcement at the adapter file itself: if a method signature drifts, the error appears at the class, not at the consumer. Without `implements`, a type drift could compile silently in `claude.ts` and only surface at the consumer (e.g., `proxy.ts`) as a confusing assignment error.
- **EF6** `install()` stub must throw synchronously inside an `async` function — i.e., the method signature is `async install(): Promise<void>` and the body is `throw new Error("install() not implemented in Phase 1...")`. Do NOT return a rejected promise or use `Promise.reject()` — throwing inside `async` automatically wraps the throw in a rejected promise, which is the correct contract for `install()` callers.

---

## Test Strategy

- **Unit**: `tests/adapters/claudeAdapter.healthCheck.test.ts` — test `healthCheck()` only, with the subprocess call mocked. Case 1: mock the probe command returning exit code 0 → `healthCheck()` returns `true`. Case 2: mock the probe command returning exit code non-zero (or binary not found) → `healthCheck()` returns `false`. Case 3: mock the probe command throwing (unexpected error) → `healthCheck()` propagates the throw (or returns `false` if the implementation swallows unexpected errors — choose one, document the choice). No real subprocess is spawned in these tests.
- **Integration**: Deferred to WS_03. `_complete_via_subprocess()` is intentionally NOT tested with a mocked subprocess here — doing so would test the mock, not the production path. WS_03 is the integration layer that exercises the real subprocess against a real subscription.
- **Contract**: `ClaudeAdapter` satisfies `CLIAdapter` — confirmed by `implements CLIAdapter` on the class declaration and `npm run typecheck`. The return type of `complete()` is `Promise<AdapterResponse>` — `{ raw: string, backend: 'claude-subprocess' }`. The contract test is structural + typelevel; the content test is WS_03.
- **Contamination/Isolation**: Not tested here. WS_09 owns contamination probes. The per-request isolation of `_complete_via_subprocess()` (stateless by construction — fresh subprocess per request) is the architectural guarantee; no test infrastructure is needed to prove it in WS_02.
- **Manual/spike**: The manual smoke test is the integration signal for WS_02 T4. It is documented below and must be run before the task is submitted for review. It does NOT need to be an automated test.

### Manual Smoke Test Protocol (required before submitting T4 for review)

Run the following in the repo root. Capture the output and paste it into the Subtask 6 Notes column.

```typescript
// smoke-test.ts (temporary file — delete after T4 sign-off)
import { ClaudeAdapter } from './src/adapters/claude.js';

const adapter = new ClaudeAdapter();

// Test 1: healthCheck
const healthy = await adapter.healthCheck();
console.log('healthCheck:', healthy); // expected: true

// Test 2: complete — text response
const response = await adapter.complete({
  messages: [{ role: 'user', content: 'Reply with only the word "pong". No other text.' }],
  tools: undefined,
});
console.log('complete.raw:', response.raw);    // expected: {"type":"text","content":"pong"}
console.log('complete.backend:', response.backend); // expected: "claude-subprocess"
```

Run with `npx tsx smoke-test.ts`. Expected output: `healthCheck: true`; `complete.raw` is a valid JSON string parseable by `QuotagateCompleteResultSchema`; `complete.backend` is `"claude-subprocess"`. Delete `smoke-test.ts` after the test.

If the smoke test fails: do not submit for review. Diagnose the failure, fix it at the correct layer, and re-run.

---

## Contract: What This Task Inherits

| Symbol / Artifact | Source | Role in This Task |
|---|---|---|
| `CLIAdapter` interface | `src/adapters/base.ts` (TASK_WS02_T1) | `ClaudeAdapter implements CLIAdapter` — all method signatures must match exactly |
| `AdapterRequest`, `AdapterResponse` | `src/types.ts` (TASK_WS01_T3) | `complete()` parameter and return type; `backend: 'claude-subprocess'` literal must be set on the return value |
| `TransportError` | `src/errors.ts` (TASK_WS01_T4) | Thrown by `_complete_via_subprocess()` on non-zero exit + empty stdout; never re-declared in this file |
| `buildConstrainedPrompt` | `src/adapters/claude.ts` (TASK_WS02_T2) | Called exactly once per `_complete_via_subprocess()` invocation to produce the stdin string; T4 must NOT add additional constraint instructions at the call site |
| `sanitisedEnv()` | `src/adapters/claude.ts` (TASK_WS02_T3) | Passed directly to `child_process.spawn`'s `env` option; T4 must NOT further modify the returned object |
| WS_02-D2-allowlist + healthCheck probe command | TASK_WS02_T3 (CLAUDE.md Decision Log) | The confirmed probe command for `healthCheck()` — read from the Decision Log before authoring `healthCheck()` |

---

## Subtask Progress Table

| # | Subtask | Status | Iteration | Notes |
|---|---|---|---|---|
| 1 | Confirm `src/adapters/claude.ts` exists and contains `buildConstrainedPrompt` and `sanitisedEnv()` (T2 and T3 outputs); read WS_02-D2-allowlist from CLAUDE.md for the healthCheck probe command | ✅ Done | 1 | Confirmed. healthCheck probe: `claude auth status`. |
| 2 | Add `ClaudeAdapter` class declaration with `implements CLIAdapter`; add `readonly name = 'claude-subprocess'`; stub all three methods with `throw new Error('not implemented')` | ✅ Done | 1 | `implements CLIAdapter` present on class declaration; `readonly name = 'claude-subprocess'`. |
| 3 | Implement `_complete_via_subprocess(req: AdapterRequest): Promise<AdapterResponse>`: spawn `claude --print`; write `buildConstrainedPrompt(...)` to stdin; close stdin; collect stdout and stderr; handle exit code per EF4 spec | ✅ Done | 3 | `node:child_process` / `stdio: ['pipe','pipe','pipe']` / `stdin.write` + `stdin.end()` / Buffer chunk collection / EF4 TransportError on non-zero + empty stdout. No `spawnSync`/`execSync` (grep confirmed empty). Named `_completeViaSubprocess`. |
| 4 | Implement `complete(req: AdapterRequest): Promise<AdapterResponse>`: single-line delegation to `_complete_via_subprocess(req)` | ✅ Done | 1 | One-line: `return this._completeViaSubprocess(req)`. No transport-selection logic. |
| 5 | Implement `healthCheck(): Promise<boolean>`: spawn the T3-confirmed probe command with `sanitisedEnv()`; return `true` on exit code 0; return `false` on non-zero or ENOENT; never throw on `false` | ✅ Done | 3 | `claude auth status` probe / ENOENT resolves `false` / non-zero resolves `false` / unexpected errors reject. |
| 6 | Implement `install(): Promise<void>` stub: `throw new Error("install() not implemented in Phase 1 — MCP registration is Phase 2")` | ✅ Done | 1 | Throws from inside `async` body (EF6). Message contains "Phase 1" and "Phase 2". |
| 7 | Run manual smoke test; paste output into Notes | ✅ Done | 1 | Smoke test ran successfully via `npx tsx smoke-test.ts`. `healthCheck: true`; `complete.raw` returned valid JSON (`{"type":"text","content":"pong"}`); `complete.backend: claude-subprocess`. `smoke-test.ts` deleted post-run. |
| 8 | Author `tests/adapters/claudeAdapter.healthCheck.test.ts`; run `npm test` | ✅ Done | 1 | 4 mocked tests (T-1..T-4). `vi.mock('node:child_process', () => ({ spawn: vi.fn() }))` + `makeMockChild` helper using `EventEmitter` + `setImmediate`. 27 tests total, all pass. |
| 9 | Run full green gate: `npm test` / `npm run typecheck` / `npm run lint` / `npm run format` | ✅ Done | 1 | `npm test`: 27/27 pass. `typecheck`: 0 errors. `lint`: 0 violations. `format`: all files unchanged. |

_Status icons: `✅ Done` | `🔄 In progress` | `⬚ Not started` | `❌ Blocked`_

---

## Current Subtask Detail

### Subtask 3: Implement `_complete_via_subprocess()`

**Approach iteration plan** (simplest → target):

1. Implement the spawn + stdin + stdout collection skeleton. Use `child_process.spawn('claude', ['--print'], { stdio: ['pipe', 'pipe', 'pipe'], env: sanitisedEnv() })`. Write the prompt to stdin. Collect stdout chunks into an array; join on `'close'` event. Resolve with `{ raw: joinedStdout, backend: 'claude-subprocess' as const }`.
2. Add exit-code handling: if `code !== 0 && stdout.trim() === ''` → throw `new TransportError(...)` with exit code and stderr. If `code !== 0 && stdout.trim() !== ''` → return `AdapterResponse` (validator decides). If `code === 0` → return `AdapterResponse` regardless of content (validator decides).
3. Wrap the entire function in a try/catch for unexpected spawn failures (ENOENT, EACCES) → re-throw as `TransportError`.

- **Current iteration**: 1 of 3
- **Verifiability / Success Criteria**: Manual smoke test returns a valid JSON string in `response.raw`; mocked `healthCheck` unit tests pass; `npm run typecheck` exits 0.
- **Challenges**: EF1 (node: protocol prefix); EF2 (stdin.end() must be called); EF3 (execa vs. spawn decision); EF4 (stderr capture).

### Subtask 5: Implement `healthCheck()`

**Approach iteration plan** (simplest → target):

1. Spawn the T3-confirmed probe command with `sanitisedEnv()`. Use a tight timeout (e.g. 5 seconds) — `healthCheck()` is called on startup, and a hanging probe would stall the proxy start.
2. On exit code 0 → return `true`. On exit code non-zero → return `false`. On `ENOENT` (binary not found) → return `false` (not throw).
3. On unexpected spawn errors (not ENOENT) → throw. This is the only case where `healthCheck()` throws.

- **Current iteration**: 1 of 3
- **Verifiability / Success Criteria**: Mocked tests in `claudeAdapter.healthCheck.test.ts` pass for installed+authenticated (true), missing binary (false). Manual smoke test confirms `healthCheck()` returns `true` on the dev machine.
- **Challenges**: A4 (distinguishing "installed but not authenticated" from "not installed"); timeout implementation without blocking the event loop.

---

## Decisions Made

### WS_02-D3 — `install()` Is a No-Op Stub in Phase 1 ✅ LOCKED (Architect, 2026-06-08)

**Decision**: `ClaudeAdapter.install()` throws `new Error("install() not implemented in Phase 1 — MCP registration is Phase 2")` from inside an `async` method body. It satisfies the `CLIAdapter` interface.

**Rationale**: `install()` in the full design writes `~/.quotagate/CLAUDE.md` and runs `claude mcp add` — both Phase 2 MCP concerns (D-SEQ-01). The stub makes the omission explicit and loud. `proxy.ts` and `installer.ts` in Phase 2 will call `adapter.install()`; the Phase 1 stub ensures callers get a clear error rather than a silent no-op if they accidentally invoke it before Phase 2.

**Rejected alternative — `install()` returns `Promise.resolve()` silently**: Silent no-op hides the fact that the MCP registration has not happened. The WS_05 proxy startup code may need to call `install()` — a silent pass would make it appear the installation succeeded.

**Rejected alternative — omit `install()` from `CLIAdapter` until Phase 2**: Breaks invariant #4. All adapters must share the same interface; retrofitting a required method into an interface mid-phase forces changes to every existing implementor.

### WS_02-D-T4-01 — `_complete_via_subprocess()` Uses `child_process.spawn`, Not `exec` or Sync Variants ✅ LOCKED (Architect, 2026-06-09)

**Decision**: `_complete_via_subprocess()` uses `child_process.spawn` (or `execa` as a thin wrapper) with `stdio: ['pipe', 'pipe', 'pipe']`. Never `execSync`, `spawnSync`, or `exec` with a callback.

**Rationale**: `execSync` and `spawnSync` block the Node.js event loop for the entire duration of the subprocess. The project convention (CLAUDE.md: "never block the event loop") and the async-first coding standard both prohibit this. `exec` with a callback is callback-based and does not compose with `async/await`. `spawn` with event listeners, or `execa` (which wraps `spawn` with async/await), is the only production-safe choice.

**Rejected alternative — `execSync`**: Blocks the event loop; usable in a smoke test, never in production.

**Rejected alternative — `exec` with callback, then `util.promisify`**: `util.promisify(exec)` has a hard 200 KB stdout buffer limit (`maxBuffer` default). A Claude response that approaches this limit would silently truncate. `spawn` with streamed stdout collection has no such limit.

### WS_02-D-T4-02 — `complete()` Delegates Entirely to `_complete_via_subprocess()` in Phase 1; No MCP Path ✅ LOCKED (Architect, 2026-06-09)

**Decision**: In Phase 1, `complete()` is a one-line delegation: `return this._complete_via_subprocess(req)`. There is no MCP path, no fallback branching, no transport selection logic.

**Rationale**: D-SEQ-01 is locked — MCP transport is Phase 2. Any Phase 1 transport-selection logic in `complete()` would be dead code at best and a maintenance hazard at worst. The clean separation is: `complete()` owns the interface contract; `_complete_via_subprocess()` owns the subprocess implementation. When Phase 2 replaces the transport, `complete()` gains a method call to the MCP path with the subprocess as fallback — but that branching lives in `complete()`, not scattered across callers.

**Rejected alternative — implement transport fallback in Phase 1 as a future-proofing measure**: Dead code in Phase 1 is technical debt. If the MCP path does not exist, a fallback to it serves no purpose and adds cognitive overhead for the BSE implementing WS_03.

### WS_02-D-T4-03 — If `execa` Is Added, It Is a Runtime Dependency ✅ LOCKED (Architect, 2026-06-09)

**Decision**: If the BSE chooses `execa` over the raw `child_process.spawn` wrapper, `execa` is added to `dependencies` (not `devDependencies`) in `package.json`. The BSE documents the choice in this tracker's Files Modified section and in the Subtask 3 Notes.

**Rationale**: `_complete_via_subprocess()` is production runtime code that runs on every API request. A runtime dependency must be in `dependencies` so it is included in the packaged `quotagate` binary.

**Rejected alternative — add `execa` to `devDependencies`**: The binary would fail at runtime on a fresh install (no `node_modules/execa` in production). This is a silent packaging error.

### Anti-overengineering scope fence ✅ LOCKED

**This task explicitly does NOT include**:

- MCP client code, MCP session management, `_mcp_lock`, or `StdioClientTransport` — Phase 2 head; D-SEQ-01 is locked.
- Connection pooling or request queue for the subprocess — WS_08. Each request spawns a fresh subprocess in Phase 1; per-request isolation is free.
- Retry loop — WS_04 (`validator.ts` owns the retry logic; the adapter returns `AdapterResponse` and lets the caller decide whether to retry).
- OpenAI response building — WS_05/WS_07. `_complete_via_subprocess()` returns `AdapterResponse { raw, backend }` only; it does not parse or transform the JSON.
- Streaming / SSE — Phase 3. `complete()` returns a fully collected response string.
- `~/.quotagate/CLAUDE.md` generation — `installer.ts` (Phase 2).
- `src/adapters/gemini.ts` or `src/adapters/codex.ts` stubs — Phase 2. Do not create placeholder files.
- Automated integration tests against a real Claude subscription — WS_03 owns these. Do not add network-dependent tests to T4's test suite.

---

## Cross-Task Contracts (Downstream Dependencies on This Task)

### WS_03 will depend on:

- `ClaudeAdapter` instantiatable via `new ClaudeAdapter()` — no constructor arguments required in Phase 1. WS_03 imports the class and calls `adapter.complete()` against a real subscription.
- `adapter.complete({ messages: [...] })` returns `AdapterResponse` with `raw` set to a non-empty string when the subscription is healthy. WS_03 passes `raw` to `QuotagateCompleteResultSchema.parse()` to confirm the constraint is working.
- `adapter.healthCheck()` returns `true` on the WS_03 test machine. WS_03 may gate its integration tests on `healthCheck()` to skip gracefully in CI.

### WS_05 will depend on:

- `CLIAdapter` interface only — `proxy.ts` holds a `CLIAdapter` reference. It must NOT import `ClaudeAdapter` directly. The constructor call (`new ClaudeAdapter()`) lives in the composition root (a future `src/index.ts` or `src/config.ts` — not `proxy.ts`).
- `adapter.complete(req)` returning `Promise<AdapterResponse>` synchronously rejects with `TransportError` on subprocess failure.

---

## Files Modified / Created

- `src/adapters/claude.ts` — **modify** (add `ClaudeAdapter` class: `implements CLIAdapter`; `readonly name = 'claude-subprocess'`; `complete()`; `_complete_via_subprocess()`; `healthCheck()`; `install()` stub; necessary imports from `node:child_process`, `src/types.ts`, `src/errors.ts`)
- `tests/adapters/claudeAdapter.healthCheck.test.ts` — **create new** (mocked healthCheck unit tests; see Required Test Cases)
- `package.json` — **possibly modify** (add `execa` to `dependencies` if BSE chooses `execa` over raw `spawn`; otherwise no change)

---

## Success Criteria / Verifiability

| # | Criterion | How to verify |
|---|---|---|
| SC-1 | `ClaudeAdapter implements CLIAdapter` — TypeScript compile-time enforcement at the class declaration | `npm run typecheck` exits 0; the `implements` keyword is present in the class declaration |
| SC-2 | `complete()` is a one-line delegation to `_complete_via_subprocess()` — no transport-selection logic, no MCP paths | Code inspection |
| SC-3 | `_complete_via_subprocess()` uses `spawn` (or `execa`), never `execSync`/`spawnSync` | Code inspection; grep: `grep -r "spawnSync\|execSync" src/adapters/` returns empty |
| SC-4 | Non-zero exit + empty stdout → `TransportError` thrown with exit code and stderr content in message | Code inspection; EF4 pattern present |
| SC-5 | Non-zero exit + non-empty stdout → `AdapterResponse` returned (validator decides) | Code inspection; manual smoke test with a forced non-zero + non-empty case if feasible |
| SC-6 | `stdin.end()` is called after writing the prompt | Code inspection; EF2 pattern present |
| SC-7 | `sanitisedEnv()` return value passed directly to `spawn`'s `env` option — not further modified | Code inspection |
| SC-8 | `healthCheck()` returns `true` on dev machine with installed + authenticated `claude` | Manual smoke test: `healthy === true` |
| SC-9 | `healthCheck()` returns `false` (not throws) when `claude` binary is missing | T-2 mocked unit test passes |
| SC-10 | `install()` throws with message containing `"Phase 1"` and `"Phase 2"` | T-3 unit test passes |
| SC-11 | Manual smoke test: `adapter.complete({ messages: [{role:'user', content:'...'}] })` returns `AdapterResponse` with non-empty `raw` and `backend: 'claude-subprocess'` | Smoke test output pasted into Subtask 7 Notes |
| SC-12 | `npm run typecheck` clean — zero errors | `npx tsc --noEmit`; zero output |
| SC-13 | `npm run lint` clean; `npm run format` no diff | Zero ESLint violations; Prettier reports no files changed |
| SC-14 | `npm test` green; no regressions from prior baseline | All tests pass |

---

## Required Test Cases

File: `tests/adapters/claudeAdapter.healthCheck.test.ts`

> These tests mock the subprocess call used by `healthCheck()`. They do NOT mock `_complete_via_subprocess()` — the real subprocess path is integration-tested in WS_03, not here.

> Mocking approach: use `vi.mock('node:child_process')` (or `vi.spyOn`) to intercept the `spawn` call inside `healthCheck()`. Alternatively, if the implementation abstracts the spawn call into a private helper, mock that helper. The goal is to test the `healthCheck()` logic without spawning a real process.

### T-1: healthCheck returns true when probe exits 0 (covers SC-8, A4)

Mock the subprocess probe command to emit exit code `0` on the `'close'` event. Call `await adapter.healthCheck()`. Assert the result is `true`.

### T-2: healthCheck returns false when claude binary is missing (covers SC-9, A4)

Mock the subprocess spawn to emit an `'error'` event with `{ code: 'ENOENT' }`. Call `await adapter.healthCheck()`. Assert the result is `false`. Assert the call did not throw.

### T-3: install() throws with a Phase 2 message (covers SC-10, WS_02-D3)

Call `await adapter.install().catch(e => e)`. Assert the caught value is an `Error`. Assert `error.message` contains `'Phase 1'` or `'Phase 2'` (implementation-specific wording — at minimum one of these substrings must be present).

### T-4: healthCheck returns false when probe exits non-zero (covers SC-9)

Mock the subprocess probe command to emit exit code `1` on the `'close'` event. Call `await adapter.healthCheck()`. Assert the result is `false`. Assert the call did not throw.

---

## Review Notes

_(Architect fills after BSE submits — verdict APPROVE / APPROVE-WITH-NITS / REQUEST-CHANGES, findings classified required-change / nit / informational, mapped to SC / decision IDs.)_

---

## Architect Sign-off

- [ ] Implementation reviewed
- [ ] All success criteria verified
- [ ] All assumptions resolved (proven, or fallback taken & documented)
- [ ] No regressions in full test suite
- [ ] `npm test` / `typecheck` / `lint` / `format` all clean
