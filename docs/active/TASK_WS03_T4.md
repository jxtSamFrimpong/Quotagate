# TASK_WS03_T4: Green-Gate Close-Out & Phase 1A Sign-Off

## Context

- **Workstream**: WS_03 (Adapter Proving & Contamination Probe)
- **Plan reference**: `docs/plan/workstreams/ws03_adapter_proving.md`
- **Phase plan**: `docs/plan/phases/01a_transport_and_constraint.md`
- **Depends on**: TASK_WS03_T1 (constraint integration test + carry-forward unit tests done), TASK_WS03_T2 (execution suppression integration test done), TASK_WS03_T3 (sequential contamination probe done). All three integration tests must pass locally before T4 begins.
- **Blocks**: WS_04 (validator + retry loop) and WS_05 (Fastify proxy server). Phase 1B cannot begin until T4 is signed off.

---

## Goal & Why

- **Goal**: This is the close-out task for WS_03 and the formal Phase 1A sign-off gate. Four deliverables:
  1. **`vitest.config.ts` update**: gate integration test inclusion/exclusion via the `CI` env var (WS_03-D4). Specifically: add `exclude: process.env['CI'] ? ['tests/integration/**'] : []` to the Vitest config so that `npm test` in CI skips the integration tests, while `npm test` locally runs them (or they continue to be excluded by naming convention — see Subtask 1 decision).
  2. **Fix any issues exposed by T1/T2/T3**: if any of the three integration tests revealed a wiring problem in `buildConstrainedPrompt`, `ClaudeAdapter`, or `sanitisedEnv()`, diagnose and fix it at the correct layer. No cheap fixes — root cause only.
  3. **Full green gate pass**: `npm test` (unit suite) green, all three integration tests pass locally, `typecheck` clean, `lint` clean, `format` no diff.
  4. **WS_03 workstream plan status update**: mark WS_03 `Status: Complete` in `docs/plan/workstreams/ws03_adapter_proving.md` and update the CLAUDE.md Session State to reflect Phase 1A complete.

- **Why**: Phase 1B (WS_04 + WS_05) depends on a proven `adapter.complete()`. "Proven" means: the constraint works (T1), execution suppression holds (T2), sequential isolation is confirmed (T3), and the full quality gate is green. A partial pass — e.g., T3 is skipped because auth was unavailable — is not sign-off. The BSE must run all three integration tests locally before submitting T4 for review.

  The `vitest.config.ts` change is the final infrastructure piece that makes the project CI-safe. Until this change exists, every future CI run would fail on the integration tests (which require a live Claude subscription). WS_03-D4 resolves this with minimal config change.

---

## Assumptions to Test

| # | Assumption | Why we believe it | How this task tests it | If false → |
|---|---|---|---|---|
| A1 | The `*.integration.test.ts` file naming convention is sufficient to exclude integration tests from `npm test` in CI — either because the Vitest `include` glob does NOT match double-extension files, OR because the `vitest.config.ts` `exclude` added in this task makes it explicit | In Subtask 1 of T1, the BSE verified whether `.integration.test.ts` files are picked up by the `include: ['tests/**/*.test.ts']` glob | Subtask 1: run `npm test` and confirm integration test files are absent from the output; if they are present, the `vitest.config.ts` change in this task is confirmed necessary | If the glob does match `.integration.test.ts` files AND the `vitest.config.ts` change is not in place: every `npm test` run would try to run integration tests and fail in CI. The fix is adding the `CI`-gated `exclude` — see WS_03-D4 |
| A2 | None of the three integration tests revealed a wiring bug in WS_02 code (`buildConstrainedPrompt`, `ClaudeAdapter`, `sanitisedEnv()`) | WS_02 was unit-tested to 100% branch coverage; the integration tests are proving the wiring through a real subprocess | If all three integration tests pass on first run, this assumption is confirmed | If any integration test fails: diagnose the root cause per the escalation path in that task's tracker (T1/T2/T3). Do not start T4's green-gate pass until the failing test is fixed and re-run |
| A3 | The total test count after WS_03 is ≥ 33 (27 WS_02 baseline + 3 carry-forward unit tests from T1 + 3 integration tests counted when run locally) | Additive: 27 + 3 carry-forward + 3 integration = 33 | Run `npm test` locally with integration tests included (temporarily include them or run `npx vitest run` directly) and confirm the count | If the count is lower: identify which test is missing and trace it to the correct task tracker |

---

## Expected Failures

- **EF1** The `CI` env var check in `vitest.config.ts` must use `process.env['CI']` (bracket notation), not `process.env.CI` (dot notation), to satisfy the TypeScript strict mode check on `process.env` which types all values as `string | undefined`. Both work at runtime; the bracket form is explicitly typed and avoids a lint warning under some ESLint configs.
- **EF2** Adding `exclude` to `vitest.config.ts` does NOT mean integration tests can be named `*.test.ts`. The naming convention (`*.integration.test.ts`) must be preserved regardless of whether the `exclude` is needed — it is the visual signal for human readers. The `exclude` is a belt-and-suspenders guard for CI, not a replacement for the naming convention.
- **EF3** If any integration test failed during T1/T2/T3 and a fix was applied to `src/adapters/claude.ts` or `src/adapters/buildConstrainedPrompt`, the BSE must re-run `npm run typecheck` and `npm run lint` after the fix to confirm the fix did not introduce a type error or lint violation. The green gate applies to the fixed code, not the pre-fix code.
- **EF4** `npm run format` must be run AFTER all file changes (including the `vitest.config.ts` change and any source fixes) to catch formatting drift. Prettier will report files changed if any of the new integration test files have inconsistent quoting or trailing commas. Run `npm run format` last, then run `npm test` again to confirm the formatted files did not introduce test failures.
- **EF5** The workstream plan update (`docs/plan/workstreams/ws03_adapter_proving.md`) and the CLAUDE.md Session State update are both required for sign-off. They are documentation, not code — but they are part of the deliverable. A clean `npm test` without the documentation updates is not complete.

---

## Test Strategy

- **Unit**: No new unit tests in this task. If a fix to WS_02 code is required (EF3), the fix must not reduce the existing unit test count or coverage. Re-run `npm run test:cov` after any source fix to confirm 100% branch coverage is maintained on `src/adapters/claude.ts`.
- **Integration**: Run all three integration tests locally and confirm they pass. Use `npx vitest run tests/integration/ --timeout 30000` to run the entire integration suite in one command. All three must pass — a skipped test (healthCheck returned false) does not count as a passing test; the BSE must have an active subscription and a functioning `claude` CLI before submitting T4.
- **Contract**: The final `npm test` output is the contract artifact. It must show ≥ 30 unit tests passing (27 baseline + 3 carry-forward from T1). The integration tests are confirmed separately via the `npx vitest run tests/integration/` command.
- **Contamination/Isolation**: The contamination test (T3) passing locally IS the contamination/isolation validation for Phase 1A. WS_09 extends this; T4 does not add new contamination coverage.
- **Manual/spike**: The BSE must manually run the three integration tests in sequence (or together via `npx vitest run tests/integration/`) and paste the output into the Subtask 4 Notes column. This output is the required evidence for T4 sign-off.

---

## Contract: What This Task Inherits

| Symbol / Artifact | Source | Role in This Task |
|---|---|---|
| `tests/integration/constraint.integration.test.ts` | TASK_WS03_T1 | Must pass locally; its pass is a required input to T4's green-gate evidence |
| `tests/integration/executionSuppression.integration.test.ts` | TASK_WS03_T2 | Must pass locally |
| `tests/integration/contamination.sequential.integration.test.ts` | TASK_WS03_T3 | Must pass locally |
| Carry-forward unit tests (T-11, T-12, T-13) | TASK_WS03_T1 | Must pass in `npm test`; counted in the ≥ 30 total |
| `vitest.config.ts` | Repo root (created in WS_01) | Modified to add CI-gated integration test exclusion |
| `docs/plan/workstreams/ws03_adapter_proving.md` | Repo | Status field updated from `Proposed` to `Complete` |

---

## Subtask Progress Table

| # | Subtask | Status | Iteration | Notes |
|---|---|---|---|---|
| 1 | Determine whether `vitest.config.ts` requires an explicit `exclude` for `*.integration.test.ts` files: run `npm test` and confirm whether integration test files appear in the output; if yes, add the `CI`-gated `exclude` per WS_03-D4 | ⬚ Not started | — | |
| 2 | If any fix was required by T1/T2/T3 failures: apply the fix to the correct source file, re-run `npm run test:cov` to confirm branch coverage unchanged, re-run the affected integration test to confirm the fix | ⬚ Not started | — | |
| 3 | Run the full unit suite: `npm test` — confirm ≥ 30 tests passing; confirm integration test files are absent from the output | ⬚ Not started | — | |
| 4 | Run all three integration tests: `npx vitest run tests/integration/ --timeout 30000` — confirm all three pass; paste output into Notes | ⬚ Not started | — | |
| 5 | Run `npm run typecheck`, `npm run lint`, `npm run format` — confirm all clean; no diff from `format` | ⬚ Not started | — | |
| 6 | Update `docs/plan/workstreams/ws03_adapter_proving.md`: set `Status: Complete`; check off each success criterion | ⬚ Not started | — | |
| 7 | Update CLAUDE.md Session State: mark WS_03 complete; update "What was completed" and "What is next" sections | ⬚ Not started | — | |

_Status icons: `✅ Done` | `🔄 In progress` | `⬚ Not started` | `❌ Blocked`_

---

## Current Subtask Detail

### Subtask 1: `vitest.config.ts` assessment and update

**Approach iteration plan** (simplest → target):

1. Run `npm test` with all three integration test files present in `tests/integration/`. Inspect the output: if the integration test files appear as "0 tests" or are entirely absent from the output, the naming convention is already sufficient — no `vitest.config.ts` change is needed beyond documenting this finding.
2. If the integration test files ARE included in `npm test` output (because the glob matches `*.integration.test.ts`): add `exclude: process.env['CI'] ? ['tests/integration/**'] : []` to `vitest.config.ts`. Re-run `npm test` and confirm the integration files are now absent. Re-run `npx vitest run tests/integration/` to confirm they still run when invoked directly.
3. If the `exclude` approach conflicts with the naming convention (unlikely): escalate to a separate `vitest.integration.config.ts` and a separate `npm run test:integration` script — but only if option 2 fails.

- **Current iteration**: 1 of 3
- **Verifiability / Success Criteria**: SC-1 (unit suite does not include integration tests) passes. SC-2 (integration tests are runnable via direct invocation) passes.
- **Challenges**: EF1 (bracket notation for `process.env`), EF2 (naming convention preserved regardless of config change).

### Subtask 2: Fix any T1/T2/T3 failures (conditional)

**Approach iteration plan** (simplest → target):

This subtask is conditional — it only runs if one of the three integration tests failed during T1/T2/T3. The fix path depends on the failure:

1. **If T1 (constraint test) failed with a `SyntaxError`** (model returned prose): re-examine `CONSTRAINT_INSTRUCTIONS` against spec §3.5 verbatim. Look for whitespace drift or missing punctuation. Update the constant; re-run T1. Do NOT loosen the Zod assertion.
2. **If T2 (execution suppression) failed with `type === 'text'` instead of `'tool_call'`**: the constraint is not steering the model to declare the call when tools are present. Re-examine `buildConstrainedPrompt`'s tool injection section — confirm the `toolChoice` and `Available functions:` block are being rendered. Update and re-run T2.
3. **If T3 (contamination) failed with TOKEN in Call B**: this is a critical product failure — diagnose subprocess PIDs first. If PIDs are distinct and TOKEN appears in Call B, escalate to the Architect immediately; do not apply a code fix without architectural review.

- **Current iteration**: 1 of 1 (conditional)
- **Verifiability / Success Criteria**: The previously failing integration test now passes. All unit tests still pass. `npm run test:cov` shows 100% branch coverage on `src/adapters/claude.ts`.
- **Challenges**: The correct fix must be at the correct layer — not a test assertion workaround, not a mock bypass.

---

## Decisions Made

### WS_03-D4 — `vitest.config.ts` Integration Test Exclusion Strategy ✅ LOCKED (Architect, 2026-06-09)

**Decision**: Use a `CI`-gated `exclude` entry in `vitest.config.ts`: `exclude: process.env['CI'] ? ['tests/integration/**'] : []`. The integration test files retain their `*.integration.test.ts` naming convention. The `exclude` is a belt-and-suspenders CI guard, not a replacement for the naming convention.

**Rationale**: The `include: ['tests/**/*.test.ts']` glob in the current `vitest.config.ts` MAY match `*.integration.test.ts` files (the glob matches any filename ending in `.test.ts`, which includes `.integration.test.ts`). A conditional `exclude` provides an explicit, self-documenting CI guard that works regardless of Vitest's glob engine version. The `CI` env var is the conventional signal for CI environments (GitHub Actions, CircleCI, etc. all set `CI=true`). Local runs (where `CI` is unset) include the integration tests; CI runs exclude them.

**Implementation**:
```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    pool: 'forks',
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: process.env['CI'] ? ['tests/integration/**'] : [],
  },
});
```

**Rejected alternative — Vitest workspace / `projects` config with separate `vitest.integration.config.ts`**: Adds a second config file, a second `npm run test:integration` script, and requires the BSE to remember to run both. Overkill for a naming problem.

**Rejected alternative — rename integration tests to `*.e2e.ts` (no `.test.ts` suffix)**: Vitest's `include` glob would then not pick them up at all, not even when invoked with `npx vitest run tests/integration/`. This breaks the ability to run integration tests with the same test runner. Naming convention must preserve `.test.ts` suffix.

**Rejected alternative — require integration tests to pass in CI from day one**: Blocks every CI run on auth. Phase 4 DX concern, not Phase 1A.

### WS_03-T4-D1 — All Three Integration Tests Must Pass Locally Before T4 Sign-Off ✅ LOCKED (Architect, 2026-06-09)

**Decision**: A skipped integration test (due to `healthCheck()` returning `false`) does NOT satisfy the sign-off requirement. The BSE must have an active Claude subscription and a functioning `claude` CLI on the local machine; must run `npx vitest run tests/integration/ --timeout 30000` and paste the passing output into the Subtask 4 Notes.

**Rationale**: Phase 1B depends on a proven `adapter.complete()`. A skipped test is not a proven test — it is an unanswered question. The cost of requiring a local subscription for sign-off is low (every developer on this project uses Claude Pro/Max by definition — that is the product's value proposition). The cost of shipping Phase 1A without a real integration test pass is high: WS_04 and WS_05 would be built on an unproven adapter.

**Rejected alternative — accept a skipped test as passing for sign-off purposes**: Defers the proof to later, compounding risk. If the adapter is broken, WS_04 and WS_05 will be built on broken foundations.

### WS_03-T4-D2 — Phase 1A Sign-Off Is the Formal Gate for WS_04 and WS_05 ✅ LOCKED (Architect, 2026-06-09)

**Decision**: WS_04 and WS_05 implementation must not begin until T4 is PA-signed off. The `AdapterResponse` contract is not considered stable until the integration tests prove the real subprocess produces conforming output.

**Rationale**: WS_04 (`validator.ts`) and WS_05 (Fastify proxy) both depend on `AdapterResponse.raw` being parseable by `QuotagateCompleteResultSchema`. If `buildConstrainedPrompt` is subtly wrong (e.g., tool injection format causes the model to respond with prose), WS_04 would be built against a schema that the real adapter never satisfies — leading to a full pipeline regression at integration time.

**Rejected alternative — begin WS_04 in parallel with WS_03**: Acceptable if the BSE has high confidence from the WS_02 smoke test. But the smoke test was a single manual invocation; WS_03 proves the full set of behavioral contracts (text path, tool_call path, contamination isolation). Parallel development compresses the feedback loop at the cost of a potential mid-WS_04 rework.

### Anti-overengineering scope fence ✅ LOCKED

**This task explicitly does NOT include**:

- New integration test cases beyond T1/T2/T3 — the Phase 1A integration suite is complete. Additional integration tests (retry path, concurrent contamination) are WS_09.
- `npm run test:integration` npm script — the integration tests are run directly with `npx vitest run tests/integration/`; a dedicated npm script is a convenience that belongs in WS_04/WS_05 when the project matures. Not needed now.
- CI pipeline setup, GitHub Actions configuration, or secrets management — Phase 4 DX concern. T4 only adds the `CI`-gated `exclude` to make the existing `npm test` command CI-safe. Wiring the Claude subscription into CI secrets is out of scope.
- Gemini adapter stubs, Phase 2 MCP client stubs — D-SEQ-01 is locked; these are Phase 2 head concerns.
- Coverage reporting CI integration — WS_06 / Phase 1C concern.

---

## Cross-Task Contracts (Downstream Dependencies on This Task)

### WS_04 will depend on (once T4 is signed off):

- `AdapterResponse { raw: string, backend: 'claude-subprocess' }` is stable and proven via integration tests.
- `QuotagateCompleteResultSchema` is the correct Zod schema for parsing `raw` — proven by T1 and T2 integration tests using it successfully.
- The `validator.ts` retry loop can trust that `adapter.complete()` returns `raw` as the verbatim model output without pre-processing.

### WS_05 will depend on:

- `CLIAdapter.complete()` is a proven, production-ready interface. `proxy.ts` can hold a `CLIAdapter` reference and call `adapter.complete()` without fear that the underlying transport is broken.
- The composition root (`src/index.ts`) can instantiate `new ClaudeAdapter()` and pass it to the proxy as a `CLIAdapter`.

---

## Files Modified / Created

- `vitest.config.ts` — **modify** (add `exclude: process.env['CI'] ? ['tests/integration/**'] : []` to the `test` config object)
- `docs/plan/workstreams/ws03_adapter_proving.md` — **modify** (set Status to `Complete`; check off all success criteria)
- `src/adapters/claude.ts` — **possibly modify** (only if a fix from T1/T2/T3 failure is required; otherwise no change)

---

## Success Criteria / Verifiability

| # | Criterion | How to verify |
|---|---|---|
| SC-1 | `npm test` (unit suite) does not include any `tests/integration/**` file in its test count | Run `npm test`; confirm no `integration` paths appear in the file listing |
| SC-2 | `npx vitest run tests/integration/ --timeout 30000` runs all three integration tests and all pass | Paste output into Subtask 4 Notes; all three `it()` calls show as passed (not skipped) |
| SC-3 | With `CI=true npx vitest run` (simulating CI), integration tests are excluded and the unit suite still passes | `CI=true npm test` exits 0; no integration test file paths appear |
| SC-4 | `npm test` shows ≥ 30 unit tests passing (27 WS_02 baseline + 3 T1 carry-forward) | Count in `npm test` output |
| SC-5 | `npm run typecheck` clean — zero errors | `npx tsc --noEmit`; zero output |
| SC-6 | `npm run lint` clean; `npm run format` no diff | Zero ESLint violations; Prettier reports no files changed |
| SC-7 | `docs/plan/workstreams/ws03_adapter_proving.md` Status is `Complete` | Code inspection |
| SC-8 | CLAUDE.md Session State reflects WS_03 complete and WS_04/WS_05 as next | Code inspection |
| SC-9 | No regressions: all tests that passed in the WS_02 baseline (27 tests) still pass | `npm test` output |
| SC-10 | If a fix was applied to WS_02 code: `npm run test:cov` still shows 100% branch coverage on `src/adapters/claude.ts` | `npm run test:cov` output |

---

## Required Test Cases

This task adds no new test cases. The test evidence is:

1. **Unit suite output** (`npm test`): ≥ 30 tests, all passing, no integration files listed.
2. **Integration suite output** (`npx vitest run tests/integration/ --timeout 30000`): all three integration tests passed.
3. **CI simulation** (`CI=true npm test`): unit suite passes, integration tests excluded.

These three outputs are pasted into the Subtask 4 Notes column as the sign-off evidence.

---

## Review Notes

_(Architect fills after BSE submits — verdict APPROVE / APPROVE-WITH-NITS / REQUEST-CHANGES, findings classified required-change / nit / informational, mapped to SC / decision IDs.)_

---

## Architect Sign-off

- [ ] Implementation reviewed
- [ ] All success criteria verified — including integration test output pasted in Subtask 4 Notes
- [ ] All assumptions resolved (proven, or fallback taken & documented)
- [ ] No regressions in full test suite
- [ ] `npm test` / `typecheck` / `lint` / `format` all clean
- [ ] Phase 1A formally closed — WS_04 and WS_05 are unblocked
