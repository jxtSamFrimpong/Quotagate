# TASK_WS01_T3: Author `src/types.ts` — `AdapterRequest`, `AdapterResponse`, `QuotagateCompleteResult` Zod Schema

## Context

- **Workstream**: WS_01 (Node/TS Project Bootstrap)
- **Plan reference**: `docs/plan/workstreams/ws01_project_bootstrap.md`
- **Phase plan**: `docs/plan/phases/01a_transport_and_constraint.md`
- **Depends on**: TASK_WS01_T2 (green gate must be passing; `vitest.config.ts` and `eslint.config.js` must exist before this task's unit tests can run).
- **Blocks**: WS_02 T2 (imports `AdapterRequest`, `AdapterResponse`, `QuotagateCompleteResult` for the subprocess adapter validation step); WS_04 T1 (imports `AdapterRequest`/`AdapterResponse` for the OpenAI translation pipeline); WS_05 (proxy imports `AdapterResponse`); WS_07 T1 (imports `QuotagateCompleteResult` for the tool-call path). All consumers import from `src/types.ts` only — they never redefine these shapes.

---

## Goal & Why

- **Goal**: Author `src/types.ts` containing: (1) `AdapterRequest` — `{ messages: OpenAIMessage[], tools?: OpenAITool[], toolChoice?: string }`; (2) `AdapterResponse` — `{ raw: string, backend: "claude-subprocess" }`; (3) the Zod schema `QuotagateCompleteResult` — a discriminated union with both branches: `{ type: "text", content: string }` and `{ type: "tool_call", name: string, arguments: Record<string, unknown> }`. Author unit tests in `tests/types/quotagateCompleteResult.test.ts` covering valid/invalid Zod parse fixtures for all five cases specified in WS_01.
- **Why**: `src/types.ts` is the single source of truth for the adapter contract (CLAUDE.md invariant #4). Every workstream in Phase 1A, 1B, and 1C imports from this file. If the shape is wrong here — or if downstream workstreams each define their own — the validation contract drifts and produces silent mismatches between what WS_02 validates and what WS_07 expects. Defining both Zod branches now (WS_01-D3), even though `tool_call` is not exercised until WS_07, prevents a breaking cross-workstream schema change mid-flight. The `backend: "claude-subprocess"` discriminant in `AdapterResponse` is the Phase 1 seam: Phase 2 extends it with `"claude-mcp"` — but only via a Decision Log entry; no consumer may widen it unilaterally.

---

## Assumptions to Test

| #   | Assumption                                                                                                                                                             | Why we believe it                                                 | How this task tests it                                                                   | If false →                                                                                                                                                                                     |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | Zod's `z.discriminatedUnion("type", [...])` correctly validates both `text` and `tool_call` branches and rejects payloads missing the discriminant field               | Standard Zod discriminated union API; no exotic configuration     | The five Zod fixture test cases (see Required Test Cases)                                | If `z.discriminatedUnion` rejects valid input or accepts invalid input: examine the schema definition for a typo; do not work around it by switching to `z.union` without a Decision Log entry |
| A2  | TypeScript infers the narrowed type from `QuotagateCompleteResult` correctly (i.e. after `if (result.type === "text")`, `result.content` is accessible without a cast) | Standard TS discriminated union narrowing                         | `npm run typecheck` passes on a narrowing code block in the test file                    | If TypeScript does not narrow: the `type` field literal types are missing; fix the Zod schema literal definitions                                                                              |
| A3  | The `backend: "claude-subprocess"` literal type in `AdapterResponse` is narrow enough that TypeScript rejects `backend: "other"`                                       | Zod `.literal()` or a TypeScript string literal type on `backend` | Add a `// @ts-expect-error` test in the unit file to confirm the wrong value is rejected | If TypeScript accepts any string: `backend` is typed as `string` rather than the literal — this is a contract breach; fix before proceeding                                                    |

---

## Expected Failures

- **EF1** `z.discriminatedUnion` requires the discriminant field to have a `z.literal()` value in each branch — not a `z.string()`. If either branch uses `z.string()` for `type`, Zod will not recognize it as a discriminated union and will throw at schema construction time. This is a schema authoring error, not a runtime concern. Fix: use `z.literal("text")` and `z.literal("tool_call")`.
- **EF2** The `arguments` field in the `tool_call` branch is `Record<string, unknown>`. In Zod, `z.record(z.string(), z.unknown())` is the correct form — `z.object({})` or `z.any()` would be wrong and would either over-restrict or bypass validation. Confirm the Zod definition uses `z.record(z.string(), z.unknown())`.
- **EF3** `OpenAIMessage` and `OpenAITool` are referenced in `AdapterRequest` — these types must be defined in `src/types.ts` as well (or imported from a local definition), not imported from `openai` npm package types (the `openai` package is not declared in `package.json` at this stage). Define minimal structural types for Phase 1; the full `openai` types package can be added in WS_05 when the proxy is wired.

---

## Test Strategy

- **Unit**: Five Zod fixture cases in `tests/types/quotagateCompleteResult.test.ts` — cover the full valid/invalid surface of `QuotagateCompleteResult`. No mocks; pure Zod parse calls.
- **Integration**: N/A — `src/types.ts` has no I/O. Typecheck (`npm run typecheck`) serves as the integration-level signal that the types compile clean.
- **Contract**: The `backend: "claude-subprocess"` discriminant in `AdapterResponse` must be a narrow literal. Verify with a `// @ts-expect-error` line in the test file that assigns `backend: "wrong"` — TypeScript must reject it. This is the seam contract that WS_02 and WS_05 depend on.
- **Manual/spike**: None required. All verification is via `npm test` + `npm run typecheck` + `npm run lint`.

---

## Contract: What This Task Inherits

| Symbol / Artifact                                                       | Source       | Role in This Task                                                     |
| ----------------------------------------------------------------------- | ------------ | --------------------------------------------------------------------- |
| Green gate (Vitest running, ESLint flat config, `tsconfig.json` strict) | TASK_WS01_T2 | Required before `tests/types/quotagateCompleteResult.test.ts` can run |
| `"type":"module"` + `"module":"ESNext"`                                 | TASK_WS01_T1 | `src/types.ts` must use ESM `export` syntax; no `module.exports`      |

---

## Subtask Progress Table

| #   | Subtask                                                                                                                                                        | Status        | Iteration | Notes                                                                                          |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | --------- | ---------------------------------------------------------------------------------------------- |
| 1   | Install Zod devDependency (`zod@^3`) in `package.json`; add it as a runtime dependency (not devDep — `src/types.ts` uses it at runtime for `.parse()`)         | ✅ Done        | 1         | Already present via `npm install zod@^3 --save`; confirmed in `dependencies`                  |
| 2   | Define minimal structural types `OpenAIMessage` and `OpenAITool` in `src/types.ts` for Phase 1 (no `openai` npm package yet)                                   | ✅ Done        | 1         | Defined inline in `src/types.ts`; no `openai` package import                                  |
| 3   | Define `AdapterRequest` and `AdapterResponse` in `src/types.ts`; `AdapterResponse.backend` must be the literal `"claude-subprocess"`                           | ✅ Done        | 1         | `backend: "claude-subprocess"` is a string literal; `// @ts-expect-error` test confirms TS rejects wrong value |
| 4   | Define `QuotagateCompleteResultSchema` Zod schema (discriminated union, both branches); export both the schema and the inferred type `QuotagateCompleteResult` | ✅ Done        | 1         | `z.literal()` discriminants; `z.record(z.string(), z.unknown())` for `arguments`              |
| 5   | Author `tests/types/quotagateCompleteResult.test.ts` with all five fixture cases; run `npm test` and confirm all pass                                          | ✅ Done        | 1         | 6 tests pass (5 fixture cases + smoke); typecheck/lint/format all clean                        |

_Status icons: `✅ Done` | `🔄 In progress` | `⬚ Not started` | `❌ Blocked`_

---

## Current Subtask Detail

### Subtask 4: Define `QuotagateCompleteResultSchema`

**Approach iteration plan** (simplest → target):

1. Define `z.discriminatedUnion("type", [z.object({type: z.literal("text"), content: z.string()}), z.object({type: z.literal("tool_call"), name: z.string(), arguments: z.record(z.string(), z.unknown())})])`.
2. Export as `QuotagateCompleteResultSchema` (the Zod schema) and `QuotagateCompleteResult` (the inferred TypeScript type via `z.infer<typeof QuotagateCompleteResultSchema>`).
3. Run `npm run typecheck` — verify TS narrows correctly after a `type === "text"` guard.

- **Current iteration**: 1 of 3
- **Verifiability / Success Criteria**: Typecheck clean; all five Zod fixture tests pass.
- **Challenges**: EF1 (discriminant must be `z.literal`, not `z.string`) and EF2 (`arguments` must be `z.record`, not `z.any`).

---

## Decisions Made

### WS_01-D3 — `src/types.ts` Defines `QuotagateCompleteResult` with Both Branches ✅ LOCKED (Architect, 2026-06-08)

**Decision**: The Zod schema `QuotagateCompleteResult` is a discriminated union with `{type:"text", content: string}` and `{type:"tool_call", name: string, arguments: Record<string, unknown>}`. Both branches are defined in WS_01 even though `tool_call` is not exercised until WS_03/WS_07.

**Rationale**: `src/types.ts` is the single source of truth for the adapter contract (invariant #4). Defining both branches now means the WS_02 validator and the WS_07 tool-call path both import the same Zod schema rather than each defining their own. If `tool_call` were deferred, WS_07 would need to add to `types.ts` mid-flight — a cross-workstream contract change that risks divergence between what WS_02 validates and what WS_07 expects.

**Rejected alternative — define only the `text` branch now, add `tool_call` in WS_07**: Forces a breaking schema change in a later workstream; creates a window where WS_02 and WS_07 are working against different type shapes.

### D-TYPES-01 — `AdapterResponse.backend` Is a Narrow Literal in Phase 1 ✅ LOCKED (Architect, 2026-06-08)

**Decision**: `AdapterResponse.backend` is typed as the literal `"claude-subprocess"` (not `string`). The Phase 2 MCP upgrade extends this to a discriminated union `"claude-subprocess" | "claude-mcp"` via a Decision Log entry at that time.

**Rationale**: The `backend` field is the seam between the adapter (WS_02) and the proxy (WS_05). A narrow literal catches any consumer that tries to widen it silently. Making it a `string` now would require all Phase 2 consumers to be audited for hardcoded assumptions.

**Rejected alternative — type `backend` as `string`**: Hides contract violations until runtime; makes Phase 2's extension of the discriminant ambiguous.

### Anti-overengineering scope fence ✅ LOCKED

**This task explicitly does NOT include**:

- The `openai` npm package or its types — `OpenAIMessage` and `OpenAITool` are defined as minimal structural types in Phase 1. The full `openai` package is added in WS_05 when the proxy endpoint is wired.
- `ArgumentBuilder`, `RequestBuilder`, `ResponseBuilder` types — those are WS_04 concerns.
- MCP-specific types (`_mcp_lock`, `quotagate_complete` tool schema, MCP session types) — Phase 2; explicitly excluded per D-SEQ-01.
- `StreamChunk` or SSE types — Phase 3.
- Zod schemas for the OpenAI wire format (`ChatCompletionRequest`, `ChatCompletionResponse`) — WS_05.
- Generics or type-level metaprogramming beyond what Zod's `z.infer` provides — premature abstraction.

---

## Cross-Task Contracts (Downstream Dependencies on This Task)

### TASK_WS01_T4 will depend on:

- `src/types.ts` must export `QuotagateError` — wait, that is T4's own file. T4 imports `QuotagateError` from `src/errors.ts` (its own output). T4 does NOT import from `src/types.ts` in the no-op stub. No dependency.

### WS_02 will depend on:

- `AdapterRequest` — exact shape: `{ messages: OpenAIMessage[], tools?: OpenAITool[], toolChoice?: string }`. WS_02 constructs `AdapterRequest` objects and passes them to `adapter.complete()`.
- `AdapterResponse` — exact shape: `{ raw: string, backend: "claude-subprocess" }`. WS_02's `complete()` returns this. `backend` is the literal `"claude-subprocess"` in Phase 1; widening it requires a Decision Log entry.
- `QuotagateCompleteResultSchema` — WS_02's validator calls `.parse()` on the subprocess stdout to produce a `QuotagateCompleteResult`. The schema must not change shape without a Decision Log entry.

### WS_05 will depend on:

- `AdapterResponse` shape (as above). The proxy wraps this into an OpenAI-format response.

### WS_07 will depend on:

- `QuotagateCompleteResultSchema` `tool_call` branch — `{ type: "tool_call", name: string, arguments: Record<string, unknown> }`. WS_07 imports and relies on the `tool_call` branch being present; it does NOT add it.

---

## Files Modified / Created

- `src/types.ts` — **create new** (`OpenAIMessage`, `OpenAITool` minimal structural types; `AdapterRequest`; `AdapterResponse` with `backend:"claude-subprocess"` literal; `QuotagateCompleteResultSchema` Zod discriminated union; exported `QuotagateCompleteResult` inferred type)
- `tests/types/quotagateCompleteResult.test.ts` — **create new** (five fixture cases: 2 valid, 3 invalid)
- `package.json` — **modify** (add `zod@^3` to `dependencies`)

---

## Success Criteria / Verifiability

| #    | Criterion                                                                                              | How to verify                                                                  |
| ---- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| SC-1 | `QuotagateCompleteResultSchema.parse({type:"text", content:"hello"})` succeeds                         | Test case T-1 passes                                                           |
| SC-2 | `QuotagateCompleteResultSchema.parse({type:"tool_call", name:"fn", arguments:{}})` succeeds            | Test case T-2 passes                                                           |
| SC-3 | `QuotagateCompleteResultSchema.parse({type:"text"})` (missing `content`) throws a Zod error            | Test case T-3 passes (`expect(() => ...).toThrow()`)                           |
| SC-4 | `QuotagateCompleteResultSchema.parse({type:"tool_call"})` (missing `name`) throws a Zod error          | Test case T-4 passes                                                           |
| SC-5 | `QuotagateCompleteResultSchema.parse({})` (missing `type`) throws a Zod error                          | Test case T-5 passes                                                           |
| SC-6 | `npm run typecheck` clean — zero TypeScript errors across `src/types.ts`                               | `npx tsc --noEmit`; zero output                                                |
| SC-7 | `AdapterResponse.backend` typed as literal `"claude-subprocess"` — TypeScript rejects any other string | `// @ts-expect-error` line in test file confirms the wrong literal is rejected |
| SC-8 | `npm test` green — no regressions to smoke test                                                        | `npm test`; all tests pass                                                     |

---

## Required Test Cases

File: `tests/types/quotagateCompleteResult.test.ts`

### T-1: valid text result (covers SC-1)

Construct `{ type: "text", content: "hello" }`. Call `QuotagateCompleteResultSchema.parse(input)`. Assert the result equals the input object. Assert inferred type narrows to the `text` branch (use `result.content` directly to confirm TypeScript does not complain).

### T-2: valid tool_call result (covers SC-2)

Construct `{ type: "tool_call", name: "fn", arguments: {} }`. Call `QuotagateCompleteResultSchema.parse(input)`. Assert result equals input. Assert `result.name` and `result.arguments` are accessible on the narrowed type.

### T-3: invalid text result — missing `content` (covers SC-3)

Construct `{ type: "text" }` (no `content`). Wrap in `expect(() => QuotagateCompleteResultSchema.parse(input)).toThrow()`. Assert a Zod error is thrown.

### T-4: invalid tool_call result — missing `name` (covers SC-4)

Construct `{ type: "tool_call" }` (no `name`, no `arguments`). Wrap in `expect(() => QuotagateCompleteResultSchema.parse(input)).toThrow()`. Assert a Zod error is thrown.

### T-5: invalid result — missing discriminant (covers SC-5)

Construct `{}` (no `type` field). Wrap in `expect(() => QuotagateCompleteResultSchema.parse(input)).toThrow()`. Assert a Zod error is thrown.

---

## Review Notes

**Verdict: APPROVE** (Principal Architect, 2026-06-09)

**Finding 1 — Nit** (A3 / SC-7, test file): The `@ts-expect-error` SC-7 check on lines 44–46 is a module-level statement outside any `it()` block. Structurally correct and enforced by typecheck; but a cosmetic `it('SC-7 compile-time: ...')` wrapper would make the contract visible in the Vitest reporter. Fix when next touching the test file — non-blocking.

**Finding 2 — Nit** (cross-task / WS_02): `OpenAIMessage.content: string | null` is the correct structural choice (null content is valid for assistant messages carrying only tool_calls). WS_02's implementer must not silently coerce `null` to `""` or skip the message when rendering history into the subprocess prompt. Record as an Assumption-to-Test in the WS_02 tracker — no change needed here.

**Finding 3 — Informational** (cross-task / WS_07): `arguments: z.record(z.string(), z.unknown())` is intentionally open — WS_07 validates individual argument values against tool parameter schemas at that layer. The openness is a feature.

All SC-1 through SC-8 verified. A1, A2, A3 all proven. EF1, EF2, EF3 all handled correctly. Scope fence clean. Cross-task contracts exact match.

---

## Architect Sign-off

- [x] Implementation reviewed
- [x] All success criteria verified
- [x] All assumptions resolved (proven, or fallback taken & documented)
- [x] No regressions in full test suite
- [x] `npm test` / `typecheck` / `lint` / `format` all clean
