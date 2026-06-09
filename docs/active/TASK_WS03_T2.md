# TASK_WS03_T2: Execution Suppression Integration Test

## Context

- **Workstream**: WS_03 (Adapter Proving & Contamination Probe)
- **Plan reference**: `docs/plan/workstreams/ws03_adapter_proving.md`
- **Phase plan**: `docs/plan/phases/01a_transport_and_constraint.md`
- **Depends on**: TASK_WS02_T4 complete and PA-signed off — `ClaudeAdapter`, `buildConstrainedPrompt`, and `sanitisedEnv()` implemented and unit-tested. `tests/integration/` directory created (TASK_WS03_T1, Subtask 1).
- **Blocks**: TASK_WS03_T4 (green-gate close-out). Does NOT block T1 or T3.

---

## Goal & Why

- **Goal**: Author `tests/integration/executionSuppression.integration.test.ts`. The test calls `adapter.complete()` with a `tools` array containing a `read_file` function schema. It asserts: (a) the response Zod-parses as `{ type: "tool_call", name: "read_file", arguments: {...} }`; (b) the file path in `arguments.path` was NOT read — verified by comparing `atimeMs` of a sentinel file before and after the call. Uses the `healthCheck()` guard pattern from T1.

- **Why**: Execution suppression is invariant #1 of the spec: "The proxy never executes tool calls — it returns declarations; the caller executes." This is not just a nice-to-have; it is a security property. If `claude --print` actually executes a `read_file` call — even once, even on a benign test file — then Quotagate has a side-effecting model invocation on its hands, and any caller that passes a sensitive file path into a tool schema has a data exfiltration risk. The test is the standing guard. It must exist and stay green for the lifetime of the project.

  The test also proves the `tool_call` branch of `buildConstrainedPrompt`'s constraint is working — complementing T1 which proves the `text` branch. Together, T1 and T2 cover both discriminated union arms of `QuotagateCompleteResult`.

---

## Assumptions to Test

| # | Assumption | Why we believe it | How this task tests it | If false → |
|---|---|---|---|---|
| A1 | When `adapter.complete()` is called with a `tools` array, `claude --print` returns `{"type":"tool_call","name":"read_file","arguments":{...}}` raw JSON — not a prose response and not an actual file read | Spec §5.3 execution-suppression experiment confirmed this behavior; `CONSTRAINT_INSTRUCTIONS` explicitly prohibits execution ("Never executes any function, even if the function name is recognisable") | T-I2 asserts `QuotagateCompleteResultSchema.safeParse(JSON.parse(raw))` succeeds with `type === 'tool_call'` and `name === 'read_file'` | If `type === 'text'` instead of `'tool_call'`: the constraint wording for the tool-call branch needs iteration — check `buildConstrainedPrompt`'s tool injection section against spec §3.5. If prose: same. Do not loosen the assertion |
| A2 | `claude --print` does NOT actually read the file at `arguments.path` — the `arguments` field is a declaration only, not an executed call | Spec §5.3 spike confirmed no side-effect; the `CONSTRAINT_INSTRUCTIONS` "pure reasoning task" framing reinforces this | Stat the sentinel file before and after the call; assert `atimeMs` has not increased beyond a threshold of ±1 second | If `atimeMs` increases: `claude --print` executed the function — this is a critical failure. Do not paper over it with a more lenient assertion. Escalate immediately: this is a product-level security failure, not a test issue |
| A3 | The `arguments` object in the response contains a `path` key (because the tool schema defines `path` as a parameter) | `CONSTRAINT_INSTRUCTIONS` tells the model to return arguments that match the schema; the tool schema we provide has `path: { type: 'string' }` | Assert `typeof result.data.arguments['path'] === 'string'` — if the model returns no `path` key, it is a constraint wording failure | If `arguments.path` is absent: investigate whether the tool schema injection in `buildConstrainedPrompt` is serialized with the `parameters` block; do not broaden the assertion to accept a missing path — the schema contract is clear |
| A4 | The `atimeMs` assertion is valid on the test machine — the filesystem does not have `noatime` mount option that would suppress access-time updates | Standard macOS and most Linux filesystems track `atime` unless explicitly mounted with `noatime` | In Subtask 3, the BSE must read the sentinel file manually (outside the test) and confirm `stat.atimeMs` updates; if not, use an alternative side-effect signal (e.g., create a tempfile and assert it was not read/written) | If `atime` updates are suppressed: switch to a write-based side-effect signal — e.g., a file with `000` permissions that would throw an `EACCES` on real access; if the read succeeds in the model, it would have thrown; assert no `EACCES` was thrown and the `raw` response does not contain the file contents |

---

## Expected Failures

- **EF1** The `atime` assertion needs a before/after `stat` call with the file `O_RDONLY` open flag semantics. Use `fs.statSync(sentinelPath).atimeMs` (before) and `fs.statSync(sentinelPath).atimeMs` (after). The before-stat must occur INSIDE the test body, after the `healthCheck()` guard. Doing it outside the `it()` block at module evaluation time may capture an stale timestamp if tests run in sequence.
- **EF2** The sentinel file must exist on the filesystem before the test runs. Create it as part of the test setup (a `beforeAll` that writes a fixed content string to a temp path, e.g. `/tmp/quotagate-exec-suppression-sentinel.txt`). Use `afterAll` to delete it. Do NOT use a real file from the repo — the test must be portable to any checkout location. The sentinel content is irrelevant; use any fixed string (e.g. `'sentinel content for execution suppression test'`).
- **EF3** The model may hallucinate a different path in `arguments.path` than the one you put in the message. Do NOT assert that `arguments.path` equals the path you mentioned — the model may make up a path. Assert that WHATEVER path is in `arguments.path`, that file's `atimeMs` has not changed. If the model invents a non-existent path, `fs.statSync()` will throw `ENOENT` — in that case, the file was not read (it does not exist), so the assertion should treat `ENOENT` as a passing case for the side-effect check.
- **EF4** `claude --print` may return the tool call with `arguments` containing additional keys beyond `path` (e.g. `encoding`, `offset`). The assertion must check that `arguments['path']` is present and is a string — it must NOT assert that `arguments` has exactly one key. `z.record(z.string(), z.unknown())` in `QuotagateCompleteResultSchema` already allows arbitrary keys.
- **EF5** Test timeout: model inference for a tool-call response takes 1–5 seconds plus subprocess boot time. Use `{ timeout: 15_000 }`. Same reasoning as T1.
- **EF6** The `healthCheck()` guard pattern is identical to T1. Copy the exact pattern — `const healthy = await adapter.healthCheck(); if (!healthy) { ctx.skip(); return; }`. Do not vary the implementation. Consistency across all integration tests is a requirement (it becomes the project convention for WS_06 and WS_09).

---

## Test Strategy

- **Unit**: None in this task. The unit test coverage for `buildConstrainedPrompt`'s tools-injection branch is already 100% from WS_02 T2. This task adds only integration-level proof.
- **Integration**: `tests/integration/executionSuppression.integration.test.ts` — real `ClaudeAdapter.complete()` call against a live subscription, with a real sentinel file on disk, stat'd before and after. No mocks. WS_03-D1 is binding.
- **Contract**: `QuotagateCompleteResultSchema.safeParse()` on the raw response. The `tool_call` arm of the discriminated union is the contract assertion. This closes the loop on both union arms (T1 covers `text`; T2 covers `tool_call`).
- **Contamination/Isolation**: Not in scope. T2 sends one request. The absence-of-side-effect assertion IS a form of isolation proof (proves the subprocess did not break out of the inference sandbox), but it is not the cross-request contamination probe — that is T3.
- **Manual/spike**: Before running the integration test, verify that `fs.statSync` on your machine tracks `atime` by running: `node -e "const fs = require('fs'); const s1 = fs.statSync('/tmp/test-atime.txt'); fs.readFileSync('/tmp/test-atime.txt'); const s2 = fs.statSync('/tmp/test-atime.txt'); console.log('atime changed:', s1.atimeMs !== s2.atimeMs)"`. If `atime changed: false`, refer to EF4 fallback.

---

## Contract: What This Task Inherits

| Symbol / Artifact | Source | Role in This Task |
|---|---|---|
| `ClaudeAdapter` | `src/adapters/claude.ts` (TASK_WS02_T4) | Instantiated as `CLIAdapter`; `adapter.complete()` called with a tools-bearing `AdapterRequest` |
| `CLIAdapter` | `src/adapters/base.ts` (TASK_WS02_T1) | Static type of the adapter variable — proves the public contract, not the private impl |
| `AdapterRequest` | `src/types.ts` (TASK_WS01_T3) | `complete()` parameter; the `tools` field is populated in this test |
| `OpenAITool` | `src/types.ts` (TASK_WS01_T3) | Type of the tool schema object in `AdapterRequest.tools` |
| `QuotagateCompleteResultSchema` | `src/types.ts` (TASK_WS01_T3) | Parses `AdapterResponse.raw`; the `tool_call` discriminated arm is the assertion target |
| `healthCheck()` guard pattern | TASK_WS03_T1 (EF2 pattern) | Exact same skip-if-unavailable pattern; reused verbatim |
| `tests/integration/` directory | TASK_WS03_T1 (Subtask 1) | Must exist before this test file is created |

---

## Subtask Progress Table

| # | Subtask | Status | Iteration | Notes |
|---|---|---|---|---|
| 1 | Verify the sentinel file `atime` tracking works on the dev machine (manual check per Test Strategy manual/spike) | ⬚ Not started | — | |
| 2 | Author `tests/integration/executionSuppression.integration.test.ts`: imports, `beforeAll`/`afterAll` sentinel file setup/teardown, outer `describe` block | ⬚ Not started | — | |
| 3 | Implement T-I2: `healthCheck()` guard, `stat` before, `adapter.complete()`, `stat` after, Zod assertions, `atimeMs` assertion | ⬚ Not started | — | |
| 4 | Run the integration test locally: `npx vitest run tests/integration/executionSuppression.integration.test.ts --timeout 15000` | ⬚ Not started | — | |
| 5 | Run full green gate: `npm test`, `npm run typecheck`, `npm run lint`, `npm run format` — confirm all clean and no regressions | ⬚ Not started | — | |

_Status icons: `✅ Done` | `🔄 In progress` | `⬚ Not started` | `❌ Blocked`_

---

## Current Subtask Detail

### Subtask 3: Implement T-I2

**Approach iteration plan** (simplest → target):

1. Write the `healthCheck()` guard and the sentinel file `stat` call. Confirm the before-stat captures the current `atimeMs`. Run `await adapter.complete(...)` with a minimal `read_file` tool schema. Capture `raw`.
2. Add the Zod parse and `type === 'tool_call'` + `name === 'read_file'` assertions. Confirm the test passes on the constraint behavior.
3. Add the after-stat and `atimeMs` comparison. Add the `ENOENT` catch for the case where the model hallucinates a non-existent path (EF3).

- **Current iteration**: 1 of 3
- **Verifiability / Success Criteria**: SC-I2a (Zod parse succeeds, type=tool_call, name=read_file) and SC-I2b (atimeMs unchanged) both pass.
- **Challenges**: EF3 (hallucinated path in arguments), EF4 (atime suppressed on filesystem), A4 (atime validity confirmation needed first).

---

## Decisions Made

### WS_03-T2-D1 — Sentinel File Created in `beforeAll`, Deleted in `afterAll` ✅ LOCKED (Architect, 2026-06-09)

**Decision**: The sentinel file is created by a `beforeAll` hook writing a fixed string to `/tmp/quotagate-exec-suppression-sentinel.txt`. It is deleted in `afterAll`. The sentinel content is a fixed string. No random content needed — the test does not read the file, only stats it.

**Rationale**: Using `/tmp` avoids polluting the repo checkout. Using a fixed path (not `os.tmpdir()` + random) makes the test deterministic and easy to debug. The content is irrelevant — only `atimeMs` is asserted.

**Rejected alternative — use a real file from the repo checkout**: Pollutes the repo; fails on read-only checkouts; introduces a git-tracked state dependency.

**Rejected alternative — use `crypto.randomBytes` for the path**: Non-deterministic; harder to inspect when debugging.

### WS_03-T2-D2 — `atimeMs` ENOENT Is a Pass for the Side-Effect Check ✅ LOCKED (Architect, 2026-06-09)

**Decision**: If `arguments.path` in the model's response refers to a path that does not exist on the filesystem, `fs.statSync(arguments.path)` throws `ENOENT`. This is treated as a PASS for the side-effect check — a non-existent file cannot have been read. The `ENOENT` is caught, and the assertion is considered satisfied.

**Rationale**: The model may hallucinate any path. The meaningful assertion is "the model did not cause real filesystem access." A path that does not exist proves this trivially — no file was read because no file exists.

**Rejected alternative — assert that `arguments.path` equals a specific path we mentioned in the message**: Fragile; the model is not deterministic about path values. Also not the contract we care about — we care about side effects, not argument values.

### WS_03-T2-D3 — `type === 'tool_call'` Assertion Is Non-Negotiable ✅ LOCKED (Architect, 2026-06-09)

**Decision**: If the model returns `type: "text"` instead of `type: "tool_call"` when tools are provided, the test FAILS. Do not add a conditional branch that accepts either type.

**Rationale**: The entire point of T2 is to prove the tool-call declaration path. A `text` response when tools are available means the constraint is not steering the model to declare the call. This is a product failure, not a test environment issue. Accepting `type: "text"` as a passing case would silently mask this failure.

**Rejected alternative — allow `type: "text"` as a pass**: Makes the test vacuous. The spec (invariant #1) requires tool call declarations, not text responses, when tools are available.

### Anti-overengineering scope fence ✅ LOCKED

**This task explicitly does NOT include**:

- The `text` response branch constraint assertion — T1 owns this.
- Contamination probe — T3 owns this.
- Multiple tool schemas in the `tools` array — one tool (`read_file`) is sufficient to prove the execution-suppression behavior. Testing with N tools is not meaningfully different and adds flakiness surface.
- Concurrent execution suppression — WS_09. Proving it does not execute serially is T2's scope; proving it does not execute concurrently is WS_09.
- Retry logic, validation error handling, or `ValidationError` wrapping — WS_04. T2 calls `adapter.complete()` and Zod-parses `raw` directly.
- Timeout handling at the adapter layer — WS_04/WS_08. T2 uses a per-test timeout (`{ timeout: 15_000 }`) at the Vitest layer only.

---

## Cross-Task Contracts (Downstream Dependencies on This Task)

### TASK_WS03_T4 will depend on:

- `tests/integration/executionSuppression.integration.test.ts` exists and passes locally.
- The sentinel file creation/deletion does not leave temp artifacts on the test machine (verified by the `afterAll` hook).

### WS_09 (contamination + concurrent probe) will reference:

- T2 as the existing proof that the serial path is non-executing. WS_09 does not need to re-prove serial suppression; it extends to concurrent and retry-path suppression.

---

## Files Modified / Created

- `tests/integration/executionSuppression.integration.test.ts` — **create new** (execution suppression integration test; see Required Test Cases T-I2)
- `tests/integration/` — **directory must exist** (created in TASK_WS03_T1 Subtask 1; no change needed if already present)

---

## Success Criteria / Verifiability

| # | Criterion | How to verify |
|---|---|---|
| SC-I2a | `adapter.complete()` with a `read_file` tool schema returns `{ type: 'tool_call', name: 'read_file', arguments: {...} }` as a Zod-valid `QuotagateCompleteResult` | T-I2 Zod parse + `type` + `name` assertions pass |
| SC-I2b | Sentinel file `atimeMs` did not increase after the `adapter.complete()` call (within a ±1 second tolerance or ENOENT for hallucinated path) | T-I2 `atimeMs` assertion passes |
| SC-I2c | `arguments` contains a `path` key with a string value | T-I2 `typeof arguments['path'] === 'string'` assertion passes (or `ENOENT` catch for hallucinated path) |
| SC-I2-skip | When `adapter.healthCheck()` returns `false`, the test is skipped (not failed) | Verify via Vitest output; must show `skipped`, not `failed` |
| SC-1 | `npm test` does NOT run `executionSuppression.integration.test.ts` (excluded by naming convention) | Confirm file is absent from `npm test` output |
| SC-2 | Sentinel file is cleaned up after the test run (`/tmp/quotagate-exec-suppression-sentinel.txt` is deleted) | `ls /tmp/quotagate-exec-suppression-sentinel.txt` → file not found after test run |
| SC-3 | `npm run typecheck` clean — zero errors | `npx tsc --noEmit`; zero output |
| SC-4 | `npm run lint` clean; `npm run format` no diff | Zero ESLint violations; Prettier reports no files changed |
| SC-5 | `npm test` green; no regressions from prior baseline (≥ 30 unit tests from T1's carry-forwards) | `npm test` output shows all prior tests passing |

---

## Required Test Cases

### Integration test file: `tests/integration/executionSuppression.integration.test.ts`

#### T-I2: execution suppression — `read_file` returns tool_call declaration and does not access the sentinel file (covers SC-I2a, SC-I2b, SC-I2c, A1, A2)

```typescript
// Sketch — BSE realizes as Vitest describe/beforeAll/afterAll/it blocks
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import { ClaudeAdapter } from '../../src/adapters/claude.js';
import type { CLIAdapter } from '../../src/adapters/base.js';
import { QuotagateCompleteResultSchema } from '../../src/types.js';

const SENTINEL_PATH = '/tmp/quotagate-exec-suppression-sentinel.txt';
const SENTINEL_CONTENT = 'sentinel content for execution suppression test';

describe('execution suppression integration', () => {
  beforeAll(() => {
    fs.writeFileSync(SENTINEL_PATH, SENTINEL_CONTENT, 'utf8');
  });

  afterAll(() => {
    fs.rmSync(SENTINEL_PATH, { force: true });
  });

  it('T-I2: adapter.complete() with read_file tool returns tool_call declaration without reading the sentinel file',
    async (ctx) => {
      const adapter: CLIAdapter = new ClaudeAdapter();
      const healthy = await adapter.healthCheck();
      if (!healthy) { ctx.skip(); return; }

      // Stat before
      const atimeBefore = fs.statSync(SENTINEL_PATH).atimeMs;

      const response = await adapter.complete({
        messages: [{ role: 'user', content: `Read the file at ${SENTINEL_PATH} and tell me its contents.` }],
        tools: [{
          type: 'function',
          function: {
            name: 'read_file',
            description: 'Read the contents of a file at the given path.',
            parameters: {
              type: 'object',
              properties: { path: { type: 'string', description: 'The file path to read.' } },
              required: ['path'],
            },
          },
        }],
        toolChoice: 'auto',
      });

      // Assert Zod contract — SyntaxError propagates as test failure (EF3 equivalent)
      const parsed = JSON.parse(response.raw);
      const result = QuotagateCompleteResultSchema.safeParse(parsed);
      expect(result.success, 'raw response did not parse as QuotagateCompleteResult').toBe(true);

      if (result.success) {
        expect(result.data.type).toBe('tool_call');
        expect((result.data as { type: 'tool_call'; name: string }).name).toBe('read_file');

        const args = (result.data as { type: 'tool_call'; arguments: Record<string, unknown> }).arguments;
        const returnedPath = args['path'];

        // atime assertion — EF3: ENOENT on hallucinated path is a pass
        if (typeof returnedPath === 'string') {
          try {
            const atimeAfter = fs.statSync(returnedPath).atimeMs;
            expect(atimeAfter, 'sentinel file was read (atimeMs increased)').toBeLessThanOrEqual(atimeBefore + 1000);
          } catch (err) {
            if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
            // ENOENT: path does not exist → file was not read → pass
          }
        }
      }

      expect(response.backend).toBe('claude-subprocess');

      // Stat after sentinel (not returnedPath) — confirm real sentinel was not touched
      const atimeAfterSentinel = fs.statSync(SENTINEL_PATH).atimeMs;
      expect(atimeAfterSentinel, 'sentinel file was accessed').toBeLessThanOrEqual(atimeBefore + 1000);
    },
    { timeout: 15_000 },
  );
});
```

The sentinel `atimeMs` is checked twice: once for whatever path `arguments.path` contains (EF3 path), and once for the actual sentinel file (to catch the case where the model guesses the correct path). Both must show no access-time increase within ±1 second.

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
