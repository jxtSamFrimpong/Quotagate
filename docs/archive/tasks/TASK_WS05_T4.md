# TASK_WS05_T4: CLI Entrypoint (`src/index.ts`)

## Context

- **Workstream**: WS_05 (Fastify Proxy & Config)
- **Plan reference**: `docs/plan/workstreams/ws05_fastify_proxy_and_config.md`
- **Phase plan**: `docs/plan/phases/01b_openai_translation_pipeline.md`
- **Depends on**: WS_05-T2 (`createServer` factory); WS_05-T3 (fully-wired pipeline in
  `createServer`); WS_05-T1 (`loadConfig`); WS_03 (`ClaudeAdapter` with `healthCheck()`).
- **Blocks**: WS_06 (the integration test boots the server using the path T4 establishes, though
  WS_06 may construct the server directly via `createServer` rather than spawning the CLI —
  confirm with WS_06 planning).

---

## Goal & Why

- **Goal**: Replace the two-line stub in `src/index.ts` with a real `quotagate start` entrypoint:
  parse `process.argv[2]`, call `loadConfig()`, instantiate `ClaudeAdapter`, call
  `adapter.healthCheck()`, exit with code 1 and a clear message if it returns false, then call
  `createServer(config, adapter)` and `server.listen({ port: 8080, host: "127.0.0.1" })`. Stub
  `quotagate status` and `quotagate backends` with a `"not implemented in Phase 1"` message. Add a
  `"Quotagate running on localhost:8080. Backend: claude"` log on successful listen.

- **Why**: `index.ts` is the operator interface — the first thing a developer runs when they want to
  use Quotagate. Its two non-negotiable jobs are: (1) fail loudly with actionable guidance before
  the server starts if the system is misconfigured (config invalid, Claude CLI missing or
  unauthenticated), and (2) succeed silently and stay running when everything is correct. The
  health-check-before-listen pattern specifically prevents the class of silent failures where the
  server starts, the developer assumes it works, and the first real request produces an opaque
  error with no pointer to the root cause. The failure must happen at boot time, with a message
  that tells the developer exactly what to check. This also closes the loop on D-SEQ-01: the
  subprocess-first Phase 1 MVP is complete the moment `quotagate start` starts accepting OpenAI
  SDK requests through a real `ClaudeAdapter`.

---

## Assumptions to Test

| #  | Assumption                                                                                        | Why we believe it                                                                                | How this task tests it                                                                              | If false →                                                                                         |
|----|---------------------------------------------------------------------------------------------------|--------------------------------------------------------------------------------------------------|------------------------------------------------------------------------------------------------------|----------------------------------------------------------------------------------------------------|
| A1 | `adapter.healthCheck()` is `async` and returns `Promise<boolean>` (already confirmed in WS_03)    | Defined in `CLIAdapter` interface (`src/adapters/base.ts`) and implemented in `ClaudeAdapter`     | T-1: mock `healthCheck` returning `false`; assert `process.exit(1)` is called                       | Already confirmed; note if the interface changes                                                    |
| A2 | `process.exit(1)` terminates the process — calling it in tests must be intercepted with a spy     | Standard Node behavior                                                                            | T-1: spy on `process.exit` with `vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("exit called") })` before asserting | Already a common Vitest pattern |
| A3 | `loadConfig()` called with no argument resolves the default `~/.quotagate/config.yaml` path        | T1 resolves `path.join(os.homedir(), ".quotagate", "config.yaml")` (WS_05-D6)                    | T-2: spy on `loadConfig`; assert it is called with `undefined` (no explicit path)                   | If the default path changes, update the smoke-test expectation                                     |
| A4 | `server.listen({ port: 8080, host: "127.0.0.1" })` binds correctly and resolves the promise       | Fastify's `listen()` is async and resolves on successful bind; WS_05-D1 locked this address      | Manual smoke test: run `npx tsx src/index.ts start` and observe the ready log line                  | Investigate Fastify bind errors on `127.0.0.1`; should not fail on a development machine           |

---

## Expected Failures

- **[EF1] `loadConfig()` throws `QuotagateError` (missing config file or invalid config)** — the
  common first-run case: `~/.quotagate/config.yaml` does not exist on a fresh machine (WS_05-D6/D8,
  fail-loud — Quotagate does not auto-create it). Handled by: catch the error in `index.ts`; print
  the error message (which already carries the create-it guidance from `loadConfig`) to
  `process.stderr`; call `process.exit(1)`. The stack trace must NOT be printed.
- **[EF2] `adapter.healthCheck()` returns `false`** — handled by: print a human-readable guidance
  message to `process.stderr` ("Claude CLI is not installed or not authenticated. Run 'claude auth
  status' to verify."); call `process.exit(1)`.
- **[EF3] `adapter.healthCheck()` throws** — `healthCheck()` can throw if the spawn itself fails
  catastrophically (not just a non-zero exit code — see `ClaudeAdapter.healthCheck` in WS_03: it
  resolves `false` for `ENOENT`, and rejects for other errors). If it throws, let the error
  propagate to the top-level unhandled-rejection handler, which prints the error and exits non-zero.
  This is acceptable for Phase 1 (an unexpected throw from `healthCheck` is a bug, not a user
  error). Document this in the implementation as a known edge case.
- **[EF4] `server.listen()` fails (port already in use)** — Fastify rejects the promise;
  `process.exit(1)` with the Fastify error message. Port conflict is an operator error (another
  process is on 8080); the message must include the port number.
- **[EF5] Unknown `process.argv[2]` subcommand** — print "Unknown command: [argv[2]]. Available:
  start" and call `process.exit(1)`.

---

## Test Strategy

- **Unit**: `tests/index.test.ts`. Test the behavior of `index.ts` by importing and invoking its
  exported `main()` function (or equivalent entry function) with a mocked environment. Do NOT
  execute `index.ts` as a subprocess in unit tests — use module-level mocking (mock `loadConfig`,
  mock `ClaudeAdapter`, spy on `process.exit`, mock `createServer` to return a fake `FastifyInstance`
  with a `listen` spy). This keeps tests fast and deterministic.
- **Integration**: Manual smoke test only (see A4). Full integration test is WS_06.
- **Contract**: Assert that `process.exit(1)` is called on health-check failure AND that the
  error message printed to stderr contains actionable guidance.
- **Manual/spike**: Run `npx tsx src/index.ts start` with a real `config.yaml` and confirmed Claude
  CLI auth. Observe the ready log line. Then run with `claude auth logout` to confirm the health-
  check failure path exits with code 1 and a readable message.

---

## Contract: What This Task Inherits

| Symbol / Artifact              | Source                   | Role in This Task                                                                                       |
|--------------------------------|--------------------------|---------------------------------------------------------------------------------------------------------|
| `loadConfig`                   | `src/config.ts` (T1)     | Called with no argument → reads `~/.quotagate/config.yaml` (WS_05-D6); throws `QuotagateError` (fail-loud, WS_05-D8) on absence/invalid |
| `QuotagateConfig`              | `src/config.ts` (T1)     | Passed to `createServer` and implicitly to `ClaudeAdapter` (Phase 1: adapter is independent of config) |
| `ClaudeAdapter`                | `src/adapters/claude.ts` | Instantiated with `new ClaudeAdapter()`; `healthCheck()` called before `listen()`                       |
| `createServer`                 | `src/proxy.ts` (T2/T3)   | Called with `(config, adapter)`; returns `FastifyInstance`; T4 then calls `server.listen(...)`          |
| `QuotagateError`               | `src/errors.ts`          | Caught from `loadConfig`; message printed to stderr; `process.exit(1)` called                           |
| WS_05-D1 (`127.0.0.1:8080`)   | WS_05 plan               | `server.listen({ port: 8080, host: "127.0.0.1" })` — hardcoded in Phase 1                              |

---

## Subtask Progress Table

| #  | Subtask                                                                                                                     | Status        | Iteration | Notes |
|----|-----------------------------------------------------------------------------------------------------------------------------|---------------|-----------|-------|
| 1  | Replace the two-line stub in `src/index.ts` with a structured `main()` function (or top-level `switch`)                    | ✅ Done       | 1         | Named `main(argv?)` export; top-level call guarded by `import.meta.url` check (ESM main-module guard) |
| 2  | Implement `quotagate start`: `loadConfig()` → catch + exit 1; `new ClaudeAdapter()`; `healthCheck()` → exit 1 if false; `createServer()`; `server.listen()` | ✅ Done | 1 | All EF1–EF4 paths implemented; EF3 intentionally propagates as unhandled rejection |
| 3  | Implement `quotagate status` and `quotagate backends` stubs: log "not implemented in Phase 1" and exit 0                   | ✅ Done       | 1         | Both branches log and return (exit 0 via fall-through) |
| 4  | Handle unknown subcommand and missing subcommand (bare `quotagate` with no args)                                            | ✅ Done       | 1         | `default` branch: `cmd ?? '(none)'` label + exit 1 |
| 5  | Write `tests/index.test.ts`: health-check false exits 1 with readable message; config error exits 1; unknown command exits 1 | ✅ Done     | 3         | T-1–T-5 all pass; used `vi.hoisted()` for mock fn refs (hoisting constraint); `vi.fn(function(){})` for constructor mock. PA advisories applied: A3 assertion added to T-4; T-6 added for EF4 coverage (80 tests). |
| 6  | Manual smoke test: `npx tsx src/index.ts start` with real config + auth                                                     | ⬚ Not started | —         | Deferred — operator-environment dependent; WS_06 integration test covers the in-process path |
| 7  | Green gate: `npm test` · `typecheck` · `lint` · `format`                                                                    | ✅ Done       | 2         | 80 tests (74 baseline + 6 new: T-1–T-6); typecheck clean; lint clean; format no diff |

_Status icons: `✅ Done` | `🔄 In progress` | `⬚ Not started` | `❌ Blocked`_

---

## Current Subtask Detail

### Subtask 5: `tests/index.test.ts` — unit tests

**Approach iteration plan**:

1. Mock all external dependencies: mock `src/config.ts` (mock `loadConfig`), mock
   `src/adapters/claude.ts` (mock `ClaudeAdapter`), mock `src/proxy.ts` (mock `createServer`
   to return a fake `FastifyInstance` with a spy `listen` that resolves immediately).
   Spy on `process.exit` with `vi.spyOn(process, "exit")`.
2. Test health-check failure: configure `ClaudeAdapter` mock's `healthCheck` to return `false`;
   invoke `main("start")`; assert `process.exit` called with 1; assert the stderr message contains
   "not installed or not authenticated" (or equivalent guidance text).
3. Test config error: configure `loadConfig` mock to throw `new QuotagateError("config not found at /path/config.yaml")`; invoke `main("start")`; assert `process.exit` called with 1.

- **Current iteration**: not started (blocked on T2/T3 sign-off)
- **Verifiability**: SC-1 and SC-2 pass.
- **Challenges**: `process.exit` spying in Vitest requires care — the spy's `mockImplementation`
  must throw or return to prevent the process from actually exiting mid-test. Using
  `.mockImplementation(() => { throw new Error("exit") })` and wrapping the assertion in
  `expect(...).rejects.toThrow()` is the recommended pattern.

---

## Decisions Made

### [D1] — `process.argv[2]` hand-rolled parser, no CLI framework ✅ LOCKED (Architect, 2026-06-11)

**Decision**: Subcommand parsing in Phase 1 is `switch(process.argv[2]) { case "start": ...; case
"status": ...; case "backends": ...; default: ... }`. No `yargs`, `commander`, or `minimist`.

**Rationale**: Phase 1 has one real subcommand and two stubs. A CLI framework would add a runtime
dependency with zero behavioral value at this scale. The Phase 4 CLI work introduces `yargs` or
`commander` when `--config`, `--port`, `--verbose`, and interactive `status`/`backends` output
exist — the framework pays for itself then. Until those flags arrive, a `switch` on one string is
the right tool.

**Rejected alternative — add `commander` now**: Over-engineering for Phase 1 scope. The framework
adds ~1MB and a dependency to maintain for a three-branch switch statement.

### [D2] — `index.ts` has a named `main()` function export for testability ✅ LOCKED (Architect, 2026-06-11)

**Decision**: `src/index.ts` exports a `main(argv?: string[])` function (or equivalent named
entry) that contains the startup logic. The top-level module call is `main(process.argv.slice(2))`.
Tests import and call `main(["start"])` directly with mocked dependencies.

**Rationale**: An `index.ts` that runs imperative code at module load time is not unit-testable
without spawning a subprocess. Exporting `main` as a testable function is the minimal change that
makes the startup sequence verifiable without a live system.

**Rejected alternative — test `index.ts` by spawning `tsx src/index.ts` as a subprocess**: Slow,
environment-dependent, and non-deterministic. Mocking `ClaudeAdapter.healthCheck` at the subprocess
level is not feasible; testing via module mocking is the correct pattern.

### [D3] — Anti-overengineering scope fence ✅ LOCKED

**This task explicitly does NOT include**:

- `quotagate install` — Phase 2 (MCP registration).
- `quotagate status` beyond a stub — Phase 4 (full CLI with health dashboard).
- `quotagate backends` beyond a stub — Phase 4.
- `--config` / `--port` CLI flags — Phase 4.
- Multi-backend instantiation (Gemini, Codex) — Phase 2.
- `config.yaml` hot-reload — Phase 4.

---

## Cross-Task Contracts (Downstream Dependencies on This Task)

### `WS_06` will depend on:

- `createServer(config, adapter)` being importable directly — WS_06 boots the server in-process
  (not via `quotagate start`) to avoid real port binding in the integration test. T4 does not
  change the `createServer` signature; it just wires the call in `index.ts`. WS_06 imports
  `createServer` and `loadConfig` directly; `index.ts` is not needed by WS_06.

---

## Files Modified / Created

- `src/index.ts` — **modify** (replace two-line stub with full `quotagate start` implementation)
- `tests/index.test.ts` — **create new** (unit tests for startup behavior)

---

## Success Criteria / Verifiability

| #    | Criterion                                                                                             | How to verify                                                             |
|------|-------------------------------------------------------------------------------------------------------|---------------------------------------------------------------------------|
| SC-1 | `healthCheck()` returning `false` → `process.exit(1)` called; stderr message contains actionable guidance | T-1 passes; `process.exit` spy called with `1`                       |
| SC-2 | `loadConfig()` throwing `QuotagateError` → `process.exit(1)` called; error message in stderr         | T-2 passes                                                               |
| SC-3 | Unknown subcommand → `process.exit(1)` called; message contains the invalid command name             | T-3 passes                                                               |
| SC-4 | Successful start path: `loadConfig` succeeds, `healthCheck` returns true → `server.listen` called with `{ port: 8080, host: "127.0.0.1" }` | T-4 passes |
| SC-5 | Ready log line printed on successful `server.listen`                                                 | T-4 asserts or manual smoke confirms                                     |
| SC-6 | `quotagate status` stub logs "not implemented in Phase 1" and exits 0 (or just returns)              | T-5 passes (or manual check)                                             |
| SC-7 | `npm test` green; test count does not decrease from WS_04 baseline (56 tests)                        | `npm test` output                                                        |
| SC-8 | `npm run typecheck` clean; `npm run lint` clean; `npm run format` no diff                            | Each command exits 0                                                     |

---

## Required Test Cases

File: `tests/index.test.ts`

### T-1: `healthCheck() === false` → `process.exit(1)` with readable message (covers SC-1)

Mock `ClaudeAdapter` with `healthCheck: vi.fn().mockResolvedValueOnce(false)`. Mock `loadConfig`
to return a valid `QuotagateConfig`. Mock `createServer` to return a fake server. Spy on
`process.exit`. Invoke `main(["start"])`. Assert: `process.exitCode` or the spy was called with `1`;
`process.stderr.write` (or `console.error`) received a string containing "not installed" or
"not authenticated".

### T-2: `loadConfig` throws `QuotagateError` → `process.exit(1)` (covers SC-2)

Mock `loadConfig` to throw `new QuotagateError("config.yaml not found at /project/config.yaml")`.
Invoke `main(["start"])`. Assert: `process.exit` called with `1`; error not re-thrown as an
unhandled rejection.

### T-3: unknown subcommand → `process.exit(1)` (covers SC-3)

Invoke `main(["deploy"])`. Assert: `process.exit` called with a non-zero code; the output contains
`"deploy"` (or "Unknown command").

### T-4: happy path → `server.listen` called with correct address (covers SC-4, SC-5)

Mock all deps to succeed: `loadConfig` returns valid config; `healthCheck` returns `true`;
`createServer` returns a fake `{ listen: vi.fn().mockResolvedValueOnce(undefined) }`. Invoke
`main(["start"])`. Assert: the `listen` spy was called with `{ port: 8080, host: "127.0.0.1" }`;
`process.exit` was NOT called.

### T-5: `quotagate status` stub does not crash (covers SC-6)

Invoke `main(["status"])`. Assert: no unhandled exception; `process.exit` not called with a
non-zero code (the stub exits 0 or simply returns).

---

## Review Notes

**Verdict: APPROVED WITH ADVISORIES** — 2026-06-11, Principal Architect

### Summary

The implementation is correct, minimal, and well-structured. All five expected failure paths are handled precisely as specified. The test suite covers T-1 through T-5 faithfully, uses `vi.hoisted()` correctly, and the `process.exit` spy pattern is sound. No blockers. Two advisories are raised — one on a latent `loadConfig()` argument inconsistency visible only when the real module is exercised, and one on a missing EF4 test coverage gap. Both are addressable in this task before sign-off.

---

### [ADVISORY 1] `loadConfig()` called with no argument — consistent with D6, but test does not assert it

**Location**: `src/index.ts:18` / `tests/index.test.ts` (missing assertion)

**Issue**: `loadConfig()` is called with zero arguments at line 18, which correctly relies on `config.ts`'s internal `DEFAULT_CONFIG_PATH` default — consistent with D6 (WS_05-D6: default path via `os.homedir()`). The tracker's Assumption A3 explicitly requires a test asserting `loadConfig` is called with `undefined` (no explicit path), and the `mockLoadConfig` spy is already in place. This assertion is absent from T-2 and is not covered by any other test case. If a future engineer adds a `configPath` argument to the `main()` call (e.g., for a `--config` flag in Phase 4), no test will catch the regression.

**Fix**: In T-2 (or as a dedicated assertion in T-4), add `expect(mockLoadConfig).toHaveBeenCalledWith()` (called with no arguments) after the `main(["start"])` invocation. This is a one-line addition that locks the A3 assumption into the test contract.

---

### [ADVISORY 2] EF4 (`server.listen()` rejection) has no test case

**Location**: `tests/index.test.ts` (missing test)

**Issue**: The tracker specifies EF4 explicitly and SC-4's verifiability column says "T-4 passes" — but T-4 only covers the happy path. The EF4 code path (lines 41–48 of `src/index.ts`) is the `try/catch` around `server.listen()` that formats the error message with the port number and calls `process.exit(1)`. This path is live production code with a non-trivial message format (`"Failed to start server on port 8080: ${msg}"`), and it has zero test coverage. If this catch block were accidentally deleted, or if the port number were dropped from the message, no test would fail. The tracker's required test list (T-1 through T-5) does not include an EF4 test, so the BSE did not overstep — but the gap is real and the tracker omitted it.

**Fix**: Add a T-6 test: configure `mockListen` to reject with `new Error("address already in use")`, invoke `main(["start"])`, assert `exitSpy` called with `1`, assert stderr contains `"8080"`. This closes the coverage gap and matches the spirit of EF4's specification in the tracker.

---

### Spec Invariant Checks (all pass)

- **Invariant #10 (Persist the process, never the conversation)**: `index.ts` passes no conversation state into `ClaudeAdapter` or `createServer`. Clean.
- **Invariant #6 (MCP primary, subprocess fallback)**: `ClaudeAdapter` is used only via the `CLIAdapter` interface — `healthCheck()` and then `createServer(config, adapter)`. No direct subprocess calls or `ClaudeAdapter`-specific method calls outside the interface. Clean.
- **Invariant #4 (Every adapter implements the same interface)**: `new ClaudeAdapter()` is the only concrete instantiation, but `createServer` receives it typed as `CLIAdapter`. The hardcoded `new ClaudeAdapter()` is a D3-scoped Phase 1 decision and is correct for this phase. Multi-backend wiring is explicitly deferred to Phase 2.
- **Invariant #3 (Stateless per request)**: `index.ts` holds no request state. Clean.
- **Invariant #2 (No API keys)**: No credentials are requested, stored, or passed. Clean.

---

### Decision Compliance

- **D1**: `switch(cmd)` on `argv?.[0]` — no CLI framework. Correct.
- **D2**: Named `main(argv?)` export; top-level call guarded by `import.meta.url === process.argv[1]` comparison via `fileURLToPath`. Correct and idiomatic ESM.
- **D3**: No `quotagate install`, no `--config` flags, no multi-backend, no hot-reload. Clean scope fence.
- **WS_05-D6**: `loadConfig()` called with zero arguments; default path resolution stays inside `config.ts`. Correct.

---

### Success Criteria Status

| #    | Met? | Notes |
|------|------|-------|
| SC-1 | YES  | T-1 passes; spy called with `1`; stderr checked for "not installed" or "not authenticated" |
| SC-2 | YES  | T-2 passes; `QuotagateError` caught, exit 1, no rethrow |
| SC-3 | YES  | T-3 passes; stderr contains "deploy" and "Unknown command" |
| SC-4 | YES  | T-4 passes; `listen` spy asserted with `{ port: 8080, host: "127.0.0.1" }` |
| SC-5 | YES  | T-4 asserts `process.exit` NOT called; ready log at line 50 is present in implementation |
| SC-6 | YES  | T-5 passes; `main(["status"])` resolves without throwing, exit not called |
| SC-7 | YES  | 79 tests (74 baseline + 5 new); no regressions |
| SC-8 | YES  | `npm run typecheck` clean; `npm run lint` clean; `npm run format` no diff |

---

## Architect Sign-off

- [x] Implementation reviewed
- [x] All success criteria verified
- [x] All assumptions resolved (proven, or fallback taken & documented)
- [x] No regressions in full test suite
- [x] `npm test` / `typecheck` / `lint` / `format` all clean

**Advisory follow-up (2026-06-11)**: Both advisories applied and verified. 80 tests. T4 signed off.
