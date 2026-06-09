# TASK_WS01_T2: Toolchain — Vitest, ESLint Flat Config, Prettier; Green Gate Against Smoke Test

## Context

- **Workstream**: WS_01 (Node/TS Project Bootstrap)
- **Plan reference**: `docs/plan/workstreams/ws01_project_bootstrap.md`
- **Phase plan**: `docs/plan/phases/01a_transport_and_constraint.md`
- **Depends on**: TASK_WS01_T1 (requires `package.json` with `"type":"module"` and `tsconfig.json` with `strict:true` before toolchain packages can be installed and configured correctly).
- **Blocks**: TASK_WS01_T3 and TASK_WS01_T4 (both require a passing green gate before their unit tests can run); all WS_02+ workstreams (the green gate is the quality ratchet — once set, it must never regress).

---

## Goal & Why

- **Goal**: Install and configure the three toolchain components — Vitest (`vitest.config.ts`, `pool:"forks"`, `environment:"node"`), ESLint flat config (`eslint.config.js`, `@typescript-eslint/eslint-plugin`, `@typescript-eslint/parser`, `parserOptions.project` pointing at `tsconfig.json`), and Prettier (`.prettierrc`) — and prove the full green gate passes against a trivial `tests/smoke.test.ts` (`expect(1+1).toBe(2)`).
- **Why**: The green gate is the quality ratchet established in WS_01: once it is green it stays green. Every later workstream in Phase 1A, 1B, and 1C runs `npm test`, `npm run typecheck`, `npm run lint`, and `npm run format` as the final proof their task is done. If Vitest, ESLint, and Prettier are misconfigured now — particularly the ESM/CJS module-mode conflict and the `parserOptions.project` gap — the failures surface as cryptic, hard-to-diagnose errors in WS_02 and WS_03 instead of here where they are cheap to fix. T2 exists to prove the ratchet works before any real source is written.

---

## Assumptions to Test

| #   | Assumption                                                                                                                                                               | Why we believe it                                                                                       | How this task tests it                                                                                                                                                        | If false →                                                                                                                    |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| A1  | ESM + tsup + Vitest agree on module mode: `"type":"module"` in `package.json` + `pool:"forks"` or `environment:"node"` in `vitest.config.ts` avoids CJS loader conflicts | WS_01 known pitfall; Vitest docs confirm `pool:"forks"` as the ESM-safe pool                            | `npm test` runs the smoke test; no `require is not defined` or `ERR_REQUIRE_ESM` errors                                                                                       | If CJS/ESM conflict surfaces: switch to `pool:"vmForks"` or add `transformMode:"ssr"` to vitest config; record finding in EF1 |
| A2  | `@typescript-eslint` type-aware rules require `parserOptions.project` to point at `tsconfig.json`; without it they silently fall back to non-type-aware mode             | WS_01 known pitfall; `@typescript-eslint` docs confirm this                                             | Deliberately trigger a type-aware rule (e.g. `@typescript-eslint/no-floating-promises` on a bare `Promise.resolve()` call in the smoke fixture) and confirm ESLint catches it | If the rule does not fire: `parserOptions.project` is missing or wrong; fix before proceeding to T3/T4                        |
| A3  | `eslint.config.js` (flat config, ESLint v9) is compatible with `"type":"module"`                                                                                         | ESLint v9 flat config is ESM-first; WS_01-D2 mandates flat config                                       | `npm run lint` exits 0 on the smoke file with no loader errors                                                                                                                | If flat config fails to load: check Node version and ESLint v9 peer dependency; do NOT fall back to `.eslintrc`               |
| A4  | Prettier can be wired as an ESM config (`.prettierrc` JSON or `prettier.config.js`) without conflict with ESLint                                                         | Standard setup — Prettier and ESLint are run independently; no `eslint-plugin-prettier` in this project | `npm run format` produces no diff after running once; `npm run lint` does not complain about formatting                                                                       | If conflicts appear: confirm `eslint-plugin-prettier` is NOT installed (it is out of scope for this project)                  |

---

## Expected Failures

- **EF1** `ERR_REQUIRE_ESM` or `SyntaxError: Cannot use import statement` during `npm test` — the most common ESM/CJS toolchain split. Caused by Vitest loading test files through a CommonJS transform path. Fix: set `pool: "forks"` in `vitest.config.ts`; if still failing, add `{ test: { environment: "node", globals: true } }`. This must be resolved in T2 before T3/T4 authors any test.
- **EF2** ESLint silently passing a type-aware rule violation — caused by `parserOptions.project` being absent or pointing to the wrong path. This is a silent failure (no crash, no error) that removes all type-aware lint coverage. Mandatory check: deliberately write a type-aware violation in the smoke fixture and confirm ESLint catches it. If it does not, `parserOptions.project` must be fixed before sign-off.
- **EF3** `vitest.config.ts` itself fails to type-check if `vite` / `vitest` packages are missing type definitions — install `@vitest/coverage-v8` (for `npm run test:cov`) and ensure `vitest` dev dependency is present.
- **EF4** Prettier formatting the `vitest.config.ts` or `eslint.config.js` in a way that ESLint then flags as a style violation — only occurs if `eslint-plugin-prettier` is accidentally installed. Confirm it is not present in `devDependencies`.

---

## Test Strategy

- **Unit**: `tests/smoke.test.ts` — a trivially-true assertion (`expect(1+1).toBe(2)`) that proves the Vitest harness loads, finds test files, and reports a pass. This is not testing product logic; it is testing the test runner itself.
- **Integration**: N/A — no cross-component wiring in this task.
- **Contract**: Verify the type-aware ESLint rule fires on a deliberately-bad fixture. Concretely: add a bare `Promise.resolve();` (no `await`, no `.catch()`) to the smoke file, run `npm run lint`, confirm `@typescript-eslint/no-floating-promises` reports an error. Remove the bad line after confirming. This proves `parserOptions.project` is wired correctly — it is the most critical toolchain contract in T2.
- **Manual/spike**: Run the full green gate in order:
  1. `npm test` — smoke test passes; Vitest reports 1 test, 1 passed.
  2. `npm run typecheck` — zero TypeScript errors.
  3. `npm run lint` — zero ESLint violations.
  4. `npm run format` — prettier reports no files changed (run `npm run format` once first to apply, then run again to confirm no diff).
  5. `npm run test:cov` — coverage report generates without error (0% on trivial smoke file is acceptable).

---

## Contract: What This Task Inherits

| Symbol / Artifact                                       | Source       | Role in This Task                                                                                                           |
| ------------------------------------------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------- |
| `package.json` with all 8 `npm run` scripts             | TASK_WS01_T1 | T2 fills in the command bodies for `test`, `test:watch`, `test:cov`, `lint`, `format` — the script keys already exist       |
| `tsconfig.json` with `strict:true`, `"module":"ESNext"` | TASK_WS01_T1 | `eslint.config.js` `parserOptions.project` must point here; `vitest.config.ts` must be consistent with the same module mode |

---

## Subtask Progress Table

| #   | Subtask                                                                                                                                                                                                                                                           | Status        | Iteration | Notes                                                                                                                                                                                                                                                                                                    |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Install Vitest devDependencies: `vitest`, `@vitest/coverage-v8`; author `vitest.config.ts` with `pool:"forks"`, `environment:"node"`, `include:["tests/**/*.test.ts"]`                                                                                            | ✅ Done        | 1         | `pool:"forks"` resolved ESM conflict on first attempt; no CJS errors. Vitest 4.1.8 installed.                                                                                                                                                                                                            |
| 2   | Install ESLint devDependencies: `eslint@^9`, `@typescript-eslint/eslint-plugin`, `@typescript-eslint/parser`; author `eslint.config.js` (flat config) with `parserOptions.project:"tsconfig.json"` and at least `@typescript-eslint/no-floating-promises` enabled | ✅ Done        | 2         | Deviation: `parserOptions.project` points at `tsconfig.eslint.json` (not `tsconfig.json`) — a new file that extends base and adds `"include": ["src","tests","*.ts","*.js"]`. Required because the main `tsconfig.json` only includes `src/`; ESLint's project-parser rejected `tests/smoke.test.ts` otherwise. Added `ignores: ['dist/**','coverage/**','node_modules/**']` to prevent linting generated files. |
| 3   | Install Prettier devDependency: `prettier`; author `.prettierrc` (semi, singleQuote, trailingComma: "all", printWidth: 100)                                                                                                                                       | ✅ Done        | 1         | `prettier@^3` was already installed by T1; only `.prettierrc` needed to be created. Format script updated from `prettier --write .` to the explicit glob form per task spec. No `eslint-plugin-prettier` installed.                                                                                       |
| 4   | Author `tests/smoke.test.ts`: `import { expect, it } from "vitest"; it("smoke", () => { expect(1+1).toBe(2); });`                                                                                                                                                 | ✅ Done        | 1         | Trivial assertion passes on first run; `tests/` directory created.                                                                                                                                                                                                                                       |
| 5   | Run full green gate; confirm type-aware ESLint rule fires on deliberate violation then remove the bad line                                                                                                                                                        | ✅ Done        | 1         | SC-7 confirmed: bare `Promise.resolve();` in smoke file triggered `@typescript-eslint/no-floating-promises` error. Bad line removed. All 8 SC verified in sequence. Additional deviation from T1: removed unused `import Fastify from "fastify"` stub from `src/index.ts` to satisfy `no-unused-vars`.   |

_Status icons: `✅ Done` | `🔄 In progress` | `⬚ Not started` | `❌ Blocked`_

---

## Current Subtask Detail

### Subtask 1: Install Vitest and Author `vitest.config.ts`

**Approach iteration plan** (simplest → target):

1. Install `vitest` and `@vitest/coverage-v8`; write the minimal config with `pool:"forks"` and `environment:"node"`.
2. Run `npm test` against `tests/smoke.test.ts`; confirm no ESM/CJS errors.
3. Run `npm run test:cov`; confirm coverage report generates.

- **Current iteration**: 1 of 3
- **Verifiability / Success Criteria**: `npm test` exits 0; Vitest reports 1 passed; no loader errors.
- **Challenges**: ESM/CJS split (EF1) — must be resolved here before any other test file is authored.

---

## Decisions Made

### WS_01-D2 — ESLint Flat Config (`eslint.config.js`) Over Legacy `.eslintrc` ✅ LOCKED (Architect, 2026-06-08)

**Decision**: Use ESLint's flat config format (`eslint.config.js`) with `@typescript-eslint/eslint-plugin` and `@typescript-eslint/parser`. No `.eslintrc.json` / `.eslintrc.js`.

**Rationale**: ESLint flat config is the current format as of ESLint v9; the legacy format is soft-deprecated. Starting on flat config avoids a forced migration within the project's own lifetime and is consistent with the project's ESM-first stance.

**Rejected alternative — legacy `.eslintrc.json`**: Introduces a migration burden. The flat config is a one-time cost now, not recurring debt.

### Anti-overengineering scope fence ✅ LOCKED

**This task explicitly does NOT include**:

- `eslint-plugin-prettier` or `eslint-config-prettier` — Prettier and ESLint are run independently in this project. Coupling them adds a fragile interaction with no benefit.
- `husky` / `lint-staged` pre-commit hooks — Phase 2 hardening concern, not bootstrap.
- `@vitest/ui` — the browser-based Vitest UI is a developer convenience, not a project requirement. Add only if the team requests it.
- `jest.config.*` — this project uses Vitest, not Jest. Do not install `jest` or any Jest plugin.
- Code coverage thresholds (`coverageThreshold` in vitest config) — N/A for this workstream; no logic to cover. Thresholds are a Phase 2 hardening concern.
- `babel.config.*` or `@babel/core` — tsup and Vitest use their own TS transform; Babel is not needed.

---

## Cross-Task Contracts (Downstream Dependencies on This Task)

### TASK_WS01_T3 will depend on:

- `npm test` must be green before T3's Zod fixture tests can be run.
- `vitest.config.ts` `include` pattern must cover `tests/types/*.test.ts` — confirm the glob is `tests/**/*.test.ts` or equivalent.

### TASK_WS01_T4 will depend on:

- Same as T3: green gate passes; typecheck is clean.

### WS_02+ will depend on:

- The green gate defined here is the quality ratchet: `npm test` / `typecheck` / `lint` / `format` must never regress. WS_02 inherits this gate unchanged.
- `eslint.config.js` covers the `src/` tree — WS_02's source files are linted by the same config.

---

## Files Modified / Created

- `vitest.config.ts` — **create new** (`pool:"forks"`, `environment:"node"`, include `tests/**/*.test.ts`)
- `eslint.config.js` — **create new** (flat config, `@typescript-eslint`, `parserOptions.project`)
- `.prettierrc` — **create new** (semi, singleQuote, trailingComma: "all", printWidth: 100)
- `tests/smoke.test.ts` — **create new** (trivial `expect(1+1).toBe(2)`)
- `package.json` — **modify** (add `vitest`, `@vitest/coverage-v8`, `eslint@^9`, `@typescript-eslint/eslint-plugin`, `@typescript-eslint/parser`, `prettier` to `devDependencies`; confirm script command bodies for `test`, `test:watch`, `test:cov`, `lint`, `format` are filled)

---

## Success Criteria / Verifiability

| #    | Criterion                                                        | How to verify                                                                                                      |
| ---- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| SC-1 | `npm test` runs `tests/smoke.test.ts` and reports 1 test passed  | `npm test`; Vitest output shows "1 passed"                                                                         |
| SC-2 | No ESM/CJS loader errors during `npm test`                       | Zero `ERR_REQUIRE_ESM` or `SyntaxError: Cannot use import statement` in Vitest output                              |
| SC-3 | `npm run typecheck` clean — zero TS errors                       | `npx tsc --noEmit`; zero output                                                                                    |
| SC-4 | `npm run lint` clean — zero ESLint violations                    | `npm run lint`; exit code 0                                                                                        |
| SC-5 | `npm run format` produces no diff after a prior format pass      | Run `npm run format`; run again; second run reports no files changed                                               |
| SC-6 | `npm run test:cov` generates a coverage report without error     | `npm run test:cov`; exits 0; `coverage/` directory created                                                         |
| SC-7 | Type-aware ESLint rule fires on a deliberate violation           | Temporarily add `Promise.resolve();` to smoke file; `npm run lint` reports `no-floating-promises`; remove the line |
| SC-8 | `eslint.config.js` uses flat config format (no `.eslintrc` file) | Confirm no `.eslintrc.json` / `.eslintrc.js` / `.eslintrc.yml` present in root                                     |

---

## Required Test Cases

File: `tests/smoke.test.ts`

### T-1: smoke — Vitest harness runs (covers SC-1, SC-2)

Import `expect` and `it` from `"vitest"`. Assert `expect(1 + 1).toBe(2)`. Purpose: prove the test runner loads, processes the ESM import, and reports a pass. No product logic; no mocks.

---

## Review Notes

**Reviewer**: Principal Architect — **2026-06-09**
**Verdict**: APPROVE-WITH-NITS

All 8 success criteria pass. The green gate is sound and will hold across WS_02–WS_09 for `src/` code. Two nits and one informational note follow; none block approval.

---

### Finding 1 — `no-explicit-any` as `warn` contradicts the project's "no `any` without a written reason" convention [nit]

**Maps to**: SC-4, CLAUDE.md coding convention ("No `any` without a written reason").

**Observation**: The rule is set to `'warn'` rather than `'error'`. `npm run lint` exits 0 even when `any` is present — warnings do not fail the command. That means the quality ratchet silently passes files that violate the stated convention. In my experience, a convention enforced only by warning is a convention that will be broken in the first week of real implementation (WS_02).

**Prescribed fix**: Change `'@typescript-eslint/no-explicit-any': 'warn'` to `'error'`. When a legitimate `any` boundary is genuinely required (e.g., dynamic `JSON.parse` output before Zod narrows it), the author adds an `// eslint-disable-next-line @typescript-eslint/no-explicit-any -- <reason>` comment. That inline suppression is the "written reason" the convention demands. The ratchet then enforces both the rule and its documentation.

---

### Finding 2 — `src/index.ts` stub comment references task IDs and workstream names [nit]

**Maps to**: CLAUDE.md key coding conventions ("Names should reveal intent").

**Observation**: The current comment is `// Quotagate entry point stub — T4 adds the QuotagateError import chain; WS_05 wires the server.` Task IDs (`T4`) and workstream labels (`WS_05`) are planning-harness artefacts, not code. They will be stale the moment those tasks complete and the comment is not updated — which, in my experience, is always. A reader six months from now sees references to completed tasks and learns nothing about the file's purpose.

**Prescribed fix**: Replace with a stable, intent-revealing comment that describes what the file _is_, not what future tasks will do to it. For example: `// Quotagate entry point — wires the CLI and starts the proxy server.` T3 and T4 can append to or replace this comment when they add real code; the comment should reflect the current state of the file, not its future state.

---

### Finding 3 — Root-level `*.ts` config files (`vitest.config.ts`, `tsup.config.ts`) are excluded from ESLint coverage [informational]

**Maps to**: SC-4, WS-01-D2.

**Observation**: The `eslint.config.js` `files` pattern is `['src/**/*.ts', 'tests/**/*.ts']`. Root-level config files are explicitly outside it. Running `npx eslint vitest.config.ts` produces `File ignored because no matching configuration was supplied`. This is not a defect for this task — those files contain no product logic and carry no floating-promise risk — but it is a gap worth knowing about.

The `*.js` glob in `tsconfig.eslint.json`'s `include` array (`"*.js"` at root) is a no-op: `allowJs` is not set in `tsconfig.json`, so TypeScript ignores `.js` files regardless. This entry is harmless but misleading; a future engineer may wonder why it is there. It should be noted but is not worth a change at this stage.

**No action required now.** If a root-level config file ever accumulates complex logic, extend the `files` pattern then. Record this gap in the WS_02 tracker's "inherited toolchain notes" so it is not re-discovered.

---

### Deviation assessment — `tsconfig.eslint.json` is correct and necessary

The deviation from the original plan (which named `tsconfig.json` directly in `parserOptions.project`) is the right call. The base `tsconfig.json` has `"include": ["src"]` and `"rootDir": "src"`; pointing ESLint's parser at it causes the parser to reject `tests/smoke.test.ts` and any root-level `.ts` config file as outside the project boundary. A separate `tsconfig.eslint.json` extending the base — overriding `rootDir: "."` and broadening `include` — is the canonical pattern for this situation.

The `rootDir: "."` override in `tsconfig.eslint.json` does NOT affect the build. `tsc --noEmit` (the `typecheck` script) uses `tsconfig.json`, not `tsconfig.eslint.json`. The override is consumed solely by ESLint's project-aware parser. This was confirmed: `npm run typecheck` exits clean with the file present.

The `tsconfig.eslint.json` file is not in `.gitignore` and will be committed with the rest of T2's output — correct; it is a permanent part of the toolchain, not a transient artefact.

---

### Green gate verification (independently run by reviewer)

| Command | Result |
| --- | --- |
| `npm test` | 1 passed, 0 failed, no loader errors |
| `npm run typecheck` | Clean (exit 0) |
| `npm run lint` | Clean (exit 0) |
| `npm run format` (2nd pass) | No files changed |
| `npm run test:cov` | Exit 0; `coverage/` created; 0% on trivial smoke file is expected and acceptable |
| SC-7 contract (BSE-verified) | `no-floating-promises` fired on bare `Promise.resolve();`; line removed |
| SC-8 | No `.eslintrc.*` files present |

---

## Architect Sign-off

- [x] Implementation reviewed
- [x] All success criteria verified
- [x] All assumptions resolved (proven, or fallback taken & documented)
- [x] No regressions in full test suite
- [x] `npm test` / `typecheck` / `lint` / `format` all clean
