# TASK_WS08_T4: Green-Gate Close-Out & WS_08 Sign-Off Preparation

## Overview

- **Workstream**: WS_08 — Validator Retry Loop & Single-Backend Router
- **Task ID**: T4
- **Estimated Duration**: ~45 minutes
- **Status**: ⬚ Not Started
- **Dependencies**: T1, T2, T3 all complete

---

## Goal

Run the full gate (all four commands), verify the test count is correct and consistent with the
projected baseline, confirm all prior workstream integration tests still pass end-to-end (WS_06,
WS_07), and produce the final count and gate-status summary that the PA needs to sign off WS_08.
T4 fixes any issues surfaced by the gate; it does not introduce new features.

---

## Success Criteria

### Gate commands
- [ ] SC-1: `npm test` exits 0 — all Vitest suites pass.
- [ ] SC-2: `npm run typecheck` exits 0 — zero TypeScript errors.
- [ ] SC-3: `npm run lint` exits 0 — zero ESLint violations.
- [ ] SC-4: `npm run format` produces no diff.
- [ ] SC-5: `CI=true npm test` exits 0 (integration tests excluded; CI-only count verified).

### Test count
- [ ] SC-6: The full test count (non-CI) is `92 + net_new_T1_T2_T3`. Document the exact new total
  in this tracker.
  - T1 adds: `tests/router.test.ts` (4–5 tests) + `responseBuilder.test.ts` T-5 update (0 net new)
    + `validator.test.ts` updates (0 net new) + `buildConstrainedPrompt` `required` test (1 net new).
  - T2 adds: 0 net new tests (all updates, no additions).
  - T3 adds: 2 net new tests (SC-1 exhaustion + SC-2 correction content).
  - **Projected total: 92 + ~6–7 net new ≈ 98–99 tests** (exact count confirmed in subtask 3).
- [ ] SC-7: The CI-only count (integration tests excluded) is `83 + net_new_T1_T2_T3_unit_only`.
  All T1/T2/T3 new tests are in `tests/` (not `tests/integration/`) → CI count increases by the
  same net new unit tests. Projected CI: `83 + ~6–7 ≈ 89–90`.

### Prior workstream regression guard
- [ ] SC-8: WS_06 end-to-end (`e2e.noTools.test.ts`) tests pass if `healthCheck()` returns true
  (skipped on CI). The proxy migration must not break the no-tools path.
- [ ] SC-9: WS_07 end-to-end (`e2e.toolCall.test.ts`) tests pass if `healthCheck()` returns true.
  The router migration must not affect the tool-call path.
- [ ] SC-10: All `tests/integration/constraint.integration.test.ts`,
  `tests/integration/contamination.sequential.integration.test.ts`,
  `tests/integration/executionSuppression.integration.test.ts`, and
  `tests/integration/e2e.errorPaths.test.ts` tests pass (skip on `healthCheck()` false).

### No regressions
- [ ] SC-11: No test that was passing before T1 is now failing or skipped for a non-live-Claude
  reason. If a test fails, it is diagnosed and fixed in T4 — not commented out or weakened.

---

## Assumptions to Test

- [ ] A1: T1's `buildConstrainedPrompt` `required` branch does not affect the existing integration
  tests (WS_06, WS_07) because those tests do not pass `tool_choice: 'required'` — confirm.
- [ ] A2: F4's union type change (`AdapterResponse.backend`) has no runtime effect — it is purely
  a type widening. Confirm no test asserts `backend === 'claude-subprocess'` in a way that would
  break if the type changes.

---

## Decisions

No new decisions in T4. T4 is a quality gate, not a feature task.

---

## Subtask Progress Table

| # | Subtask | Status | Notes |
|---|---------|--------|-------|
| 1 | Run `npm run typecheck` | ⬚ Not Started | Catches any missed callsite updates |
| 2 | Run `npm run lint` and `npm run format` | ⬚ Not Started | |
| 3 | Run `npm test` — record exact test count | ⬚ Not Started | Fill SC-6 projected total with actuals |
| 4 | Run `CI=true npm test` — record CI-only count | ⬚ Not Started | Fill SC-7 |
| 5 | Verify WS_06/WS_07 integration tests pass (live Claude) | ⬚ Not Started | Skip gracefully if no live subscription |
| 6 | Fix any gate failures | ⬚ Not Started | Diagnose root cause; no workarounds |
| 7 | Document final test counts in this tracker | ⬚ Not Started | Full: ___ / CI: ___ |

---

## Test Strategy

T4 runs tests, does not author them. If a test failure is discovered:

1. **If a new test fails**: it is a bug in T1/T2/T3 implementation — fix the implementation or the
   test assertion (only if the assertion was wrong, documented why).
2. **If an old test regresses**: it is a T1/T2/T3 breakage — trace the regression to the specific
   change and fix the root cause. Do NOT comment out or weaken the assertion.
3. **If a live-Claude test fails**: healthCheck() should handle this gracefully — check that
   `ctx.skip()` is called correctly. If the skip is not firing, that is a test bug, not a live
   failure.

---

## Review Notes

*(PA fills after implementation)*

---

## Final Test Counts (filled by BSE during T4)

- **Full test count** (npm test): ___
- **CI-only count** (CI=true npm test): ___
- **Net new tests from WS_08**: ___

---

## Sign-off

- [ ] PA reviewed (Full Pass: all SC verified)
- [ ] Green gate passing
- [ ] WS_08 complete — ready for WS_09
