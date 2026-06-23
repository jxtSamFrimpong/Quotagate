# TASK_WS08_T1: Structural Corrections (F1/F3/F4) + `src/router.ts`

## Overview

- **Workstream**: WS_08 — Validator Retry Loop & Single-Backend Router
- **Task ID**: T1
- **Estimated Duration**: ~1.5 hours
- **Status**: ✅ Complete
- **Dependencies**: WS_07 signed off (green gate at 92 tests)

---

## Goal

Apply three PA deferred findings (F1, F3, F4) to the existing codebase — correcting the `call_` ID
format, the `tool_choice:"required"` instruction gap, and the `AdapterResponse.backend` type
narrowness — then author `src/router.ts`. All structural corrections happen first so that T2's proxy
migration and T3's retry tests run against a corrected codebase. T1 must leave the green gate clean
before T2 starts.

---

## Success Criteria

### F1 — `call_` ID format
- [x] SC-F1-1: `responseBuilder.ts` tool_call branch generates ID as
  `'call_' + randomUUID().replace(/-/g, '').slice(0, 24)` — 24 alphanumeric chars, no hyphens.
- [x] SC-F1-2: `tests/responseBuilder.test.ts` T-5 regex updated to `/^call_[0-9a-f]{24}$/`.
- [x] SC-F1-3: The `chatcmpl-` prefix format is **unchanged** — only the `call_` format changes.
- [x] SC-F1-4: All other T-5 assertions remain intact (finish_reason, content, tool_calls length,
  function name, arguments, UUID uniqueness).

### F3 — `tool_choice:"required"` instruction gap
- [x] SC-F3-1: `buildConstrainedPrompt` in `src/adapters/claude.ts` adds a conditional branch:
  when `toolChoice === 'required'`, the prompt includes an explicit unconditional directive stating
  the model must invoke one of the available functions regardless of whether the conversation
  "calls for it."
- [x] SC-F3-2: The unconditional directive is appended in the `parts` array **before** the
  conversation turn — not after, to preserve the same positional relationship as `CONSTRAINT_INSTRUCTIONS`.
- [x] SC-F3-3: The `toolChoice !== 'required'` path is unchanged — the existing conditional
  phrasing ("if the conversation calls for invoking one of the available functions") is preserved
  for `auto` and `none`.
- [x] SC-F3-4: `tests/adapters/buildConstrainedPrompt.test.ts` T-14 proves the `required` path
  includes the unconditional directive, the `auto` path does not, and the directive appears before
  `Conversation:` in the output.

### F4 — `AdapterResponse.backend` union
- [x] SC-F4-1: `AdapterResponse.backend` in `src/types.ts` changes from the literal
  `'claude-subprocess'` to the union `'claude-subprocess' | 'claude-mcp'`.
- [x] SC-F4-2: All existing `'claude-subprocess' as const` assignments in `src/adapters/claude.ts`
  remain valid (literal is assignable to union — no cast needed). Verified by typecheck.
- [x] SC-F4-3: `npm run typecheck` passes with no errors after this change.

### WS_08-D4 — `maxAttempts` parameter (B-1, LOCKED)
- [x] SC-D4-1: `validateWithRetry` signature changes to
  `(raw, messages, invoker, maxAttempts: number): Promise<QuotagateCompleteResult>`.
- [x] SC-D4-2: The internal `MAX_ATTEMPTS` constant is **removed**; the `for` loop uses the
  `maxAttempts` parameter.
- [x] SC-D4-3: All existing `validator.test.ts` calls to `validateWithRetry` are updated to pass
  `3` as the fourth argument — behavior is identical, now explicit.
- [x] SC-D4-4: `proxy.ts` call site wired in T1 (not T2) — green gate requires all callers to
  compile. `config.retry.max_attempts` is now passed at the call site. T2's SC-P4 is pre-completed.

### `src/router.ts` — synchronous single-backend resolver
- [x] SC-R1: `resolve(alias, config, adapters)` returns the `CLIAdapter` from the `adapters` map
  whose key matches `config.models[alias].backend`.
- [x] SC-R2: Unknown alias (not in `config.models`) → returns `null`.
- [x] SC-R3: Known alias with no matching key in `adapters` map → returns `null`.
  (e.g., `config.models["gemini-pro"].backend === "gemini"` but `adapters` map has no `"gemini"` key)
- [x] SC-R4: Wrong key convention (e.g., key is `"claude-subprocess"` but backend is `"claude"`)
  → returns `null`. SC-R4 test has explicit comment documenting the invariant.
- [x] SC-R5: `resolve()` is a **pure synchronous function** — no I/O, no side effects, no
  `Promise`. JSDoc Phase 2 note present.
- [x] SC-R6: `tests/router.test.ts` covers SC-R1–R5 (5 tests, all passing).

---

## Assumptions to Test

- [x] A1: The literal `'claude-subprocess'` assignment in `claude.ts` is compatible with the union
  type `'claude-subprocess' | 'claude-mcp'` without adding a cast — confirmed by typecheck.
- [x] A2: Tests for `buildConstrainedPrompt` are in `tests/adapters/buildConstrainedPrompt.test.ts`
  (not `claude.test.ts`). T-14 added there.
- [x] A3: `proxy.test.ts` tests call `validateWithRetry` indirectly through the proxy — confirmed
  they did not need updating. Only `validator.test.ts` direct call sites were updated.

---

## Decisions

**WS_08-D4 (LOCKED — B-1)**: `validateWithRetry` accepts `maxAttempts: number` as a fourth
parameter. The `MAX_ATTEMPTS = 3` constant is removed. All direct call sites supply `3` explicitly
(behavior unchanged). `proxy.ts` (T2) will wire `config.retry.max_attempts`.

**F3 placement decision (LOCKED)**: The `required` unconditional directive is injected into the
`buildConstrainedPrompt` output (stdin payload), not into `CONSTRAINT_INSTRUCTIONS` (the
`--system-prompt` channel). Rationale: the directive is contextual to the specific request's
`tool_choice` value; `CONSTRAINT_INSTRUCTIONS` is static and channel-clean. Mixing
per-request state into the system-prompt channel would break the clean separation established
in WS_02.

---

## Subtask Progress Table

| # | Subtask | Status | Notes |
|---|---------|--------|-------|
| 1 | F1: Update `responseBuilder.ts` `call_` ID expression | ✅ Done | One-line change |
| 2 | F1: Update `responseBuilder.test.ts` T-5 regex assertion | ✅ Done | `/^call_[0-9a-f]{24}$/` |
| 3 | F4: Update `AdapterResponse.backend` in `types.ts` to union | ✅ Done | Literal stays valid |
| 4 | D4: Remove `MAX_ATTEMPTS`; add `maxAttempts` param to `validateWithRetry` | ✅ Done | All validator tests + proxy.ts updated |
| 5 | F3: Add `required` directive branch in `buildConstrainedPrompt` | ✅ Done | Conditional on `toolChoice === 'required'` |
| 6 | F3: Add unit test for `required` vs `auto` path in `buildConstrainedPrompt` | ✅ Done | T-14 in buildConstrainedPrompt.test.ts |
| 7 | Author `src/router.ts` | ✅ Done | Sync, pure, JSDoc Phase 2 note |
| 8 | Author `tests/router.test.ts` | ✅ Done | 5 tests: SC-R1–R5 |
| 9 | Run green gate (`npm test`, `typecheck`, `lint`, `format`) | ✅ Done | CI: 89/89; full: 94/98 (+4 live-Claude flaky) |

---

## Test Strategy

**New files:**
- `src/router.ts` — exported `resolve()` function
- `tests/router.test.ts` — 4–5 unit tests covering SC-R1–R6

**Updated files:**
- `tests/responseBuilder.test.ts` — T-5 regex only (one assertion)
- `tests/validator.test.ts` — all `validateWithRetry(raw, msgs, invoker)` calls → `validateWithRetry(raw, msgs, invoker, 3)` (no behavior change)
- `tests/adapters/claude.test.ts` (or equivalent) — new test for `buildConstrainedPrompt` `required` path

**Proof of correctness**: `npm run typecheck` clean after F4 union change confirms the literal is
assignable to the union. The router unit tests are 100% branch coverage — pure function with no I/O
means no excuse for gaps.

---

## Review Notes

**PA Full Pass — 2026-06-23 — APPROVE**

All SC verified. Gate clean. No blocking findings. Four non-blocking observations:

- **O-1 (non-blocking):** Real OpenAI `call_` IDs use base62 (mixed-case alphanumeric), not hex-only.
  The 24-char hex format is pragmatic (UUID as entropy source) and acceptable for Phase 1. Revisit
  in Phase 3 DX if OpenAI SDK consumers check the ID format more strictly. Not a T1 error.

- **O-2 (non-blocking):** `tests/types/quotagateCompleteResult.test.ts` SC-7 comment still reads
  `"is not assignable to 'claude-subprocess'"` — union widened by F4, comment stale. `"wrong"` is
  still not in the union so the `@ts-expect-error` suppresses a real error correctly. Update comment
  in T4 cleanup.

- **O-3 (non-blocking):** F3 directive fires when `toolChoice === 'required'` but no tools are
  present — "MUST invoke one of the available functions" with nothing to invoke. Upstream client
  contract (OpenAI) requires non-empty `tools` with `tool_choice: 'required'`; a Zod guard in
  `OpenAIChatRequestSchema` is the correct fix. Deferred; not T1's scope.

- **O-4 (non-blocking):** T-14 tests `required` vs `auto` only. `none` takes the same else-branch
  as `auto` — full branch coverage is achieved; a `none` assertion would add readability only.
  Low priority.

**T2 handoff note:** SC-P4 ("wire `config.retry.max_attempts` in `proxy.ts`") was pre-completed in
T1 to satisfy the green gate. BSE must not re-apply it in T2 — mark SC-P4 satisfied at T2 start.

---

## Sign-off

- [x] PA reviewed — Full Pass 2026-06-23 (4 non-blocking observations, 0 blockers)
- [x] Green gate passing — CI: 89 tests (+6 from 83); typecheck clean; lint clean; format clean.
  Full run: 94/98 passed (4 failures are live-Claude flakiness — markdown-fenced output/timeout;
  first background run passed all 98; not T1 regressions).
