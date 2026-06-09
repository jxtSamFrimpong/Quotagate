# TASK_WS03_T1: Constraint Integration Test + WS_02 Carry-Forward Unit Tests

## Context

- **Workstream**: WS_03 (Adapter Proving & Contamination Probe)
- **Plan reference**: `docs/plan/workstreams/ws03_adapter_proving.md`
- **Phase plan**: `docs/plan/phases/01a_transport_and_constraint.md`
- **Depends on**: TASK_WS02_T4 complete and PA-signed off — `ClaudeAdapter`, `buildConstrainedPrompt`, and `sanitisedEnv()` implemented and unit-tested. `QuotagateCompleteResultSchema` from `src/types.ts` (TASK_WS01_T3).
- **Blocks**: TASK_WS03_T4 (green-gate close-out cannot run until T1, T2, T3 are all authored and passing). Does NOT block T2 or T3 — they are independent.

---

## Goal & Why

- **Goal**: Author two deliverables in this task:
  1. `tests/integration/constraint.integration.test.ts` — calls `adapter.complete()` through the real `ClaudeAdapter` against a live Claude subscription; asserts `AdapterResponse.raw` Zod-parses as `QuotagateCompleteResult` with `type: "text"` and non-empty `content`. Guards with `healthCheck()` skip if CLI unavailable.
  2. Three carry-forward unit test additions to `tests/adapters/buildConstrainedPrompt.test.ts` (T-11, T-12, T-13 — see WS_02 carry-forward notes): `system` role smoke test; `tool` role smoke test; explicit assertion that both return-format example JSON substrings are present in the constraint output.

- **Why**: The integration test is the proof that Quotagate's own constraint code path works — not a one-liner experiment from spec §5.2, but `ClaudeAdapter.complete()` through `buildConstrainedPrompt()` through `sanitisedEnv()` through a real subprocess. The word "our" matters: `buildConstrainedPrompt` was unit-tested against its own output, but only WS_03 proves that output actually constrains the Claude model to return `{"type":"text",...}` raw JSON.

  The carry-forward unit tests tighten the guarantee that T1's integration assertion rests on. If a future edit removes the return-format examples from `CONSTRAINT_INSTRUCTIONS`, or silently drops `system`/`tool` role messages, the unit tests will catch it before any integration test runs. The unit tests are the fast gate; the integration test is the real-world proof.

---

## Assumptions to Test

| # | Assumption | Why we believe it | How this task tests it | If false → |
|---|---|---|---|---|
| A1 | `ClaudeAdapter.complete()` — using `buildConstrainedPrompt()`'s output as stdin and `sanitisedEnv()` as the subprocess env — produces a raw response that Zod-parses as `QuotagateCompleteResult` with `type:"text"` and non-empty `content` on a simple no-tools message | Spec §5.2 experiments confirmed this with a manual shell one-liner; WS_02 implemented `buildConstrainedPrompt` faithfully from spec §3.5 | T-I1: call `adapter.complete({ messages:[{role:'user', content:'Reply with the word pong only.'}] })` and assert `QuotagateCompleteResultSchema.safeParse(JSON.parse(raw)).success === true` with `type === 'text'` and `content.length > 0` | If the integration test fails with a prose response: the constraint wording needs iteration — fix `buildConstrainedPrompt` (WS_02 code, not the test). Do NOT loosen the Zod assertion. If the response is valid JSON but wrong shape: re-examine `CONSTRAINT_INSTRUCTIONS` against spec §3.5 verbatim |
| A2 | `sanitisedEnv()` allowlist `{PATH, USER}` is sufficient for `claude --print` to authenticate under subprocess spawn from Node.js, not just from the shell | WS_02 T3 empirical spike confirmed `{PATH, USER}` on macOS (darwin 25.5.0) under a shell invocation; Node subprocess spawn is slightly different (no shell init, different fd inheritance) | The integration test itself is the proof — if it passes, subprocess spawn from Node authenticates correctly; if it fails with an auth error, the allowlist needs extension | If auth fails under Node spawn but not shell: add `HOME` to the allowlist temporarily; re-validate without it; record the outcome as an update to WS_02-D2-allowlist; do not ship with an unexplained expanded allowlist |
| A3 | `buildConstrainedPrompt` correctly handles all four `OpenAIMessage` roles (`user`, `assistant`, `system`, `tool`) without crashing or silently dropping messages | WS_02 T2 covered `user` and `assistant` roles; `system` and `tool` were noted as carry-forward items | T-11 and T-12 unit tests construct messages with `system` and `tool` roles respectively and assert the role label appears in the output and no exception is thrown | If a `system` or `tool` role message is dropped or causes an exception: fix `buildConstrainedPrompt` in `src/adapters/claude.ts` — the message serialization loop must handle all four `OpenAIMessage.role` values |
| A4 | The return-format examples in `CONSTRAINT_INSTRUCTIONS` (`{"type":"text",...}` and `{"type":"tool_call",...}`) are present in the prompt produced by `buildConstrainedPrompt` | `CONSTRAINT_INSTRUCTIONS` is a static constant containing these strings verbatim; a unit test asserting their presence provides a tripwire against future wording changes that remove them | T-13 asserts both format example substrings are present in `buildConstrainedPrompt`'s output | If either example is absent: the constraint wording has drifted from spec §3.5 — restore the verbatim text; do not patch the test to make it pass |

---

## Expected Failures

- **EF1** The integration test directory `tests/integration/` does not exist yet — the BSE must create it. Creating `tests/integration/constraint.integration.test.ts` requires `mkdir -p tests/integration/` first. Vitest's `include: ['tests/**/*.test.ts']` glob pattern does NOT include `.integration.test.ts` files — verifying the exclusion is part of Subtask 2 (run `npm test` without the integration test running; confirm the file is excluded).
- **EF2** Vitest's `ctx.skip()` API for runtime test skipping: the correct pattern in Vitest is `test('name', async (ctx) => { if (!healthy) { ctx.skip(); return; } ... })`. The `ctx` parameter is a `TaskContext` passed by Vitest to the test function. Do NOT use `test.skip()` (marks the test as permanently skipped at parse time). The `ctx.skip()` call must be followed by `return` to halt the test body — omitting the `return` causes the remainder of the test body to execute despite the skip.
- **EF3** `JSON.parse(raw)` can throw a `SyntaxError` if the model returns prose instead of JSON. The integration test must NOT catch this silently — let it propagate as a test failure. A `SyntaxError` here means the constraint is not working; it is not a test infrastructure bug. The failure message "SyntaxError: Unexpected token" in the test output is diagnostic signal.
- **EF4** `QuotagateCompleteResultSchema.safeParse()` returns `{ success: false, error: ZodError }` on a valid JSON object that does not match either discriminated union arm (e.g. `{ type: "unknown" }`). The test must assert `result.success === true` before accessing `result.data` — TypeScript's discriminated union narrowing on `SafeParseReturn` enforces this at compile time. Use `.data` only inside an `if (result.success)` branch.
- **EF5** Test timeout: `claude --print` takes 50–200ms to boot plus model inference time (typically 1–5 seconds for a short response). Use `{ timeout: 15_000 }` on the integration test's `it()` block. The default Vitest timeout of 5 seconds is too short.
- **EF6** `npm run test:cov` may report a coverage regression on `src/adapters/claude.ts` if the carry-forward unit tests were the marginal tests hitting the `system`/`tool` branches. They are not — `buildConstrainedPrompt`'s message-serialization loop is branch-covered by the existing T-2/T-3 tests regardless of role value. But confirm with `npm run test:cov` after the carry-forward tests are added.

---

## Test Strategy

- **Unit** (carry-forward additions to `tests/adapters/buildConstrainedPrompt.test.ts`): Three new test cases (T-11, T-12, T-13) added to the existing describe block. No I/O, no subprocess. These are pure-function assertions; no mocks needed. They must not increase the wall-clock time of `npm test` by more than a few milliseconds.
- **Integration** (`tests/integration/constraint.integration.test.ts`): Spawns the real `claude --print` subprocess via `ClaudeAdapter.complete()`. No mocks. No stub adapters. A mock here would test the mock, not the transport (WS_03-D1). The `healthCheck()` guard (EF2 skip pattern) keeps the local green gate clean when the subscription is unavailable.
- **Contract**: The Zod schema assertion (`QuotagateCompleteResultSchema.safeParse`) is the contract test — it asserts the adapter's output conforms to the shape that WS_04 (`validator.ts`) and WS_07 (`responseBuilder.ts`) will depend on. This is not a test of the Zod schema itself; it is a test of the adapter's conformance to the output contract.
- **Contamination/Isolation**: Not in scope for this task. T1 sends one request. Sequential contamination is T3.
- **Manual/spike**: None required beyond running the integration test locally. If T-I1 fails, the diagnostic path is: (a) check `await adapter.healthCheck()` manually, (b) confirm `claude --print` is reachable from Node subprocess, (c) inspect `AdapterResponse.raw` by temporarily logging it in the test.

---

## Contract: What This Task Inherits

| Symbol / Artifact | Source | Role in This Task |
|---|---|---|
| `ClaudeAdapter` | `src/adapters/claude.ts` (TASK_WS02_T4) | Instantiated in the integration test via `new ClaudeAdapter()`; called via `adapter.complete()` — not `_completeViaSubprocess()` directly |
| `CLIAdapter` | `src/adapters/base.ts` (TASK_WS02_T1) | The integration test types the adapter as `CLIAdapter`, not `ClaudeAdapter` — tests the public contract, not the private implementation |
| `AdapterRequest`, `AdapterResponse` | `src/types.ts` (TASK_WS01_T3) | `complete()` parameter and return type; `raw: string` is Zod-parsed |
| `QuotagateCompleteResultSchema` | `src/types.ts` (TASK_WS01_T3) | Used directly in the integration test to parse `AdapterResponse.raw`; discriminated union with `type:"text"` and `type:"tool_call"` arms |
| `buildConstrainedPrompt` | `src/adapters/claude.ts` (TASK_WS02_T2) | Carry-forward unit tests (T-11, T-12, T-13) import and call this function directly |
| Existing test file | `tests/adapters/buildConstrainedPrompt.test.ts` (TASK_WS02_T2) | T-11/T-12/T-13 are appended to the existing `describe('buildConstrainedPrompt', ...)` block — do not create a new file |

---

## Subtask Progress Table

| # | Subtask | Status | Iteration | Notes |
|---|---|---|---|---|
| 1 | Create `tests/integration/` directory; confirm `vitest.config.ts` excludes `*.integration.test.ts` files (by file-naming convention — they are NOT picked up by `include: ['tests/**/*.test.ts']`; verify this by adding a trivial file and confirming `npm test` does not count it) | ⬚ Not started | — | |
| 2 | Add T-11 (system role smoke test) and T-12 (tool role smoke test) to `tests/adapters/buildConstrainedPrompt.test.ts` — append to the existing describe block | ⬚ Not started | — | |
| 3 | Add T-13 (return-format example substring assertions) to `tests/adapters/buildConstrainedPrompt.test.ts` | ⬚ Not started | — | |
| 4 | Run `npm test` — confirm 3 new unit tests pass and total ≥ 30; confirm `npm run typecheck` and `npm run lint` clean | ⬚ Not started | — | |
| 5 | Author `tests/integration/constraint.integration.test.ts` with the `healthCheck()` guard, `adapter.complete()` call, `JSON.parse(raw)`, and `QuotagateCompleteResultSchema.safeParse()` assertion (see Required Test Cases for T-I1) | ⬚ Not started | — | |
| 6 | Run the integration test locally: `npx vitest run tests/integration/constraint.integration.test.ts --timeout 15000` — confirm T-I1 passes and `AdapterResponse.backend === 'claude-subprocess'` | ⬚ Not started | — | |
| 7 | Run full green gate: `npm test` (unit suite only — integration test excluded by naming convention), `npm run typecheck`, `npm run lint`, `npm run format` — confirm all clean and no regressions | ⬚ Not started | — | |

_Status icons: `✅ Done` | `🔄 In progress` | `⬚ Not started` | `❌ Blocked`_

---

## Current Subtask Detail

### Subtask 1: Create integration directory + verify exclusion

**Approach iteration plan** (simplest → target):

1. `mkdir -p tests/integration/` and create a one-line placeholder (`// placeholder`) named `placeholder.integration.test.ts`. Run `npm test` and confirm the placeholder is not counted in the test output. Delete the placeholder. This confirms `.integration.test.ts` files are excluded from the unit suite by the `include: ['tests/**/*.test.ts']` glob (which matches `*.test.ts` but not `*.integration.test.ts`).
2. If the glob unexpectedly DOES match `.integration.test.ts` files: update `vitest.config.ts` to add `exclude: process.env['CI'] ? ['tests/integration/**'] : []` — but first confirm this is actually needed, because the double-extension `*.integration.test.ts` should NOT match the single-star pattern `*.test.ts`. The Vitest glob engine matches the full filename against `*.test.ts`; a filename ending in `.integration.test.ts` ends in `.test.ts` and WILL match. In that case the exclude is necessary and must be added as part of this subtask, not deferred to T4.

- **Current iteration**: 1 of 2
- **Verifiability / Success Criteria**: `npm test` output does not include any file from `tests/integration/` in its test count.
- **Challenges**: The `*.integration.test.ts` glob matching behavior of Vitest is the critical unknown here. If the glob matches, the vitest.config.ts change belongs in T4 (green-gate close-out) per WS_03-D4 — but the directory creation and the verification step belong here regardless.

### Subtask 5: Author the integration test

**Approach iteration plan** (simplest → target):

1. Write the `healthCheck()` guard and `ctx.skip()` pattern first (EF2). Verify it compiles and that `ctx` is typed as `TaskContext` in the Vitest import.
2. Add the `adapter.complete()` call and capture `raw`. Add `console.log` to inspect `raw` on first run — remove after confirmed.
3. Add `JSON.parse(raw)` (no try/catch — let `SyntaxError` propagate as a test failure per EF3). Add `QuotagateCompleteResultSchema.safeParse(parsed)` and the success + `type === 'text'` + `content.length > 0` assertions.

- **Current iteration**: 1 of 3
- **Verifiability / Success Criteria**: SC-I1 passes. `result.data.type === 'text'` and `result.data.content` is a non-empty string.
- **Challenges**: EF1 (directory creation), EF2 (skip pattern), EF3 (do not catch SyntaxError), EF5 (timeout).

---

## Decisions Made

### WS_03-D1 — Integration Tests Run Against the Real Subscription; No Mock Adapter ✅ LOCKED (Architect, 2026-06-08)

**Decision**: The integration tests invoke the real `claude --print` subprocess via `ClaudeAdapter.complete()`. No mock adapter, no stub subprocess.

**Rationale**: A mock proves nothing about the real transport. The point of WS_03 is to prove the real code path — `buildConstrainedPrompt()` output → subprocess stdin → model → `AdapterResponse.raw` — against the actual Claude subscription. The risk of flakiness from auth/network is managed by the `healthCheck()` guard (EF2 skip pattern), not by mocking away the transport.

**Rejected alternative — mock `child_process.spawn` and assert on the spawned command**: This is a unit test, not an integration test. It proves the spawn call shape, not that the model responds correctly to the constraint. Belongs in WS_02 T4, not here.

**Rejected alternative — use a `StubAdapter` that returns a hardcoded `AdapterResponse`**: Proves nothing. The entire point of T1 is to prove the real adapter works.

### WS_03-D2 — Integration Test File Naming Convention: `*.integration.test.ts` ✅ LOCKED (Architect, 2026-06-09)

**Decision**: Integration tests are named `<name>.integration.test.ts` (not `<name>.test.ts`). This distinguishes them visually and — if the Vitest glob behavior requires it — allows a targeted `exclude` pattern in `vitest.config.ts` gated on `process.env['CI']`.

**Rationale**: File-naming is the simplest and most legible convention. It requires zero Vitest config change in the common case (double-extension files may already be excluded by the `include` glob) and only requires a config change if the glob unexpectedly matches. Minimal config, maximum clarity.

**Rejected alternative — Vitest workspace / `projects` config**: Adds a second configuration file and a separate test run invocation. Overkill for a naming problem.

**Rejected alternative — `test.concurrent` tag marker**: Requires a Vitest config change regardless; less visible in the file browser; harder to grep.

### WS_03-D5 — Integration Test Types the Adapter as `CLIAdapter`, Not `ClaudeAdapter` ✅ LOCKED (Architect, 2026-06-09)

**Decision**: The integration test declares `const adapter: CLIAdapter = new ClaudeAdapter()`. It does NOT call `_completeViaSubprocess()` directly.

**Rationale**: The integration test proves the public contract, not the private implementation. If a future Phase 2 change renames or refactors `_completeViaSubprocess()`, the integration test should not need to change. Typing the variable as `CLIAdapter` enforces that the test is agnostic to the implementation detail.

**Rejected alternative — call `_completeViaSubprocess()` directly**: Tests the private method, not the public `CLIAdapter` contract. Breaks on any refactoring that moves the transport into a differently-named method.

### Anti-overengineering scope fence ✅ LOCKED

**This task explicitly does NOT include**:

- Execution suppression assertion (file not read) — T2 owns this.
- Contamination probe (sequential call B does not contain call A's token) — T3 owns this.
- `vitest.config.ts` changes for CI exclusion — T4 owns this (WS_03-D4, locked there).
- Tests for `tool_call` response branch — T2 owns this.
- `system` or `tool` role messages in the integration test — carry-forward unit tests (T-11, T-12) prove the function handles these roles; the integration test uses a simple `user` role message only. Running integration tests for every role permutation is over-testing the integration layer.
- Any retry logic or validator wrapping — WS_04 owns this. T1 calls `adapter.complete()` and Zod-parses the raw string directly — no retry, no `ValidationError` wrapping.

---

## Cross-Task Contracts (Downstream Dependencies on This Task)

### TASK_WS03_T4 will depend on:

- `tests/integration/constraint.integration.test.ts` exists and passes locally (T-I1 passes, `npm test` still excludes it from the unit suite).
- The carry-forward unit tests (T-11, T-12, T-13) exist in `tests/adapters/buildConstrainedPrompt.test.ts` and pass with `npm test`.
- Total unit test count ≥ 30 (27 baseline + 3 carry-forward).

### TASK_WS03_T2 and T3 will reuse:

- The `healthCheck()` guard pattern (EF2) authored in this task. T2 and T3 use the same skip-if-unavailable pattern — do not vary the pattern between tasks.
- The `tests/integration/` directory created in Subtask 1.

---

## Files Modified / Created

- `tests/integration/constraint.integration.test.ts` — **create new** (integration test; see Required Test Cases T-I1)
- `tests/adapters/buildConstrainedPrompt.test.ts` — **modify** (append T-11, T-12, T-13 to the existing describe block)
- `tests/integration/` — **create directory**

---

## Success Criteria / Verifiability

| # | Criterion | How to verify |
|---|---|---|
| SC-1 | `tests/integration/` directory exists | `ls tests/integration/` |
| SC-2 | `npm test` does NOT include `constraint.integration.test.ts` in its test count (unit suite only) | Run `npm test`; confirm test file path does not appear in output (or `vitest.config.ts` exclude is in place per T4's WS_03-D4) |
| SC-3 | T-11: `system` role message content appears in `buildConstrainedPrompt` output without exception | `npm test` — T-11 passes |
| SC-4 | T-12: `tool` role message content appears in `buildConstrainedPrompt` output without exception | `npm test` — T-12 passes |
| SC-5 | T-13: both return-format JSON example substrings (`"type": "text"` and `"type": "tool_call"`) are present in `buildConstrainedPrompt` output | `npm test` — T-13 passes |
| SC-6 | `adapter.complete({ messages:[{role:'user', content:'Reply pong.'}] })` returns `AdapterResponse` where `JSON.parse(raw)` succeeds without `SyntaxError` | T-I1 integration test passes locally |
| SC-7 | `QuotagateCompleteResultSchema.safeParse(JSON.parse(raw))` returns `{ success: true, data: { type: 'text', content: <non-empty string> } }` | T-I1 assertions pass |
| SC-8 | `AdapterResponse.backend === 'claude-subprocess'` | T-I1 assertion passes |
| SC-I-skip | When `adapter.healthCheck()` returns `false`, the integration test is skipped (not failed) | Simulate by temporarily making healthCheck return false; confirm Vitest output shows `skipped` not `failed` |
| SC-9 | `npm run typecheck` clean — zero errors | `npx tsc --noEmit`; zero output |
| SC-10 | `npm run lint` clean; `npm run format` no diff | Zero ESLint violations; Prettier reports no files changed |
| SC-11 | `npm test` green and total unit test count ≥ 30; no regressions from the 27-test WS_02 baseline | `npm test` output shows 30+ passing |

---

## Required Test Cases

### Carry-forward unit tests (append to `tests/adapters/buildConstrainedPrompt.test.ts`)

#### T-11: system role message content appears in output (covers SC-3, A3)

Construct `messages = [{ role: 'system', content: 'You are a helpful proxy.' }, { role: 'user', content: 'hello' }]`. Call `buildConstrainedPrompt(messages, undefined, 'none')`. Assert the result contains `'You are a helpful proxy.'`. Assert no exception was thrown (the call itself is the implicit assertion). Assert the result contains `'hello'` — proving the `system` role message did not corrupt serialization of subsequent messages.

#### T-12: tool role message content appears in output (covers SC-4, A3)

Construct `messages = [{ role: 'user', content: 'call fn' }, { role: 'tool', content: '{"result": 42}', tool_call_id: 'call_abc123' }]`. Call `buildConstrainedPrompt(messages, undefined, 'none')`. Assert the result contains `'{"result": 42}'`. Assert the result contains `'call fn'` — proving the `tool` role message did not corrupt prior messages.

#### T-13: both return-format example JSON substrings are present in constraint output (covers SC-5, A4)

Call `buildConstrainedPrompt([{ role: 'user', content: 'x' }], undefined, 'none')`. Assert the result contains the substring `'"type": "text"'`. Assert the result contains the substring `'"type": "tool_call"'`. (These are the return-format examples from spec §3.5 that must survive any future `CONSTRAINT_INSTRUCTIONS` edit.)

---

### Integration test file: `tests/integration/constraint.integration.test.ts`

#### T-I1: constraint produces a Zod-valid `{type:"text"}` response via real adapter (covers SC-6, SC-7, SC-8, A1, A2)

```typescript
// Sketch — BSE realizes as a Vitest it() block with { timeout: 15_000 }
import { describe, it, expect } from 'vitest';
import { ClaudeAdapter } from '../../src/adapters/claude.js';
import type { CLIAdapter } from '../../src/adapters/base.js';
import { QuotagateCompleteResultSchema } from '../../src/types.js';

describe('constraint integration', () => {
  it('T-I1: adapter.complete() returns Zod-valid {type:"text"} for a no-tools message',
    async (ctx) => {
      const adapter: CLIAdapter = new ClaudeAdapter();
      const healthy = await adapter.healthCheck();
      if (!healthy) { ctx.skip(); return; }

      const response = await adapter.complete({
        messages: [{ role: 'user', content: 'Reply with only the word "pong". No other text.' }],
      });

      // EF3: let SyntaxError propagate — do not catch
      const parsed = JSON.parse(response.raw);
      const result = QuotagateCompleteResultSchema.safeParse(parsed);

      expect(result.success, 'raw response did not parse as QuotagateCompleteResult').toBe(true);
      if (result.success) {
        expect(result.data.type).toBe('text');
        expect((result.data as { type: 'text'; content: string }).content.length).toBeGreaterThan(0);
      }
      expect(response.backend).toBe('claude-subprocess');
    },
    { timeout: 15_000 },
  );
});
```

Assert that `result.data.type === 'text'`. Assert that `content` is a non-empty string. Assert `response.backend === 'claude-subprocess'`. If the `healthCheck()` returns `false`, the test is skipped via `ctx.skip()`.

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
