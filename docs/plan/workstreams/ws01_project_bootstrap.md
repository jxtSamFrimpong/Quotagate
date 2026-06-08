# Workstream WS_01: Node/TS Project Bootstrap

> A workstream scopes ~1 day of work and is more detailed than its parent phase: concrete goals +
> deliverables, locked decisions (with rejected alternatives), a task breakdown, cross-task
> contracts, and success/quality gates. It is the bridge from phase goals to hour-sized tasks.

## Workstream Overview
- **Parent Phase**: [Phase 1A — Claude Subprocess Adapter & Constraint](../phases/01a_transport_and_constraint.md)
- **Timeframe**: ~1 day
- **Status**: Proposed
- **Dependencies**: None — this is the first workstream. All others depend on it.

---

## Goals & Deliverables

- **Goal 1**: A compiling, linting, formatting, and test-passing Node/TypeScript project from the first commit.
  - Deliverable: `package.json` (ESM `"type":"module"`, all `npm run` scripts from CLAUDE.md, Fastify v5 declared), `tsconfig.json` (`strict: true`), ESLint flat-config, Prettier config, `vitest.config.ts`. The green gate passes against a trivial placeholder test.

- **Goal 2**: The shared type foundation that every later workstream depends on.
  - Deliverable: `src/types.ts` — `AdapterRequest`, `AdapterResponse`, and the Zod schema for `QuotagateCompleteResult` (`{type:"text"}` and `{type:"tool_call"}` discriminated union).

- **Goal 3**: The error hierarchy that the adapter (WS_02) and proxy (WS_05) both reference from day one.
  - Deliverable: `src/errors.ts` — `QuotagateError` base class, `TransportError`, `ValidationError` subclasses. Class hierarchy only; no logic.

- **Goal 4**: A build-target entry point so `tsup`/`tsc` can type-check the full chain.
  - Deliverable: `src/index.ts` — no-op stub (`// Phase 1B fleshes this out`). Imports `QuotagateError` so the import chain is exercised.

---

## Why This Workstream Matters

Every subsequent workstream in Phases 1A, 1B, and 1C imports from `src/types.ts` and `src/errors.ts`. If those types drift or the toolchain has configuration gaps, the failures surface as cryptic type errors in WS_02 and WS_04 instead of here where they are cheap to fix. The principle is simple: a broken foundation poisons every workstream that follows it. WS_01 exists so that "does this compile and lint cleanly?" is a question that is answered once, on day one, never re-litigated.

The green gate — `npm test` / `typecheck` / `lint` / `format` — is a quality ratchet: once it is green, it stays green. WS_01 establishes the ratchet.

---

## Locked Decisions

### WS_01-D1 — Fastify v5 Declared in WS_01 (Server Not Started) ✅ LOCKED (Architect, 2026-06-08)
Inherits **D-1A-05** from the parent phase plan.

**Decision**: Pin `fastify@5.x` in `package.json` during WS_01 bootstrap. The server does not start until WS_05, but the dependency and its TypeScript types are present from the first `npm install` so typecheck is clean across all phases without a package change mid-flight.

**Rationale**: Fastify v5 is native ESM on Node 20 (`"type":"module"`). Declaring it now means any type errors at the Fastify boundary surface in WS_05 when the server is actually wired, not as a surprise in Phase 1B with an ambiguous root cause. It costs nothing to declare a dependency early.

**Rejected alternative — declare Fastify in WS_05**: The `tsconfig.json` strict-mode type check covers the whole `src/` tree; `proxy.ts` type-stubs (even empty) would fail typecheck if the package is not installed. Deferring creates a toolchain gap.

### WS_01-D2 — ESLint Flat Config (`eslint.config.js`) Over Legacy `.eslintrc` ✅ LOCKED (Architect, 2026-06-08)
**Decision**: Use ESLint's flat config format (`eslint.config.js`) with the `@typescript-eslint/eslint-plugin` and `@typescript-eslint/parser`. No `.eslintrc.json` / `.eslintrc.js`.

**Rationale**: ESLint flat config is the current format as of ESLint v9; the legacy format is soft-deprecated. Starting on flat config avoids a forced migration later and is compatible with the project's ESM-first stance.

**Rejected alternative — legacy `.eslintrc.json`**: Introduces a migration burden within the project's own lifetime. The flat config is a one-time cost now, not a recurring debt.

### WS_01-D3 — `src/types.ts` Defines `QuotagateCompleteResult` with Both Branches ✅ LOCKED (Architect, 2026-06-08)
**Decision**: The Zod schema `QuotagateCompleteResult` is a discriminated union with `{type:"text", content: string}` and `{type:"tool_call", name: string, arguments: Record<string, unknown>}`. Both branches are defined in WS_01 even though the `tool_call` branch is not exercised until WS_03/WS_07.

**Rationale**: `src/types.ts` is the single source of truth for the adapter contract (invariant #4). Defining both branches now means the WS_02 validator and WS_07 tool-call path both import the same Zod schema rather than each defining their own. If the `tool_call` branch were deferred, WS_07 would need to add to `types.ts` mid-flight — a cross-workstream contract change.

**Rejected alternative — define only the `text` branch now, add `tool_call` in WS_07**: Forces a breaking schema change in a later workstream; risks a `types.ts` divergence between what WS_02 validates and what WS_07 expects.

---

## Task Breakdown

| Task ID | Description | Est. Duration | Status | Task Tracker Link |
|---------|-------------|---------------|--------|-------------------|
| T1 | Initialize repo: `package.json` (ESM, all npm scripts), `tsconfig.json` (strict, ESM, path aliases), `tsup.config.ts`, `.gitignore`, `README.md` stub | ~1 hour | ⬚ Not started | `../../active/TASK_WS01_T1.md` |
| T2 | Install and configure toolchain: Vitest (`vitest.config.ts`), ESLint flat config (`eslint.config.js`), Prettier (`.prettierrc`). Green gate passes against a trivial `src/__tests__/smoke.test.ts` | ~1 hour | ⬚ Not started | `../../active/TASK_WS01_T2.md` |
| T3 | Author `src/types.ts`: `AdapterRequest`, `AdapterResponse`, `QuotagateCompleteResult` Zod schema (both branches). Unit tests: valid/invalid Zod fixtures parse correctly | ~1 hour | ⬚ Not started | `../../active/TASK_WS01_T3.md` |
| T4 | Author `src/errors.ts` (`QuotagateError`, `TransportError`, `ValidationError`) and `src/index.ts` (no-op stub). Verify full typechain compiles clean. | ~45 min | ⬚ Not started | `../../active/TASK_WS01_T4.md` |

*Status: `✅ Completed` | `🔄 In Progress` | `⬚ Not started` | `❌ Blocked`*

*T1 and T2 are sequential (T2 needs `package.json`). T3 and T4 are independent once T2 is green. Run T3 and T4 in parallel if two sessions are available.*

---

## Cross-Task Contracts

### `QuotagateCompleteResult` Zod schema (owned by T3 → consumed by WS_02 T2, WS_07 T1)
Defined in `src/types.ts`. The discriminated union:
```
{ type: "text",      content: string }
{ type: "tool_call", name: string, arguments: Record<string, unknown> }
```
WS_02 and WS_07 import this schema; they do NOT redefine it. Shape changes to this schema are breaking contract revisions that must be flagged in the Decision Log.

### `AdapterRequest` / `AdapterResponse` types (owned by T3 → consumed by WS_02, WS_04, WS_05)
`AdapterRequest`: `{ messages: OpenAIMessage[], tools?: OpenAITool[], toolChoice?: string }`.
`AdapterResponse`: `{ raw: string, backend: "claude-subprocess" }` (Phase 1; the `backend` discriminant is extended in Phase 2 with `"claude-mcp"`). These are the seams between the translation pipeline (WS_04) and the adapter (WS_02). Consumers must not widen `backend` without a Decision Log entry.

### `QuotagateError` / `TransportError` / `ValidationError` (owned by T4 → consumed by WS_02, WS_05)
Defined in `src/errors.ts` only — never re-declared in adapter or proxy files. WS_02's `_complete_via_subprocess` throws `TransportError`; WS_05's `proxy.ts` catches `QuotagateError` and maps to HTTP error responses.

### `npm run` script table (owned by T1 → consumed by all workstreams)
The exact script names (`dev`, `build`, `test`, `test:watch`, `test:cov`, `typecheck`, `lint`, `format`) are fixed here. Later workstreams run them by name; they must not be renamed or removed.

---

## Success & Evaluation Criteria

- **Functional requirements**:
  - [ ] `npm install` completes without errors on Node 20+.
  - [ ] `npx tsc --noEmit` produces zero errors across all files in `src/`.
  - [ ] `npm run lint` produces zero ESLint violations.
  - [ ] `npm run format` produces no diff (Prettier already applied).
  - [ ] `npm test` runs and passes (smoke test + `types.ts` Zod unit tests).
  - [ ] `npm run build` (tsup) produces a bundle without errors.

- **Named tests that prove this workstream done**:
  - [ ] `tests/types/quotagateCompleteResult.test.ts` — Zod parses `{type:"text", content:"hello"}` as valid; `{type:"tool_call", name:"fn", arguments:{}}` as valid; `{type:"text"}` (missing `content`) as invalid; `{type:"tool_call"}` (missing `name`) as invalid; `{}` as invalid.
  - [ ] `tests/smoke.test.ts` — trivial `expect(1+1).toBe(2)` proving the Vitest harness runs.

- **Quality gates**:
  - [ ] `npm test` green; no test-count regression
  - [ ] `npm run typecheck` clean
  - [ ] `npm run lint` clean; `npm run format` produces no diff
  - [ ] Coverage: N/A for this workstream (no logic to cover); Zod schema tests provide structural coverage of `types.ts`

---

## Known Pitfalls & Implementation Notes

**ESM + tsup + Vitest alignment**: All three tools must agree that the project is ESM (`"type":"module"` in `package.json`, `"module":"ESNext"` in `tsconfig.json`). Vitest needs `pool: "forks"` or `environment: "node"` in its config to avoid CommonJS loader conflicts. Verify this in T2 before writing any real source.

**Fastify v5 TypeScript types**: Fastify v5 ships its own types; do not install `@types/fastify` (v4 artifact). The import is `import Fastify from "fastify"` — verify this compiles in T1 even against the no-op stub.

**ESLint flat config with TypeScript**: The `@typescript-eslint` plugin requires `parserOptions.project` pointing at `tsconfig.json`. Without it, type-aware rules silently fall back to non-type-aware mode. Confirm at least one type-aware rule fires correctly in T2.

**`tsconfig.json` `paths` vs `tsup` resolution**: If path aliases (e.g. `@/types`) are configured in `tsconfig.json`, `tsup` must be told about them via `esbuildOptions` or `tsup`'s `paths` option. Keep aliases minimal in Phase 1 to avoid this complexity — relative imports are fine until Phase 3.

**`src/index.ts` as build entry for `tsup`**: tsup needs an entry point. The no-op stub must be a valid TypeScript file (not empty) — a single comment and one import is sufficient. This prevents `tsup` from emitting a warning about an empty bundle.
