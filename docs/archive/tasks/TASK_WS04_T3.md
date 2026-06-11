# TASK_WS04_T3: Validator — Retry Loop (`validateWithRetry` orchestrator)

## Context

- **Workstream**: WS_04 (Argument Builder, Validator & Response Builder)
- **Plan reference**: `docs/plan/workstreams/ws04_translation_pipeline.md`
- **Phase plan**: `docs/plan/phases/01b_openai_translation_pipeline.md`
- **Depends on**: **T2 complete** — the pure `parseAndValidate(raw)` core exists in `src/validator.ts`;
  `ValidationError` in `src/errors.ts`; `OpenAIMessage` / `AdapterResponse` in `src/types.ts`. T3
  extends the **same file** T2 created, so it is strictly sequential after T2.
- **Blocks**: WS_05 T2 (`proxy.ts` wires `adapter.complete()` as the `invoker`), WS_06 (the no-tools
  E2E success path flows through the orchestrator), WS_08 (live forced-retry replaces the `invoker`
  with a controlled test double).
- **Governing decision**: **OD-5 — LOCKED, SPLIT (2026-06-10).** The retry loop is a thin orchestrator,
  `validateWithRetry`, wrapping T2's pure `parseAndValidate`; both live in `src/validator.ts`. This task
  owns the orchestrator only — it does **not** reimplement parse/validate.

---

## Goal & Why

- **Goal**: Extend `src/validator.ts` with `validateWithRetry` — the retry **policy** layered on top of
  T2's pure parse/validate **judgment**. On a `ValidationError` from `parseAndValidate`, it appends a
  **content-free** correction note to the caller's original `messages`, re-invokes the adapter through a
  supplied `invoker` callback to obtain a fresh `raw`, and re-validates — for a maximum of **3 total
  attempts**, after which it throws `ValidationError`. The loop is a bounded `for` loop with an explicit
  internal attempt counter (not recursion). **Only `ValidationError` triggers a retry**; any other
  throwable (e.g. a `TransportError` from the `invoker`) propagates immediately, unwrapped. The live
  forced-retry exercise against a real adapter is Phase 1C WS_08 (D-1B-02 / WS_04-D2); this task proves
  the loop's structure against synthetic `vi.fn()` doubles.

  **Locked signature (OD-5):**

  ```typescript
  function validateWithRetry(
    raw: string,
    messages: OpenAIMessage[],
    invoker: (messages: OpenAIMessage[]) => Promise<AdapterResponse>,
  ): Promise<QuotagateCompleteResult>;
  ```

  `raw` is attempt 1 (already produced by the caller's first `adapter.complete()`). `messages` is the
  caller's original conversation, owned here so the orchestrator can build the corrected array.
  `invoker` produces attempts 2…3. There is **no public `attempt` parameter** — the counter is internal
  to the `for` loop (this resolves the workstream's contradictory `attempt?`-threaded signature; see
  Decisions Made).

- **Why**: Validation answers one question — *is this model output valid?* (a pure, side-effect-free
  judgment, T2). Retry answers a different one — *what do we do when it is not?* (a policy: re-ask up to
  3×, then surface a hard failure). OD-5 keeps these as two functions so the bug-prone part (schema
  validation) stays purely testable and the policy part stays transport-agnostic. The `invoker` callback
  is the seam where the Phase 2 MCP transport will substitute in: WS_05 wires the subprocess adapter's
  `complete()`; Phase 2 passes an MCP-backed invoker; **neither `parseAndValidate` nor `validateWithRetry`
  changes** — this is the "subprocess-phase code must survive the MCP upgrade" mandate made literal. The
  correction note lives **inside** the orchestrator (not scattered into `proxy.ts`) so the
  contamination-safety logic sits beside the validation it guards. Getting the bound exact (3), the
  retry-trigger narrow (`ValidationError` only), and the note content-free is what lets WS_08 build the
  live forced-retry proof on a sound, deterministic base.

---

## Assumptions to Test

| #   | Assumption                                                                                                                       | Why we believe it                                                                                                                          | How this task tests it                                                                                                            | If false →                                                                                                              |
| --- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| A1  | **3 total attempts** (initial `raw` + 2 `invoker` retries) is the correct bound                                                  | WS_04-D2 locks "max-3 termination"; the workstream SC says "throws after exactly 3 attempts" and "malformed-then-good resolves on attempt 2" | T-2 (resolves on attempt 2 → 1 invoker call); T-3 (3 malformed → throw after exactly 3 `parseAndValidate` calls / 2 invoker calls) | If a different bound is needed: change the single `MAX_ATTEMPTS` const and the two assertions — the loop shape is unchanged |
| A2  | Rebuilding the retry messages as `[...originalMessages, correctionNote]` **each attempt** (single note, never accumulated) is the right stimulus | WS_04-D3 (content-free note); a single note keeps `messages.length + 1` stable and avoids stateful note pile-up across attempts (invariant #10) | T-4 asserts the `invoker` receives exactly `messages.length + 1` messages on every retry, last role `"user"`                      | If the model needs the prior note retained: that would be stateful — re-open WS_04-D3 before changing; default stays single-note |
| A3  | **Only `ValidationError` triggers a retry**; any other throwable from `invoker` (e.g. `TransportError`) propagates immediately   | A transport/spawn failure is not a model-format failure; retrying a dead subprocess adds latency and masks the real error (Engineering Integrity: honest failure) | T-5: an `invoker` that throws `TransportError` propagates it unwrapped, with **no** further retry and **no** `ValidationError` wrap | If transport errors should also retry: that is a separate backoff policy, out of scope here — document and defer        |
| A4  | A schema-valid `{type:"tool_call"}` on attempt 1 is a **success** for the orchestrator (no retry), per OD-7                       | `parseAndValidate` returns a schema-valid `tool_call` faithfully (OD-7); the orchestrator only retries on `ValidationError`, which this is not | T-6: a `tool_call` `raw` resolves to the parsed result, `invoker` never called                                                   | If `tool_call` should retry: it should not — it is valid output; rejection is `responseBuilder`'s job (OD-7/WS_04-D4)   |

---

## Expected Failures

- **[EF1]** Attempt 1's `raw` is already valid → `validateWithRetry` returns immediately and **never calls
  the `invoker`** (0 retries). This is the common WS_06 hot path — a well-formed response still flows
  through the orchestrator, so the zero-retry path must be correct and allocation-cheap.
- **[EF2]** Malformed attempt 1, valid attempt 2 → `invoker` called **once** with `messages.length + 1`
  messages; resolves to the attempt-2 result.
- **[EF3]** Three consecutive malformed responses → `ValidationError` thrown after **exactly 3** attempts
  (3 `parseAndValidate` calls; `invoker` called **exactly twice**). The thrown error is a
  `ValidationError`, content-free (it does not embed any of the three malformed payloads).
- **[EF4]** `invoker` itself rejects with `TransportError` (subprocess spawn failed mid-retry). The error
  **propagates immediately**, unwrapped — it is **not** caught, **not** retried, and **not** re-thrown as
  `ValidationError`. The proxy maps the `TransportError` to its 500 (D-1B error-handling).
- **[EF5]** A schema-valid `{type:"tool_call"}` on attempt 1. `parseAndValidate` returns it faithfully
  (OD-7) → the orchestrator returns it with **no** retry. The orchestrator never inspects the result's
  `type`; rejection of the unsupported branch is `responseBuilder`'s single loud boundary (WS_04-D4),
  not the retry loop's.
- **[EF6]** The correction note must **never** echo or reference the malformed prior response (WS_04-D3 /
  invariant #10). Echoing it would carry prior-turn content into the retry's message array — a stateful
  contamination vector. The note is a formatting nudge only.

---

## Test Strategy

- **Unit**: `tests/validator.test.ts` — the retry subset (T2 owns the no-retry success/failure cases).
  Each case constructs a **fresh** `vi.fn()` `invoker` double (never shared across cases — stale call
  counts would break the attempt-count assertions). The double is scripted to return malformed/good
  `AdapterResponse` objects per attempt, or to throw. No real subprocess, no real adapter.
- **Integration**: None here. The orchestrator runs on the live success path in WS_06 (0-retry); the
  **forced** live-retry proof (real adapter coerced to retry, plus the retry-path contamination check) is
  Phase 1C WS_08, which substitutes a controlled double per D-1C-02.
- **Contract**: The orchestrator's only outcomes are (a) a typed `QuotagateCompleteResult`, or (b) a
  thrown `ValidationError` (on retry exhaustion) / a propagated non-`ValidationError` (on transport
  failure). It never returns a partial or "close-enough" object.
- **Contamination/Isolation**: T-4 is the structural contamination guard — it asserts the correction note
  is content-free (does not contain the malformed-fixture sentinel). This is the unit-level counterpart to
  WS_08's live retry-path contamination proof.

---

## Open Decisions for User

> **None.** All WS_04 open decisions were resolved in the 2026-06-10 elevation. The two that shape this
> task — **OD-5** (split: orchestrator wraps the pure core) and **WS_04-D3** (correction note is
> content-free) — are recorded under **Decisions Made** below. No row in this tracker is ⏳ OPEN.

---

## Contract: What This Task Inherits

| Symbol / Artifact         | Source                          | Role in This Task                                                                                       |
| ------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `parseAndValidate(raw)`   | `src/validator.ts` (**T2**)     | The pure parse-or-throw core the orchestrator calls each attempt — **not** reimplemented here          |
| `ValidationError`         | `src/errors.ts` (WS_01 T4)      | The **only** throwable that triggers a retry; also the exhaustion failure thrown after 3 attempts      |
| `OpenAIMessage`           | `src/types.ts` (WS_01 T3)       | Element of the `messages` array; the correction note is one `{role:"user", content}` `OpenAIMessage`   |
| `AdapterResponse`         | `src/types.ts` (WS_01 T3)       | Return type of the `invoker`; the orchestrator reads `.raw` from each retry response                   |
| `QuotagateCompleteResult` | `src/types.ts` (WS_01 T3)       | Resolved return type on success (text **or** tool_call arm — see OD-7 / A4)                             |

---

## Subtask Progress Table

| #   | Subtask                                                                                                                                        | Status        | Iteration | Notes |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | --------- | ----- |
| 1   | Add the stable, content-free `CORRECTION_NOTE` module constant to `src/validator.ts` (WS_04-D3 template).                                     | ⬚ Not started | —         | Wording must stay stable — WS_08's test asserts its structure |
| 2   | Author `validateWithRetry(raw, messages, invoker)`: `for` loop, attempts 1…`MAX_ATTEMPTS` (3); retry **only** on `ValidationError`; rebuild `[...messages, CORRECTION_NOTE]` each retry; throw `ValidationError` on exhaustion. | ⬚ Not started | —         | Wraps T2's `parseAndValidate`; non-`ValidationError` propagates |
| 3   | Write the retry subset of `tests/validator.test.ts`: T-1 … T-6 (see Required Test Cases) with fresh `vi.fn()` per case.                        | ⬚ Not started | —         |       |
| 4   | Run green gate: `npm test`, `npm run typecheck`, `npm run lint`, `npm run format`; confirm no test-count drop from the 33-test baseline.       | ⬚ Not started | —         |       |

_Status icons: `✅ Done` | `🔄 In progress` | `⬚ Not started` | `❌ Blocked`_

---

## Current Subtask Detail

### Subtask 2: Author `validateWithRetry`

**Approach iteration plan** (simplest → target):

1. Bounded loop calling the pure core, no retry stimulus yet:
   ```
   const MAX_ATTEMPTS = 3;
   let currentRaw = raw;
   for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
     try {
       return parseAndValidate(currentRaw);
     } catch (err) {
       if (!(err instanceof ValidationError)) throw err;   // A3: only validation failures retry
       if (attempt === MAX_ATTEMPTS) throw err;            // A1: exhausted → surface the failure
       const corrected = [...messages, CORRECTION_NOTE];   // A2: single note, rebuilt from original
       currentRaw = (await invoker(corrected)).raw;        // OD-5 seam: transport behind the callback
     }
   }
   ```
2. Confirm the `instanceof ValidationError` guard lets `TransportError` (and any non-validation throwable)
   escape unwrapped (EF4 / A3). Do **not** add a `catch (err) { throw new ValidationError(...) }` blanket —
   that would mask transport failures as validation failures, the exact "cheap fix" the Engineering
   Integrity bar forbids.
3. Confirm the correction array is rebuilt from the **original** `messages` each retry (single note,
   never accumulated — A2), and that `CORRECTION_NOTE` is content-free (EF6 / WS_04-D3).

- **Current iteration**: 1 of 3
- **Verifiability / Success Criteria**: SC-1 … SC-7.
- **Challenges**: The retry-trigger narrowness (A3) is the subtle correctness point — a broad
  `catch`-and-wrap would pass the malformed-then-good tests while silently breaking the transport-error
  contract. T-5 exists specifically to catch that regression.

---

## Decisions Made

### [WS_04-D2 inherited] — Retry Loop Written and Unit-Tested in WS_04; Live Exercise Is Phase 1C ✅ LOCKED (Architect, 2026-06-08)

**Decision**: The retry loop (attempt counter, re-invoke via `invoker` with a correction note, max-3
termination, `ValidationError` on exhaustion) is fully written and unit-tested against synthetic
`vi.fn()` doubles in WS_04 T3. The **live** forced-retry path (real adapter coerced into a retry, plus
the retry-path contamination proof) is Phase 1C WS_08.

**Rationale**: A live forced-retry test is non-deterministic from the model and belongs with the
controlled test double mandated for 1C (D-1C-02). The structural loop, however, must exist now so WS_05
can wire the success path and WS_06 can run.

**Rejected alternative — defer the whole retry loop to WS_08**: WS_05 needs `validateWithRetry` present to
wire the proxy's request path; deferring it blocks WS_05/WS_06.

### [OD-5 resolution] — SPLIT: `validateWithRetry` wraps the pure `parseAndValidate` ✅ LOCKED (User, 2026-06-10)

**Decision**: The validator is two functions in `src/validator.ts`: a pure `parseAndValidate(raw):
QuotagateCompleteResult` (T2 — no I/O, no adapter knowledge) and a thin orchestrator `validateWithRetry(raw,
messages, invoker)` (T3) that wraps it with the attempt loop. The retry loop does **not** reimplement
parse/validate; it calls the pure core each attempt. There is **no public `attempt` parameter** — the
counter is internal to the `for` loop.

**Rationale**: Single-responsibility at the precise seam where the Phase 2 MCP transport substitutes in
(the `invoker` becomes an MCP-backed callback; neither function changes). The bug-prone schema validation
stays purely testable with zero mocks; the retry policy stays transport-agnostic and reusable. Keeping the
correction-note logic inside the orchestrator (not in `proxy.ts`) keeps contamination-safety beside the
validation it guards. This also resolves the workstream's contradictory `validate()` signature (two forms,
one with `invoker:()=>…` and one with `invoker:(correctionMessages)=>…`, plus a threaded `attempt?`): the
single coherent shape is the pure `parseAndValidate(raw)` plus `validateWithRetry(raw, messages, invoker)`.

**Rejected alternative — single `validate(raw, invoker, attempt)` with the loop inline (the workstream's
original lock)**: Fuses parse/validate to re-invocation, so the pure path cannot be tested in isolation,
and leaks the `attempt` counter into the public signature.

**Rejected alternative — retry orchestrated in `proxy.ts`**: Overloads the HTTP layer with retry policy
and the correction-note contamination logic, and makes the policy unreusable outside HTTP.

### [WS_04-D3 inherited] — Correction Note Carries Formatting Instruction Only; No Prior-Turn Content ✅ LOCKED (Architect, 2026-06-08)

**Decision**: The correction note appended on retry is a **formatting instruction only** — it does **not**
echo or reference any content from the malformed prior response. The stable template (a single
`{role:"user", content}` message), kept verbatim because WS_08's contamination test asserts its structure:

> `The previous response was not valid JSON or did not match the required schema. Please respond with a
> single raw JSON object in one of these forms: {"type":"text","content":"<string>"} or
> {"type":"tool_call","name":"<string>","arguments":{...}}`

**Rationale**: Echoing prior-turn content would carry session context into the retry attempt, violating
invariant #10 ("persist the process, never the conversation"). The note is a formatting nudge, not a
history entry — keeping it content-free keeps the retry path as clean as the initial path.

**Rejected alternative — echo the malformed response ("your last output was: …")**: Introduces prior-turn
content into the retry's message array — a contamination vector the project's invariants forbid.

### [D2] — Anti-overengineering scope fence ✅ LOCKED

**This task explicitly does NOT include**:

- The pure `parseAndValidate` core — owned by **T2**; T3 calls it, never reimplements it.
- Markdown-fence stripping or output normalization — out of scope (OD-6); fenced output fails
  `parseAndValidate` → `ValidationError` → retry. Normalizing would mask a constraint regression.
- Exponential backoff, jitter, or transport-error retry — **only** `ValidationError` retries (A3); a
  transport backoff policy is a separate, deferred concern.
- Live / forced retry against a real adapter — Phase 1C WS_08 (D-1B-02).
- Any reach-through to the adapter from inside the validator — the validator imports no adapter; the
  `invoker` callback is the only door (OD-5 seam).
- Rejection of the unsupported `{type:"tool_call"}` branch — that is `responseBuilder`'s single boundary
  (OD-7 / WS_04-D4); the orchestrator returns a schema-valid `tool_call` faithfully (A4 / EF5).

---

## Cross-Task Contracts (Downstream Dependencies on This Task)

### WS_05 T2 (`proxy.ts`) will depend on:

- `validateWithRetry(raw, messages, invoker)` returning a typed `QuotagateCompleteResult` on success and
  throwing `ValidationError` on retry exhaustion (non-`ValidationError` throwables propagate unwrapped).
  WS_05 wires the `invoker` as `(msgs) => adapter.complete(buildAdapterRequest({ ...body, messages: msgs }))`
  — re-running the full build+complete with the corrected messages. Consumers must not bypass the
  orchestrator to read `AdapterResponse.raw` directly.

### WS_08 will depend on:

- The `invoker` being a plain injected callback — WS_08 substitutes a `vi.fn()` double for the
  retry-exhaustion and retry-path contamination proofs (D-1C-02). The stable `CORRECTION_NOTE` wording is
  part of this contract: WS_08's contamination test asserts its content-free structure, so the wording
  must not change after WS_08 is written.

---

## Files Modified / Created

- `src/validator.ts` — **modify** (add `CORRECTION_NOTE` const + `validateWithRetry`; T2 created the file
  with `parseAndValidate`).
- `tests/validator.test.ts` — **modify** (add the retry subset T-1 … T-6; T2 created the success-path
  subset).

---

## Success Criteria / Verifiability

| #    | Criterion                                                                                                                               | How to verify                                                          |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| SC-1 | A valid attempt-1 `raw` resolves **without** calling the `invoker` (0 retries)                                                          | T-1 (`invoker` call count === 0)                                       |
| SC-2 | Malformed attempt 1, good attempt 2 resolves to the attempt-2 result after exactly one `invoker` call                                  | T-2                                                                    |
| SC-3 | Three consecutive malformed responses throw `ValidationError` after **exactly 3** attempts (`invoker` called **exactly twice**)        | T-3 (`instanceof ValidationError`; assert `invoker` call count === 2)  |
| SC-4 | On retry, the `invoker` receives `messages.length + 1` messages, the appended message has `role:"user"`                                 | T-4                                                                    |
| SC-5 | The correction note is **content-free** — it does not contain the malformed fixture's sentinel substring (WS_04-D3 contamination guard) | T-4 (assert the appended message content excludes the sentinel)        |
| SC-6 | A non-`ValidationError` from the `invoker` (`TransportError`) **propagates unwrapped** — no retry, no `ValidationError` wrap            | T-5 (`instanceof TransportError`; `invoker` called exactly once)       |
| SC-7 | A schema-valid `{type:"tool_call"}` attempt-1 `raw` resolves faithfully to the parsed result with **no** retry (OD-7 / A4)             | T-6 (`invoker` call count === 0; result `type === "tool_call"`)        |
| SC-8 | `npm run typecheck` clean (no `any`); `npm run lint` clean; `npm run format` no diff                                                   | Zero issues                                                            |
| SC-9 | Coverage: the retry branches (success-on-1, retry-then-good, exhaustion, transport-escape) fully covered                               | `npm run test:cov`                                                     |
| SC-10| Zero regressions; no test-count drop from the 33-test baseline (new unit tests added)                                                   | `npm test` green                                                       |

---

## Required Test Cases

File: `tests/validator.test.ts` (retry subset; T2 owns the success-path subset). **Fresh `vi.fn()`
`invoker` per case.**

### T-1: success on attempt 1, invoker never called (covers SC-1, EF1)

`invoker = vi.fn()`. Call `validateWithRetry('{"type":"text","content":"Hi"}', messages, invoker)`. Assert
the resolved value is `{type:"text",content:"Hi"}` and `invoker` was **not** called.

### T-2: malformed-then-good resolves on attempt 2 (covers SC-2, EF2)

`invoker` returns `{raw:'{"type":"text","content":"ok"}', backend:'claude-subprocess'}` once. Call with a
malformed attempt-1 `raw`. Assert it resolves to `{type:"text",content:"ok"}` and `invoker` was called
**exactly once** with `messages.length + 1` messages.

### T-3: three malformed → `ValidationError` after exactly 3 attempts (covers SC-3, EF3)

`invoker` returns malformed `raw` on every call. Call with a malformed attempt-1 `raw`. Assert it rejects
with `instanceof ValidationError`, `invoker` was called **exactly twice** (attempts 2 and 3), and the
thrown message contains none of the three malformed payloads.

### T-4: correction-note structure is correct **and content-free** (covers SC-4, SC-5, EF6)

Use a malformed attempt-1 `raw` carrying a distinctive sentinel substring; `invoker` returns good on
attempt 2. Inspect the messages the `invoker` received: assert length === `messages.length + 1`, the last
message has `role:"user"`, and its `content` does **not** contain the sentinel (proving the malformed
prior turn is not echoed — WS_04-D3 / invariant #10).

### T-5: transport error propagates, not retried, not wrapped (covers SC-6, EF4, A3)

`invoker = vi.fn().mockRejectedValue(new TransportError('spawn failed'))`. Call with a malformed attempt-1
`raw`. Assert the rejection is `instanceof TransportError` (NOT `ValidationError`) and `invoker` was called
**exactly once** (no further retry after a transport failure).

### T-6: schema-valid tool_call resolves without retry (covers SC-7, EF5, A4 / OD-7)

`invoker = vi.fn()`. Call with attempt-1 `raw` =
`'{"type":"tool_call","name":"get_weather","arguments":{"city":"Accra"}}'`. Assert it resolves to the
parsed `tool_call` result, and `invoker` was **not** called (a schema-valid result is a success, not a
retry trigger; rejection of the unsupported branch is `responseBuilder`'s job).

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
