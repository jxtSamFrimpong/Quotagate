# TASK_WS06_T4: Green-Gate Close-Out — Full Suite + Phase 1B Sign-Off

## Context

- **Workstream**: WS_06 (No-Tools End-to-End Integration Test)
- **Plan reference**: `docs/plan/workstreams/ws06_e2e_no_tools.md`
- **Phase plan**: `docs/plan/phases/01b_openai_translation_pipeline.md`
- **Depends on**: TASK_WS06_T2 (happy-path passing) + TASK_WS06_T3 (error-path tests passing)
- **Blocks**: Phase 1C (WS_07 tool-call path, WS_08 retry hardening). Neither may begin until T4 is signed off.

---

## Goal & Why

- **Goal**: Run the complete test suite (`npm test`), confirm all four green-gate commands pass, fix any issues surfaced by the live end-to-end run that slipped through T2/T3's individual sign-offs, and record the Phase 1B close-out in `CLAUDE.md` Session State via the `/house-keeping` skill.
- **Why**: The green gate is a ratchet. "Once `npm test` · `typecheck` · `lint` · `format` is green, it stays green." (Engineering Integrity §5.) T4 is the formal integration of all WS_06 tests into the suite, the Phase 1B exit gate, and the unlock for Phase 1C. It exists because the full suite run can surface issues that the individual task runs missed: Vitest fork concurrency, port conflicts between integration tests running in parallel, or import-order interactions between the new files and the existing suite.

---

## Assumptions to Test

| #  | Assumption | Why we believe it | How this task tests it | If false → |
|----|------------|-------------------|------------------------|------------|
| A1 | The two new integration test files (`e2e.noTools.test.ts` and `e2e.errorPaths.test.ts`) do not conflict with the three existing integration test files when Vitest runs them in parallel fork workers | The existing tests each create their own `ClaudeAdapter` instance; the new tests bind to OS-assigned ephemeral ports (port:0); no shared mutable state | Run `npm test` with all tests active; confirm no inter-test contamination | If Fastify port conflicts surface, check that `listen({ port: 0 })` is used (not a hardcoded port) |
| A2 | `npm run typecheck` (which runs `tsc --noEmit` with `"include": ["src"]`) remains clean after the new test files are added | The `tsconfig.json` includes only `src/` — test files are not type-checked by `tsc`; tests are type-checked by Vitest/tsx | Confirm `typecheck` still exits 0; if it starts picking up test files, there is a tsconfig regression | Check `tsconfig.json` — the `include: ["src"]` constraint is intentional |
| A3 | The full suite test count is ≥ 83 (80 WS_01–WS_05 baseline + T-1 smoke from T1 + T-2 happy-path from T2 + T-3a/T-3b error paths from T3) | Each task adds one or two test cases | Check reported test count in `npm test` output | If count is lower, a test was skipped or a file was excluded; investigate |
| A4 | The integration tests skip cleanly in CI (the `vitest.config.ts` `exclude: process.env['CI'] ? ['tests/integration/**'] : []` is already in place) | WS_03-D2 established this pattern; `vitest.config.ts` already implements it | Run `CI=true npm test` and confirm integration tests are excluded; count is 80 (the WS_01–WS_05 unit tests) | Update `vitest.config.ts` if the pattern does not cover the new test files |

---

## Expected Failures

- **[EF1]** A production code fix applied during T2 (e.g., constraint wording change in `claude.ts`) introduces a subtle regression in one of the WS_03 integration tests (constraint, contamination, or execution-suppression). The full suite run catches this. Fix: revert the constraint change and re-examine; or broaden the T-2 assertion to accommodate the actual Claude response while preserving the contract.
- **[EF2]** `npm run lint` or `npm run format` fails due to the new test files. Common causes: import ordering (node builtins → third-party → local), missing trailing newline, or spacing in the raw `fetch` body string. Fix: run `npm run format` first (it writes), then `lint`.
- **[EF3]** The two new `beforeAll` fixtures both bind servers to port:0 but Vitest's fork pool runs them in the same process. Two Fastify instances can both bind to port:0 simultaneously without conflict — the OS assigns distinct ports. If a conflict surfaces, it means hardcoded ports were accidentally introduced. Fix: verify `listen({ port: 0 })` is used in both fixtures.
- **[EF4]** T-2 passes in isolation but times out under the full concurrent suite run because Vitest runs integration tests in parallel fork workers and the Claude subprocess is under CPU load from multiple concurrent calls. Raise the T-2 timeout to 90,000ms if the solo-run passes but the full-suite run times out. Document the change.
- **[EF5]** `CI=true npm test` still runs integration tests (count > 80). Cause: the `vitest.config.ts` glob `tests/integration/**` does not match the new file paths. Verify the paths match the glob.

---

## Test Strategy

This task is not about writing new test cases. It is about:

1. **Integration**: running the full suite and confirming all five green-gate conditions.
2. **Regression detection**: comparing the test count and pass/fail status against the WS_05 baseline (80 tests).
3. **CI simulation**: running `CI=true npm test` to confirm integration tests are correctly excluded.
4. **Housekeeping**: updating `CLAUDE.md` Session State with the Phase 1B close-out.

No new production files. No new test files. Only fixes to issues surfaced by the full run.

---

## Contract: What This Task Inherits

| Symbol / Artifact | Source | Role in This Task |
|-------------------|--------|-------------------|
| `npm test` (Vitest run) | `package.json` | Runs all tests in `tests/**/*.test.ts` |
| `vitest.config.ts` `exclude` rule | Repo root | Already excludes `tests/integration/**` when `CI=true` |
| WS_05 baseline: 80 tests passing | CLAUDE.md Session State | The minimum count; T4 must show ≥ 83 |
| Phase 1B success criteria | `docs/plan/phases/01b_openai_translation_pipeline.md` §Success Criteria | The checklist T4 formally closes |
| `/house-keeping` skill | `.claude/skills/` | The mechanism for updating `CLAUDE.md` and committing the close-out |

---

## Subtask Progress Table

| #  | Subtask | Status | Iteration | Notes |
|----|---------|--------|-----------|-------|
| 1  | Run `npm test` with all tests active (including integration). Record the output: total test count, pass count, skip count, any failures | ✅ Done | 1 | 84 tests, 17 files, 0 failures. Duration 14.85s. |
| 2  | If any test fails: triage against the EF list. Apply the minimal fix in the correct layer. Re-run `npm test`. Confirm no new regressions | ✅ Done | — | No failures — subtask N/A. |
| 3  | Run `npm run typecheck` — confirm zero errors | ✅ Done | 1 | `tsc --noEmit` exits 0, zero TS errors. |
| 4  | Run `npm run lint` — confirm zero issues | ✅ Done | 1 | `eslint .` exits 0, zero errors/warnings. |
| 5  | Run `npm run format` — confirm no diff (run `--check` mode or compare git status) | ✅ Done | 1 | `npm run format` exits 0; all 30 source/test files unchanged. Docs (.md) are outside the format script glob — not a regression. |
| 6  | Run `CI=true npm test` — confirm integration tests are excluded; confirm count is 80 (WS_01–WS_05 unit tests only) | ✅ Done | 1 | 77 tests, 12 files. Integration tests correctly excluded. Tracker assumption of "80" was stale: the pre-WS_06 full-suite count was 80 (77 unit + 3 pre-existing integration); CI mode correctly excludes all 7 integration tests leaving 77. No config change needed. |
| 7  | Invoke `/house-keeping` skill to: update `CLAUDE.md` Session State with Phase 1B close-out note, update WS_06 status to Completed in the workstream doc, and commit the close-out | ✅ Done | 1 | House-keeping invoked; CLAUDE.md updated; committed. |

_Status icons: `✅ Done` | `🔄 In progress` | `⬚ Not started` | `❌ Blocked`_

---

## Current Subtask Detail

### Subtask 1: Full suite run

**Approach iteration plan**:
1. Run `npm test`. Record output.
2. If failures: fix per EF list and re-run.
3. Once green: proceed to typecheck, lint, format, CI simulation, close-out.

- **Current iteration**: 1 of 3
- **Verifiability**: `npm test` exits zero with ≥ 83 tests reported.
- **Critical discipline**: Do not adjust test assertions to make the suite green. Fix the production code at the correct layer. If the fix is non-trivial (e.g., requires a new decision), stop and escalate to the Principal Architect before proceeding.

---

## Decisions Made

### D1 — Phase 1B close-out is a CLAUDE.md update + commit, not a code change ✅ LOCKED (Architect, 2026-06-12)

**Decision**: The Phase 1B sign-off is recorded in `CLAUDE.md` Session State via the `/house-keeping` skill. It is not a code change and does not affect the production source tree.

**Rationale**: The close-out note is a planning record. Its content: (a) date of sign-off, (b) WS_06 status → Completed, (c) test count at close-out, (d) WS_07 and WS_08 unblocked. The `/house-keeping` skill handles archiving, CLAUDE.md update, and commit atomically.

**Rejected alternative — no formal close-out record**: The close-out is the formal gate for Phase 1C. Without a recorded close-out, subsequent work has no clear starting point and the session state becomes misleading.

### D2 — Only `src/` changes are permitted in T4; no new test files ✅ LOCKED (Architect, 2026-06-12)

**Decision**: T4 may only modify `src/` files to fix regressions surfaced by the full suite run. It does not add new test cases. The test files are locked after T2 and T3 sign off.

**Rationale**: T4 is an integration and close-out task. Adding test cases in T4 would circumvent the T2/T3 review process. Any discovered gap should be filed as a new task in Phase 1C or WS_08.

**Rejected alternative — open-ended test additions in T4**: Violates the Rule of One. T4 is one coherent deliverable: full suite green, gate closed.

### D3 — Anti-overengineering scope fence ✅ LOCKED

**This task explicitly does NOT include**:
- Writing new integration tests (T1/T2/T3 own that).
- Streaming implementation (Phase 3 scope).
- Token count implementation (spec §7.4: CLI agents return no token counts; field must remain absent).
- WS_07 (tool-call path) or WS_08 (retry hardening) work — those are Phase 1C and must not begin until T4 is signed off.

---

## Files Modified / Created

- Potentially `src/adapters/claude.ts` — **modify** only if a regression in the constraint tests is surfaced (EF1)
- Potentially `src/responseBuilder.ts` — **modify** only if a shape regression is surfaced
- `.claude/CLAUDE.md` — **modify** (Phase 1B close-out note via `/house-keeping`)
- `docs/plan/workstreams/ws06_e2e_no_tools.md` — **modify** (status → Completed via `/house-keeping`)

---

## Success Criteria / Verifiability

| #    | Criterion | How to verify |
|------|-----------|---------------|
| SC-1 | `npm test` exits 0; total test count ≥ 83 (80 baseline + ≥3 new integration tests) | Test runner output |
| SC-2 | Zero failures in the full suite; any previously passing test still passes | No red output from Vitest |
| SC-3 | `npm run typecheck` exits 0 | Zero TypeScript errors |
| SC-4 | `npm run lint` exits 0 | Zero ESLint errors or warnings |
| SC-5 | `npm run format` produces no diff | `prettier --check` exits 0 or `git diff` shows no changes after `--write` |
| SC-6 | `CI=true npm test` excludes integration tests; count equals 80 (the WS_01–WS_05 baseline) | Test runner output shows 80 tests, no integration test file names |
| SC-7 | CLAUDE.md Session State updated with WS_06 Completed, Phase 1B exit note, date, test count | Read the updated CLAUDE.md |
| SC-8 | WS_07 and WS_08 are unblocked (recorded in CLAUDE.md "What is next") | Session State "What is next" lists WS_07 and WS_08 |

---

## Required Test Cases

_No new test cases are added in T4. The required evidence is the `npm test` output showing SC-1 and SC-2 satisfied._

---

## Phase 1B Close-Out Note (for CLAUDE.md update)

The `/house-keeping` skill must record the following in Session State:

- **Status**: WS_06 complete — all T1–T4 signed off. Phase 1B MVP fully proven E2E.
- **Test count**: `<N>` tests (80 WS_01–WS_05 baseline + `<M>` new integration tests from WS_06).
- **What was completed**: WS_06 T1 (server fixture, smoke), T2 (happy-path full pipeline, 6 assertions), T3 (stream guard + model guard via raw fetch), T4 (full suite green, Phase 1B gate closed).
- **What is next**: WS_07 (tool-call path) and WS_08 (retry hardening) — Phase 1C unblocked.
- **Phase 1B exit**: The spec §6 criterion — "an OpenAI SDK script produces correct chat completions using the Claude subscription" — is now formally proven end-to-end.

---

## Review Notes

_(Architect fills after BSE submits.)_

---

## Architect Sign-off

- [ ] Implementation reviewed
- [ ] All success criteria verified
- [ ] All assumptions resolved
- [ ] No regressions in full test suite
- [ ] `npm test` / `typecheck` / `lint` / `format` all clean
- [ ] Phase 1B close-out recorded in CLAUDE.md; WS_07 and WS_08 confirmed unblocked
