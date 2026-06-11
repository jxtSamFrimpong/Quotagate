# TASK_WS04_T2: Validator — Parse & Validate (success path)

## Context

- **Workstream**: WS_04 (Argument Builder, Validator & Response Builder)
- **Plan reference**: `docs/plan/workstreams/ws04_translation_pipeline.md`
- **Phase plan**: `docs/plan/phases/01b_openai_translation_pipeline.md`
- **Depends on**: WS_03 signed off — `QuotagateCompleteResultSchema` + `QuotagateCompleteResult` stable
  in `src/types.ts`; `ValidationError` in `src/errors.ts`.
- **Blocks**: T3 (extends the same file with the retry loop), WS_05 T2, WS_06.
- **Resolved decision**: **OD-5 (the validate-seam fork) — LOCKED, SPLIT (2026-06-10).** T2 ships the
  pure `parseAndValidate(raw): QuotagateCompleteResult` core (no `invoker`, no `attempt`, no adapter
  knowledge). The retry orchestrator `validateWithRetry` is **T3**. No row in this tracker is ⏳ OPEN.

---

## Goal & Why

- **Goal**: Author the pure parse-and-validate core of `src/validator.ts` —
  `parseAndValidate(raw: string): QuotagateCompleteResult` (OD-5 LOCKED). It takes the raw string returned
  by `adapter.complete()` (`AdapterResponse.raw`), parses it as JSON, validates it against
  `QuotagateCompleteResultSchema` (the `{type:"text"}` arm is exercised this phase), and **returns** the
  parsed `QuotagateCompleteResult` on success or **throws** `ValidationError` on failure (malformed JSON,
  wrong/absent `type`, missing `content`). It is pure — no I/O, no `invoker`, no adapter knowledge. The
  retry loop (`validateWithRetry`) is **added in T3** as a thin orchestrator around this core; T2 proves
  the single-shot parse/validate path.

- **Why**: The validator is the seam where "trust nothing from the model un-validated" (CLAUDE.md,
  "Validation at the seams") is enforced. The raw subprocess output is untrusted text; the validator is
  what converts it into a typed `QuotagateCompleteResult` the response builder can rely on. It sits in
  the **hot path of the WS_06 no-tools integration test** — a well-formed response still flows through it
  — so it cannot be deferred wholesale to Phase 1C (that is exactly the D-1B-02 / WS_04-D2 reasoning).
  Getting the success path and the three failure modes (bad JSON, wrong type, missing field) exactly
  right, with `ValidationError` as the single honest failure signal, is what lets the retry loop (T3) and
  the live retry exercise (Phase 1C WS_08) build on a sound base. A validator that returned a "close
  enough" object on partial input would corrupt the output contract silently — the opposite of the
  Engineering Integrity bar.

---

## Assumptions to Test

| #   | Assumption                                                                                                          | Why we believe it                                                                                                                | How this task tests it                                                                                          | If false →                                                                                                                |
| --- | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| A1  | `adapter.complete()` returns `raw` that is a bare JSON object string (no markdown fences, no prose) on the success path | WS_03 proved this against the real subscription (constraint via `--system-prompt`); T-I1/T-I3 Zod-parse `raw` directly today     | T-1 parses a bare-JSON text fixture and asserts `{type:"text",content:...}`                                     | If fences/prose appear: that is a *constraint* failure (adapter layer) surfaced as a `ValidationError` → retry (T3). The validator does NOT strip fences (see OD-6) |
| A2  | A single `JSON.parse` + one `safeParse` against `QuotagateCompleteResultSchema` is the complete validation needed   | The schema is the contract (spec §3.5); both arms (`text`, `tool_call`) are already encoded in `QuotagateCompleteResultSchema`   | T-1 … T-4 cover valid-text, malformed-JSON, wrong-type, missing-content against that one schema                 | If extra validation is needed: it is not here — OD-7 LOCKED routes the unsupported `tool_call` rejection to `responseBuilder`, not the validator |
| A3  | `JSON.parse` failure and Zod `safeParse` failure should both surface as the **same** `ValidationError` type         | Both are "the model's output did not meet the contract"; one failure type keeps the retry trigger (T3) and proxy mapping simple  | T-2 (malformed JSON) and T-3/T-4 (schema failures) all assert `instanceof ValidationError`                     | If they must differ: document why; but a single failure class is the simpler, honest signal for "output invalid"          |

---

## Expected Failures

- **[EF1]** `raw` is not valid JSON (`JSON.parse` throws `SyntaxError`). The validator must catch the
  `SyntaxError` and throw `ValidationError` — it must NOT let a raw `SyntaxError` escape (the proxy maps
  `QuotagateError` subclasses, not arbitrary throwables, D-1B error-handling). Caught here, retried in T3.
- **[EF2]** `raw` parses to JSON but fails the schema — e.g. `{"type":"image",...}` (unknown
  discriminant), `{"type":"text"}` (missing `content`), `{"content":"hi"}` (missing `type`). All → one
  `ValidationError`.
- **[EF3]** `raw` is `{"type":"tool_call","name":"f","arguments":{}}` — **valid** against the schema (the
  `tool_call` arm parses successfully). **OD-7 LOCKED (2026-06-10): the validator returns the parsed
  `tool_call` faithfully** (it IS schema-valid; rejecting schema-valid output here would be dishonest) and
  `responseBuilder.buildChatCompletion` is the **single, loud rejection point** for the unsupported branch
  this phase (throws `QuotagateError`, WS_04-D4). Rejecting in both places would be redundant and risk two
  error types for one condition. T-5 asserts this fixture **resolves** to the parsed result, not a throw.
- **[EF4]** `raw` is an empty string or whitespace (subprocess returned nothing on a non-zero exit that
  still resolved — see claude.ts L124 path). `JSON.parse("")` throws → `ValidationError` (EF1 path).
  Confirm whitespace-only `raw` does not slip through as valid.
- **[EF5]** `raw` contains a valid JSON object wrapped in markdown fences (` ```json … ``` `). Under the
  `--system-prompt` constraint WS_03 showed this is rare, but not impossible at temperature. The
  validator does **not** strip fences (OD-6) — fenced output fails `JSON.parse` → `ValidationError` →
  retry (T3). Stripping/normalizing is explicitly out of scope (it would mask a constraint regression).

---

## Test Strategy

- **Unit**: `tests/validator.test.ts` — pure parse/validate tests over string fixtures. No subprocess,
  no adapter, no mocks for the success-path cases (T2 owns the no-retry cases; T3 adds the `vi.fn()`
  invoker cases). Each case constructs a `raw` string and asserts the resolved value or the thrown
  `ValidationError`.
- **Integration**: None here. The validator runs in the live path in WS_06; the forced-retry live
  exercise is Phase 1C WS_08.
- **Contract**: The assertion target is `QuotagateCompleteResultSchema` — the spec §3.5 contract. A
  resolved value must be a typed `QuotagateCompleteResult`; a failure must be a `ValidationError`
  (`instanceof`), never a leaked `SyntaxError` or a `ZodError`.
- **Contamination/Isolation**: N/A for the success path. The retry-path isolation proof is T3 (structure)
  + WS_08 (live).

---

## Open Decisions — RESOLVED (2026-06-10 elevation)

> Both decisions shaping this task's signature and rejection seam are LOCKED. No row remains ⏳ OPEN.
> Formal dated decision blocks live in the workstream's Locked Decisions section.

- **[OD-5] Validate-seam fork — RESOLVED: SPLIT.** A pure `parseAndValidate(raw): QuotagateCompleteResult`
  in `validator.ts` (this task) + a separate `validateWithRetry` orchestrator (T3), also in
  `validator.ts`. **T2's public export is `parseAndValidate(raw)`** — no `invoker`, no `attempt`. This
  resolves the workstream's contradictory `validate()` signature (it was written two ways) into one
  coherent shape. _(Rejected: single inline `validate(raw, invoker, attempt)` — fuses parse/validate to
  re-invocation, untestable in isolation. Rejected: retry in `proxy.ts` — overloads the HTTP layer.)_

- **[OD-7] Unsupported `{type:"tool_call"}` rejection seam — RESOLVED: in `responseBuilder`, not the
  validator.** `parseAndValidate` returns a schema-valid `tool_call` faithfully;
  `responseBuilder.buildChatCompletion` is the single loud rejection point (throws `QuotagateError`,
  WS_04-D4). _(Rejected: reject in the validator — rejecting schema-valid output is dishonest, and two
  components rejecting one condition risks divergent error types.)_

---

## Contract: What This Task Inherits

| Symbol / Artifact                | Source                       | Role in This Task                                                          |
| -------------------------------- | ---------------------------- | ------------------------------------------------------------------------- |
| `QuotagateCompleteResultSchema`  | `src/types.ts` (WS_01 T3)    | The Zod schema validated against; both arms encoded, `text` exercised here |
| `QuotagateCompleteResult`        | `src/types.ts` (WS_01 T3)    | Resolved return type on success                                           |
| `ValidationError`                | `src/errors.ts` (WS_01 T4)   | The single failure type for bad JSON or schema mismatch                   |
| `AdapterResponse`                | `src/types.ts` (WS_01 T3)    | Source of `raw`; `parseAndValidate` consumes only the `raw` string, not the whole response (the `invoker` returning `AdapterResponse` belongs to T3's `validateWithRetry`) |

---

## Subtask Progress Table

| #   | Subtask                                                                                                                | Status        | Iteration | Notes |
| --- | -------------------------------------------------------------------------------------------------------------------- | ------------- | --------- | ----- |
| 1   | Author `parseAndValidate(raw): QuotagateCompleteResult` in `src/validator.ts`: `JSON.parse` (catch `SyntaxError`→`ValidationError`) + `safeParse` → return or throw `ValidationError`. | ⬚ Not started | —         | OD-5 resolved (pure core; export `parseAndValidate`) |
| 2   | Confirm `tool_call` is returned faithfully (OD-7 LOCKED): no rejection in the validator; `responseBuilder` is the single rejection point. | ⬚ Not started | —         | OD-7 resolved |
| 3   | Write `tests/validator.test.ts` success-path cases: T-1 … T-5 (see Required Test Cases).                              | ⬚ Not started | —         | Retry cases are T3 |
| 4   | Run green gate; confirm no regression from the 33-test baseline.                                                       | ⬚ Not started | —         |       |

_Status icons: `✅ Done` | `🔄 In progress` | `⬚ Not started` | `❌ Blocked`_

---

## Current Subtask Detail

### Subtask 1: Parse-and-validate core

**Approach iteration plan** (simplest → target):

1. `let parsed; try { parsed = JSON.parse(raw); } catch { throw new ValidationError("…not valid JSON"); }`
2. `const r = QuotagateCompleteResultSchema.safeParse(parsed); if (!r.success) throw new ValidationError("…schema mismatch"); return r.data;`
3. Export the core as the public `parseAndValidate(raw): QuotagateCompleteResult` (OD-5 LOCKED: pure core;
   T3's `validateWithRetry` wraps it). The parse/validate body above is the whole of this function — no
   wrapper, no `invoker`, no `attempt`.

- **Current iteration**: 1 of 3
- **Verifiability / Success Criteria**: SC-1 … SC-4.
- **Challenges**: Keep error messages descriptive but **content-free** — do NOT echo `raw` into the
  `ValidationError` message (that would seed the T3 correction note with prior-turn content, the WS_04-D3
  contamination concern). The message states *that* parsing/validation failed, not *what* the model said.

---

## Decisions Made

### [WS_04-D2 inherited] — Validator Written and Unit-Tested in WS_04; Live Exercise Is Phase 1C ✅ LOCKED (Architect, 2026-06-08)

**Decision**: The validator (success path here in T2; retry loop in T3) is fully written and
unit-tested against synthetic fixtures in WS_04. The live forced-retry path (real adapter response,
retry-path contamination proof) is Phase 1C WS_08.

**Rationale**: The validator is in the hot path of the WS_06 no-tools integration test — a well-formed
response still flows through it — so deferring it wholesale to 1C would block WS_06. A live forced-retry
test is non-deterministic and belongs with the controlled test double mandated for 1C.

**Rejected alternative — defer all of `validator.ts` to WS_08**: Blocks WS_06, which needs the validator
present on the success path.

### [D2] — Anti-overengineering scope fence ✅ LOCKED

**This task explicitly does NOT include**:

- The retry loop (attempt counter, re-invoke, max-3, `ValidationError` on exhaustion) — **T3** owns it.
- Markdown-fence stripping or any output normalization — out of scope (OD-6); fenced output fails
  parsing → `ValidationError` → retry. Normalizing would mask a constraint regression.
- Building the OpenAI response — `responseBuilder.ts` (T4).
- Live/forced retry against a real adapter — Phase 1C WS_08.
- Any reach-through to the adapter from inside the validator (Known Pitfalls) — the validator does not
  import or construct an adapter.

---

## Cross-Task Contracts (Downstream Dependencies on This Task)

### T3 will depend on:

- `parseAndValidate(raw)` — the pure core that turns one `raw` string into `QuotagateCompleteResult` or
  throws `ValidationError`. T3's `validateWithRetry` wraps this in the retry loop; it must **not**
  reimplement the parse logic.

### WS_05 T2 / WS_06 will depend on:

- `parseAndValidate(raw)` returning a typed `QuotagateCompleteResult` on success and throwing
  `ValidationError` on invalid output — the only two outcomes. (WS_05 calls it through T3's
  `validateWithRetry`, the retry-aware entry point.) Consumers must not bypass it to read
  `AdapterResponse.raw` directly.

---

## Files Modified / Created

- `src/validator.ts` — **create new** (parse-and-validate core; T3 extends with the retry loop).
- `tests/validator.test.ts` — **create new** (success-path cases T-1 … T-5; T3 adds retry cases).

---

## Success Criteria / Verifiability

| #    | Criterion                                                                                                      | How to verify                                                          |
| ---- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| SC-1 | A valid text fixture `'{"type":"text","content":"Hello"}'` resolves/returns `{type:"text",content:"Hello"}`   | T-1                                                                    |
| SC-2 | `'not json'` throws `ValidationError` (not a raw `SyntaxError`)                                               | T-2 (`instanceof ValidationError`)                                     |
| SC-3 | `'{"type":"image","content":"x"}'` (unknown discriminant) throws `ValidationError`                           | T-3                                                                    |
| SC-4 | `'{"type":"text"}'` (missing `content`) throws `ValidationError`                                              | T-4                                                                    |
| SC-5 | A schema-valid `{type:"tool_call"}` `raw` **resolves** to the parsed `tool_call` result (OD-7: validator does not reject; `responseBuilder` is the rejection point) | T-5                                                                    |
| SC-6 | The `ValidationError` message is content-free (does not embed `raw` / model output)                          | T-6 (assert `err.message` does not contain the malformed fixture text) |
| SC-7 | `npm run typecheck` clean; no unused exports; no `any` (use `unknown` + Zod narrowing)                        | Zero errors                                                            |
| SC-8 | `npm run lint` clean; `npm run format` no diff                                                                | Zero issues                                                            |
| SC-9 | Zero regressions; no test-count drop from the 33-test baseline                                                | `npm test` green                                                       |

---

## Required Test Cases

File: `tests/validator.test.ts` (success-path subset; T3 adds the retry subset)

### T-1: valid text fixture resolves (covers SC-1, A1)

Input `'{"type":"text","content":"Hello"}'`; assert the resolved value deep-equals
`{type:"text",content:"Hello"}`.

### T-2: malformed JSON throws `ValidationError` (covers SC-2, EF1)

Input `'not json'`; assert it throws and the thrown value is `instanceof ValidationError` (and NOT a raw
`SyntaxError`).

### T-3: unknown discriminant throws `ValidationError` (covers SC-3, EF2)

Input `'{"type":"image","content":"x"}'`; assert `ValidationError`.

### T-4: missing required field throws `ValidationError` (covers SC-4, EF2)

Input `'{"type":"text"}'` (no `content`); assert `ValidationError`. Add a second case `'{"content":"hi"}'`
(no `type`) → `ValidationError`.

### T-5: schema-valid `tool_call` resolves faithfully (covers SC-5, EF3, OD-7)

Input `'{"type":"tool_call","name":"get_weather","arguments":{"city":"Accra"}}'`. OD-7 LOCKED: assert
`parseAndValidate` **resolves** to `{type:"tool_call",name:"get_weather",arguments:{city:"Accra"}}` (it
does NOT throw — the value is schema-valid). The unsupported-branch rejection is `responseBuilder`'s job
(T4), proven there.

### T-6: `ValidationError` message is content-free (covers SC-6; WS_04-D3 contamination guard)

Input a malformed fixture containing a distinctive sentinel substring; assert the thrown
`ValidationError.message` does **not** contain that sentinel — proving model output is not echoed into the
error (which would otherwise leak into the T3 correction note).

---

## Review Notes

_(Architect fills after BSE submits.)_

---

## Architect Sign-off

- [ ] Implementation reviewed
- [ ] All success criteria verified
- [ ] All assumptions resolved (proven, or fallback taken & documented)
- [ ] No regressions in full test suite
- [ ] `npm test` / `typecheck` / `lint` / `format` all clean
