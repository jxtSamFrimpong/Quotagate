# TASK_WS03_T3: Sequential Contamination Probe

## Context

- **Workstream**: WS_03 (Adapter Proving & Contamination Probe)
- **Plan reference**: `docs/plan/workstreams/ws03_adapter_proving.md`
- **Phase plan**: `docs/plan/phases/01a_transport_and_constraint.md`
- **Depends on**: TASK_WS02_T4 complete and PA-signed off — `ClaudeAdapter` implemented; per-request fresh subprocess spawn is the architectural guarantee being tested. `tests/integration/` directory created (TASK_WS03_T1, Subtask 1).
- **Blocks**: TASK_WS03_T4 (green-gate close-out). Does NOT block T1 or T2.

---

## Goal & Why

- **Goal**: Author `tests/integration/contamination.sequential.integration.test.ts`. The test makes two sequential `adapter.complete()` calls against the real `ClaudeAdapter`:
  - **Call A**: sends a message containing the fixed contamination token `const TOKEN = "8f3a1c2d-9e4b-4f7a-b6c5-1d2e3f4a5b6c"` in a natural-language framing.
  - **Call B**: sends a separate, independent message asking the model to report what it knows, without any reference to the token.
  - Asserts that `raw` from Call B does not contain the TOKEN string.
  Guards with the `healthCheck()` skip pattern. Uses `{ timeout: 30_000 }` (two sequential model invocations).

- **Why**: This test is the standing regression guard for invariant #10 ("Persist the process, never the conversation") and invariant #11 ("One request in flight per MCP session"). On the subprocess transport, statelessness is free — each call spawns a fresh `claude --print` process that has no memory of prior calls. The test passes by construction today.

  But "by construction" is only safe if the test is there to catch the day the construction changes. Phase 2 replaces the subprocess with a persistent MCP session. Phase 2's implementation must keep this test green by earning the isolation guarantee structurally (via `_mcp_lock` and per-session call serialization), not by relying on the subprocess-fresh-process property. The test stays in the suite forever. It is the invariant's proof-of-life, not just a Phase 1A check.

---

## Assumptions to Test

| # | Assumption | Why we believe it | How this task tests it | If false → |
|---|---|---|---|---|
| A1 | Two sequential `adapter.complete()` calls spawn two independent `claude --print` subprocesses, each starting with an empty context seeded only by `buildConstrainedPrompt(req.messages)` | This is the direct consequence of `_completeViaSubprocess()` calling `spawn('claude', ['--print'], ...)` fresh on every invocation — there is no shared state object, no session handle, no persistent process | Call A injects the TOKEN; Call B probes with no reference to Call A; assert TOKEN is absent from Call B's response | If TOKEN appears in Call B's response: the adapter has introduced shared state between calls — diagnose whether a session handle, a shared stdin/stdout pipe, or a process cache is leaking context. This is a critical product-level failure; do not adjust the assertion |
| A2 | The TOKEN value `"8f3a1c2d-9e4b-4f7a-b6c5-1d2e3f4a5b6c"` is sufficiently distinctive that it cannot appear coincidentally in Call B's response | UUID v4 format is astronomically unlikely to appear in any model response that does not have the token in its context | Confirming by inspection: model responses to "What is 2 + 2?" or "Hello" never contain UUID-format strings | If TOKEN appears coincidentally in Call B's response despite correct isolation: change the token to a different UUID and re-run. Do NOT weaken the assertion. The probability of two consecutive UUID coincidences is negligible — a second coincidence would indicate a deeper contamination |
| A3 | The `CONSTRAINT_INSTRUCTIONS` framing does not cause the model to echo back a UUID it has never seen — e.g. the constraint does not say "repeat the user's last message" | The constraint instructions say "pure reasoning endpoint; return JSON only" — there is no mechanism that would cause the model to fabricate a UUID that matches the TOKEN | Call B's prompt does not mention the TOKEN — if TOKEN appears, it could only have come from Call A's context leaking | If TOKEN appears in Call B despite correct constraint and correct isolation: investigate whether the subprocess is truly fresh (add a `process.pid` log temporarily to confirm two distinct PIDs); if PIDs differ and TOKEN still appears, re-examine whether `sanitisedEnv()` is somehow leaking context via an env var |

---

## Expected Failures

- **EF1** Test timeout: this test makes TWO sequential `adapter.complete()` calls, each with subprocess boot + model inference time. Total wall-clock time can be 10–20 seconds in the worst case. Use `{ timeout: 30_000 }` (30 seconds) — double the per-call budget. Do NOT use the 15-second timeout from T1/T2; it is not sufficient for two serial calls.
- **EF2** The `healthCheck()` guard is called once before both calls. It does not need to be called before each individual call. If the subscription expires mid-test between Call A and Call B, Call B will throw a `TransportError` — this is acceptable behavior (the test will fail with a transport error, not with a false positive on contamination). Do not add a second `healthCheck()` before Call B.
- **EF3** Call B's message must be phrased such that it cannot accidentally contain the TOKEN even through coincidence. Use a generic probe: `'What is 2 plus 2? Respond only with the JSON format specified in your instructions.'` — this constrains the model to return `{"type":"text","content":"4"}` or similar, which contains no UUID-format strings.
- **EF4** Do NOT use `crypto.randomUUID()` at runtime to generate the token. The TOKEN must be a fixed constant defined at the top of the test file. A runtime-generated token is non-deterministic: if the test fails, the token value does not appear in source control, making the failure impossible to reproduce by reading the code. A fixed constant makes the failure deterministic and the test readable.
- **EF5** Both Call A and Call B must Zod-parse their raw responses before the contamination assertion. If Call A returns a malformed JSON (the constraint failed), the contamination check is irrelevant — the test should fail at the Zod parse, not at the TOKEN assertion. This keeps the failure signal clean: a Zod failure means "constraint broken"; a TOKEN-in-B failure means "contamination detected."

---

## Test Strategy

- **Unit**: None in this task. The sequential contamination probe is inherently integration-level — it requires two real subprocess invocations to prove isolation.
- **Integration**: `tests/integration/contamination.sequential.integration.test.ts` — two real `ClaudeAdapter.complete()` calls in sequence. No mocks. WS_03-D1 is binding.
- **Contract**: Zod-parse both Call A and Call B responses. This is the standard contract assertion for all WS_03 integration tests. The contamination assertion is ADDITIONAL to the contract assertion — both must pass.
- **Contamination/Isolation**: This is the primary test. Sequential sub-case only. The concurrent sub-case is WS_09 (requires the Fastify proxy server to be up — WS_05 must be complete). Do not attempt the concurrent sub-case here.
- **Manual/spike**: None required. The contamination test is fully automated. If it fails, the diagnostic path is: (a) add a temporary `console.log` to `_completeViaSubprocess()` to log the subprocess PID for each call; (b) confirm two distinct PIDs appear in the test output; (c) if PIDs are the same, the adapter is reusing a subprocess — diagnose the spawn call; (d) if PIDs are different and TOKEN appears in Call B, investigate `sanitisedEnv()` for context-leaking env vars.

---

## Contract: What This Task Inherits

| Symbol / Artifact | Source | Role in This Task |
|---|---|---|
| `ClaudeAdapter` | `src/adapters/claude.ts` (TASK_WS02_T4) | Instantiated as `CLIAdapter`; `adapter.complete()` called twice in sequence |
| `CLIAdapter` | `src/adapters/base.ts` (TASK_WS02_T1) | Static type of the adapter variable |
| `AdapterRequest`, `AdapterResponse` | `src/types.ts` (TASK_WS01_T3) | Parameter and return type of `complete()` |
| `QuotagateCompleteResultSchema` | `src/types.ts` (TASK_WS01_T3) | Zod-parses both Call A and Call B responses before the contamination assertion |
| `healthCheck()` guard pattern | TASK_WS03_T1 (EF2 pattern) | Same skip-if-unavailable pattern; `ctx.skip(); return;` inside the `it()` callback |
| `tests/integration/` directory | TASK_WS03_T1 (Subtask 1) | Must exist |

---

## Subtask Progress Table

| # | Subtask | Status | Iteration | Notes |
|---|---|---|---|---|
| 1 | Author `tests/integration/contamination.sequential.integration.test.ts`: imports, constants (`TOKEN`, `CALL_A_MESSAGE`, `CALL_B_MESSAGE`), outer `describe` block | ⬚ Not started | — | |
| 2 | Implement T-I3: `healthCheck()` guard, Call A (`adapter.complete()` with TOKEN in message), Zod parse of Call A response, assert Call A's `type === 'text'` | ⬚ Not started | — | |
| 3 | Implement Call B: `adapter.complete()` with the probe message (no reference to TOKEN), Zod parse of Call B response, assert Call B's `type === 'text'`, assert `raw` does not contain TOKEN | ⬚ Not started | — | |
| 4 | Run the integration test locally: `npx vitest run tests/integration/contamination.sequential.integration.test.ts --timeout 30000` | ⬚ Not started | — | |
| 5 | Run full green gate: `npm test`, `npm run typecheck`, `npm run lint`, `npm run format` — confirm all clean and no regressions | ⬚ Not started | — | |

_Status icons: `✅ Done` | `🔄 In progress` | `⬚ Not started` | `❌ Blocked`_

---

## Current Subtask Detail

### Subtask 1: Author the test file skeleton

**Approach iteration plan** (simplest → target):

1. Create the file with imports, the `TOKEN` constant, and two message constants `CALL_A_MESSAGE` and `CALL_B_MESSAGE`. Write the `describe` block and a single `it()` stub that calls `ctx.skip()` unconditionally. Run `npx vitest run tests/integration/contamination.sequential.integration.test.ts` to confirm the file compiles and the test is skipped.
2. Replace the stub with the real `healthCheck()` guard. Add Call A with `adapter.complete()` and capture `responseA`. Add the Zod parse of `responseA.raw`.
3. Add Call B with a separate `adapter.complete()` call (no reference to TOKEN). Add Zod parse of `responseB.raw`. Add the TOKEN-absence assertion on `responseB.raw`.

- **Current iteration**: 1 of 3
- **Verifiability / Success Criteria**: SC-I3a and SC-I3b both pass when run locally. `npm test` does not include this file in the unit suite count.
- **Challenges**: EF1 (double-timeout), EF4 (fixed TOKEN, not `crypto.randomUUID()`), EF5 (Zod-parse both responses before the TOKEN assertion).

### Subtask 3: TOKEN-absence assertion

**Approach iteration plan** (simplest → target):

1. Assert `!responseB.raw.includes(TOKEN)` — the simplest possible assertion. This is the correct strength; do NOT use a regex or a case-insensitive variant. The TOKEN is a fixed UUID string; the assertion is exact.
2. If the TOKEN appears in `responseB.raw` unexpectedly: do NOT adjust the assertion. Log `responseB.raw` to inspect the content. Confirm the subprocess PIDs are distinct (add temporary logging to `_completeViaSubprocess()`). File a bug against the adapter if PIDs are the same.

- **Current iteration**: 1 of 2
- **Verifiability / Success Criteria**: SC-I3b passes. `responseB.raw.includes(TOKEN)` returns `false`.
- **Challenges**: A1 (if TOKEN appears, root-cause first; do not paper over with a looser assertion).

---

## Decisions Made

### WS_03-D3 — Contamination Token Is a Fixed UUID Constant ✅ LOCKED (Architect, 2026-06-08)

**Decision**: `const TOKEN = "8f3a1c2d-9e4b-4f7a-b6c5-1d2e3f4a5b6c"` — defined at the top of the test file, never generated at runtime.

**Rationale**: A fixed constant is deterministic, readable in CI logs, and reproducible across machines and runs. A UUID v4 format string is astronomically unlikely to appear in a model response that does not contain the token in its context (probability ~1/2^122 per character position). The token must survive into source control so a failing test is immediately debuggable by reading the test file.

**Rejected alternative — `crypto.randomUUID()` at runtime**: Non-deterministic; if the test fails, the token value is not in source control; the failure cannot be reproduced by reading the code. Makes debugging harder.

**Rejected alternative — a common phrase like "secret123"**: Could appear coincidentally in model output through training data. UUID format strings do not.

### WS_03-T3-D1 — Call B Probe Message Must Not Reference the TOKEN ✅ LOCKED (Architect, 2026-06-09)

**Decision**: Call B's message is `'What is 2 plus 2? Respond only with the JSON format specified in your instructions.'` — a generic arithmetic probe with no UUID, no reference to Call A, and no reference to the TOKEN.

**Rationale**: If Call B's message mentioned the TOKEN (even negatively — "do not repeat the token"), the model might include it in the response through instruction-following. The probe must be entirely independent to produce a clean contamination signal. An arithmetic probe forces a `{"type":"text","content":"4"}` or similar response that structurally cannot contain a UUID.

**Rejected alternative — "What did I just tell you?" as the probe**: Ambiguous — could be interpreted as referring to the constraint instructions, not Call A. Also could cause the model to hallucinate a plausible-sounding call A if the context is fresh.

**Rejected alternative — "Do you remember the code word?"**: Explicitly references a code word, which could cause the model to invent one. The probe must not prime the model to think about tokens or codes.

### WS_03-T3-D2 — TOKEN Assertion Is Exact String Match; No Regex, No Case-Insensitive ✅ LOCKED (Architect, 2026-06-09)

**Decision**: The assertion is `expect(responseB.raw).not.toContain(TOKEN)` — an exact substring match. No regex, no `toLowerCase()` variant.

**Rationale**: The TOKEN is a fixed UUID string. Case-sensitive exact match is the most precise assertion. A regex would be unnecessarily complex for a string-containment check. Case-insensitive would be incorrect — UUIDs are lowercase hex; a case-insensitive match would add false positive surface without adding value.

**Rejected alternative — regex match for UUID-format strings**: Over-broad; would catch any UUID in the response, not just the specific TOKEN. The assertion is about a specific token, not about UUID-format strings in general.

### Anti-overengineering scope fence ✅ LOCKED

**This task explicitly does NOT include**:

- Concurrent contamination probe — WS_09. Concurrent sub-case requires the Fastify proxy server (WS_05) to be running. Do not attempt to launch multiple concurrent `adapter.complete()` calls in a `Promise.all()` from this test — the per-request subprocess serialization is trivially guaranteed by the sequential nature of the test; the concurrent case is the hard one and belongs in WS_09.
- Retry-path contamination — WS_09. Verifying that a retried request does not leak context from its prior failed attempt is a WS_04 + WS_09 concern.
- More than two sequential calls — one injection (Call A) and one probe (Call B) is sufficient to prove isolation. Adding a third call adds flakiness surface and model latency without additional architectural signal.
- TOKEN assertion on Call A's response — Call A is expected to contain the TOKEN (it was injected in the message). Only Call B's response is asserted for TOKEN absence.

---

## Cross-Task Contracts (Downstream Dependencies on This Task)

### TASK_WS03_T4 will depend on:

- `tests/integration/contamination.sequential.integration.test.ts` exists and passes locally.

### WS_09 will depend on:

- T3 as the baseline proof that sequential calls are isolated. WS_09 extends this proof to the concurrent case over the MCP transport. WS_09 does NOT need to re-prove serial isolation — T3 owns that proof.

---

## Files Modified / Created

- `tests/integration/contamination.sequential.integration.test.ts` — **create new** (sequential contamination probe; see Required Test Cases T-I3)

---

## Success Criteria / Verifiability

| # | Criterion | How to verify |
|---|---|---|
| SC-I3a | Call A's raw response Zod-parses as `QuotagateCompleteResult` with `type === 'text'` (the TOKEN message is a plain statement, not a tool request) | T-I3 Zod parse + `type` assertion for Call A passes |
| SC-I3b | Call B's raw response does NOT contain the TOKEN string `"8f3a1c2d-9e4b-4f7a-b6c5-1d2e3f4a5b6c"` | `expect(responseB.raw).not.toContain(TOKEN)` passes |
| SC-I3c | Call B's raw response Zod-parses as `QuotagateCompleteResult` with `type === 'text'` | T-I3 Zod parse + `type` assertion for Call B passes |
| SC-I3-skip | When `adapter.healthCheck()` returns `false`, the test is skipped (not failed) | Verify via Vitest output; must show `skipped`, not `failed` |
| SC-1 | `npm test` in CI does NOT run `contamination.sequential.integration.test.ts` (excluded by the `CI`-gated `exclude` in `vitest.config.ts`, added in T4). Locally, the file runs but skips gracefully if auth is unavailable. | Run `CI=true npm test`; confirm file is absent from output |
| SC-2 | `npm run typecheck` clean — zero errors | `npx tsc --noEmit`; zero output |
| SC-3 | `npm run lint` clean; `npm run format` no diff | Zero ESLint violations; Prettier reports no files changed |
| SC-4 | `npm test` green; no regressions from prior baseline (≥ 30 unit tests from T1's carry-forwards) | `npm test` output shows all prior tests passing |

---

## Required Test Cases

### Integration test file: `tests/integration/contamination.sequential.integration.test.ts`

#### T-I3: sequential calls are isolated — Call B's response contains no trace of Call A's TOKEN (covers SC-I3a, SC-I3b, SC-I3c, A1, A2)

```typescript
// Sketch — BSE realizes as Vitest describe/it block
import { describe, expect, it } from 'vitest';
import { ClaudeAdapter } from '../../src/adapters/claude.js';
import type { CLIAdapter } from '../../src/adapters/base.js';
import { QuotagateCompleteResultSchema } from '../../src/types.js';

// WS_03-D3: fixed UUID constant — never crypto.randomUUID()
// This token is designed to be unique enough that coincidental appearance is
// astronomically unlikely. Do not change this value without updating the decision log.
const TOKEN = '8f3a1c2d-9e4b-4f7a-b6c5-1d2e3f4a5b6c';

describe('sequential contamination probe', () => {
  it('T-I3: call B response contains no trace of call A token',
    async (ctx) => {
      const adapter: CLIAdapter = new ClaudeAdapter();
      const healthy = await adapter.healthCheck();
      if (!healthy) { ctx.skip(); return; }

      // Call A: inject the TOKEN into the conversation context
      const responseA = await adapter.complete({
        messages: [
          {
            role: 'user',
            content: `Remember this code word for later: ${TOKEN}. Acknowledge you have noted it.`,
          },
        ],
      });

      // Assert Call A Zod-parses correctly (EF5: fail here if constraint is broken, not at TOKEN assertion)
      const parsedA = JSON.parse(responseA.raw);
      const resultA = QuotagateCompleteResultSchema.safeParse(parsedA);
      expect(resultA.success, 'Call A response did not parse as QuotagateCompleteResult').toBe(true);
      if (resultA.success) {
        expect(resultA.data.type).toBe('text');
      }

      // Call B: generic probe with no reference to the TOKEN or Call A
      const responseB = await adapter.complete({
        messages: [
          {
            role: 'user',
            content: 'What is 2 plus 2? Respond only with the JSON format specified in your instructions.',
          },
        ],
      });

      // Assert Call B Zod-parses correctly
      const parsedB = JSON.parse(responseB.raw);
      const resultB = QuotagateCompleteResultSchema.safeParse(parsedB);
      expect(resultB.success, 'Call B response did not parse as QuotagateCompleteResult').toBe(true);
      if (resultB.success) {
        expect(resultB.data.type).toBe('text');
      }

      // Contamination assertion: TOKEN must be absent from Call B's raw response
      expect(responseB.raw, 'TOKEN found in Call B response — contamination detected').not.toContain(TOKEN);
    },
    { timeout: 30_000 }, // EF1: two serial model calls — use double the single-call budget
  );
});
```

The test body is deliberately linear: Call A → parse A → Call B → parse B → contamination check. Each assertion is a distinct failure mode. A Zod failure on Call A means the constraint is broken. A Zod failure on Call B means the constraint is broken on the probe. A TOKEN-in-B means contamination. These are three categorically different failures and must produce three categorically different error messages.

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
