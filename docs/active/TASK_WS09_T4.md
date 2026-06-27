# TASK_WS09_T4: Phase-1 Green-Gate Sign-Off (Housekeeping — No Code)

## Context

- **Workstream**: WS_09 (Full Contamination Test Suite & Phase-1 Sign-Off)
- **Plan reference**: `docs/plan/workstreams/ws09_contamination_and_signoff.md`
- **Phase plan**: `docs/plan/phases/01c_tool_calling_and_acceptance.md`
- **Depends on**: T1 ✅, T2 ✅, and T3 ✅ (T3 requires OD-1 resolved first) — all green-gate-clean
- **Blocks**: Phase 2 head (MCP upgrade) — Phase 1 cannot close until this is signed off

---

## Goal & Why

- **Goal**: Formally close Phase 1. This is a **documentation/housekeeping** task — it writes **no
  source code**. It (1) runs the full gate and records both the full-local and CI test counts;
  (2) verifies every spec §6 acceptance criterion maps to a named, passing test; (3) records the
  Phase-1 sign-off note in `.claude/CLAUDE.md` Session State; (4) flips the phase and workstream
  statuses to Completed; (5) records "what is next" (Phase 2 head: MCP upgrade).
- **Why**: WS_09 sign-off **is** the Phase 1 sign-off. Phase 2's MCP upgrade inherits the
  contamination suite as its regression guard; the sign-off note is the record the next session reads
  to know what was proven and what the MCP upgrade must preserve (invariants #10/#11).

---

## Assumptions to Test

| #   | Assumption                                                                                  | Why we believe it                                                  | How this task tests it                                          | If false →                                              |
| --- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------- | ------------------------------------------------------- |
| A1  | CI count stays exactly **91** after T1/T2/T3 (all new files under `tests/integration/**`).   | `vitest.config.ts` excludes `tests/integration/**` when `CI` set.  | Run `CI=1 npx vitest run` and count.                            | A new test landed outside `tests/integration/` — relocate it. |
| A2  | Every spec §6 criterion has a named passing test (no orphan criterion, no orphan test).      | WS_06/07/08 + T1/T2/T3 cover §6 by design.                         | Build the §6 → test mapping table below and verify each row.    | Missing coverage — escalate; do NOT sign off.            |
| A3  | The full local suite is green with live Claude available; skips cleanly without it.          | All live cases are `healthCheck()`-guarded.                        | `npm test` locally with `claude whoami` valid.                  | Re-auth (`claude` login) or note skip; investigate code only if a non-live test fails. |

---

## Expected Failures

- **[EF1]** A live integration test fails due to expired auth / CLI update (not a code bug) → run
  `claude whoami`, re-authenticate, re-run. The `healthCheck()` guard skips cleanly if auth is
  unavailable; do not conclude a code regression from a skip.
- **[EF2]** T3 is still blocked on OD-1 → **T4 cannot complete.** T4 must not sign off Phase 1 while
  any §6 sub-case is unproven. If OD-1 is unresolved, T4 stays Not Started.

---

## Test Strategy

- **No new tests.** T4 only runs the existing gate and verifies coverage.
- **Coverage audit**: produce the spec §6 → named-test mapping (below) and confirm each row green.
- **Gate**: `npm run typecheck`, `npm run lint`, `npm run format` (no diff), `npm test` (full local),
  and `CI=1 npx vitest run` (CI subset == 91).

---

## Spec §6 → Named-Test Coverage Map (the audit T4 must complete)

| Spec §6 criterion                                  | Named test                                                                            | Status |
| -------------------------------------------------- | ------------------------------------------------------------------------------------- | ------ |
| No-tools happy path (`stop`, content, id prefix)   | `tests/integration/e2e.noTools.test.ts` T-2                                            | ⬚      |
| Tool-call path (`tool_calls`, fn name, args)       | `tests/integration/e2e.toolCall.test.ts` T-a                                           | ⬚      |
| Invariant #1 (no execution side effect)            | `tests/integration/e2e.toolCall.test.ts` T-b (write_file absence-of-side-effect)      | ⬚      |
| Retry exhaustion → HTTP 500 (proxy level)          | `tests/proxy.test.ts` `WS_08 T3-SC1`                                                   | ⬚      |
| Retry exhaustion → OpenAI SDK `APIError` surface   | `contamination.sequential.http.integration.test.ts` T-2 (WS_09 T1)                    | ⬚      |
| Contamination — sequential (HTTP path)             | `contamination.sequential.http.integration.test.ts` T-1 (WS_09 T1)                    | ⬚      |
| Contamination — concurrent                         | `contamination.concurrent.http.integration.test.ts` T-1 (WS_09 T2)                    | ⬚      |
| Contamination — retry path                         | `contamination.retryPath.http.integration.test.ts` (WS_09 T3 — pending OD-1)          | ⬚      |
| Contamination — sequential (adapter level guard)   | `tests/integration/contamination.sequential.integration.test.ts` T-I3 (WS_03)         | ⬚      |

_T4 checks each row green (or cleanly skipped for live cases) before sign-off. A `⬚` that cannot be
turned green blocks the sign-off._

---

## Subtask Progress Table

| #   | Subtask                                                                                              | Status        | Iteration | Notes |
| --- | --------------------------------------------------------------------------------------------------- | ------------- | --------- | ----- |
| 1   | Run `npm run typecheck` / `lint` / `format --check`; record clean.                                   | ⬚ Not started | —         | SC-3. |
| 2   | Run full local `npm test`; record total count + pass/skip breakdown.                                 | ⬚ Not started | —         | SC-1. |
| 3   | Run `CI=1 npx vitest run`; confirm count == 91.                                                       | ⬚ Not started | —         | SC-2. |
| 4   | Complete the §6 → named-test coverage map (every row green/skipped).                                  | ⬚ Not started | —         | SC-4. |
| 5   | Write Phase-1 sign-off note into `.claude/CLAUDE.md` Session State ("What was completed").            | ⬚ Not started | —         | SC-5. |
| 6   | Flip phase statuses 01a/01b/01c → Completed (status lines in `docs/plan/phases/01*.md`).              | ⬚ Not started | —         | SC-6. |
| 7   | Flip WS_01–WS_09 status lines → Completed in each `docs/plan/workstreams/ws0*.md`.                    | ⬚ Not started | —         | SC-6. |
| 8   | Record "what is next" (Phase 2 head: MCP upgrade) in Session State.                                   | ⬚ Not started | —         | SC-5. |

---

## Decisions Made

### [D1] — T4 is documentation-only; touches no `src/` ✅ LOCKED (Architect, 2026-06-26)

**Decision**: T4 edits only Markdown (`.claude/CLAUDE.md`, `docs/plan/phases/01*.md`,
`docs/plan/workstreams/ws0*.md`) and runs the gate. No source files change.
**Rationale**: WS_09 is an acceptance/proof workstream (no new production code); the sign-off is a
planning record. Editing `src/` here would violate the workstream's scope.
**Rejected alternative — bundle a "small cleanup" src change**: scope creep; any code change belongs
in its own task with its own review.

### [D2] — Sign-off is blocked until ALL §6 sub-cases are green ✅ LOCKED

**Decision**: T4 does not sign off Phase 1 while any §6 criterion (including the T3 retry-path
sub-case, pending OD-1) is unproven.
**Rationale**: The spec requires all three contamination sub-cases to pass for Phase 1. A partial
sign-off would falsely record Phase 1 as complete.

---

## Files Modified / Created

- `.claude/CLAUDE.md` — **modify** (Session State: Phase-1 sign-off note + what-is-next).
- `docs/plan/phases/01a_*.md`, `01b_*.md`, `01c_*.md` — **modify** (status line → Completed).
- `docs/plan/workstreams/ws01..ws09_*.md` — **modify** (status line → Completed).
- No `src/` or `tests/` changes.

---

## Success Criteria / Verifiability

| #    | Criterion                                                                                      | How to verify                                  |
| ---- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| SC-1 | Full local `npm test` green (or live cases cleanly skipped); count recorded.                   | `npm test` output captured in sign-off note.   |
| SC-2 | `CI=1 npx vitest run` count == **91** (no regression; no new CI-runnable tests).               | CI run count recorded.                         |
| SC-3 | `npm run typecheck` clean; `npm run lint` clean; `npm run format` no diff.                      | Gate commands clean.                            |
| SC-4 | §6 → named-test coverage map complete; every row green/skipped; no orphan criterion or test.   | Coverage table all checked.                    |
| SC-5 | Phase-1 sign-off note in `.claude/CLAUDE.md` Session State: §6 criteria list + what-is-next.    | Section present and specific (per-criterion).  |
| SC-6 | Phase statuses 01a/01b/01c = Completed; WS_01–WS_09 statuses = Completed.                       | Status lines updated.                          |

---

## Required Test Cases

None — T4 authors no tests. Verification is the gate run + the coverage audit.

---

## Review Notes

_(Architect fills after BSE submits — this is also the Phase-1 sign-off review.)_

---

## Architect Sign-off

<!-- This sign-off IS the Phase 1 sign-off. -->

- [ ] T1, T2, T3 all signed off and green
- [ ] §6 coverage map complete and all green/skipped
- [ ] CI count == 91; full local suite green
- [ ] Sign-off note + status flips landed
- [ ] `npm test` / `typecheck` / `lint` / `format` all clean
- [ ] **Phase 1 declared Complete**
