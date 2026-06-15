# TASK_WS07_T4: Green-Gate Close-Out & Post-Integration Hardening

## Context

- **Workstream**: WS_07 (Tool-Call Response Path)
- **Plan reference**: `docs/plan/workstreams/ws07_tool_call_response_path.md`
- **Phase plan**: `docs/plan/phases/01c_tool_calling_and_acceptance.md`
- **Depends on**: TASK_WS07_T3 (live tool-call integration test must have completed at least one full passing run)
- **Blocks**: WS_08 (retry hardening can proceed in parallel, but T4 sign-off is required before WS_09 acceptance gate)

---

## Goal & Why

- **Goal**: Run the full green gate (`npm test`, `typecheck`, `lint`, `format`, `CI=true npm test`), verify exact test counts, confirm the T-4 replacement in `responseBuilder.test.ts` is in force (no residual throw assertion), and harden any constraint wording that T3's live run exposed as unstable. Produce the signed-off WS_07 state that WS_09 will build on.
- **Why**: The green gate is a ratchet. WS_07 adds approximately 7 new tests (4 from T1, 3 from T2, 2 integration from T3 — exact count depends on T2 choices). Any count regression from the 84-test baseline is a sign-off blocker. Additionally, T3's live integration run is the first time the full stack runs with `tools` present — it may expose constraint wording issues (model returning text instead of tool_call) that require a fix in `CONSTRAINT_INSTRUCTIONS` before the gate can close. T4 is the checkpoint that ensures these findings are addressed, not deferred into WS_08.

---

## Assumptions to Test

| #  | Assumption | Why we believe it | How this task tests it | If false → |
|----|------------|-------------------|------------------------|------------|
| A1 | `tests/responseBuilder.test.ts` T-4 has been REPLACED (not left alongside a new test) — the old assertion (`throw QuotagateError`) is gone and the new assertion (`not.toThrow`) is in its place | T2 subtask 2 mandated this; if both exist, `npm test` would fail because the old T-4 expects a throw from a function that no longer throws | `npm test` green confirms this — a residual old T-4 would fail immediately on the tool_call input | Correct `tests/responseBuilder.test.ts` — remove the old T-4 body and ensure only the new assertion is present |
| A2 | `CI=true npm test` excludes all integration tests (the 2 from T3 plus the 7 from WS_06) and produces exactly `84 + T1_count + T2_count` unit tests | `vitest.config.ts` uses a glob that excludes `tests/integration/**` when `process.env.CI === 'true'`; WS_06 T4 confirmed this produces 77 unit tests from the 84-test baseline | Run `CI=true npm test` and count the output; the expected count is 77 (WS_06 CI baseline) + T1_new_count (4) + T2_new_count (3 new tests: rewritten T-4 counted as 1, T-5 as 1, T-6 as 1) = 84 | If the count is off: a test was accidentally placed in `tests/integration/` that should be in `tests/` (over-count), or a new test file is not being discovered by Vitest (under-count). Check the glob in `vitest.config.ts` |
| A3 | T3's live run produced a passing T-a (`finish_reason:"tool_calls"`) without constraint changes | WS_06 T2 passed without constraint changes; the CONSTRAINT_INSTRUCTIONS already include the tool_call format spec; empirical evidence from the PA Full Pass confirms the constraint worked for the no-tools path | T4 confirms by reviewing T3's run notes in its subtask progress table | EF1 in T3 manifested — `CONSTRAINT_INSTRUCTIONS` needs iteration. Fix is in `src/adapters/claude.ts`; see Subtask 4 |
| A4 | `write_file` T-b path uniqueness prevents cross-run interference | UUID path is unique per test run by construction; `afterEach` cleanup removes the path even if the assertion passes | Confirm by running the full integration suite twice in sequence and checking no stale-file errors | If a stale file from a previous run is found at a UUID path, that path was not cleaned up in a previous aborted run — `fs.rmSync(path, {force:true})` in `afterEach` handles this by design (force mode ignores ENOENT) |

---

## Expected Failures

- **[EF1]** `npm test` fails because old T-4 (`throw QuotagateError`) is still present alongside the new assertion. Fix: remove the old `it('T-4: tool_call branch throws...')` block from `tests/responseBuilder.test.ts`. Leave only the rewritten T-4.
- **[EF2]** `npm run typecheck` fails with a residual type error. Most likely cause: a field added in `responseBuilder.ts` during T2 that does not match the `ChatCompletion` type (e.g., `refusal` omitted, or `tool_calls` element missing `type: 'function'`). Fix at the source in `src/responseBuilder.ts`.
- **[EF3]** `CI=true npm test` count is wrong (not 77 + T1 + T2 count). Most likely cause: a new test was accidentally placed in `tests/integration/` instead of `tests/` (over-count under CI=false, under-count under CI=true). Fix: move the test to the correct directory.
- **[EF4]** T3's live run showed EF1 (model returning text for tool_call requests). T4 inherits this finding and must fix it in `CONSTRAINT_INSTRUCTIONS` before closing. See Subtask 4.
- **[EF5]** `npm run format` shows a diff in a file not otherwise modified. Most likely cause: a trailing space or inconsistent indentation introduced in a new test file. Fix: run `npm run format` and commit the diff.

---

## Test Strategy

- **No new tests in T4**: T4 does not add any new test cases. Its test work is verification — running the existing suite and confirming counts.
- **Green gate sequence**: Run the four gate commands in order: (1) `npm test`, (2) `npm run typecheck`, (3) `npm run lint`, (4) `npm run format`. Then run (5) `CI=true npm test`. All five must exit 0 before sign-off.
- **Count verification**: The expected test count is computed from the baseline (84) plus the counts added in T1, T2, and T3. Document the final count in the subtask table.
- **Constraint iteration (if needed)**: If T3's run notes show EF1 was triggered, Subtask 4 applies the fix to `CONSTRAINT_INSTRUCTIONS` and re-runs the full integration suite. The fix must not change `QuotagateCompleteResultSchema` or any test assertion — only the prompt text in `src/adapters/claude.ts`.

---

## Contract: What This Task Inherits

| Symbol / Artifact | Source | Role in This Task |
|-------------------|--------|-------------------|
| T3 subtask progress table | `TASK_WS07_T3.md` | Records whether EF1 manifested and whether constraint changes were applied |
| `CONSTRAINT_INSTRUCTIONS` | `src/adapters/claude.ts` | The only permissible target for constraint wording fixes (WS_07 workstream Known Pitfalls) |
| `vitest.config.ts` CI glob | `vitest.config.ts` | Controls which tests run under `CI=true`; must not be modified |
| WS_06 T4 CI count (77) | `docs/archive/tasks/TASK_WS06_T4.md` | The established baseline for unit-only test count |
| T-4 in `tests/responseBuilder.test.ts` | T2 deliverable | Must assert `not.toThrow`, not `throw QuotagateError` — verified in Subtask 1 |

---

## Subtask Progress Table

| #  | Subtask | Status | Iteration | Notes |
|----|---------|--------|-----------|-------|
| 1  | Confirm T-4 in `tests/responseBuilder.test.ts` is the REPLACED version (asserts `not.toThrow`, not `throw`) — read the file and verify | ⬚ Not started | — | |
| 2  | Run `npm test` — record the full test count; assert 0 failures | ⬚ Not started | — | Expected: 90 (T1+T2 signed off) + 2 (T3) = 92 total |
| 3  | Run `npm run typecheck` — 0 errors | ⬚ Not started | — | |
| 4  | If T3 run notes show EF1 (constraint failure): iterate `CONSTRAINT_INSTRUCTIONS` in `src/adapters/claude.ts`, re-run T3's live integration test until T-a passes, then re-run `npm test` | ⬚ Not started | — | Only applies if EF1 manifested in T3 |
| 5  | Run `npm run lint` — 0 warnings | ⬚ Not started | — | |
| 6  | Run `npm run format` — 0 diffs | ⬚ Not started | — | |
| 7  | Run `CI=true npm test` — confirm unit-only count = 77 + 4 (T1) + 2 (T2 net) = 83; 0 failures; 9 integration tests excluded (7 from WS_06 + 2 from T3) | ⬚ Not started | — | The 2 T3 integration tests must NOT appear in CI=true run |
| 8  | Confirm `write_file` T-b is UUID-path-unique: run the integration suite twice in sequence, no stale-file error on second run | ⬚ Not started | — | |
| 9  | Record final test counts in this subtask table (full run count, CI=true unit count) | ⬚ Not started | — | |

_Status icons: `✅ Done` | `🔄 In progress` | `⬚ Not started` | `❌ Blocked`_

---

## Current Subtask Detail

### Subtask 1: Verify T-4 replacement

Read `tests/responseBuilder.test.ts` and confirm the T-4 `it()` block:
- Does NOT contain `toThrow(QuotagateError)` or any throw assertion
- DOES contain a `not.toThrow()` assertion (or equivalent positive assertion for the tool_call branch)
- Is the only `it()` block covering the `tool_call` branch throw/no-throw behavior (no duplicate)

If both the old and new T-4 exist: the old one will fail, surfacing in Subtask 2's `npm test` run. Fix by removing the old block.

- **Current iteration**: 1 of 1
- **Verifiability**: Read the file; the old `'tool_call branch throws QuotagateError'` string must not appear.

### Subtask 4: Constraint wording iteration (conditional — only if T3 EF1 manifested)

**Only execute this subtask if T3's subtask progress table shows EF1 triggered (model returned `{type:"text"}` for a tool-call request).**

The fix target is `CONSTRAINT_INSTRUCTIONS` in `src/adapters/claude.ts` — specifically the opening framing and the format specification. The `buildConstrainedPrompt()` "Available functions" section may also need strengthening. Candidate improvements:
- Make the function-call instruction more emphatic when `tools` are present (e.g., "When a function is available and the user's request can be fulfilled by calling it, you MUST return the tool_call format").
- Confirm that `buildConstrainedPrompt()` includes the tool definitions (function name, description, parameters) in a way the model clearly identifies as callable.

After each change, run only the T3 integration test (not the full suite) to keep iteration fast. Once T-a passes reliably (≥ 2 consecutive runs), run the full suite.

**Stop condition**: If 3 constraint wording iterations fail to produce a reliable `{type:"tool_call"}` response, escalate to PA. The issue may be a model version change or a fundamental prompt engineering limitation that requires a deeper architectural response.

**Scope guard**: Do NOT change `QuotagateCompleteResultSchema`, `parseAndValidate()`, `validateWithRetry()`, or any test assertions to accommodate a constraint failure. The constraint must be fixed; the schema and tests are the contract.

---

## Decisions Made

### D1 — Constraint Wording Fixes Land in `claude.ts`, Never in the Schema or Tests ✅ LOCKED (Architect, 2026-06-15)

**Decision**: If T3's live run reveals that the model does not reliably return `{type:"tool_call"}` for tool-call requests, the fix is in `CONSTRAINT_INSTRUCTIONS` or `buildConstrainedPrompt()` in `src/adapters/claude.ts`. The `QuotagateCompleteResultSchema` in `src/types.ts` is not changed. Test assertions are not relaxed.

**Rationale**: The constraint prompt is Quotagate's own text, fully tunable without breaking any contract. The Zod schema is the output contract — loosening it to accept malformed model output would propagate the malformation into the `ChatCompletion` response received by the caller. The test assertions describe the correct contract; they are not wrong if the model fails to meet them.

**Rejected alternative — add a fallback that accepts `{type:"text"}` output as a valid tool_call response**: Violates invariant #5 (the response must be indistinguishable from the real OpenAI API) and produces a broken `ChatCompletion` object for agentic callers.

### D2 — Anti-overengineering scope fence ✅ LOCKED

**This task explicitly does NOT include**:
- Adding new test cases — T4 is verification only.
- Changes to `vitest.config.ts` or the CI exclusion glob.
- Changes to `src/proxy.ts`, `src/types.ts`, `src/validator.ts`, or `src/responseBuilder.ts` unless Subtask 4 requires a constraint-adjacent fix.
- WS_08 or WS_09 work — T4 closes WS_07; it does not begin WS_08.

---

## Files Modified / Created

- `src/adapters/claude.ts` — **potentially modify** (constraint wording in `CONSTRAINT_INSTRUCTIONS` if Subtask 4 applies)
- No other production files.
- No new test files.

---

## Success Criteria / Verifiability

| #    | Criterion | How to verify |
|------|-----------|---------------|
| SC-1 | `tests/responseBuilder.test.ts` T-4 asserts `not.toThrow`, not `throw QuotagateError` | Read the file; old throw assertion absent |
| SC-2 | `npm test` exits 0; expected count is 84 (baseline) + 4 (T1) + 3 (T2) + 2 (T3) = 93 or greater | `npm test` output; record actual count in subtask 9 |
| SC-3 | `npm run typecheck` exits 0; 0 TypeScript errors | Command output |
| SC-4 | `npm run lint` exits 0; 0 ESLint violations | Command output |
| SC-5 | `npm run format` exits 0; 0 diffs in `src/` and `tests/` | Command output |
| SC-6 | `CI=true npm test` exits 0; expected unit count = 77 (WS_06 CI baseline) + 4 (T1) + 3 (T2) = 84; T3's 2 integration tests absent from this run | `CI=true npm test` output; count documented in subtask 9 |
| SC-7 | Running the full integration suite twice in sequence produces no stale-file error and the same pass/fail result both times | Manual second run; `afterEach` cleanup confirmed |
| SC-8 | If Subtask 4 was executed: constraint wording change committed with a descriptive message; the change is in `CONSTRAINT_INSTRUCTIONS` only | `git diff` shows only `src/adapters/claude.ts` in Subtask 4's scope |

---

## Required Test Cases

**None.** T4 does not add test cases. Its deliverable is a verified green gate with documented counts.

---

## Review Notes

_(Architect fills after BSE submits.)_

---

## Architect Sign-off

- [ ] Implementation reviewed
- [ ] All success criteria verified
- [ ] All assumptions resolved (proven, or fallback taken & documented)
- [ ] No regressions in full test suite
- [ ] `npm test` / `typecheck` / `lint` / `format` all clean
