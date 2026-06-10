# Workstream WS_03: Adapter Proving & Contamination Probe

> A workstream scopes ~1 day of work and is more detailed than its parent phase: concrete goals +
> deliverables, locked decisions (with rejected alternatives), a task breakdown, cross-task
> contracts, and success/quality gates. It is the bridge from phase goals to hour-sized tasks.

## Workstream Overview

- **Parent Phase**: [Phase 1A — Claude Subprocess Adapter & Constraint](../phases/01a_transport_and_constraint.md)
- **Timeframe**: ~1 day
- **Status**: Complete
- **Dependencies**: WS_02 signed off — `ClaudeAdapter`, `build_constrained_prompt`, and `sanitised_env()` must be complete and unit-tested before integration tests can run against the real subscription.

---

## Goals & Deliverables

- **Goal 1**: Re-validate Mechanism A (the prompt-engineering constraint) as driven by Quotagate's own `build_constrained_prompt` — not a manual shell one-liner, but the actual code path.
  - Deliverable: A passing integration test (`tests/integration/constraint.test.ts`) that calls `adapter.complete()` with a no-tools message and asserts the raw response Zod-parses as `{type:"text"}` with non-empty content. This is the living proof that spec §5.2 holds through Quotagate's prompt, not just the experiment.

- **Goal 2**: Re-validate execution suppression — `claude --print` returns a `tool_call` declaration and does not act.
  - Deliverable: A passing integration test (`tests/integration/executionSuppression.test.ts`) that calls `adapter.complete()` with a `tools` array containing a side-effecting name (`read_file`) and asserts: (a) the response is `{type:"tool_call", name:"read_file"}`, and (b) the file at the path in the arguments was NOT read (absence-of-side-effect assertion).

- **Goal 3**: The sequential contamination probe — fresh-process isolation asserted as a test so it is inherited by Phase 1B and 1C as a regression guard.
  - Deliverable: A passing integration test (`tests/integration/contamination.sequential.test.ts`) that calls `adapter.complete()` twice in sequence: call A with a distinctive secret token in the message, call B asking "what did I just say?" Assert B's raw response contains no trace of the token from A.

- **Goal 4**: Phase 1A green-gate close-out — every quality check passing with the full suite including integration tests.
  - Deliverable: `npm test` green, `typecheck` clean, `lint` clean, `format` no-diff, with the integration tests counted in the suite. WS_03 sign-off is the Phase 1A sign-off.

---

## Why This Workstream Matters

WS_02 builds and unit-tests the adapter in isolation. WS_03 fires it at the real Claude subscription and asks the hard questions: does Quotagate's own constraint wording actually work, or did something get lost between the experiment and the implementation? Does `sanitised_env()` hold auth correctly under subprocess spawn from Node, not just from the shell?

This workstream also establishes the contamination test as a first-class regression gate. On the subprocess transport, fresh-process isolation makes it pass by construction — but "by construction" is only safe if the test is there to catch the day someone introduces a shared-state mechanism. Phase 1B and 1C inherit this test suite; Phase 2's MCP upgrade must keep it green (re-earning the guarantee structurally via `_mcp_lock`). The test is the contract.

WS_03 sign-off unlocks Phase 1B. WS_04 and WS_05 both depend on a proven `adapter.complete()` and a stable `AdapterResponse` contract. There is no value in building the translation pipeline on top of an unproven adapter.

---

## Locked Decisions

### WS_03-D1 — Integration Tests Run Against the Real Subscription; No Mock Adapter ✅ LOCKED (Architect, 2026-06-08)

**Decision**: The integration tests in WS_03 invoke the real `claude --print` subprocess against the developer's live Claude subscription. No mock or stub is used for the adapter itself in these tests.

**Rationale**: The entire point of this workstream is to prove the real transport works under Quotagate's own code path. A mock adapter proves nothing about the subprocess, `sanitised_env()`, or the constraint wording. The risk of flaky tests from network/auth issues is accepted; it is managed by the `healthCheck()` guard (skip the suite if the CLI is not available) rather than by mocking the transport away.

**Rejected alternative — mock `child_process.spawn` and assert on the spawned command**: This would be a unit test of the spawn call, not a proof that `claude --print` works. It belongs in WS_02 (if at all); WS_03's job is real-world validation.

### WS_03-D2 — Integration Tests Are Marked with a Vitest `integration` Tag and Can Be Skipped in CI ✅ LOCKED (Architect, 2026-06-08)

**Decision**: Integration tests use a Vitest `tags` marker (e.g. `test.concurrent.each` with a describe block tagged `integration`) or a file-naming convention (`*.integration.test.ts`). A `vitest.config.ts` workspace or `--testNamePattern` flag allows CI to exclude them. The local green gate always runs them; CI may skip if no Claude subscription is available in the CI environment.

**Rationale**: These tests require a live `claude` CLI installation and subscription. Running them in a clean CI environment without auth would fail every PR check with a transport error, drowning real failures. The pragmatic answer is: run integration tests locally on the dev machine; gate the CI suite on unit tests only until a CI-accessible subscription is configured.

**Rejected alternative — require integration tests to pass in CI from day one**: Blocks every CI run until a Claude subscription is wired into CI secrets, which is a Phase 4 DX concern, not Phase 1A.

### WS_03-D3 — Contamination Probe Uses a Distinctive Token, Not a Predictable Phrase ✅ LOCKED (Architect, 2026-06-08)

**Decision**: Call A's distinctive value is a randomly generated token (e.g. `crypto.randomUUID()` or a fixed UUID constant chosen at authoring time) injected into a natural-language message ("Remember the code word: `<token>`"). Call B's probe is a simple "what was the code word I mentioned?" Assert B's response does not contain the token string.

**Rationale**: A predictable phrase like "secret123" could plausibly appear in a model response through coincidence or training data. A UUID-shaped string is vanishingly unlikely to appear in a response that does not have access to call A's context. The assertion is therefore high-confidence and low-noise.

**Rejected alternative — use a common word as the distinctive token**: Risks false negatives (the model generates the word coincidentally) and makes the test fragile.

---

## Task Breakdown

| Task ID | Description                                                                                                                                                                                                                                                                                     | Est. Duration | Status        | Task Tracker Link              |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ------------- | ------------------------------ |
| T1      | Author `tests/integration/constraint.test.ts`: calls `adapter.complete()` with a no-tools message; asserts `AdapterResponse.raw` Zod-parses as `QuotagateCompleteResult` with `type:"text"` and non-empty `content`. Guards with `healthCheck()` skip if CLI unavailable.                       | ~1 hour       | ✅ Completed | `../../archive/tasks/TASK_WS03_T1.md` |
| T2      | Author `tests/integration/executionSuppression.test.ts`: calls `adapter.complete()` with `tools:[{name:"read_file", ...}]`; asserts response is `{type:"tool_call", name:"read_file"}`; asserts the file path in `arguments` was not read (stat the path before and after; assert no new read). | ~1 hour       | ✅ Completed | `../../archive/tasks/TASK_WS03_T2.md` |
| T3      | Author `tests/integration/contamination.sequential.test.ts`: two sequential `adapter.complete()` calls (A: inject distinctive UUID token; B: probe for the token); assert B's raw response does not contain the token string.                                                                   | ~45 min       | ✅ Completed | `../../archive/tasks/TASK_WS03_T3.md` |
| T4      | Green-gate close-out: run the full suite (`npm test`, `typecheck`, `lint`, `format`). Fix any issues exposed by the integration tests (constraint wording, env vars, spawn flags). Update the CLAUDE.md Decision Log with the WS_02-D2-allowlist entry if not already recorded.                 | ~1 hour       | ✅ Completed | `../../archive/tasks/TASK_WS03_T4.md` |

_Status: `✅ Completed` | `🔄 In Progress` | `⬚ Not started` | `❌ Blocked`_

_T1, T2, and T3 are independent of each other — write and run them in any order. T4 is the close-out and depends on all three passing. If T1 fails due to a constraint wording issue, fix `build_constrained_prompt` in WS_02 before proceeding to T4._

---

## Cross-Task Contracts

### `ClaudeAdapter` + `CLIAdapter` (inherited from WS_02 → consumed by T1, T2, T3)

All three integration tests instantiate `ClaudeAdapter` and call it via the `CLIAdapter` interface — they do not call `_complete_via_subprocess` directly. This ensures the integration tests prove the public contract, not the private implementation.

### `QuotagateCompleteResult` Zod schema (inherited from WS_01 T3 → consumed by T1, T2, T3)

The integration tests use this schema to parse `AdapterResponse.raw`. They do not write their own JSON parsing. If the raw response fails Zod validation, that is a test failure — not a test-code bug — and surfaces the constraint wording issue explicitly.

### `healthCheck()` guard pattern (defined in T1 → reused in T2, T3)

The skip-if-unavailable guard is authored in T1 and used as a shared pattern in T2 and T3. It calls `adapter.healthCheck()` before the test body; if it returns `false`, the test is skipped with `test.skip`. This pattern is the contract for all integration tests in this project — WS_06 and WS_09 will follow it.

### Phase 1A sign-off (produced by T4 → consumed by WS_04/WS_05 as a gate)

WS_03 T4 completion is the formal gate for Phase 1B. WS_04 and WS_05 must not begin implementation until T4 is signed off. The dependency is: `AdapterResponse` contract stable, `adapter.complete()` proven live, green gate holding.

---

## Success & Evaluation Criteria

- **Functional requirements**:
  - [x] `adapter.complete({ messages:[{role:"user", content:"Hello"}] })` returns an `AdapterResponse` where `QuotagateCompleteResult.safeParse(JSON.parse(raw))` succeeds with `type:"text"` and non-empty `content`.
  - [x] `adapter.complete()` with `tools:[{name:"read_file", ...}]` returns `{type:"tool_call", name:"read_file"}` and the file was not read (no side effect).
  - [x] Two sequential `adapter.complete()` calls: call B's response does not contain call A's UUID token. Fresh-process isolation confirmed.
  - [x] `sanitised_env()` allowlist confirmed: `claude --print` auth holds under the stripped environment (evidenced by the integration tests passing, not just `healthCheck()`).

- **Named tests that prove this workstream done**:
  - [x] `tests/integration/constraint.integration.test.ts` — Zod parse of raw response succeeds as `{type:"text"}`; content is non-empty string.
  - [x] `tests/integration/executionSuppression.integration.test.ts` — response is `{type:"tool_call"}`; absence-of-side-effect assertion passes.
  - [x] `tests/integration/contamination.sequential.integration.test.ts` — call B's response contains no trace of call A's UUID token.

- **Quality gates**:
  - [x] `npm test` green; integration tests counted in the suite; no test-count regression from WS_02 baseline
  - [x] `npm run typecheck` clean
  - [x] `npm run lint` clean; `npm run format` produces no diff
  - [x] WS_02-D2-allowlist decision recorded in CLAUDE.md Decision Log (the empirical env allowlist finding is a resolved decision, not just a code comment)

---

## Known Pitfalls & Implementation Notes

**Integration test flakiness from startup latency**: `claude --print` takes 50–200ms to boot (spec §3.1). In a test suite that runs many integration tests back-to-back, accumulated latency is fine — but add a reasonable per-test timeout (`test(..., { timeout: 15_000 })`). The default Vitest timeout of 5 seconds is too short for a subprocess that boots a Node CLI.

**Execution suppression test — file path assertion**: The test passes a tool schema with a `path` parameter and asserts the returned `arguments.path` was not read. Do not assert on the exact path value returned (the Haiku path-leak in spec §5.3 shows the model may hallucinate a path). Assert only that the file at whatever path was returned does not have a newer `atime` than before the call. If the model returns no path at all in arguments, that is a constraint wording issue — investigate `build_constrained_prompt`, not the test.

**Contamination test token choice**: Use a UUID constant (`const TOKEN = "8f3a1c2d-9e4b-4f7a-b6c5-1d2e3f4a5b6c"`) rather than `crypto.randomUUID()` at runtime. A fixed constant makes the test deterministic and easy to read in CI logs. Document the token in the test file's comment so a future reader understands why a UUID is appearing in the assertion.

**`healthCheck()` and authentication state**: If the developer's `claude` CLI subscription has expired or requires re-authentication, all integration tests will skip. This is the correct behavior — it avoids noisy failures. If tests are unexpectedly all skipping, run `claude whoami` manually to confirm auth state before debugging the test code.

**Constraint wording iteration**: If T1 fails because the model returns a prose response instead of JSON, the fix is in `build_constrained_prompt` (WS_02 T2), not in the test. Adjust the constraint wording to more closely mirror the validated language in spec §3.5 and re-run. Do not adjust the Zod assertion to be more lenient — the schema is the contract.

**Sequential vs concurrent contamination**: This workstream proves only the sequential sub-case. The concurrent and retry-path sub-cases are Phase 1C (WS_09). Do not attempt to write the concurrent test here — it requires the full Fastify server to be up (WS_05 and WS_06 must be complete first, per D-1C-04).
