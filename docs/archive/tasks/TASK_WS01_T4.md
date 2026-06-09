# TASK_WS01_T4: Author `src/errors.ts` (Error Hierarchy) and `src/index.ts` (No-op Entry Stub)

## Context

- **Workstream**: WS_01 (Node/TS Project Bootstrap)
- **Plan reference**: `docs/plan/workstreams/ws01_project_bootstrap.md`
- **Phase plan**: `docs/plan/phases/01a_transport_and_constraint.md`
- **Depends on**: TASK_WS01_T2 (green gate must pass; typecheck must be running cleanly). T4 is independent of T3 — both can proceed in parallel once T2 is signed off.
- **Blocks**: WS_02 (the subprocess adapter's `_complete_via_subprocess` throws `TransportError`; the adapter imports from `src/errors.ts` from day one); WS_05 (the proxy's `proxy.ts` catches `QuotagateError` and maps it to HTTP error responses); no workstream may re-declare these classes outside `src/errors.ts`.

---

## Goal & Why

- **Goal**: Author `src/errors.ts` containing the three-class error hierarchy — `QuotagateError` (base, extends `Error`), `TransportError extends QuotagateError`, `ValidationError extends QuotagateError` — with no logic beyond the class definitions and a `name` property on each. Author `src/index.ts` as a no-op stub that imports `QuotagateError` from `src/errors.ts` (exercising the import chain) and contains a single comment (`// Phase 1B fleshes this out`). Verify the full typechain compiles clean: `npm run typecheck` and `npm run build` both exit 0.
- **Why**: CLAUDE.md mandates that all custom errors subclass a single `QuotagateError` base defined in `src/errors.ts` only — never scattered into subsystem files. This prevents import cycles and mirrors the single-point-of-truth discipline applied to `src/types.ts`. WS_02's `complete()` method throws `TransportError` in Phase 1A; without this file, typecheck fails from the moment WS_02 is authored. `src/index.ts` is equally necessary: `tsup` requires a valid entry point to type-check and build the project. An absent or empty entry file causes `tsup` to warn about an empty bundle and prevents verifying the full import chain (D-1A-04, D-1A-06).

---

## Assumptions to Test

| #   | Assumption                                                                                                                                                           | Why we believe it                                                                    | How this task tests it                                                                                                            | If false →                                                                                                                                                                                             |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A1  | `tsup` accepts a non-empty-but-trivial `src/index.ts` (one import, one comment) without warnings about an empty bundle                                               | WS_01 pitfall note: the stub must be a valid TS file with at least one import        | `npm run build` exits 0 with no "empty bundle" warning                                                                            | If warning persists: add a trivial re-export (`export { QuotagateError }`) to the stub; record the decision                                                                                            |
| A2  | `class QuotagateError extends Error` works correctly in strict ESM (Node 20, `"target":"ES2022"`) — specifically that `instanceof` checks on subclasses are reliable | Standard TypeScript class extension; ES2022 target preserves native class semantics  | A `// @ts-expect-error` style comment is not needed; `npm run typecheck` confirms subclass assignments are accepted by TypeScript | If `instanceof` is broken (ES5 target artifact): check `tsconfig.json` `target` — must be `"ES2022"` or higher, not `"ES5"` which breaks `instanceof` on custom Error subclasses                       |
| A3  | `src/index.ts` importing from `./errors.ts` exercises the full typechain and will surface any path resolution or module-mode issue                                   | This is the only cross-file import in WS_01 T4; it is the minimal valid import chain | `npx tsc --noEmit` exits 0; `npm run build` produces `dist/index.js`                                                              | If resolution fails: check for missing `.js` extension in the import specifier (required under `"moduleResolution":"NodeNext"`); or switch to `"bundler"` resolution which does not require extensions |

---

## Expected Failures

- **EF1** `instanceof` checks on custom `Error` subclasses are unreliable when `tsconfig.json` targets `ES5` — TypeScript's ES5 class emit breaks the prototype chain. This is a classic trap. Mitigation: `tsconfig.json` must use `"target":"ES2022"` or higher (set in T1). Confirm in T4 by checking that `new TransportError("x") instanceof QuotagateError` is `true` at the TypeScript type level (a compile-time type-narrowing test is sufficient; a runtime test is not required in WS_01 since there is no logic yet).
- **EF2** `tsup` may emit a warning if `src/index.ts` has only a comment and no import. The stub must contain at least one import statement (`import { QuotagateError } from "./errors.js"` or equivalent) so tsup has a non-empty module graph. If the import produces a "module not found" error, the path extension handling is wrong — see A3.
- **EF3** If `src/errors.ts` does not set `this.name` on each subclass, `error.name` will read `"Error"` rather than `"TransportError"` or `"ValidationError"` at runtime. This is not a typecheck issue — it is a runtime semantic gap. It becomes a real problem in WS_05 when the proxy logs error names to map to HTTP status codes. Set `this.name = "TransportError"` in each subclass constructor now so WS_05 inherits correct semantics without a change.

---

## Test Strategy

- **Unit**: No behavioral logic exists in `src/errors.ts` (class hierarchy only). The primary verification is structural: TypeScript accepts `new TransportError("msg") as QuotagateError` and `new ValidationError("msg") as QuotagateError` — confirmed by `npm run typecheck`. No Vitest test file is required for WS_01 T4's error classes themselves. If the BSE wants a simple smoke test for the hierarchy (assigning subclass instances to the base type), one may be added but it is not required for sign-off.
- **Integration**: The import chain test is the integration signal: `src/index.ts` → `src/errors.ts`. `npm run build` and `npm run typecheck` both passing proves the chain compiles and bundles correctly.
- **Contract**: The error class names and hierarchy are the contract: `QuotagateError` (base), `TransportError` and `ValidationError` (subclasses). No consumer may re-declare these. `src/errors.ts` is the only definition file. This is verified by inspection at review time.
- **Manual/spike**: Run in order:
  1. `npx tsc --noEmit` — zero errors.
  2. `npm run build` — `tsup` produces `dist/index.js` without warnings.
  3. `npm test` — no regressions (smoke test from T2 still passes).
  4. `npm run lint` and `npm run format` — zero violations, no diff.

---

## Contract: What This Task Inherits

| Symbol / Artifact                             | Source       | Role in This Task                                                   |
| --------------------------------------------- | ------------ | ------------------------------------------------------------------- |
| `tsconfig.json` `"target":"ES2022"` or higher | TASK_WS01_T1 | Required for reliable `instanceof` on custom Error subclasses (EF1) |
| `tsup.config.ts` entry `src/index.ts`         | TASK_WS01_T1 | T4 must produce a non-trivial `src/index.ts` that tsup can bundle   |
| Green gate (typecheck + lint + format + test) | TASK_WS01_T2 | All four gates must still pass after T4's files are added           |

---

## Subtask Progress Table

| #   | Subtask                                                                                                                                                                                                                                                                              | Status      | Iteration | Notes                                                                                                                                                                                                                    |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Author `src/errors.ts`: `QuotagateError extends Error` (base, `this.name = "QuotagateError"`); `TransportError extends QuotagateError` (`this.name = "TransportError"`); `ValidationError extends QuotagateError` (`this.name = "ValidationError"`) — class hierarchy only, no logic | ✅ Done     | 1         | Three classes, three `this.name` assignments. Prettier normalised quotes to single. SC-7 grep returns only `src/errors.ts`.                                                                                              |
| 2   | Author `src/index.ts`: single comment `// Phase 1B fleshes this out`; one import `import { QuotagateError } from "./errors.js"` (or without extension if `moduleResolution:"bundler"`)                                                                                               | ✅ Done     | 1         | `moduleResolution:"bundler"` confirmed — extension optional but kept. Import aliased `_QuotagateError` to satisfy `no-unused-vars` ESLint rule (unused binding; A3 import-chain purpose is satisfied by the resolution). |
| 3   | Run `npm run typecheck` and `npm run build`; confirm both exit 0 and no warnings                                                                                                                                                                                                     | ✅ Done     | 1         | `typecheck` exits 0. `tsup` exits 0, produces `dist/index.js` and `dist/index.d.ts`. No empty-bundle warning.                                                                                                           |
| 4   | Run `npm test`, `npm run lint`, `npm run format`; confirm no regressions from T2's green gate                                                                                                                                                                                        | ✅ Done     | 1         | 2 test files / 7 tests all pass. `lint` clean. `format` reports all files unchanged on second run.                                                                                                                      |

_Status icons: `✅ Done` | `🔄 In progress` | `⬚ Not started` | `❌ Blocked`_

---

## Current Subtask Detail

### Subtask 1: Author `src/errors.ts`

**Approach iteration plan** (simplest → target):

1. Define `QuotagateError extends Error` with a constructor that sets `this.name` and calls `super(message)`.
2. Define `TransportError extends QuotagateError` and `ValidationError extends QuotagateError` — same pattern; no additional fields or logic in Phase 1.
3. Export all three classes. Confirm TypeScript accepts `new TransportError("msg") as QuotagateError` without a cast.

- **Current iteration**: 1 of 3
- **Verifiability / Success Criteria**: `npm run typecheck` exits 0; TypeScript accepts the subclass assignment without a cast; `npm run lint` reports no violations on the file.
- **Challenges**: EF1 (ES target must be ES2022+); EF3 (`this.name` must be set explicitly on each subclass).

---

## Decisions Made

### D-1A-04 — `src/errors.ts` Created in Phase 1A as a Zero-Logic Stub ✅ LOCKED (Architect, 2026-06-08)

Inherits **D-1A-04** from `docs/plan/phases/01a_transport_and_constraint.md`.

**Decision**: Create `src/errors.ts` in WS_01 (T4) with `QuotagateError`, `TransportError`, `ValidationError`. Class hierarchy only. Later phases extend it without restructuring.

**Rationale**: The adapter's `complete()` method (WS_02) throws `TransportError`; without `src/errors.ts`, `npx tsc --noEmit` fails the moment WS_02 is authored. The error hierarchy is the shared contract — defining it once, here, prevents the scattered re-declaration that CLAUDE.md explicitly prohibits.

**Rejected alternative — defer `src/errors.ts` to Phase 1B**: The adapter's `complete()` method throws `TransportError` in Phase 1A. Without the file, WS_02 has no base to extend; typecheck fails in WS_02 instead of being caught here in WS_01 where it is cheap.

### D-1A-06 — `src/index.ts` Entry-Point Stub Created in WS_01 T4 ✅ LOCKED (Architect, 2026-06-08)

Inherits **D-1A-06** from `docs/plan/phases/01a_transport_and_constraint.md`.

**Decision**: Create `src/index.ts` as a minimal no-op stub in WS_01. Phase 1B (WS_05) replaces it with the real `quotagate start` implementation.

**Rationale**: `tsup`/`tsc` require a valid entry point to type-check and build the project from day one. The stub imports `QuotagateError` from `src/errors.ts` so the import chain is exercised and any path resolution issue surfaces immediately, not in WS_02.

**Rejected alternative — leave `src/index.ts` to Phase 1B**: A build with no entry point cannot verify the full typechain. Import errors would surface as a surprise mid-phase in WS_05 instead of being confirmed clean in WS_01.

### Anti-overengineering scope fence ✅ LOCKED

**This task explicitly does NOT include**:

- Any logic in `src/errors.ts` — no `toJSON()`, no `httpStatusCode`, no `isRetryable` property, no structured error codes. These are WS_05 concerns when the proxy needs to map errors to HTTP responses.
- Additional error subclasses beyond `TransportError` and `ValidationError` — WS_02 and WS_05 will add them as needed, extending the hierarchy in `src/errors.ts` only.
- `src/index.ts` CLI argument parsing, Fastify wiring, or any product logic — Phase 1B. The stub contains only a comment and one import.
- Any re-export of types from `src/types.ts` through `src/index.ts` — the barrel export pattern is premature; consumers import directly from the source module.
- `src/config.ts` or `src/router.ts` stubs — WS_05 and Phase 1B.
- Test file for `src/errors.ts` — the hierarchy has no logic to test; structural correctness is proven by `npm run typecheck`. A test file is optional and not required for sign-off.

---

## Cross-Task Contracts (Downstream Dependencies on This Task)

### WS_02 will depend on:

- `TransportError` class exported from `src/errors.ts` — WS_02's `_complete_via_subprocess()` throws `new TransportError("...")` on subprocess failures.
- `ValidationError` class exported from `src/errors.ts` — WS_02's validator (or WS_03's integration test) may throw `ValidationError` on Zod parse failures.
- `QuotagateError` class exported from `src/errors.ts` — WS_02 may catch `QuotagateError` broadly for adapter-level error handling.
- These classes must NOT be re-declared in `src/adapters/claude.ts` or any other file — `src/errors.ts` is the single definition.

### WS_05 will depend on:

- `QuotagateError` as the base class that `proxy.ts` catches to map to HTTP error responses. The `this.name` property (set in subtask 1) is what the proxy uses to distinguish `TransportError` vs `ValidationError` when constructing HTTP 500 vs HTTP 400 responses.

---

## Files Modified / Created

- `src/errors.ts` — **create new** (`QuotagateError` base; `TransportError` subclass; `ValidationError` subclass; `this.name` set on each; no logic)
- `src/index.ts` — **create new** (no-op stub: one comment `// Phase 1B fleshes this out`; one import `import { QuotagateError } from "./errors.js"`)

---

## Success Criteria / Verifiability

| #    | Criterion                                                                                                 | How to verify                                                                            |
| ---- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| SC-1 | `npx tsc --noEmit` exits 0 across `src/errors.ts` and `src/index.ts`                                      | Zero TypeScript errors in output                                                         |
| SC-2 | `npm run build` (tsup) produces `dist/index.js` without warnings                                          | Exit code 0; no "empty bundle" warning; `dist/index.js` exists                           |
| SC-3 | TypeScript accepts `new TransportError("x") as QuotagateError` without a cast                             | Compile-time: `npx tsc --noEmit` on a file containing this assignment exits 0            |
| SC-4 | TypeScript accepts `new ValidationError("x") as QuotagateError` without a cast                            | Same as SC-3                                                                             |
| SC-5 | `npm test` green — T2's smoke test still passes; no regression                                            | `npm test`; Vitest reports 1 passed (+ any T3 tests if T3 is already done)               |
| SC-6 | `npm run lint` clean; `npm run format` no diff                                                            | Zero ESLint violations; Prettier reports no files changed                                |
| SC-7 | `src/errors.ts` is the ONLY definition of the three error classes — no other file in `src/` declares them | Code review / grep: `grep -r "extends QuotagateError" src/` returns only `src/errors.ts` |

---

## Required Test Cases

`src/errors.ts` contains class hierarchy only — no behavioral logic. There are no Vitest test cases required for WS_01 T4. Structural correctness is proven by `npm run typecheck` (SC-1, SC-3, SC-4).

If the BSE elects to add an optional structural test file (`tests/errors/hierarchy.test.ts`), it may assert:

- `new TransportError("msg") instanceof QuotagateError` is `true`.
- `new ValidationError("msg") instanceof QuotagateError` is `true`.
- `new TransportError("msg").name === "TransportError"` is `true`.
- `new ValidationError("msg").name === "ValidationError"` is `true`.

This is a "nice to have" for later workstreams that depend on `instanceof` and `.name` semantics. It is not required for T4 sign-off.

---

## Review Notes

**Verdict: APPROVE** (Principal Architect, 2026-06-09; required change applied by reviewer, gate re-verified)

---

**Finding 1 — required-change** (SC-2, A1, EF2): `dist/index.js` is 0 bytes and `dist/index.d.ts` exports nothing (`export {  }`). EF2 has materialised.

The BSE aliased the import to `_QuotagateError` to silence the ESLint `no-unused-vars` error, which is a legitimate concern, but the fix was applied at the wrong layer. The `_` prefix satisfies the linter; it does not satisfy the bundler. tsup performs tree-shaking over the module graph. A side-effect-only import with no re-export and no runtime reference is eliminated entirely — which is exactly what happened here. The bundle is empty.

The task spec's own A1 "If false" path prescribes the correct resolution: add `export { QuotagateError }` to `src/index.ts`. A re-export is both a valid import (satisfies `no-unused-vars` without any alias) and a real module graph edge that tsup cannot tree-shake away. The scope fence (§ "Anti-overengineering scope fence") does not prohibit this — it prohibits re-exporting `src/types.ts` through `src/index.ts` as a barrel export; re-exporting the entry module's own anchor class is a different thing.

The fix is one line in `src/index.ts`:

```typescript
// Phase 1B fleshes this out
export { QuotagateError } from './errors.js';
```

This satisfies `no-unused-vars` (the symbol is exported, not unused), produces a non-zero `dist/index.js`, and honours A1's fallback path. Remove the `import { QuotagateError as _QuotagateError }` line entirely; the re-export form is cleaner and accomplishes both goals at once. After the fix: re-run `npm run build` and confirm `dist/index.js` is non-zero, then re-run the full gate.

**Finding 2 — informational** (SC-3, SC-4, A2, EF1): All other criteria are clean. `tsconfig.json` confirms `"target":"ES2022"` — EF1 is conclusively avoided. `typecheck` exits 0, which confirms TypeScript accepts both `new TransportError("x") as QuotagateError` and `new ValidationError("x") as QuotagateError` without casts (SC-3, SC-4 implicitly verified by the class hierarchy being accepted at all). A2 is resolved in the positive.

**Finding 3 — informational** (EF3, WS_05 contract): `this.name` is correctly set on all three constructors — `"QuotagateError"`, `"TransportError"`, `"ValidationError"`. EF3 is conclusively avoided. The WS_05 `.name`-based HTTP-status-code mapping contract is fully honoured.

**Finding 4 — informational** (SC-7): The SC-7 grep returns only `src/errors.ts`. The hierarchy is not scattered. Cross-task contracts (WS_02, WS_05 imports) are satisfied at the structural level.

**Finding 5 — informational** (scope fence): The scope fence is clean. No logic, no extra subclasses, no additional config file changes, no test file added. The BSE stayed precisely within bounds on every dimension except the EF2 issue.

**Resolution of Finding 1**: `src/index.ts` updated to `export { QuotagateError } from './errors.js'`. `dist/index.js` is now 175 bytes (non-zero). Full gate re-verified clean: 7/7 tests pass, typecheck 0 errors, lint 0 violations, format no diff.

---

## Architect Sign-off

- [x] Implementation reviewed
- [x] All success criteria verified
- [x] All assumptions resolved (proven, or fallback taken & documented)
- [x] No regressions in full test suite
- [x] `npm test` / `typecheck` / `lint` / `format` all clean
