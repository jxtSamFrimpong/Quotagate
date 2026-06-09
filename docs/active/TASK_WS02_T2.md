# TASK_WS02_T2: Author `buildConstrainedPrompt` in `src/adapters/claude.ts`

## Context

- **Workstream**: WS_02 (Claude Subprocess Adapter & Constraint)
- **Plan reference**: `docs/plan/workstreams/ws02_subprocess_adapter_and_constraint.md`
- **Phase plan**: `docs/plan/phases/01a_transport_and_constraint.md`
- **Depends on**: TASK_WS02_T1 (the `src/adapters/` directory must exist; but `buildConstrainedPrompt` does not import from `base.ts` — T2 is effectively independent and can run in parallel with T3). TASK_WS01_T3 (`AdapterRequest`, `OpenAIMessage`, `OpenAITool` from `src/types.ts` must exist).
- **Blocks**: TASK_WS02_T4 — `_complete_via_subprocess()` calls `buildConstrainedPrompt` to produce the stdin string. T4 cannot be authored until T2 is signed off and the function signature is stable.

---

## Goal & Why

- **Goal**: Author the private function `buildConstrainedPrompt(messages: OpenAIMessage[], tools: OpenAITool[] | undefined, toolChoice: string): string` inside `src/adapters/claude.ts`. Author unit tests in `tests/adapters/buildConstrainedPrompt.test.ts` covering all branches with 100% coverage. The function must not be exported — it is an internal implementation detail of the adapter.
- **Why**: `buildConstrainedPrompt` is the entire Phase 1 constraint mechanism (Mechanism A per D-SEQ-01). If the constraint wording is weak or the conversation history is serialized incorrectly, the Claude model will not return valid JSON — and every request through the proxy will fail validation in WS_04. This function is also the only place constraint text is ever injected (WS_02-D1 is locked: the translation pipeline never injects constraint text). Getting it correct here, with 100% branch coverage on a pure function, is the cheapest and most thorough way to prove the constraint is sound before any subprocess is ever spawned.

---

## Assumptions to Test

| # | Assumption | Why we believe it | How this task tests it | If false → |
|---|---|---|---|---|
| A1 | The constraint instructions from spec §3.5 are sufficient to suppress Claude from executing tools and to elicit a raw JSON response | Spec §5.2 experiments confirmed this wording works with `claude --print` | Wording in `buildConstrainedPrompt` output is verified verbatim in T-1 via substring assertion; real execution suppression is confirmed in WS_03 | If WS_03 contamination test fails: do not weaken the constraint — escalate to Architect for a revised wording and a new experiment round |
| A2 | `tools: undefined` and `tools: []` are indistinguishable in the prompt output — no tool schemas are injected in either case | Spec §5.1 uses `echo '<prompt>' | claude --print` with no tool flags; an empty/absent tools array should produce no tool injection | T-5 and T-6 assert that the output of `buildConstrainedPrompt(messages, undefined, 'none')` equals the output of `buildConstrainedPrompt(messages, [], 'none')` (or at minimum that neither contains any tool schema text) | If they differ: investigate which case leaks tool text; the fix is a normalisation guard `if (!tools || tools.length === 0)` before the injection branch — document the choice with a Decision Log entry |
| A3 | `OpenAIMessage.content: string \| null` — a null-content message (valid for assistant messages with only `tool_calls`) is rendered faithfully and is neither coerced to `""` nor silently dropped from the conversation history | Flagged in WS_01 T3 Review Finding 2; `OpenAIMessage.content` is typed `string \| null` in `src/types.ts` | T-7 constructs an assistant message with `content: null` and asserts the output is a valid string that does not contain `"null"` as a literal (i.e. JSON-serialization of the word null is not the output) and that the message turn is represented | If the null coercion is not caught: the conversation history is silently corrupted; this is a contract violation — do not paper over it with `?? ''`; the correct fix is an explicit guard rendering the turn boundary without text content |
| A4 | The constraint instructions must appear in the output regardless of whether `tools` are present | The constraint is unconditional — it is not gated on `tools` being non-empty | T-1 asserts constraint text is present with tools; T-8 asserts it is also present without tools | If constraint text is absent in either path: the branch that omits it is a bug — fix the control flow |

---

## Expected Failures

- **EF1** If `buildConstrainedPrompt` is accidentally exported from `src/adapters/claude.ts`, ESLint's `no-unused-vars` rule will not fire (it is used in T4), but the architectural contract is violated — constraint logic must be internal. The test file imports the function for testing purposes; if the export is added only for testability, that is a design smell. Mitigation: keep the function unexported in the production module; the test file will import from the module in a way that does not require a public export — see T2 Required Test Cases for the pattern (Vitest can test private functions when imported from the same module using a named export used only in test builds, but the cleaner approach is to co-locate the test to call the module-private function via a thin testing shim). **Resolution**: The function should be exported with a `/* @internal */` JSDoc tag in the module — it is package-private, not truly private. This is a standard TS pattern for testable internals. Note this in the Subtask Progress Table when implemented.
- **EF2** The constraint instructions from spec §3.5 include backtick-delimited JSON examples. If the prompt serialization uses template literals, escaped backticks may produce double-escaping. Use explicit single-quote string concatenation or a tagged template where the constraint block is a plain string constant at the top of the function — not inline in a template literal that also contains dynamic content.
- **EF3** If `toolChoice` is passed as `"auto"` when tools are `undefined`, and the function injects tool-choice language into the prompt, the model may be confused about whether to use tools. Guard: if `tools` is undefined or empty, do not mention `toolChoice` in the prompt at all — it is irrelevant and potentially harmful.
- **EF4** The `arguments` field in the `tool_call` branch of the constraint example JSON uses `{...}`. If the constraint text is serialized with `JSON.stringify`, the ellipsis placeholder will be lost. The constraint instructions must be a static string constant, not dynamically serialized JSON.

---

## Test Strategy

- **Unit**: `tests/adapters/buildConstrainedPrompt.test.ts` — pure function, no I/O, no mocks. 100% branch coverage is required (no excuse for gaps on a pure function). Branches to cover: (1) constraint instructions always present; (2) user messages serialized; (3) assistant messages with non-null content; (4) assistant messages with null content (A3); (5) `tools: undefined` path; (6) `tools: []` path (must equal undefined path per A2); (7) `tools: [...]` with one or more tool schemas injected; (8) `toolChoice` included when tools are present, ignored when tools are absent; (9) messages array not mutated after the call.
- **Integration**: N/A — pure function. The integration proof is deferred to WS_03, where `buildConstrainedPrompt` output is fed to a real `claude --print` subprocess and the response is Zod-parsed.
- **Contract**: The output of `buildConstrainedPrompt` is the stdin string for `claude --print`. The contract is that: (a) constraint instructions from spec §3.5 appear verbatim in the output; (b) every message in the input `messages` array is represented in the output; (c) tool schemas are injected when `tools` is non-empty; (d) the output does not contain raw `null` as a string literal where a message content was null.
- **Manual/spike**: None required. All verification is `npm test` + `npm run test:cov` (to confirm 100% branch coverage on the module) + `npm run typecheck` + `npm run lint`.

---

## Contract: What This Task Inherits

| Symbol / Artifact | Source | Role in This Task |
|---|---|---|
| `OpenAIMessage` | `src/types.ts` (TASK_WS01_T3) | The message shape `buildConstrainedPrompt` serializes; `content: string \| null` — null must be handled faithfully (A3) |
| `OpenAITool` | `src/types.ts` (TASK_WS01_T3) | The tool schema shape injected into the prompt when `tools` is non-empty |
| Constraint text | Spec §3.5 | The exact wording — must appear verbatim; do not paraphrase |
| `src/adapters/` directory | TASK_WS02_T1 | `src/adapters/claude.ts` lives here; the directory must exist |

---

## Subtask Progress Table

| # | Subtask | Status | Iteration | Notes |
|---|---|---|---|---|
| 1 | Create `src/adapters/claude.ts` with the `buildConstrainedPrompt` function (unexported first; see EF1 note below) and the spec §3.5 constraint text as a static constant | ⬚ Not started | — | |
| 2 | Handle `tools` injection branch: when `tools` is non-empty, serialize each tool's `function` schema into the prompt; when `tools` is undefined or empty, omit the tool schemas entirely (no mention of `toolChoice`) | ⬚ Not started | — | |
| 3 | Handle `null` content on assistant messages (A3): render the turn boundary without text content — do not coerce to `""` or drop the message | ⬚ Not started | — | |
| 4 | Export `buildConstrainedPrompt` with `/* @internal */` JSDoc (needed for test access; see EF1) | ⬚ Not started | — | |
| 5 | Author `tests/adapters/buildConstrainedPrompt.test.ts` covering all 9 branches (see Test Strategy) | ⬚ Not started | — | |
| 6 | Run `npm run test:cov` — confirm 100% branch coverage on `src/adapters/claude.ts`; run full green gate | ⬚ Not started | — | |

_Status icons: `✅ Done` | `🔄 In progress` | `⬚ Not started` | `❌ Blocked`_

---

## Current Subtask Detail

### Subtask 1: Define `buildConstrainedPrompt` skeleton and constraint constant

**Approach iteration plan** (simplest → target):

1. Create `src/adapters/claude.ts`. Define `const CONSTRAINT_INSTRUCTIONS` as the verbatim §3.5 text (static string constant — no template literals, no dynamic interpolation). Define `buildConstrainedPrompt(messages, tools, toolChoice): string` returning `CONSTRAINT_INSTRUCTIONS` only, for now.
2. Add message serialization: iterate `messages`, render each as `<role>: <content>` (or equivalent turn-boundary format). Handle `content: null` via an explicit guard.
3. Add tools injection: if `tools` is defined and non-empty, serialize each `tool.function` schema (name, description, parameters) into the prompt. Do not mention `toolChoice` if tools is absent.

- **Current iteration**: 1 of 3
- **Verifiability / Success Criteria**: `npm run typecheck` exits 0; T-1 constraint-present assertion passes.
- **Challenges**: EF2 (backtick escaping in constraint text); EF3 (toolChoice gating); A3 (null content).

---

## Decisions Made

### WS_02-D1 — `buildConstrainedPrompt` Lives Inside the Adapter, Not the Translation Layer ✅ LOCKED (Architect, 2026-06-08)

**Decision**: `buildConstrainedPrompt` is a function in `src/adapters/claude.ts`, not in `argumentBuilder.ts`, `validator.ts`, or any pipeline file. The translation pipeline is transport-agnostic and must never inject constraint text.

**Rationale**: The translation pipeline maps OpenAI shapes to adapter shapes. If it injected constraint text, adding `GeminiAdapter` in Phase 2 would require the pipeline to be adapter-aware — breaking the clean abstraction and violating invariant #4.

**Rejected alternative — inject constraint in `argumentBuilder.ts`**: Forces `argumentBuilder` to be adapter-aware; requires rework in Phase 2 when Gemini/Codex adapters arrive.

### WS_02-D-T2-01 — Constraint Text Is a Static String Constant, Not a Template Literal ✅ LOCKED (Architect, 2026-06-09)

**Decision**: The spec §3.5 constraint instructions are defined as a `const CONSTRAINT_INSTRUCTIONS: string` at the top of `src/adapters/claude.ts`. No dynamic interpolation of the constraint block itself. Only the surrounding message serialization uses template literals.

**Rationale**: The constraint wording is the validated result of spec §5.2 experiments. Mixing it into a template literal risks accidental mutation (backtick escaping, whitespace drift) and makes it harder to review diffs. A named constant is self-documenting and grep-friendly.

**Rejected alternative — inline constraint text in a template literal with dynamic content**: Risk of double-escaping and whitespace drift; harder to audit against spec §3.5 verbatim.

### WS_02-D-T2-02 — `null` Content on Assistant Messages Is Rendered as an Empty Turn Boundary ✅ LOCKED (Architect, 2026-06-09)

**Decision**: When `OpenAIMessage.content` is `null`, `buildConstrainedPrompt` renders the message as a turn boundary with no text body (e.g., `assistant: [no text content]` or an equivalent marker that preserves the turn structure). It does NOT coerce `null` to `""` or skip the message.

**Rationale**: Null content is valid in the OpenAI wire format for assistant messages carrying only `tool_calls`. Coercing to `""` or dropping the message would silently corrupt the conversation history — the model would receive a different turn sequence than what the caller intended. A faithful rendering (even if the text body is a placeholder marker) preserves the turn structure.

**Rejected alternative — coerce `null` to `""`**: Silent data corruption; violates the output contract ("indistinguishable from real API" — invariant #5). The model receives incorrect history.

**Rejected alternative — drop the message if content is null**: Silently drops a turn from the conversation; the model sees a different sequence than the caller sent. Also a contract violation.

### Anti-overengineering scope fence ✅ LOCKED

**This task explicitly does NOT include**:

- `ClaudeAdapter` class definition — T4.
- `sanitisedEnv()` function — T3.
- `_complete_via_subprocess()` — T4.
- Any subprocess spawning, process lifecycle management, or I/O — T4.
- Retry logic — WS_04.
- Streaming or SSE — Phase 3.
- Tool-call response building — WS_05/WS_07.
- Zod validation of the function's output — `buildConstrainedPrompt` returns a string; validation of the model's JSON response from that string is `validator.ts` (WS_04).
- `~/.quotagate/CLAUDE.md` generation — `installer.ts` (Phase 2; WS_02-D3 locked).

---

## Cross-Task Contracts (Downstream Dependencies on This Task)

### TASK_WS02_T4 will depend on:

- `buildConstrainedPrompt(messages: OpenAIMessage[], tools: OpenAITool[] | undefined, toolChoice: string): string` — T4's `_complete_via_subprocess()` calls this exactly once per request to produce the stdin string. T4 must NOT add additional constraint instructions at the call site — the constraint is self-contained in this function.
- The return value is a `string` suitable for piping to `claude --print` via stdin. T4 must pass it as-is; do not wrap it in JSON or add outer quoting.

---

## Files Modified / Created

- `src/adapters/claude.ts` — **create new** (`CONSTRAINT_INSTRUCTIONS` static constant with verbatim spec §3.5 text; `buildConstrainedPrompt` function — exported with `/* @internal */` JSDoc; handles all message types including null content; handles tools present/absent; handles toolChoice gating)
- `tests/adapters/buildConstrainedPrompt.test.ts` — **create new** (9 branch-covering test cases; see Required Test Cases)

---

## Success Criteria / Verifiability

| # | Criterion | How to verify |
|---|---|---|
| SC-1 | `buildConstrainedPrompt` output contains the spec §3.5 constraint instructions verbatim — all five `CRITICAL BEHAVIOUR RULES` lines and both return-format examples | T-1 substring assertions pass |
| SC-2 | Each message in the input array is represented in the output (role + content) | T-2, T-3 content-in-output assertions pass |
| SC-3 | `tools: undefined` and `tools: []` produce identical output — no tool schema text in either case | T-5 and T-6 equality assertion passes |
| SC-4 | `tools: [...]` (non-empty) injects each tool's `name`, `description`, and `parameters` into the output | T-4 schema-in-output assertions pass |
| SC-5 | A message with `content: null` is rendered faithfully — not coerced to `""`, not dropped, not serialized as the string `"null"` | T-7 null-content assertion passes |
| SC-6 | Input `messages` array is not mutated after the call | T-9 reference-equality check passes |
| SC-7 | `buildConstrainedPrompt` and `sanitisedEnv` together have 100% branch coverage on `src/adapters/claude.ts` | `npm run test:cov` reports 100% branch on the module |
| SC-8 | `npm run typecheck` clean — zero errors | `npx tsc --noEmit`; zero output |
| SC-9 | `npm run lint` clean; `npm run format` no diff | Zero ESLint violations; Prettier reports no files changed |
| SC-10 | `npm test` green; no regressions from prior baseline | All tests pass (≥ 8 existing + new T2 tests) |

---

## Required Test Cases

File: `tests/adapters/buildConstrainedPrompt.test.ts`

### T-1: constraint instructions present — with tools (covers SC-1, SC-4, A1, A4)

Construct `messages = [{ role: 'user', content: 'what is 2+2?' }]` and `tools = [{ type: 'function', function: { name: 'calc', description: 'calculator', parameters: {} } }]`. Call `buildConstrainedPrompt(messages, tools, 'auto')`. Assert the result contains `"Returns ONLY a raw JSON object"` (verbatim from spec §3.5). Assert the result contains `"Never executes any function"`. Assert the result contains `"calc"` (tool name injected). Assert the result contains `"calculator"` (tool description injected).

### T-2: user message content appears in output (covers SC-2)

Construct `messages = [{ role: 'user', content: 'ping' }]`. Call `buildConstrainedPrompt(messages, undefined, 'none')`. Assert the result contains `'ping'`.

### T-3: assistant message content appears in output (covers SC-2)

Construct `messages = [{ role: 'user', content: 'hello' }, { role: 'assistant', content: 'hi there' }]`. Call `buildConstrainedPrompt(messages, undefined, 'none')`. Assert the result contains `'hi there'`.

### T-4: tools array serializes all tool schemas (covers SC-4)

Construct `tools = [{ type: 'function', function: { name: 'fn_a', description: 'desc_a', parameters: { type: 'object', properties: {} } } }, { type: 'function', function: { name: 'fn_b', description: 'desc_b', parameters: {} } }]`. Call `buildConstrainedPrompt([{ role: 'user', content: 'go' }], tools, 'auto')`. Assert the result contains `'fn_a'` and `'fn_b'`.

### T-5: `tools: undefined` produces no tool schema text (covers SC-3, A2)

Call `buildConstrainedPrompt([{ role: 'user', content: 'x' }], undefined, 'none')`. Capture the result. Assert it does not contain `"function"` as a tool-schema keyword (implementation-specific — adjust the assertion to whatever structural marker the implementation uses to delineate tool schemas).

### T-6: `tools: []` output equals `tools: undefined` output (covers SC-3, A2)

Call both `buildConstrainedPrompt([{ role: 'user', content: 'x' }], undefined, 'none')` and `buildConstrainedPrompt([{ role: 'user', content: 'x' }], [], 'none')`. Assert the two result strings are identical.

### T-7: null content on assistant message is rendered faithfully (covers SC-5, A3)

Construct `messages = [{ role: 'user', content: 'call fn' }, { role: 'assistant', content: null }]`. Call `buildConstrainedPrompt(messages, undefined, 'none')`. Assert the result is a `string` (not undefined, not null). Assert the result does not contain the literal substring `"null"` in a position where the content value would appear (i.e. the null was not JSON-stringified). Assert the result still contains the user's message `'call fn'` — the assistant turn being null-content must not have caused earlier messages to be dropped.

### T-8: constraint instructions present — without tools (covers SC-1, A4)

Call `buildConstrainedPrompt([{ role: 'user', content: 'y' }], undefined, 'none')`. Assert the result contains `"Returns ONLY a raw JSON object"`. Assert the result contains `"Never executes any function"`. (Constraint is unconditional — present regardless of tools.)

### T-9: input messages array is not mutated (covers SC-6)

Construct `const original = [{ role: 'user' as const, content: 'hello' }]`. Capture `original[0]` reference. Call `buildConstrainedPrompt(original, undefined, 'none')`. Assert `original[0].content === 'hello'` (content not mutated) and `original.length === 1` (array not mutated).

---

## Review Notes

_(Architect fills after BSE submits — verdict APPROVE / APPROVE-WITH-NITS / REQUEST-CHANGES, findings classified required-change / nit / informational, mapped to SC / decision IDs.)_

---

## Architect Sign-off

- [ ] Implementation reviewed
- [ ] All success criteria verified
- [ ] All assumptions resolved (proven, or fallback taken & documented)
- [ ] No regressions in full test suite
- [ ] `npm test` / `typecheck` / `lint` / `format` all clean
