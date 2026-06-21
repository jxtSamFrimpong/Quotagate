# TASK_WS08_T1: Structural Corrections (F1/F3/F4) + `src/router.ts`

## Overview

- **Workstream**: WS_08 — Validator Retry Loop & Single-Backend Router
- **Task ID**: T1
- **Estimated Duration**: ~1.5 hours
- **Status**: ⬚ Not Started
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
- [ ] SC-F1-1: `responseBuilder.ts` tool_call branch generates ID as
  `'call_' + randomUUID().replace(/-/g, '').slice(0, 24)` — 24 alphanumeric chars, no hyphens.
- [ ] SC-F1-2: `tests/responseBuilder.test.ts` T-5 regex updated to `/^call_[0-9a-f]{24}$/`.
- [ ] SC-F1-3: The `chatcmpl-` prefix format is **unchanged** — only the `call_` format changes.
- [ ] SC-F1-4: All other T-5 assertions remain intact (finish_reason, content, tool_calls length,
  function name, arguments, UUID uniqueness).

### F3 — `tool_choice:"required"` instruction gap
- [ ] SC-F3-1: `buildConstrainedPrompt` in `src/adapters/claude.ts` adds a conditional branch:
  when `toolChoice === 'required'`, the prompt includes an explicit unconditional directive stating
  the model must invoke one of the available functions regardless of whether the conversation
  "calls for it."
- [ ] SC-F3-2: The unconditional directive is appended in the `parts` array **before** the
  conversation turn — not after, to preserve the same positional relationship as `CONSTRAINT_INSTRUCTIONS`.
- [ ] SC-F3-3: The `toolChoice !== 'required'` path is unchanged — the existing conditional
  phrasing ("if the conversation calls for invoking one of the available functions") is preserved
  for `auto` and `none`.
- [ ] SC-F3-4: `tests/adapters/claude.test.ts` (or the file that tests `buildConstrainedPrompt`)
  has a test proving that the `required` path includes the unconditional directive and the `auto`
  path does not.

### F4 — `AdapterResponse.backend` union
- [ ] SC-F4-1: `AdapterResponse.backend` in `src/types.ts` changes from the literal
  `'claude-subprocess'` to the union `'claude-subprocess' | 'claude-mcp'`.
- [ ] SC-F4-2: All existing `'claude-subprocess' as const` assignments in `src/adapters/claude.ts`
  remain valid (literal is assignable to union — no cast needed).
- [ ] SC-F4-3: `npm run typecheck` passes with no errors after this change.

### WS_08-D4 — `maxAttempts` parameter (B-1, LOCKED)
- [ ] SC-D4-1: `validateWithRetry` signature changes to
  `(raw, messages, invoker, maxAttempts: number): Promise<QuotagateCompleteResult>`.
- [ ] SC-D4-2: The internal `MAX_ATTEMPTS` constant is **removed**; the `for` loop uses the
  `maxAttempts` parameter.
- [ ] SC-D4-3: All existing `validator.test.ts` calls to `validateWithRetry` are updated to pass
  `3` as the fourth argument — behavior is identical, now explicit.
- [ ] SC-D4-4: `proxy.ts` call site (updated in T2) will pass `config.retry.max_attempts` — T1
  updates the signature only; T2 wires the config value.

### `src/router.ts` — synchronous single-backend resolver
- [ ] SC-R1: `resolve(alias, config, adapters)` returns the `CLIAdapter` from the `adapters` map
  whose key matches `config.models[alias].backend`.
- [ ] SC-R2: Unknown alias (not in `config.models`) → returns `null`.
- [ ] SC-R3: Known alias with no matching key in `adapters` map → returns `null`.
  (e.g., `config.models["gemini-pro"].backend === "gemini"` but `adapters` map has no `"gemini"` key)
- [ ] SC-R4: Wrong key convention (e.g., key is `"claude-subprocess"` but backend is `"claude"`)
  → returns `null`. A unit test **must** prove this with an explicit comment documenting the
  invariant: the adapters map key must exactly equal the config `backend` string.
- [ ] SC-R5: `resolve()` is a **pure synchronous function** — no I/O, no side effects, no
  `Promise`. A JSDoc comment states:
  `// Phase 2: extend to Promise<CLIAdapter | null> to support async health checks.`
- [ ] SC-R6: `tests/router.test.ts` covers: known alias resolves; unknown alias returns null;
  missing backend key returns null; wrong-key-convention returns null (with comment).

---

## Assumptions to Test

- [ ] A1: The literal `'claude-subprocess'` assignment in `claude.ts` is compatible with the union
  type `'claude-subprocess' | 'claude-mcp'` without adding a cast — verify with `typecheck`.
- [ ] A2: `buildConstrainedPrompt` tests exist in `tests/adapters/claude.test.ts` — verify before
  writing SC-F3-4 (if no existing test file, check `tests/adapters/` for the right location).
- [ ] A3: The `maxAttempts` parameter change does not require updating `proxy.test.ts` tests that
  call `validateWithRetry` indirectly (they go through the proxy, not the function directly) —
  only `validator.test.ts` calls `validateWithRetry` directly and needs updating.

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
| 1 | F1: Update `responseBuilder.ts` `call_` ID expression | ⬚ Not Started | One-line change |
| 2 | F1: Update `responseBuilder.test.ts` T-5 regex assertion | ⬚ Not Started | `/^call_[0-9a-f]{24}$/` |
| 3 | F4: Update `AdapterResponse.backend` in `types.ts` to union | ⬚ Not Started | Literal stays valid |
| 4 | D4: Remove `MAX_ATTEMPTS`; add `maxAttempts` param to `validateWithRetry` | ⬚ Not Started | All validator tests updated |
| 5 | F3: Add `required` directive branch in `buildConstrainedPrompt` | ⬚ Not Started | Conditional on `toolChoice === 'required'` |
| 6 | F3: Add unit test for `required` vs `auto` path in `buildConstrainedPrompt` | ⬚ Not Started | Asserts directive present/absent |
| 7 | Author `src/router.ts` | ⬚ Not Started | Sync, pure, JSDoc comment for Phase 2 |
| 8 | Author `tests/router.test.ts` | ⬚ Not Started | SC-R1–R6 |
| 9 | Run green gate (`npm test`, `typecheck`, `lint`, `format`) | ⬚ Not Started | Must pass before T2 starts |

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

*(PA fills after implementation)*

---

## Sign-off

- [ ] PA reviewed
- [ ] Green gate passing (92 + net new tests, no regression)
