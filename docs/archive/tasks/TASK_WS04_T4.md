# TASK_WS04_T4: Response Builder (QuotagateCompleteResult → OpenAI chat.completion)

## Context

- **Workstream**: WS_04 (Argument Builder, Validator & Response Builder)
- **Plan reference**: `docs/plan/workstreams/ws04_translation_pipeline.md`
- **Phase plan**: `docs/plan/phases/01b_openai_translation_pipeline.md`
- **Depends on**: WS_03 signed off — `src/types.ts` stable (`QuotagateCompleteResult`). **Adds the
  `openai` npm package as a dependency** (pinned major) for the `ChatCompletion` return type, imported as
  `import type` (OD-2 — LOCKED 2026-06-10; not on disk today). Independent of T1, T2, T3.
- **Blocks**: WS_05 T2 (`proxy.ts` builds the response body via `buildChatCompletion`), WS_06 (no-tools
  E2E), WS_07 (adds the `tool_call` branch to the same function).

---

## Goal & Why

- **Goal**: Author `src/responseBuilder.ts` exporting
  `buildChatCompletion(result: QuotagateCompleteResult, model: string): ChatCompletion`. For the
  `{type:"text"}` branch (the only branch this phase), produce a well-formed OpenAI `chat.completion`:
  `id` = `"chatcmpl-" + crypto.randomUUID()`, `object: "chat.completion"`, a `created` unix-seconds
  timestamp, `model` echoed from the argument, and `choices[0]` = `{ index:0, message:{ role:"assistant",
  content:<result.content> }, finish_reason:"stop", logprobs:null }`. If called with `type:"tool_call"`,
  throw loudly (the explicit pending-stub for WS_07). The return type must satisfy the `openai` package's
  `ChatCompletion` type.

- **Why**: Invariant #5 — "the OpenAI response format is the output contract; output must be
  indistinguishable from the real API." This is the single point where Quotagate's internal
  `AdapterResponse`/`QuotagateCompleteResult` shape becomes the public contract every consumer's OpenAI
  SDK parses. Any field that is "close but not quite" — a missing `created`, a missing `logprobs`, a
  wrong `finish_reason` — is a breaking change for every consumer. Validating the **return type against
  the `openai` package's own TypeScript types** (not a hand-rolled fixture) is what makes the contract
  real at compile time rather than aspirational. The explicit throw on `tool_call` keeps the
  not-yet-implemented branch **loud rather than silently wrong** (Engineering Integrity: no silent
  failures) — a partial tool-call implementation here, untested, would create false confidence before
  WS_07 validates that path properly.

---

## Assumptions to Test

| #   | Assumption                                                                                                                  | Why we believe it                                                                                                            | How this task tests it                                                                                                        | If false →                                                                                                       |
| --- | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| A1  | The object `buildChatCompletion` returns satisfies the `openai` package's `ChatCompletion` type with no `as` cast          | The `openai` SDK's `ChatCompletion` is a structural TS type; building every required field makes it assignable              | A compile-time `const _typecheck: ChatCompletion = result;` (or a typed return annotation) in the test file — `tsc` is the check | If a required field is missing (`created`, `logprobs`, `index`, …) the build fails to compile — add the field; do not cast away the error |
| A2  | A no-tools text response maps to `finish_reason:"stop"` and `content` = the model's text                                   | Spec §4.2 steps 7–8: `{type:"text"}` → `finish_reason:"stop"`, `message.content` = the text                                | T-2 asserts `finish_reason==="stop"` and `choices[0].message.content === result.content`                                     | If the SDK rejects `"stop"` here: re-read §4.2 — `"stop"` is the documented value for a completed text turn       |
| A3  | `crypto.randomUUID()` is available natively in Node 20+ with no import                                                     | Node 20 LTS exposes `globalThis.crypto.randomUUID()`; project targets Node 20+                                              | T-1 asserts `id` matches `/^chatcmpl-[0-9a-f-]{36}$/`; runs under the project's Node                                         | If unavailable: import `randomUUID` from `node:crypto` — still no third-party dep (do NOT add a uuid library)     |
| A4  | The `openai` package can be added as a dependency without breaking the ESM/Node20/tsup build                               | `openai` ships ESM + types; the project is already ESM (`"type":"module"`) and bundles with tsup                            | After OD-2 resolves and the dep is added: `npm run typecheck` + `npm run build` stay green                                  | If it breaks the build: import the `ChatCompletion` type only (`import type`), which tsup tree-shakes to nothing at runtime |

---

## Expected Failures

- **[EF1]** `buildChatCompletion` is called with `{type:"tool_call", ...}`. It MUST throw (per WS_04-D4)
  — a loud, explicit pending-stub — never return a partial/empty completion. **OD-4 LOCKED (2026-06-10):
  throw the base `QuotagateError`** with a descriptive "tool_call branch not yet implemented" message.
  WS_07 replaces this throw with the real `tool_call` implementation, so a bespoke subclass would be
  short-lived; the base type is the right call now. (This is also the single rejection point for the
  unsupported branch — OD-7: the validator returns `tool_call` faithfully; the rejection lands here.)
- **[EF2]** `result.content` is an empty string `""`. The OpenAI contract permits empty assistant
  content; `buildChatCompletion` must NOT throw or substitute a placeholder — it returns `content: ""`.
  (Whether the *model* should ever return empty content is a validator concern, T2 — not the builder's.)
- **[EF3]** Missing a required `ChatCompletion` field (`created`, `logprobs`, `index`,
  `object`). **The workstream's locked SC and signature omit `created` and `logprobs` entirely** —
  building the object without them will fail to compile against the real `openai` type. This task adds
  them. Caught at compile time (A1), never shipped.
- **[EF4]** `usage` field. The real `ChatCompletion.usage` is optional (`?`) / nullable in the SDK, and
  CLI agents return no token counts (spec §7.4). Phase 1B omits `usage` (or sets it `undefined`). Do not
  fabricate token counts. Confirm the chosen `openai` major version types `usage` as optional so omission
  compiles (see OD-2 — pin the version).

---

## Test Strategy

- **Unit**: `tests/responseBuilder.test.ts` — pure-function tests, no I/O, no mocks. Build a completion
  from a `{type:"text"}` result and assert every field of the contract; assert the `tool_call` throw.
- **Integration**: None here. The builder's output is exercised against a live OpenAI SDK client in
  WS_06; this task proves the shape in isolation so WS_06 is a confirmation pass.
- **Contract**: The load-bearing check is the **compile-time** assignment to the `openai` package's
  `ChatCompletion` type (A1). This is the invariant-#5 guard. A hand-rolled fixture is explicitly NOT a
  substitute (Known Pitfalls).
- **Contamination/Isolation**: N/A — pure function, no transport, no state.

---

## Open Decisions — RESOLVED (2026-06-10 elevation)

> Both open decisions affecting this task are LOCKED. No row remains ⏳ OPEN. Formal dated decision blocks
> live in the workstream's Locked Decisions section.

- **[OD-2] Add `openai` as a dependency, pin the major — RESOLVED: yes, add it (pinned major), `import
  type` only.** `openai` becomes a regular dependency; `ChatCompletion` is imported as
  `import type { ChatCompletion } from "openai/resources/chat/completions"` so tsup tree-shakes the
  runtime away (the type alone is used). The major version is pinned because the `ChatCompletion` shape
  (notably `usage` optionality and `logprobs`) varies across majors and the compile-time contract must be
  stable. _(Rejected: hand-roll a parallel `ChatCompletion` type — it would drift from the real SDK and
  defeat the invariant-#5 compile-time guard.)_

- **[OD-4] Error type thrown on the `tool_call` branch — RESOLVED: base `QuotagateError`.** Throw
  `QuotagateError("tool_call branch not yet implemented")` with a descriptive message. WS_07 replaces the
  throw with the real implementation, so a bespoke subclass would be short-lived. _(Rejected: a dedicated
  routing-error subclass — premature; the throw is removed in WS_07.)_

---

## Contract: What This Task Inherits

| Symbol / Artifact            | Source                            | Role in This Task                                                             |
| ---------------------------- | --------------------------------- | ---------------------------------------------------------------------------- |
| `QuotagateCompleteResult`    | `src/types.ts` (WS_01 T3)         | Input; discriminated union; this task handles the `type:"text"` arm only     |
| `ChatCompletion`             | `openai` pkg (**added via OD-2**) | Return type; the output contract (invariant #5). Imported as `import type`   |
| `QuotagateError`             | `src/errors.ts` (WS_01 T4)        | Thrown on the `tool_call` branch (OD-4 LOCKED — base `QuotagateError`)       |
| `crypto.randomUUID()`        | Node 20 global                    | Generates the `chatcmpl-<uuid>` `id` — no third-party uuid dependency        |

---

## Subtask Progress Table

| #   | Subtask                                                                                                                         | Status        | Iteration | Notes |
| --- | ----------------------------------------------------------------------------------------------------------------------------- | ------------- | --------- | ----- |
| 1   | Add `openai` to `package.json` (pinned major, OD-2 LOCKED); `import type { ChatCompletion }`. Confirm `typecheck` + `build` stay green. | ✅ Done | 1 of 1 | Pinned `^6.0.0` (installed 6.42.0); `import type` from `openai/resources/chat/completions` |
| 2   | Author `src/responseBuilder.ts`: `buildChatCompletion(result, model)` — text branch builds the full contract object (incl. `created`, `logprobs`). | ✅ Done | 1 of 1 | `refusal: null` required in v6 — added; `randomUUID` from `node:crypto` |
| 3   | Add the explicit throw for `type:"tool_call"`: base `QuotagateError` (OD-4 LOCKED), descriptive message. | ✅ Done | 1 of 1 | OD-4 resolved |
| 4   | Write `tests/responseBuilder.test.ts`: T-1 … T-5 (see Required Test Cases), including the compile-time `ChatCompletion` check. | ✅ Done | 1 of 1 |       |
| 5   | Run green gate: `npm test`, `typecheck`, `lint`, `format`; confirm no regression from the 33-test baseline.                   | ✅ Done | 1 of 1 | 43 tests (was 33); typecheck · lint · format clean |

_Status icons: `✅ Done` | `🔄 In progress` | `⬚ Not started` | `❌ Blocked`_

---

## Current Subtask Detail

### Subtask 2: Author `buildChatCompletion` (text branch)

**Approach iteration plan** (simplest → target):

1. Build the object literal with all required `ChatCompletion` fields hard-wired for the text branch:
   `id`, `object:"chat.completion"`, `created: Math.floor(Date.now()/1000)`, `model`,
   `choices:[{ index:0, message:{ role:"assistant", content: result.content, refusal: null }, finish_reason:"stop", logprobs:null }]`.
2. Annotate the return type as `ChatCompletion` (not `as` cast) so `tsc` enforces completeness (A1, EF3).
3. Confirm `usage` omission compiles under the pinned `openai` major (EF4).

- **Current iteration**: 1 of 3
- **Verifiability / Success Criteria**: SC-1 … SC-4.
- **Challenges**: The exact set of required `message` fields (`refusal`, `annotations`) differs by
  `openai` major — this is why OD-2 pins the version. Build against the pinned types, not from memory.

---

## Decisions Made

### [WS_04-D4 inherited] — `responseBuilder.ts` Handles `{type:"text"}` Branch Only ✅ LOCKED (Architect, 2026-06-08)

**Decision**: `buildChatCompletion` handles only `QuotagateCompleteResult` where `type === "text"`. If
called with `type === "tool_call"`, it throws (the explicit pending-stub). The tool-call branch is added
in WS_07.

**Rationale**: Implementing the tool-call branch before WS_07 — which owns the `tool_calls[]` array
shape, `content:null`, `finish_reason:"tool_calls"`, and `call_<id>` format and their tests — would put
untested code in the green gate and create false confidence. The explicit throw makes the omission loud.

**Rejected alternative — implement both branches now**: Creates untested tool-call code in the green
gate; WS_07 is where that path is validated.

> **Resolved (OD-4, 2026-06-10):** the thrown error is the **base `QuotagateError`** (descriptive
> message). WS_07 replaces the throw with the real `tool_call` implementation, so a bespoke subclass would
> be short-lived.

### [D2] — Anti-overengineering scope fence ✅ LOCKED

**This task explicitly does NOT include**:

- The `{type:"tool_call"}` response branch — WS_07 (full `tool_calls[]`, `content:null`,
  `finish_reason:"tool_calls"`, `call_<id>`).
- Streaming / SSE response shape — Phase 3.
- `usage` token accounting — CLI agents return no token counts (spec §7.4); omitted in Phase 1B.
- Multiple `choices` (`n > 1`) — Phase 1B emits exactly one choice.
- Validation/parsing of the model output — owned by `validator.ts` (T2/T3); this task receives an
  already-validated `QuotagateCompleteResult`.

---

## Cross-Task Contracts (Downstream Dependencies on This Task)

### WS_05 T2 (`proxy.ts`), WS_06, and WS_07 will depend on:

- `buildChatCompletion(result, model): ChatCompletion` — a **pure** function; deterministic except for
  `id` (random UUID) and `created` (clock). WS_07 adds the `tool_call` branch to this **same function
  without changing the signature**. The return type must satisfy `openai`'s `ChatCompletion` — that is
  the invariant-#5 contract and WS_06's E2E test asserts it against a live SDK client.

---

## Files Modified / Created

- `src/responseBuilder.ts` — **create new** (`buildChatCompletion`, text branch + `tool_call` throw).
- `package.json` — **modify** (add `openai` dependency, pinned major; per OD-2).
- `tests/responseBuilder.test.ts` — **create new** (T-1 … T-5).

---

## Success Criteria / Verifiability

| #    | Criterion                                                                                                                            | How to verify                                                          |
| ---- | --------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| SC-1 | `buildChatCompletion({type:"text",content:"Hi"},"claude-sonnet-4-6").id` matches `/^chatcmpl-[0-9a-f-]{36}$/`                      | T-1                                                                    |
| SC-2 | Returned object has `object:"chat.completion"`, a numeric `created`, `model:"claude-sonnet-4-6"`, and exactly one `choices` entry | T-2                                                                    |
| SC-3 | `choices[0]` = `{ index:0, message:{ role:"assistant", content:"Hi", … }, finish_reason:"stop", logprobs:null }`; `content` equals `result.content` | T-2                                                                    |
| SC-4 | The returned object is assignable to `openai`'s `ChatCompletion` with **no** `as` cast                                            | T-3 — compile-time typed assignment; `npx tsc --noEmit` zero errors   |
| SC-5 | `buildChatCompletion({type:"tool_call",name:"f",arguments:{}}, model)` throws `QuotagateError` (OD-4) with a descriptive "not yet implemented" message | T-4                                                                    |
| SC-6 | `result.content === ""` yields `choices[0].message.content === ""` (no throw, no placeholder)                                     | T-5 (EF2)                                                              |
| SC-7 | `npm run typecheck` clean; `npm run build` (tsup) succeeds with the new dep; no unused exports                                    | Zero errors                                                            |
| SC-8 | `npm run lint` clean; `npm run format` no diff                                                                                    | Zero issues                                                            |
| SC-9 | Coverage 100% branch on `responseBuilder.ts` (text branch + throw)                                                                | `npm run test:cov`                                                     |
| SC-10| Zero regressions; no test-count drop from the 33-test baseline                                                                    | `npm test` green                                                       |

---

## Required Test Cases

File: `tests/responseBuilder.test.ts`

### T-1: `id` format (covers SC-1, A3)

Build from `{type:"text",content:"Hi"}`; assert `id` matches `/^chatcmpl-[0-9a-f-]{36}$/` and that two
successive calls yield distinct `id`s (UUID uniqueness).

### T-2: full text-branch contract (covers SC-2, SC-3, A2)

Assert `object==="chat.completion"`, `typeof created === "number"`, `model` echoed, `choices.length===1`,
`choices[0].index===0`, `choices[0].finish_reason==="stop"`, `choices[0].message.role==="assistant"`,
`choices[0].message.content==="Hi"`, `choices[0].logprobs===null`.

### T-3: return type satisfies `openai` `ChatCompletion` (covers SC-4, A1)

A typed assignment `const out: ChatCompletion = buildChatCompletion({type:"text",content:"Hi"}, "m");`
(imported `import type { ChatCompletion } from "openai/resources/chat/completions"`). The check is that
`tsc` compiles this with no cast — do NOT hand-roll a parallel `ChatCompletion` type.

### T-4: `tool_call` branch throws `QuotagateError` (covers SC-5, EF1, OD-4)

`expect(() => buildChatCompletion({type:"tool_call",name:"f",arguments:{}}, "m")).toThrow(QuotagateError)`
(OD-4 LOCKED) with a descriptive message asserting "not yet implemented" (or equivalent).

### T-5: empty content is preserved, not rejected (covers SC-6, EF2)

`buildChatCompletion({type:"text",content:""}, "m")` returns `choices[0].message.content === ""` and does
not throw.

---

## Review Notes

**Architect review — 2026-06-11 — APPROVED WITH NOTES**

All locked decisions in scope for T4 confirmed: OD-2 (`openai` pinned `^6.0.0`, `import type` only — `responseBuilder.ts:3` has zero runtime reference) and OD-4 (base `QuotagateError` thrown on `tool_call` branch — confirmed; `responseBuilder.test.ts:38` asserts exact class). Four post-review notes implemented:

- **Note 1 (T4's own):** `openai` moved from `dependencies` → `devDependencies`. Correct — every byte of usage is `import type`, erased by TypeScript before the binary is emitted. OD-2's "regular dependency" reasoning was correct about tsup tree-shaking the bundle but incomplete about `npm install` behavior for consumers. Zero behavioral impact on the compiled output.
- **Note 4 (T4's downstream concern):** `usage: undefined` vs `null` verification documented in `ws06_e2e_no_tools.md` Known Pitfalls as a WS_06 T2 assertion item. `refusal: null` correctly included (required field in openai v6 `ChatCompletionMessage`). `randomUUID` from `node:crypto` confirmed correct — `globalThis.crypto` is not typed in this tsconfig's lib.
- Notes 2 and 3 are T1-scope items.

Compile-time `const out: ChatCompletion = buildChatCompletion(...)` assignment in T-3 confirmed genuine invariant-#5 guard — the function's `: ChatCompletion` return annotation (not `as` cast) is the primary enforcement point; `tsc` fails if any required field is missing or mistyped. All 10 success criteria verified.

---

## Architect Sign-off

- [x] Implementation reviewed
- [x] All success criteria verified
- [x] All assumptions resolved (proven, or fallback taken & documented)
- [x] No regressions in full test suite
- [x] `npm test` / `typecheck` / `lint` / `format` all clean
