# Workstream WS_08: Validator Retry Loop & Single-Backend Router

> A workstream scopes ~1 day of work and is more detailed than its parent phase: concrete goals +
> deliverables, locked decisions (with rejected alternatives), a task breakdown, cross-task
> contracts, and success/quality gates. It is the bridge from phase goals to hour-sized tasks.

## Workstream Overview

- **Parent Phase**: [Phase 1C — Tool Calling & Acceptance](../phases/01c_tool_calling_and_acceptance.md)
- **Timeframe**: ~2 days
- **Status**: ✅ **Completed** (Phase 1 closed, 2026-08-24 — WS_09 T4 sign-off)
- **Dependencies**: WS_06 signed off — Phase 1B green gate holding; no-tools end-to-end integration test passing. WS_08 and WS_07 are largely independent and can proceed in parallel after WS_06. WS_09 depends on both WS_07 and WS_08 being signed off.

---

## Goals & Deliverables

- **Goal 1**: The validator retry loop fully exercised on a live path using a controlled test double.
  - Deliverable: Extended `tests/` coverage for `src/validator.ts` — specifically the live retry path exercised via a Vitest `vi.fn()` double that wraps the `invoker` parameter of `validate()`. The double injects a malformed raw string on attempt 1 and a well-formed result on attempt 2. This exercises the loop in the context of the full `validate()` call path as used by `proxy.ts` — not just the isolated retry-loop unit test from WS_04 T3. Also: retry-exhaustion test (three consecutive malformed responses from the double → `ValidationError` after exactly 3 attempts). And: confirmation that the correction note in the re-invocation message array carries only the formatting instruction, not the prior malformed content (WS_04-D3).

- **Goal 2**: `src/router.ts` — a thin single-backend alias resolver that replaces the inline lookup in `proxy.ts`.
  - Deliverable: `src/router.ts` — exports `resolve(alias: string, config: QuotagateConfig, adapters: Record<string, CLIAdapter>): CLIAdapter | null`. Reads `config.models`, looks up the alias, returns the corresponding `CLIAdapter` from the `adapters` map, or `null` if the alias is unknown or the backend has no registered adapter. No health checks, no multi-backend fallback (Phase 2). The signature is synchronous in Phase 1 and designed so Phase 2 can extend it to `Promise<CLIAdapter | null>` (async health check) without changing the `proxy.ts` call site beyond a single `await`.

- **Goal 3**: `proxy.ts` updated to use `router.ts` instead of the inline lookup from WS_05.
  - Deliverable: Modified `src/proxy.ts` — the inline alias resolution block (from WS_05-D3) is replaced by a call to `resolve(request.model, config, adapters)`. The HTTP 400 path for unknown aliases is preserved. The `createServer` factory signature changes to accept an `adapters` map instead of a single adapter: `createServer(config: QuotagateConfig, adapters: Record<string, CLIAdapter>): FastifyInstance`. All existing tests updated for the new signature.

---

## Why This Workstream Matters

WS_04 scaffolded the retry loop and unit-tested it against synthetic fixtures. The WS_04 tests prove the loop logic in isolation. WS_08 proves that the loop, as wired into the real `proxy.ts` → `adapter.complete()` path, behaves correctly under the full HTTP lifecycle — and that the retry path does not contaminate subsequent requests. The latter proof is essential before WS_09 can assert it as an acceptance criterion.

`router.ts` is a small but load-bearing seam. By extracting the alias resolution to a named module with a defined signature, WS_08 creates the interface that Phase 2 will extend to multi-backend resolution, health checks, and the `auto` routing policy. The Phase 2 extension does not touch `proxy.ts` at all — it only extends `router.ts`. Getting the interface right here is what makes Phase 2 a clean extension rather than a proxy rewrite.

The `proxy.ts` migration from inline lookup to `router.ts` is explicitly a mechanical change — the HTTP behavior is identical. The reason to do it in WS_08 rather than Phase 2 is that WS_09's acceptance tests should run against the final Phase 1 production code path, not a half-migrated proxy. The acceptance gate tests what will be released.

---

## Locked Decisions

### WS_08-D1 — Retry Tests Use a `vi.fn()` Double at the `invoker` Boundary; Two Distinct Tests ✅ LOCKED (Architect, 2026-06-08)

Inherits **D-1C-02** from the parent phase plan.

**Decision**: Two distinct tests:
(a) **Retry logic integration test** — a `vi.fn()` double is passed as the `invoker` argument to `validate()`; the double returns a malformed string on call 1 and a well-formed `AdapterResponse` on call 2. Asserts the resolved `QuotagateCompleteResult` is the second response, and that `invoker` was called twice. Also tests the exhaustion case: three consecutive malformed responses → `ValidationError`.
(b) **Retry-path contamination integration test** — in WS_09 (this is referenced here for clarity; it is not authored in WS_08). The contamination test runs the full HTTP path via the OpenAI SDK, uses a double to inject a malformed first response for request A, then asserts request B has a clean context. WS_08 provides the mechanism (the `invoker` boundary); WS_09 exercises the contamination assertion.

**Rationale**: The retry loop unit test in WS_04 T3 proved the loop logic in isolation. WS_08's test (a) proves it in the context of the full `validate()` call as wired by `proxy.ts`. The distinction matters: WS_04's test passes a bare `vi.fn()` directly; WS_08's test wires the double into the full proxy pipeline and asserts the HTTP response code (200 on success; 500 on exhaustion).

**Rejected alternative — test the retry loop only at the `validator.ts` unit level (WS_04)**: Already done in WS_04. WS_08 adds the proxy-level test because the HTTP error mapping (`ValidationError` → HTTP 500) has not been exercised by the retry loop yet — the WS_05 stub-adapter tests used a clean adapter, never a double that fails.

### WS_08-D2 — `router.ts` Signature Is Synchronous in Phase 1; Designed for Async Extension in Phase 2 ✅ LOCKED (Architect, 2026-06-08)

Inherits **D-1C-01** from the parent phase plan.

**Decision**: `resolve(alias, config, adapters)` returns `CLIAdapter | null` synchronously in Phase 1. It does not perform I/O. The `proxy.ts` call site does not use `await`. In Phase 2, when health checks are added, the signature becomes `Promise<CLIAdapter | null>` — and `proxy.ts` simply adds `await`. This is a deliberate backward-incompatible extension at the Phase 2 boundary, not a breaking change to the Phase 1 behavior.

**Rationale**: Health checks are network I/O; a synchronous router cannot perform them. Designing the signature as synchronous now and extending it to async in Phase 2 is cleaner than pre-emptively making it async (which would require `await` everywhere in Phase 1 for a function that does a Map lookup). The change from sync to async at the Phase 2 boundary is a single-line diff in `proxy.ts`.

**Rejected alternative — make `resolve` return `Promise<CLIAdapter | null>` now**: Forces `await resolve(...)` in `proxy.ts` for a function that does a Map lookup. Introduces async overhead and misleads the reader about the function's complexity. The Phase 2 migration is a known, bounded change — defer it.

### WS_08-D3 — `createServer` Factory Signature Changes to Accept `adapters` Map ✅ LOCKED (Architect, 2026-06-08)

**Decision**: `createServer` in `proxy.ts` changes from `createServer(config, adapter: CLIAdapter)` to `createServer(config, adapters: Record<string, CLIAdapter>)`. The adapters map is keyed by backend name (e.g. `{"claude": new ClaudeAdapter()}`). `router.ts`'s `resolve()` receives this map and returns the matching adapter. `index.ts` is updated to construct the map and pass it. All existing tests (WS_05 unit tests, WS_06 integration tests) are updated to pass the new signature.

**Rationale**: The router needs to dispatch to different adapters by backend name. The map makes the routing table explicit and testable in isolation — `resolve("claude-sonnet-4-6", config, {"claude": stubAdapter})` is a clean unit test. A single `adapter` parameter could not support multi-backend routing even in Phase 1's single-adapter case without naming the adapter.

**Rejected alternative — keep `createServer(config, adapter)` and pass the adapter to the inline lookup**: The inline lookup is being removed in favor of `router.ts`. Once `router.ts` exists, the proxy should not also hold a reference to a single adapter — it would duplicate the routing concern.

---

## Task Breakdown

| Task ID | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Est. Duration                                                                                                                                                                                                     | Status        | Task Tracker Link              |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ------------------------------ | ------------------------------ |
| T1      | Author `src/router.ts`: `resolve(alias, config, adapters)` — synchronous Map lookup; returns `CLIAdapter                                                                                                                                                                                                                                                                                                                                                                                  | null`. Unit tests: known Claude alias resolves to the injected adapter; unknown alias returns null; case-sensitivity behavior documented and tested; `adapters` map with missing backend returns null gracefully. | ~1 hour       | ⬚ Not started                  | `../../active/TASK_WS08_T1.md` |
| T2      | Update `src/proxy.ts`: replace inline lookup with `resolve()`; update `createServer` signature to `(config, adapters)`. Update `src/index.ts` to construct the adapters map. Update `tests/proxy.test.ts` and `tests/integration/e2e.noTools.test.ts` / `tests/integration/e2e.toolCall.test.ts` for the new signature. Green gate passes after migration.                                                                                                                                | ~1 hour                                                                                                                                                                                                           | ⬚ Not started | `../../active/TASK_WS08_T2.md` |
| T3      | Author retry loop integration tests (proxy-level): (a) `vi.fn()` double wired as the adapter's `complete()` method; double returns malformed string on attempt 1, well-formed on attempt 2; assert `proxy.ts` returns HTTP 200. (b) Double returns malformed string three times; assert `proxy.ts` returns HTTP 500 with OpenAI-format error body and no stack trace. (c) Assert correction note in messages array has correct structure (formatting instruction, no prior-turn content). | ~1 hour                                                                                                                                                                                                           | ⬚ Not started | `../../active/TASK_WS08_T3.md` |
| T4      | Green-gate close-out: run the full suite (`npm test`, `typecheck`, `lint`, `format`). Fix any issues from the `proxy.ts` migration or the retry tests. Confirm WS_06's e2e tests still pass end-to-end with the new `router.ts` path.                                                                                                                                                                                                                                                     | ~45 min                                                                                                                                                                                                           | ⬚ Not started | `../../active/TASK_WS08_T4.md` |

_Status: `✅ Completed` | `🔄 In Progress` | `⬚ Not started` | `❌ Blocked`_

_T1 is independent and can start immediately. T2 depends on T1 (replaces the inline lookup with the router). T3 depends on T2 (the proxy-level test uses the updated `createServer` signature). T4 depends on all three._

---

## Cross-Task Contracts

### `resolve(alias, config, adapters)` signature (owned by T1 → consumed by T2, T3, WS_09)

Defined in `src/router.ts`. Full signature:

```typescript
function resolve(
  alias: string,
  config: QuotagateConfig,
  adapters: Record<string, CLIAdapter>,
): CLIAdapter | null;
```

`proxy.ts` (T2) calls this synchronously. WS_09's tests use the same proxy, so the router is exercised in the acceptance tests without any additional wiring. Phase 2 extends this signature to `Promise<CLIAdapter | null>` — that is a planned, bounded change, not a surprise.

### `createServer(config, adapters)` updated signature (owned by T2 → consumed by T3, WS_06 tests, WS_09)

All callers of `createServer` must be updated in T2: `src/index.ts`, `tests/proxy.test.ts`, `tests/integration/e2e.noTools.test.ts`, `tests/integration/e2e.toolCall.test.ts`. The `adapters` map for tests uses a stub `CLIAdapter` keyed as `{"claude": stubAdapter}`, matching the config fixture's `backend: "claude"`.

### `validate()` invoker boundary (inherited from WS_04 → consumed by T3)

T3's retry tests pass a `vi.fn()` double as the `invoker` parameter to `validate()`. This is the exact boundary defined in WS_04-D2 and WS_04 T3. The double is wired via a stub adapter whose `complete()` method is a `vi.fn()`. The proxy calls `adapter.complete()` which is the double. The key is that the double is at the adapter boundary, not the validator boundary — this exercises the full `proxy.ts` → `adapter.complete()` → `validate()` path, not just `validate()` in isolation.

### Correction note message structure (inherited from WS_04-D3 → asserted in T3)

T3 asserts that on retry, the `invoker` receives a messages array whose last element is `{role: "user", content: "<formatting instruction>"}` with no content from the malformed prior response. The exact wording of the correction note must match what was established in WS_04-D3.

---

## Success & Evaluation Criteria

- **Functional requirements**:
  - [ ] `resolve("claude-sonnet-4-6", config, {"claude": adapter})` returns `adapter`.
  - [ ] `resolve("not-a-model", config, {"claude": adapter})` returns `null`.
  - [ ] `POST /v1/chat/completions` with a stub adapter whose `complete()` returns malformed on attempt 1 and well-formed on attempt 2 returns HTTP 200 with a valid `ChatCompletion`.
  - [ ] `POST /v1/chat/completions` with a stub adapter whose `complete()` always returns malformed returns HTTP 500 with an OpenAI-format error body; no stack trace in response body.
  - [ ] Correction note in retry messages has `role: "user"` and contains a formatting instruction but no content from the prior malformed response.
  - [ ] WS_06's end-to-end integration tests still pass after the `proxy.ts` migration to `router.ts`.

- **Named tests that prove this workstream done**:
  - [ ] `tests/router.test.ts` — known alias resolves; unknown alias returns null; missing backend returns null; alias case behavior.
  - [ ] `tests/proxy.test.ts` (extended) — malformed-then-good → 200; triple malformed → 500 OpenAI-format; correction note structure.

- **Quality gates**:
  - [ ] `npm test` green; no test-count regression from WS_07 baseline; all prior integration tests (WS_06, WS_07) still pass
  - [ ] `npm run typecheck` clean
  - [ ] `npm run lint` clean; `npm run format` produces no diff
  - [ ] Coverage: `router.ts` at 100% branch coverage (pure function, no I/O — no excuse for gaps)

---

## Known Pitfalls & Implementation Notes

**`vi.fn()` double at the adapter boundary, not the validator boundary**: The retry test in T3 must wire the double as the adapter's `complete()` method, not by passing a double directly to `validate()`. The proxy calls `adapter.complete()`, and the result of that call is passed to `validate()` as the `AdapterResponse.raw` string. If the double were wired at the `validate()` level, it would skip the `proxy.ts` → `adapter.complete()` wiring and not test the HTTP error mapping (`ValidationError` → HTTP 500).

**`router.ts` case sensitivity**: Model aliases in `config.yaml` are lowercase (`claude-sonnet-4-6`). If the developer sends `"Claude-Sonnet-4-6"` (wrong case), `resolve()` will return `null` and the proxy returns HTTP 400. This is correct behavior — model names are case-sensitive in the OpenAI API. Document this in the unit test with a comment so future maintainers understand the decision.

**`proxy.ts` signature migration — test update blast radius**: The `createServer` signature change from `(config, adapter)` to `(config, adapters)` touches every test file that creates a server. Be systematic: find all callers with `grep -r "createServer"` before starting T2. Missing an update produces a TypeScript error on `typecheck`, which is the correct detection mechanism — but it is faster to update them all upfront.

**`resolve()` return type `null` vs HTTP 400**: `proxy.ts` must check `if (adapter === null)` after calling `resolve()` and return HTTP 400 immediately. The `null` return from `resolve()` does not automatically produce an HTTP response — the proxy must handle it explicitly. This check was already present in the WS_05 inline lookup (the `"model not supported"` 400 path); T2 migrates it to use the `null` sentinel from `router.ts`.

**Phase 2 `resolve` async extension — note for the implementer**: When Phase 2 adds health checks to `router.ts`, the function signature becomes `async resolve(...)`. The `proxy.ts` call site changes from `const adapter = resolve(...)` to `const adapter = await resolve(...)`. This is a one-line change in `proxy.ts` and a signature change in `router.ts`. It is NOT a redesign of the routing logic. Document this in `router.ts` with a comment: `// Phase 2: extend to Promise<CLIAdapter | null> to support async health checks.`
