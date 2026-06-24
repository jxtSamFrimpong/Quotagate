# TASK_WS08_T2: Migrate `proxy.ts` to `router.ts`; Update All Callers

## Overview

- **Workstream**: WS_08 — Validator Retry Loop & Single-Backend Router
- **Task ID**: T2
- **Estimated Duration**: ~1.5 hours
- **Status**: ✅ Complete
- **Dependencies**: T1 complete and green gate passing

---

## Goal

Replace the inline model-alias lookup in `proxy.ts` with a call to `router.ts`'s `resolve()`, and
change the `createServer` factory signature from `(config, adapter: CLIAdapter)` to
`(config, adapters: Record<string, CLIAdapter>)`. Wire `config.retry.max_attempts` into the
`validateWithRetry` call (completing WS_08-D4). Update every caller of `createServer` — seven files
in total — so the green gate holds. No HTTP behavior changes: the 400/500 paths are identical; only
the routing mechanism moves from inline to `router.ts`.

---

## Success Criteria

### proxy.ts migration
- [ ] SC-P1: `createServer` signature is `(config: QuotagateConfig, adapters: Record<string, CLIAdapter>): FastifyInstance`.
- [ ] SC-P2: The inline alias lookup block (`const entry = config.models[model]; if (entry === undefined || entry.backend !== 'claude') { ... }`) is **removed** and replaced by:
  ```
  const adapter = resolve(parsed.data.model, config, adapters);
  if (adapter === null) { /* HTTP 400 model_not_supported */ }
  ```
- [ ] SC-P3: The HTTP 400 `model_not_supported` path is preserved — same status code, same `code`
  field, same message shape.
- [ ] SC-P4: `validateWithRetry` call is updated to pass `config.retry.max_attempts` as the fourth
  argument: `validateWithRetry(response.raw, parsed.data.messages, invoker, config.retry.max_attempts)`.
- [ ] SC-P5: `proxy.ts` imports `resolve` from `./router.js` and removes the direct `config.models`
  lookup.

### index.ts update
- [ ] SC-I1: `main()` constructs an adapters map before calling `createServer`:
  ```
  const adapters = { claude: adapter };
  const server = createServer(config, adapters);
  ```
- [ ] SC-I2: No other behavior in `main()` changes.

### Test file updates (blast radius — all 7 files)
- [ ] SC-T1: `tests/proxy.test.ts` (describe block 1 — factory tests):
  - All `createServer(minimalConfig, stubAdapter)` calls updated to `createServer(minimalConfig, { claude: stubAdapter })`.
  - T-3c semantic fix: uses `createServer(geminiConfig, { claude: stubAdapter })` — gemini backend has no `'gemini'` key in the map → `resolve()` returns `null` → HTTP 400. The test assertion is unchanged (400 `model_not_supported`) but the mechanism now goes through `router.ts`.
- [ ] SC-T2: `tests/proxy.test.ts` (describe block 2 — pipeline wiring tests):
  - All `createServer(minimalConfig, stubAdapter)` calls updated to `createServer(minimalConfig, { claude: stubAdapter })`.
- [ ] SC-T3: `tests/index.test.ts`:
  - The `vi.mock` of `../src/proxy.js` already mocks `createServer` as a `vi.fn()` — the mock arity does not matter at runtime. Verify no explicit arity assertion exists that would break; update the mock shape if needed.
- [ ] SC-T4: `tests/integration/e2e.noTools.test.ts`:
  - `createServer(config, adapter)` → `createServer(config, { claude: adapter })`.
- [ ] SC-T5: `tests/integration/e2e.toolCall.test.ts`:
  - `createServer(config, adapter)` → `createServer(config, { claude: adapter })`.
- [ ] SC-T6: `tests/integration/e2e.errorPaths.test.ts`:
  - `createServer(config, adapter)` → `createServer(config, { claude: adapter })`.
- [ ] SC-T7: Any other file discovered via `grep -r "createServer"` is also updated.

### Key convention correctness
- [ ] SC-K1: The literal key `'claude'` used in all test and production adapters maps matches the
  `backend: claude` value in `config.minimal.yaml`. The adapters map key **must** equal the config
  `backend` string exactly — this invariant is the routing contract.

---

## Assumptions to Test

- [ ] A1: `tests/index.test.ts` mocks `createServer` via `vi.mock` at the module level — confirm it
  does not break when the real signature changes (mock intercepts the call, doesn't validate arity).
- [ ] A2: No file outside `src/` and `tests/` calls `createServer` (smoke: `grep -r "createServer" .`).
- [ ] A3: `tests/integration/e2e.errorPaths.test.ts` uses the same `beforeAll` server-fixture
  pattern as `e2e.noTools.test.ts` — confirm the key `'claude'` update is sufficient (no hardcoded
  backend name elsewhere in that file).
- [ ] A4: The `gemini` adapter key is absent from the map in the T-3c test — this is what makes
  `resolve()` return `null` for `gemini-pro`. Verify `resolve()` handles this correctly (SC-R3 in T1
  covers this case, but confirm the proxy-level 400 path fires correctly end-to-end).

---

## Decisions

**WS_08-D3 (LOCKED — from workstream plan)**: `createServer` changes from `(config, adapter)` to
`(config, adapters: Record<string, CLIAdapter>)`. The adapters map is keyed by backend name
(`'claude'`, `'gemini'`, etc.) matching config `backend` values.

**WS_08-D4 completion (T2 half)**: T1 changed the `validateWithRetry` signature to accept
`maxAttempts`. T2 wires `config.retry.max_attempts` at the call site in `proxy.ts`. Together,
these two tasks complete the end-to-end B-1 fix.

**T-3c semantic clarification (LOCKED)**: After migration, T-3c proves that a model whose backend
has no registered adapter in the map → HTTP 400 `model_not_supported`. The mechanism changes
(inline check → router null → 400) but the HTTP contract is identical.

---

## Subtask Progress Table

| # | Subtask | Status | Notes |
|---|---------|--------|-------|
| 1 | `grep -r "createServer" .` — list all callers before touching anything | ⬚ Not Started | Verify the 7-file blast radius |
| 2 | Update `proxy.ts` signature + replace inline lookup with `resolve()` | ⬚ Not Started | Also thread `config.retry.max_attempts` |
| 3 | Update `src/index.ts` — construct `{ claude: adapter }` map | ⬚ Not Started | |
| 4 | Update `tests/proxy.test.ts` (both describe blocks + T-3c) | ⬚ Not Started | T-3c gets semantic comment |
| 5 | Update `tests/index.test.ts` — verify/update mock shape | ⬚ Not Started | Likely no change needed |
| 6 | Update `tests/integration/e2e.noTools.test.ts` | ⬚ Not Started | |
| 7 | Update `tests/integration/e2e.toolCall.test.ts` | ⬚ Not Started | |
| 8 | Update `tests/integration/e2e.errorPaths.test.ts` | ⬚ Not Started | |
| 9 | Run `npm run typecheck` — catch any missed callers via TS errors | ⬚ Not Started | Missed updates produce TS errors |
| 10 | Run full green gate (`npm test`, `typecheck`, `lint`, `format`) | ⬚ Not Started | Must pass before T3 |

---

## Test Strategy

**No new test files.** All work is updates to existing callers.

**Detection mechanism for missed callers**: `npm run typecheck` will emit a type error at every
call site that still passes a single `CLIAdapter` — TypeScript is the blast-radius detector. Run
it after step 2 (the signature change) to get a complete list of broken callers before fixing them.

**Key regression guard**: After T2, `proxy.test.ts` T-3c must still produce HTTP 400
`model_not_supported`. If it produces anything else, the router null-return path is broken.

**WS_06 regression guard**: `e2e.noTools.test.ts` T-1 and T-2 must still pass end-to-end against
a live Claude subscription (skipped if `healthCheck()` returns false). The router migration must
not change any behavior observable at the HTTP level.

---

## Review Notes

**PA Full Pass Review (2026-06-24):**

✅ **All SC verified:**
- Router contract enforcement: `resolve()` returns adapter iff `adapters[config.models[alias].backend]` is defined; KEY CONVENTION INVARIANT documented in JSDoc.
- Proxy abstraction: Zero subprocess leakage; `CLIAdapter` interface contract honored; will survive Phase 2 MCP upgrade.
- T-3c routing test: Explicitly tests backend-absent case (known alias, missing adapter key) → HTTP 400 `model_not_supported`.
- D4 end-to-end: `config.retry.max_attempts` wired through to `validateWithRetry()` fourth argument; `MAX_ATTEMPTS` constant removed.
- D-SEQ-01 abstraction boundary: Clean. Phase 2 transport change only touches `adapters/claude.ts`; proxy/router/index unaffected.
- Integration tests: All 3 e2e files exercise production paths; router contract live-tested.

**O-1 (cosmetic, addressed):** T-3c updated to use an isolated adapter stub for test clarity (makes intent self-documenting: this adapter should never be called). Commit: `0c59221 fix(O-1): isolate adapter stub in proxy.test.ts T-3c for clarity`. Unit tests pass (93 passed, no regression).

**Verdict:** FULL PASS — T3 may proceed.

---

## Sign-off

- [x] PA review pending (BSE implementation complete)
- [x] Green gate passing (89 tests, no regression from T1 baseline)
