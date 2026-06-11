# TASK_WS04_T1: Argument Builder (OpenAI request → AdapterRequest)

## Context

- **Workstream**: WS_04 (Argument Builder, Validator & Response Builder)
- **Plan reference**: `docs/plan/workstreams/ws04_translation_pipeline.md`
- **Phase plan**: `docs/plan/phases/01b_openai_translation_pipeline.md`
- **Depends on**: WS_03 signed off — `src/types.ts` stable (`AdapterRequest`, `OpenAIMessage`, `OpenAITool`). **Adds a new type `OpenAIChatRequest` to `src/types.ts`** as a hand-rolled Zod schema (OD-3 — LOCKED 2026-06-10).
- **Blocks**: WS_05 T2 (`proxy.ts` calls `buildAdapterRequest`), WS_06 (no-tools E2E).

---

## Goal & Why

- **Goal**: Author `src/argumentBuilder.ts` exporting one pure function,
  `buildAdapterRequest(body: OpenAIChatRequest): AdapterRequest`. It maps the validated OpenAI request
  fields (`messages`, optional `tools`, optional `tool_choice`) one-for-one onto the adapter's
  `AdapterRequest` shape (`messages`, `tools?`, `toolChoice?`). It adds **no** constraint text, **no**
  system message, and **no** field not present in the caller's request. As part of this task, add the
  `OpenAIChatRequest` type to `src/types.ts` (the request shape the proxy parses; it does not yet exist
  on disk). Per OD-3 (LOCKED), it is a **hand-rolled Zod schema** for the Phase-1B fields (`model`,
  `messages`, `tools?`, `tool_choice?`, `stream?`) whose inferred type drives both this builder's input
  and WS_05's HTTP-body parsing — not imported from the `openai` package.

- **Why**: `argumentBuilder.ts` is one of only three modules that straddle the OpenAI shape and the
  adapter shape, so it is exactly where constraint text could leak in and where transport-agnosticism
  (invariant #4) is won or lost. The constraint is owned one layer down — by `buildConstrainedPrompt`
  inside `src/adapters/claude.ts` (delivered via `--system-prompt`, WS_03). If this layer injected
  constraint text, adding a Gemini adapter in Phase 2 would force `argumentBuilder.ts` to branch on the
  target backend — collapsing the clean OpenAI→adapter mapping. The separation-of-concerns test makes
  that invariant **visible and regression-guarded**: without it, a future "helpful" system prompt added
  here would stay invisible until the WS_09 contamination tests failed for inexplicable reasons. Getting
  this right in isolation is what lets WS_06's E2E test be a confirmation pass, not a debugging session.

---

## Assumptions to Test

| #   | Assumption                                                                                              | Why we believe it                                                                                                                | How this task tests it                                                                                                  | If false →                                                                                                                  |
| --- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| A1  | A one-for-one field map (`messages`→`messages`, `tools`→`tools`, `tool_choice`→`toolChoice`) is the complete translation needed for the adapter — no enrichment | The adapter (`buildConstrainedPrompt`) already serializes tools + conversation; it owns the constraint. The builder only renames/forwards. | T-1 asserts the output `messages` are reference-equal in content to the input; T-3 asserts no extra keys beyond `{messages, tools?, toolChoice?}` | If the adapter needs more context: that is an adapter concern, not a builder concern — push it down to `buildConstrainedPrompt`, do not enrich here |
| A2  | `tools: undefined` and `tools: []` must produce the **same** `AdapterRequest` so the adapter cannot differentiate "no tools" from "empty tools" | `buildConstrainedPrompt` already normalizes `tools && tools.length > 0 ? tools : undefined` (claude.ts L56); the builder should match | T-2 asserts `buildAdapterRequest({...,tools:[]})` deep-equals `buildAdapterRequest({...,tools:undefined})` | If they diverge: the adapter's normalization papers over it today, but the contract is dishonest — fix the builder to normalize at the seam |
| A3  | `OpenAIChatRequest` can be expressed as a Zod schema in `src/types.ts` whose inferred type drives both the proxy's request parsing (WS_05) and this builder's input | WS_05 must Zod-parse the body anyway (phase goal); a single source schema avoids a parallel hand-rolled type drifting from the parser | This task defines the schema/type; WS_05 T1 consumes it for parsing. Compile-time check: builder input type === schema-inferred type | If a Zod schema cannot capture the needed shape: fall back to a hand-rolled `interface` + document why parsing diverges (OD-3) |

---

## Expected Failures

- **[EF1]** Caller omits `tool_choice` entirely. The builder must NOT inject a default value into the
  returned `AdapterRequest` — doing so would violate WS_04-D1 ("inject nothing not present in the caller's
  original request"). Per OD-1 (LOCKED 2026-06-10): the builder **passes `tool_choice` through verbatim**
  (omitted → `toolChoice: undefined`); **the default belongs at the adapter boundary, where it already
  lives** (`buildConstrainedPrompt(..., req.toolChoice ?? 'auto')`, claude.ts L90). One default, one
  owner. The workstream's Success Criteria row that injected `"auto"` here was the contradiction OD-1
  resolved; the workstream doc is corrected to match.
- **[EF2]** Caller sends `tools: []`. Must be normalized to match `tools: undefined` (A2/T-2), not
  forwarded as an empty array — otherwise two equivalent requests produce two different `AdapterRequest`
  objects and the adapter's own normalization is the only thing saving correctness.
- **[EF3]** Caller sends extra OpenAI fields the builder does not map (`temperature`, `top_p`, `n`,
  `max_tokens`, `stream`, `user`). These are **dropped** at the builder — Phase 1B supports none of
  them, and silently passing them into `AdapterRequest` (which has no slot for them) is impossible by
  type. `stream` is rejected upstream in `proxy.ts` (D-1B-04), never reaching the builder. Document that
  drop is intentional, not a bug.
- **[EF4]** A caller mutates the returned `AdapterRequest.messages` array. The builder is pure and must
  not retain a reference it later relies on, but it also must not be forced to deep-clone defensively
  (cost with no benefit in this single-threaded request path). Cross-Task Contract states consumers must
  not mutate the returned object; that is the contract, not a runtime guard.

---

## Test Strategy

- **Unit**: `tests/argumentBuilder.test.ts` — pure-function tests, no I/O, no mocks. Exercises the field
  map, the `undefined`/`[]` tools equivalence, the `toolChoice` forwarding, and the
  separation-of-concerns guard (no constraint text, no added system message).
- **Integration**: None in this task. The builder is exercised end-to-end in WS_06; here it is proven in
  isolation so WS_06 is a confirmation pass.
- **Contract**: The output is type-checked against `AdapterRequest` from `src/types.ts` (compile-time).
  The separation-of-concerns assertion is the load-bearing contract: the `messages` the builder emits
  are exactly the caller's messages, with no constraint phrase added.
- **Contamination/Isolation**: Not transport-touching. The separation-of-concerns test is the upstream
  guard that keeps the WS_09 contamination tests interpretable (no stray prompt injected here).

---

## Open Decisions — RESOLVED (2026-06-10 elevation)

> Both open decisions affecting this task are LOCKED. No row remains ⏳ OPEN. Formal dated decision blocks
> live in the workstream's Locked Decisions section.

- **[OD-1] `toolChoice` default — RESOLVED: pass through `undefined`.** The builder forwards `tool_choice`
  verbatim; the adapter's existing `?? 'auto'` (claude.ts L90) is the **sole** default. Honors WS_04-D1
  (no injection at the translation layer) and lets each Phase-2 adapter pick its own default. The
  contradictory `toolChoice:"auto"` Success Criterion is corrected. _(Rejected: inject `"auto"` here —
  duplicates the default across two layers and locks all future backends to the OpenAI default.)_

- **[OD-3] Source of `OpenAIChatRequest` — RESOLVED: hand-rolled Zod schema in `src/types.ts`.** A minimal
  schema for the Phase-1B fields (`model`, `messages`, `tools?`, `tool_choice?`, `stream?`); its inferred
  type is the builder's input and WS_05's parse target — a single source so the parser and the type cannot
  drift. _(Rejected: import the request-params type from `openai` — it is a type, not a runtime validator,
  so WS_05 would still need a separate Zod schema, risking drift.)_

---

## Contract: What This Task Inherits

| Symbol / Artifact            | Source                          | Role in This Task                                                      |
| ---------------------------- | ------------------------------- | --------------------------------------------------------------------- |
| `AdapterRequest`             | `src/types.ts` (WS_01 T3)       | Return type of `buildAdapterRequest`; fields `messages, tools?, toolChoice?` |
| `OpenAIMessage`              | `src/types.ts` (WS_01 T3)       | Element type of `messages` on both sides of the map                   |
| `OpenAITool`                 | `src/types.ts` (WS_01 T3)       | Element type of `tools` on both sides of the map                      |
| `OpenAIChatRequest`          | `src/types.ts` (**added here**) | Input type of `buildAdapterRequest` — does not exist yet (OD-3)       |
| `buildConstrainedPrompt`     | `src/adapters/claude.ts` (WS_02)| Reference for the `tools` normalization rule (`length > 0 ? tools : undefined`) and the `toolChoice ?? 'auto'` default — the builder must NOT duplicate the constraint, only mirror the normalization |

---

## Subtask Progress Table

| #   | Subtask                                                                                                                                   | Status        | Iteration | Notes |
| --- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------- | --------- | ----- |
| 1   | Add `OpenAIChatRequest` to `src/types.ts` as a hand-rolled Zod schema (OD-3 LOCKED) for `model`/`messages`/`tools?`/`tool_choice?`/`stream?`; export schema + inferred type. | ✅ Done | 1 of 1 | OD-3 resolved |
| 2   | Author `src/argumentBuilder.ts`: `buildAdapterRequest(body)` — map `messages`/`tools`/`tool_choice`; normalize `tools` (`[]`→`undefined`); pass `tool_choice` through verbatim (OD-1 LOCKED). | ✅ Done | 1 of 1 | OD-1 resolved (pass-through) |
| 3   | Write `tests/argumentBuilder.test.ts`: T-1 … T-5 (see Required Test Cases).                                                              | ✅ Done | 1 of 1 |       |
| 4   | Run green gate: `npm test`, `npm run typecheck`, `npm run lint`, `npm run format`; confirm no regression from 33-test baseline.          | ✅ Done | 1 of 1 | 43 tests (was 33); typecheck · lint · format clean |

_Status icons: `✅ Done` | `🔄 In progress` | `⬚ Not started` | `❌ Blocked`_

---

## Current Subtask Detail

### Subtask 2: Author `buildAdapterRequest`

**Approach iteration plan** (simplest → target):

1. Straight field copy: `{ messages: body.messages, tools: body.tools, toolChoice: body.tool_choice }`.
2. Add the `tools` normalization (`body.tools && body.tools.length > 0 ? body.tools : undefined`) so
   `[]` and `undefined` collapse to the same shape (A2).
3. Pass `toolChoice` through verbatim (OD-1 LOCKED: omitted → `undefined`; explicit value forwarded as-is).
   The adapter applies `?? 'auto'` — the builder never defaults.

- **Current iteration**: 1 of 3
- **Verifiability / Success Criteria**: SC-1, SC-2, SC-3, SC-4 (see below).
- **Challenges**: None blocking — OD-1 and OD-3 are resolved. Keep the builder a faithful mirror: no field
  the caller did not send.

---

## Decisions Made

### [WS_04-D1 inherited] — `argumentBuilder.ts` Is a Pure Function With No Constraint Injection ✅ LOCKED (Architect, 2026-06-08)

**Decision**: `buildAdapterRequest` maps OpenAI request fields to `AdapterRequest` fields one-for-one.
It does not append a system message, modify the `messages` array, or inject any text not present in the
caller's original request. The constraint is owned exclusively by `buildConstrainedPrompt` /
`--system-prompt` inside `src/adapters/claude.ts`.

**Rationale**: Transport-agnosticism (invariant #4). Injecting constraint text here would force
per-backend branching when Phase 2 adds Gemini.

**Rejected alternative — inject the constraint as a system message here**: Breaks transport-agnosticism;
the translation layer stops being a clean OpenAI→adapter mapping.

> **Tension resolved (OD-1, 2026-06-10):** WS_04-D1's "inject nothing" principle was in tension with the
> workstream Success Criteria's `toolChoice:"auto"` default. **Resolved in favour of WS_04-D1** — the
> builder passes `tool_choice` through; the adapter's `?? 'auto'` (claude.ts L90) is the sole default.

### [D2] — Anti-overengineering scope fence ✅ LOCKED

**This task explicitly does NOT include**:

- Constraint text / system-prompt logic — owned by `src/adapters/claude.ts` (WS_02/WS_03).
- Zod **parsing** of the incoming HTTP body — owned by `proxy.ts` (WS_05 T1). This task may *define* the
  `OpenAIChatRequest` schema/type, but the proxy does the parsing.
- `tool_call` / response-side concerns — `responseBuilder.ts` (T4) and WS_07.
- Any field beyond `messages`/`tools`/`tool_choice` (`temperature`, `n`, `stream`, …) — not supported in
  Phase 1B; dropped at the builder (EF3). `stream` is rejected in `proxy.ts` (D-1B-04).

---

## Cross-Task Contracts (Downstream Dependencies on This Task)

### WS_05 T2 (`proxy.ts`) and WS_06 will depend on:

- `buildAdapterRequest(body: OpenAIChatRequest): AdapterRequest` — a **pure** function: no I/O, no
  side effects, no module-level state. Consumers import it directly and must **not** mutate the returned
  object (the builder does not defensively clone).
- `OpenAIChatRequest` (the type/schema) — WS_05 T1 parses the HTTP body into this exact type. If WS_05
  needs a field this task did not include, that is a contract revision requiring a Decision Log entry.

---

## Files Modified / Created

- `src/argumentBuilder.ts` — **create new** (`buildAdapterRequest`).
- `src/types.ts` — **modify** (add `OpenAIChatRequest` schema/type; no change to existing exports).
- `tests/argumentBuilder.test.ts` — **create new** (T-1 … T-5).

---

## Success Criteria / Verifiability

| #    | Criterion                                                                                                                       | How to verify                                                          |
| ---- | ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| SC-1 | `buildAdapterRequest({ model, messages:[{role:"user",content:"Hi"}] })` returns `messages` exactly equal to the input messages, with no added system message and no constraint text | T-1 (deep-equal on `messages`; assert no element has constraint phrases) |
| SC-2 | `tools:[]` and `tools:undefined` produce deep-equal `AdapterRequest` objects                                                  | T-2                                                                    |
| SC-3 | Output object has no keys beyond `{ messages, tools?, toolChoice? }`                                                            | T-3 (`Object.keys` assertion)                                          |
| SC-4 | `toolChoice` passed through verbatim (OD-1): omitted `tool_choice` → `toolChoice: undefined`; explicit `"none"` → `toolChoice: "none"`; builder never injects `"auto"` | T-4                                                                    |
| SC-5 | `npm run typecheck` clean; builder return type assignable to `AdapterRequest`; no unused exports                              | `npx tsc --noEmit` → zero errors                                       |
| SC-6 | `npm run lint` clean; `npm run format` no diff                                                                                | Zero issues                                                            |
| SC-7 | Coverage 100% branch on `argumentBuilder.ts` (pure function)                                                                  | `npm run test:cov`                                                     |
| SC-8 | Zero regressions; no test-count drop from the 33-test baseline                                                                | `npm test` green                                                       |

---

## Required Test Cases

File: `tests/argumentBuilder.test.ts`

### T-1: messages pass through unmodified; no constraint text, no added system message (covers SC-1, A1)

Construct `buildAdapterRequest({ model:"claude-sonnet-4-6", messages:[{role:"user",content:"Hi"}] })`.
Assert the returned `messages` deep-equal the input. Assert no message contains constraint phrases
(`'API proxy'`, `'Return only the JSON object'` — the same phrases the WS_03 inverse-contract tests
guard). Assert no `system`-role message was added that was not in the input.

### T-2: `tools: []` ≡ `tools: undefined` (covers SC-2, A2, EF2)

Assert `buildAdapterRequest({model,messages,tools:[]})` deep-equals
`buildAdapterRequest({model,messages,tools:undefined})`. Both must have `tools` normalized identically.

### T-3: no extra keys leak into `AdapterRequest` (covers SC-3, EF3)

Pass a body carrying unsupported fields (e.g. `temperature`, `n`). Assert
`Object.keys(result).sort()` ⊆ `['messages','toolChoice','tools']` and that no unsupported field appears
on the returned object.

### T-4: `toolChoice` pass-through (covers SC-4, OD-1, EF1)

OD-1 LOCKED (pass-through): assert omitting `tool_choice` yields `toolChoice: undefined` (the builder
injects **no** `"auto"` default), and an explicit `tool_choice:"none"` is forwarded verbatim as
`toolChoice:"none"`. The `?? 'auto'` default is the adapter's responsibility (claude.ts L90), not the
builder's, and is out of scope for this test.

### T-5: multi-message conversation order preserved (covers SC-1)

Pass a 3-message conversation (`system`, `user`, `assistant`); assert order and content are preserved
1:1 in the output `messages`.

---

## Review Notes

**Architect review — 2026-06-11 — APPROVED WITH NOTES**

All locked decisions in scope for T1 confirmed: OD-1 (pass-through verbatim — `argumentBuilder.ts:8` injects nothing; `?? 'auto'` stays exclusively in `claude.ts:90`) and OD-3 (hand-rolled Zod schema — no `openai` import in `types.ts`). Four post-review notes implemented:

- **Note 2 (T1's own):** `tool_choice` tightened from `z.string()` to `z.enum(['auto','required','none'])` in `src/types.ts`. Correct per spec §3.5; `z.string()` was accepting arbitrary strings and forwarding them to `buildConstrainedPrompt` rather than failing loudly at the parse boundary. Tests still pass — T-4 uses `'none'` which is in the enum.
- **Note 3 (T1's downstream concern):** Object-form `tool_choice` gap documented in `ws07_tool_call_response_path.md` Known Pitfalls as a scope decision required before WS_07 begins.
- Notes 1 and 4 are T4-scope items.

Separation-of-concerns guard in T-1 confirmed load-bearing: structural check (no injected system message) is independent of phrase matching and catches any injection regardless of content. T-3's `as unknown as OpenAIChatRequest` cast is correct test technique — proves the builder is clean even if the Zod boundary is circumvented at runtime before `proxy.ts` validates. All 5 success criteria verified.

---

## Architect Sign-off

- [x] Implementation reviewed
- [x] All success criteria verified
- [x] All assumptions resolved (proven, or fallback taken & documented)
- [x] No regressions in full test suite
- [x] `npm test` / `typecheck` / `lint` / `format` all clean
