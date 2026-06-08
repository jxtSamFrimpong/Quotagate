# TASK_WS01_T1: Initialize Repo — `package.json`, `tsconfig.json`, `tsup.config.ts`, `.gitignore`, `README.md`

## Context
- **Workstream**: WS_01 (Node/TS Project Bootstrap)
- **Plan reference**: `docs/plan/workstreams/ws01_project_bootstrap.md`
- **Phase plan**: `docs/plan/phases/01a_transport_and_constraint.md`
- **Depends on**: None — this is the first task in the project.
- **Blocks**: TASK_WS01_T2 (toolchain config requires `package.json` to resolve packages); all later workstreams (WS_02+) depend on the `npm run` script table and the ESM/TS config being stable.

---

## Goal & Why
- **Goal**: Produce a valid, installable Node/TypeScript project root: `package.json` (ESM `"type":"module"`, all eight `npm run` scripts from CLAUDE.md, `fastify@5.x` declared), `tsconfig.json` (`strict: true`, `"module":"ESNext"`, `"moduleResolution":"bundler"` or `"NodeNext"`, no path aliases beyond relative imports), `tsup.config.ts` (entry `src/index.ts`, ESM output), `.gitignore` (covers `node_modules`, `dist`, `.env`), and a `README.md` stub.
- **Why**: Every subsequent task in WS_01 — and every later workstream — runs commands by name against the scripts defined here and imports packages declared here. The `npm run` script table is a cross-task contract: script names that are renamed or removed in a later workstream break WS_02, WS_04, and WS_05 without warning. Setting strict ESM from the first commit prevents the silent CJS/ESM loader split that is the single most common source of toolchain debt in Node projects. Declaring `fastify@5.x` now (rather than in WS_05) ensures typecheck covers the Fastify boundary from day one — any type error at that boundary surfaces in WS_05 where it belongs, not as a cryptic compile failure mid-phase (WS_01-D1, D-1A-05).

---

## Assumptions to Test

| # | Assumption | Why we believe it | How this task tests it | If false → |
|---|---|---|---|---|
| A1 | Node 20+ and npm are present on the dev machine | Project requirement; CLAUDE.md states Node 20+ as the runtime target | `npm install` completes without error; `node --version` ≥ 20 | Cannot proceed — Node 20 must be installed before WS_01 |
| A2 | Fastify v5 types are self-contained; `@types/fastify` must NOT be installed | WS_01-D1: Fastify v5 ships its own types; `@types/fastify` is a v4 artifact | After `npm install`, TypeScript resolves `import Fastify from "fastify"` without error in `src/index.ts` stub | If types are missing, check the Fastify v5 package — do not install `@types/fastify`; open a tracker note |
| A3 | `"module":"ESNext"` + `"type":"module"` in `package.json` produces a coherent ESM project with `tsup` | ESM-first is the project mandate; tsup is designed for this combination | `npm run build` produces a `.js` bundle with no CJS warnings; tsup does not inject `require()` shims | Investigate `"moduleResolution":"NodeNext"` + explicit `.js` extensions in relative imports; record finding |
| A4 | No path aliases are needed in Phase 1 (relative imports suffice) | WS_01 pitfall note: `tsconfig.json` `paths` aliases require matching `tsup` `esbuildOptions` — adds toolchain complexity for no benefit in Phase 1 | All imports in Phase 1 source files use relative paths; no `@/` aliases appear | If a later task introduces an alias, add `esbuildOptions.alias` to `tsup.config.ts` at that time — not now |

---

## Expected Failures

- **EF1** `npm install` may warn about peer dependency mismatches between `fastify@5.x` and `@fastify/*` plugins if any are accidentally included — no plugins are declared in this task, so this should not occur. If it does: remove any accidentally added Fastify plugin deps and re-run.
- **EF2** `tsup` may emit a warning about an empty or trivially-small bundle when `src/index.ts` is a no-op stub — this is cosmetic and expected. The stub must contain at least one import (added in T4) to suppress the warning; in T1 a comment-only file is acceptable since T4 has not been authored yet. Record if the warning blocks the build.
- **EF3** `tsc --noEmit` may fail with `"Cannot find module 'fastify'"` if `npm install` was not run first — this is operator error, not a configuration bug. The green-gate sequence is always: `npm install` → then gate commands.

---

## Test Strategy
- **Unit**: None — this task produces configuration files and a build manifest, not runtime logic. There is no behaviour to unit-test.
- **Integration**: N/A at this stage.
- **Contract**: Verified by the green-gate command sequence below. The `npm run` script names are the contract; verify each script resolves and exits 0.
- **Manual/spike**: Run in order after authoring all files:
  1. `npm install` — zero errors, `node_modules/` populated, `fastify` and `typescript` present.
  2. `npx tsc --noEmit` — zero errors (only `src/index.ts` stub exists at this point; later tasks add files but must not break this).
  3. `npm run build` — `tsup` produces output in `dist/` without errors.
  4. `npm run lint` — will pass trivially (no source beyond stub).
  5. `npm run format` — produces no diff.
  6. Confirm `node --version` ≥ 20 and that `package.json` has `"type": "module"`.

  Full green gate (`npm test` included) is T2's responsibility — T1's gate is typecheck + build + lint + format only, since Vitest is not yet configured.

---

## Subtask Progress Table

| # | Subtask | Status | Iteration | Notes |
|---|---------|--------|-----------|-------|
| 1 | Author `package.json`: `"type":"module"`, `"engines":{"node":">=20"}`, all eight `npm run` scripts (dev, build, test, test:watch, test:cov, typecheck, lint, format), `fastify@5.x` as a dependency, `typescript`, `tsup`, `tsx` as devDependencies | ⬚ Not started | — | Script commands verbatim from CLAUDE.md table |
| 2 | Author `tsconfig.json`: `"strict":true`, `"module":"ESNext"`, `"target":"ES2022"`, `"moduleResolution":"bundler"`, `"outDir":"dist"`, `"rootDir":"src"`, `include:["src"]` — no `paths` aliases | ⬚ Not started | — | Pitfall: keep `paths` empty; relative imports only in Phase 1 |
| 3 | Author `tsup.config.ts`: entry `["src/index.ts"]`, `format:["esm"]`, `dts:true`, `clean:true` | ⬚ Not started | — | Must produce ESM output; no CJS target in Phase 1 |
| 4 | Author `.gitignore`: `node_modules/`, `dist/`, `.env`, `.env.*`, `*.log`, `coverage/` | ⬚ Not started | — | |
| 5 | Author `README.md` stub: project name, one-line description, `npm install` + green-gate commands | ⬚ Not started | — | Stub only — no architecture prose |
| 6 | Run `npm install` and verify typecheck + build pass; confirm Fastify types resolve in `src/index.ts` stub | ⬚ Not started | — | `npx tsc --noEmit` + `npm run build` must exit 0 |

*Status icons: `✅ Done` | `🔄 In progress` | `⬚ Not started` | `❌ Blocked`*

---

## Current Subtask Detail

### Subtask 1: Author `package.json`
**Approach iteration plan** (simplest → target):
1. Minimal `package.json` with name, version, `"type":"module"`, and all eight scripts (commands verbatim from CLAUDE.md).
2. Add `dependencies` (`fastify@^5.0.0`) and `devDependencies` (`typescript`, `tsup`, `tsx`, `@types/node`).
3. Verify `npm install` completes and `node_modules/fastify` contains TypeScript types.

- **Current iteration**: 1 of 3
- **Verifiability / Success Criteria**: `npm install` exits 0; `package.json` contains all eight script names; `"type":"module"` present.
- **Challenges**: Confirming the exact Fastify v5 semver range (`^5.0.0`) resolves on npm at implementation time.

---

## Decisions Made

### WS_01-D1 — Fastify v5 Declared in WS_01 (Server Not Started) ✅ LOCKED (Architect, 2026-06-08)
Inherits **D-1A-05** from `docs/plan/phases/01a_transport_and_constraint.md`.

**Decision**: Pin `fastify@5.x` in `package.json` during WS_01 bootstrap. The server does not start until WS_05, but the dependency and its TypeScript types are present from the first `npm install`.

**Rationale**: Fastify v5 is native ESM on Node 20. Any type errors at the Fastify boundary surface in WS_05 when the server is actually wired, not as a surprise mid-phase. Declaring early costs nothing.

**Rejected alternative — declare Fastify in WS_05**: `tsconfig.json` strict-mode type check covers the whole `src/` tree; even stub files referencing Fastify types would fail typecheck if the package is not installed. Deferring creates a toolchain gap in WS_02–WS_04.

### Anti-overengineering scope fence ✅ LOCKED
**This task explicitly does NOT include**:
- Path aliases (`@/types`, `@/errors`, etc.) in `tsconfig.json` — relative imports are correct for Phase 1; aliases require matching `tsup` `esbuildOptions` and add resolution complexity (see pitfall in WS_01 plan). Aliases are a Phase 3 concern if module depth warrants them.
- CI/CD pipeline files (`.github/workflows/`, `Dockerfile`, `.dockerignore`) — Phase 4 / post-WS_01.
- `jest.config.*` or any test runner config — that is T2's scope.
- ESLint or Prettier config files — T2's scope.
- Multi-package / monorepo setup (`packages/`, `workspaces`) — not warranted; single-package project.
- `docker-compose.yml` or container orchestration — Phase 4.

---

## Cross-Task Contracts (Downstream Dependencies on This Task)

### TASK_WS01_T2 will depend on:
- `package.json` `devDependencies` must include `typescript` and enough for T2 to add `vitest`, `eslint`, `prettier` entries — T2 extends `devDependencies`, does not replace them.
- The eight `npm run` script names are locked: `dev`, `build`, `test`, `test:watch`, `test:cov`, `typecheck`, `lint`, `format`. T2 fills in the `vitest`/`eslint`/`prettier` command bodies but must not rename or remove any of these keys.

### TASK_WS01_T3 and TASK_WS01_T4 will depend on:
- `tsconfig.json` `strict: true` is present and `"include": ["src"]` covers `src/types.ts` and `src/errors.ts`.
- `"type":"module"` in `package.json` is present so ESM imports in source files resolve correctly.

### WS_02+ will depend on:
- The exact eight script names above — they run these by name. Any rename is a breaking change requiring a Decision Log entry.

---

## Files Modified / Created
- `package.json` — **create new** (ESM, all scripts, fastify@5.x declared)
- `tsconfig.json` — **create new** (strict, ESM, no path aliases)
- `tsup.config.ts` — **create new** (entry: src/index.ts, format: esm, dts: true)
- `.gitignore` — **create new** (node_modules, dist, .env, coverage)
- `README.md` — **create new** (stub: name, one-liner, install + gate commands)

---

## Success Criteria / Verifiability

| # | Criterion | How to verify |
|---|-----------|---------------|
| SC-1 | `npm install` completes without errors on Node 20+ | Run `npm install`; exit code 0; `node_modules/fastify` present |
| SC-2 | All eight `npm run` scripts are present in `package.json` with the exact names from CLAUDE.md | `cat package.json \| grep -E '"(dev\|build\|test\|test:watch\|test:cov\|typecheck\|lint\|format)"'` — all eight appear |
| SC-3 | `fastify@5.x` is declared in `dependencies` and its types resolve | `npx tsc --noEmit` exits 0 against `src/index.ts` stub (stub contains `import Fastify from "fastify"`) |
| SC-4 | `npm run build` (tsup) produces a bundle in `dist/` without errors | `npm run build`; exit code 0; `dist/index.js` exists |
| SC-5 | `npm run typecheck` clean — zero errors | `npx tsc --noEmit`; zero output |
| SC-6 | `"type":"module"` and `"strict":true` present in the respective files | Inspect `package.json` and `tsconfig.json` |
| SC-7 | No path aliases in `tsconfig.json` | `tsconfig.json` has no `paths` key, or `paths` is `{}` |

---

## Required Test Cases

This task produces configuration files only. There is no runtime logic and therefore no Vitest test cases owned by T1. Verification is entirely via the green-gate commands listed in SC-1 through SC-7.

The smoke test (`tests/smoke.test.ts`) that proves the Vitest harness runs is owned by **TASK_WS01_T2** — it depends on T2's `vitest.config.ts`.

---

## Review Notes
*(Architect fills after BSE submits — verdict APPROVE / APPROVE-WITH-NITS / REQUEST-CHANGES, findings classified required-change / nit / informational, mapped to SC / decision IDs.)*

---

## Architect Sign-off
- [ ] Implementation reviewed
- [ ] All success criteria verified
- [ ] All assumptions resolved (proven, or fallback taken & documented)
- [ ] No regressions in full test suite
- [ ] `npm test` / `typecheck` / `lint` / `format` all clean
