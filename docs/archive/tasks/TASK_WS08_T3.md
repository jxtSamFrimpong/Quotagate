# TASK_WS08_T3: Retry Loop Integration Tests at Proxy Level

## Overview

- **Workstream**: WS_08 — Validator Retry Loop & Single-Backend Router
- **Task ID**: T3
- **Estimated Duration**: ~1 hour
- **Status**: ⬚ Not Started
- **Dependencies**: T2 complete and green gate passing

---

## Goal

Prove that the retry loop, as wired into the real `proxy.ts` → `adapter.complete()` path, produces
the correct HTTP responses at the exhaustion boundary and that the correction note threads through
the pipeline with the right content. Two existing tests already cover the malformed-then-good happy
path at the proxy level (`proxy.test.ts` pipeline T-3) and at the validator unit level
(`validator.test.ts` T-3/T-4) — T3 does NOT re-author those. What T3 adds is specifically:

1. **Retry exhaustion at HTTP level** — three consecutive malformed responses cause the proxy to
   return HTTP 500 with a correctly shaped OpenAI-format error body and no stack trace. No current
   test proves this end-to-end path.
2. **Correction note content at proxy level** — the second `adapter.complete()` call receives a
   messages array whose last element has `role:'user'` and `content` beginning with
   `"The previous response was not valid JSON"`. This is distinct from `validator.test.ts` T-4
   (which proves content-freeness only) — T3 proves the actual correction wording threads through
   the proxy pipeline.

---

## Success Criteria

### SC-1: Retry exhaustion → HTTP 500, OpenAI-format error body
- [ ] SC-1-a: `stubAdapter.complete` returns `{ raw: 'not json', backend: 'claude-subprocess' }`
  on all three attempts (three `mockResolvedValueOnce` calls).
- [ ] SC-1-b: HTTP response status is `500`.
- [ ] SC-1-c: Response body has shape `{ error: { message: string, type: string, code: string } }`.
- [ ] SC-1-d: `body.error.code` is `'validation_error'`.
- [ ] SC-1-e: `body.error.type` is `'validation_error'`.
- [ ] SC-1-f: `body.error.stack` is `undefined` — no stack trace leaked.
- [ ] SC-1-g: `stubAdapter.complete` was called exactly **3** times (attempt 1 uses the initial
  call; attempts 2 and 3 are invoked by `validateWithRetry` via the `invoker` closure).

### SC-2: Correction note content threads through pipeline
- [ ] SC-2-a: `stubAdapter.complete` returns malformed on attempt 1, well-formed
  `'{"type":"text","content":"recovered"}'` on attempt 2.
- [ ] SC-2-b: HTTP response status is `200`.
- [ ] SC-2-c: `stubAdapter.complete` was called exactly **2** times.
- [ ] SC-2-d: The **first** `stubAdapter.complete` call received a messages array of length `1`
  (original messages only).
- [ ] SC-2-e: The **second** `stubAdapter.complete` call received a messages array of length `2`.
- [ ] SC-2-f: The last element of the second call's messages array has `role: 'user'`.
- [ ] SC-2-g: The last element's `content` **starts with** `"The previous response was not valid JSON"`.
- [ ] SC-2-h: The last element's `content` does **not** contain the malformed raw string from
  attempt 1 (content-free guard — redunant but explicit belt-and-suspenders at this level).

---

## Assumptions to Test

- [ ] A1: `proxy.test.ts` pipeline describe block's `stubAdapter.complete` is reset via
  `vi.clearAllMocks()` in `beforeEach` — confirm this pattern holds so that `mockResolvedValueOnce`
  calls in SC-1 and SC-2 do not bleed across tests. If not, the tests must clear mocks themselves.
- [ ] A2: The `invoker` closure in `proxy.ts` calls `adapter.complete(buildAdapterRequest({...}))` —
  the `adapter` reference in scope is the one injected via the `adapters` map. After T2's migration,
  `adapter` comes from `resolve(model, config, adapters)`. Confirm the closure still closes over the
  correct `adapter` reference.
- [ ] A3: Three `mockResolvedValueOnce` calls is the right setup for SC-1 — the first call happens
  before `validateWithRetry` (raw response from the initial `adapter.complete()` call in `proxy.ts`),
  and attempts 2 and 3 are the invoker calls inside the retry loop. Three total calls = one
  pre-validate + two retries.

---

## Decisions

**Test placement (LOCKED)**: Both new tests go into `tests/proxy.test.ts` under the existing
"pipeline wiring" describe block — alongside the existing T-3 (malformed-then-good). This keeps all
proxy-level retry assertions in one place.

**SC-2 is NOT redundant with `proxy.test.ts` T-3 (LOCKED)**: T-3 asserts message array lengths
(1 and 2). SC-2 adds the content assertion (`role:'user'`, content begins with the correction
wording). These are distinct assertions. SC-2 proves the actual CORRECTION_NOTE value propagates,
not just that a message was appended.

**No new test files (LOCKED)**: T3 extends `proxy.test.ts` only. There is no `retryIntegration.test.ts`
or similar — the proxy test is the correct home for proxy-level retry behavior.

---

## Subtask Progress Table

| # | Subtask | Status | Notes |
|---|---------|--------|-------|
| 1 | Verify `proxy.test.ts` pipeline block's `beforeEach` clears mocks | ⬚ Not Started | A1 assumption |
| 2 | Add SC-1 test (retry exhaustion → HTTP 500) to pipeline describe block | ⬚ Not Started | 3 malformed `mockResolvedValueOnce` |
| 3 | Add SC-2 test (correction note content) to pipeline describe block | ⬚ Not Started | Asserts content starts-with |
| 4 | Run `npm test` — verify both new tests pass and no existing tests regress | ⬚ Not Started | |
| 5 | Run full green gate | ⬚ Not Started | Baseline is T2's count |

---

## Test Strategy

**No new test files.** All additions go into `tests/proxy.test.ts` (pipeline wiring describe block).

**Two new tests** added after the existing T-3 (or logically grouped with it):
- `T-5 (WS_08): retry exhaustion (3× malformed) → HTTP 500 validation_error, no stack` (SC-1)
- `T-6 (WS_08): correction note content threads through proxy pipeline` (SC-2)

Naming convention: use WS_08 suffix or descriptive name to distinguish from existing T-5/T-6 if
they exist in the same describe block. The WS_08 T-3/T-4 in `responseBuilder.test.ts` already
occupy `T-5`/`T-6` names there — be careful with naming in `proxy.test.ts` to avoid confusion.

**What proves T3 done**: both new tests pass, `stubAdapter.complete` call counts are exactly 3 and
2 respectively, and the existing pipeline T-3 (malformed-then-good, 200) still passes.

---

## Review Notes

**PA Full Pass — 2026-06-25 — Verdict: APPROVE.** Both new tests are rigorous, meet every success
criterion, exercise the real production path end-to-end (`server.inject()` → Zod parse → `resolve()`
→ `adapter.complete()` → `validateWithRetry()` → `setErrorHandler`/`buildChatCompletion` → HTTP
response), and respect all abstraction boundaries. Key confirmations:

- **Engineering Integrity** — no in-memory shortcuts; the malformed-raw mock genuinely fails the live
  `JSON.parse` → real `ValidationError`; both request shape (messages + CORRECTION_NOTE) and response
  shape (OpenAI error envelope) validated; green gate ratcheted 89 → 91, 0 regressions; tests mock at
  the `CLIAdapter` interface (`satisfies CLIAdapter`), so they survive the MCP upgrade unchanged.
- **SC-1 (7/7)** — HTTP 500, `error.{code,type}='validation_error'`, non-empty `message`, `stack`
  undefined, exactly 3 adapter calls (proves `maxAttempts=3` honored, D4 wired end-to-end).
- **SC-2 (8/8)** — malformed→good→200, messages length 1→2, correction note `role:'user'`, content
  `toMatch(/^The previous response was not valid JSON/)`, content-free guard (`not.toContain('not json')`).
- **Spec integrity** — Invariant #5 (OpenAI error contract via real `setErrorHandler`), #11 (strictly
  sequential `await` retries, no parallelism), §3.2 (live `CORRECTION_NOTE` propagation), §4.4
  (descriptive non-leaking 500).
- **Assumptions A1/A2/A3** all verified.

**O-1 (non-blocking, cosmetic)** — SC-2 structurally overlaps existing T-3 (both assert message
lengths 1→2, 200, 2 calls); the load-bearing additions are the CORRECTION_NOTE wording and
content-free assertions. Optional one-line comment above SC-2 noting the distinction; may be folded
into T4 or left as-is. Not a blocker.

---

## Sign-off

- [x] PA reviewed — APPROVE (PA Full Pass, 2026-06-25)
- [x] Green gate passing (91 tests, net +2 from T2 baseline, no regression)
