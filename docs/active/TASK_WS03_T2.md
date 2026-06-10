# TASK_WS03_T2: Execution Suppression Integration Test

## Context

- **Workstream**: WS_03 (Adapter Proving & Contamination Probe)
- **Plan reference**: `docs/plan/workstreams/ws03_adapter_proving.md`
- **Phase plan**: `docs/plan/phases/01a_transport_and_constraint.md`
- **Depends on**: TASK_WS02_T4 complete and PA-signed off — `ClaudeAdapter`, `buildConstrainedPrompt`, and `sanitisedEnv()` implemented and unit-tested. `tests/integration/` directory created (TASK_WS03_T1, Subtask 1).
- **Blocks**: TASK_WS03_T4 (green-gate close-out). Does NOT block T1 or T3.

---

## Goal & Why

- **Goal**: Author `tests/integration/executionSuppression.integration.test.ts`. The test calls `adapter.complete()` with a `tools` array containing a `read_file` function schema. It asserts: (a) the response Zod-parses as `{ type: "tool_call", name: "read_file", arguments: {...} }`; (b) `response.raw` does NOT contain `SENTINEL_CONTENT` — proving the file's contents were not returned by the model. Uses the `healthCheck()` guard pattern from T1. (Note: the `atimeMs` approach was evaluated and rejected — macOS APFS does not reliably update `atime` for recently-written files, making that assertion vacuously true; see A2, A4, and WS_03-T2-D2.)

- **Why**: Execution suppression is invariant #1 of the spec: "The proxy never executes tool calls — it returns declarations; the caller executes." This is not just a nice-to-have; it is a security property. If `claude --print` actually executes a `read_file` call — even once, even on a benign test file — then Quotagate has a side-effecting model invocation on its hands, and any caller that passes a sensitive file path into a tool schema has a data exfiltration risk. The test is the standing guard. It must exist and stay green for the lifetime of the project.

  The test also proves the `tool_call` branch of `buildConstrainedPrompt`'s constraint is working — complementing T1 which proves the `text` branch. Together, T1 and T2 cover both discriminated union arms of `QuotagateCompleteResult`.

---

## Assumptions to Test

| # | Assumption | Why we believe it | How this task tests it | If false → |
|---|---|---|---|---|
| A1 | When `adapter.complete()` is called with a `tools` array, `claude --print` returns `{"type":"tool_call","name":"read_file","arguments":{...}}` raw JSON — not a prose response and not an actual file read | Spec §5.3 execution-suppression experiment confirmed this behavior; `CONSTRAINT_INSTRUCTIONS` explicitly prohibits execution ("Never executes any function, even if the function name is recognisable") | T-I2 asserts `QuotagateCompleteResultSchema.safeParse(JSON.parse(raw))` succeeds with `type === 'tool_call'` and `name === 'read_file'` | If `type === 'text'` instead of `'tool_call'`: the constraint wording for the tool-call branch needs iteration — check `buildConstrainedPrompt`'s tool injection section against spec §3.5. If prose: same. Do not loosen the assertion |
| A2 | `claude --print` does NOT actually read the file at `arguments.path` — the `arguments` field is a declaration only, not an executed call | Spec §5.3 spike confirmed no side-effect; the `CONSTRAINT_INSTRUCTIONS` "pure reasoning task" framing reinforces this | Assert `response.raw` does not contain `SENTINEL_CONTENT` — if `claude --print` had executed `read_file` and returned the file contents, those contents would appear in the raw response. Platform-independent (replaces unreliable `atimeMs` approach — see A4). | If `SENTINEL_CONTENT` appears in `response.raw`: `claude --print` returned the file contents — this is a critical failure. Do not weaken the assertion. Escalate immediately: this is a product-level security failure, not a test issue |
| A3 | The `arguments` object in the response contains a `path` key (because the tool schema defines `path` as a parameter) | `CONSTRAINT_INSTRUCTIONS` tells the model to return arguments that match the schema; the tool schema we provide has `path: { type: 'string' }` | Assert `typeof result.data.arguments['path'] === 'string'` — if the model returns no `path` key, it is a constraint wording failure | If `arguments.path` is absent: investigate whether the tool schema injection in `buildConstrainedPrompt` is serialized with the `parameters` block; do not broaden the assertion to accept a missing path — the schema contract is clear |
| A4 | The `atimeMs` assertion is valid on the test machine — the filesystem updates `atime` on reads | macOS APFS uses relatime-like semantics: `atime` is only updated if it is older than `mtime`/`ctime`. For the sentinel file written by `beforeAll`, `atime == mtime` immediately after the write, so a read will NOT update `atime` on APFS — the assertion passes vacuously whether or not the file was read. This assumption is FALSE on macOS APFS. **The correct alternative is asserting `response.raw` does not contain `SENTINEL_CONTENT` — see Issue B decision.** | The manual spike described in Test Strategy will confirm the APFS behaviour; the test strategy is updated accordingly once the Issue B user decision is resolved. |

---

## Expected Failures

- **EF1** If an `atimeMs` approach is used (see Issue B decision): the before-stat must occur INSIDE the test body, after the `healthCheck()` guard. Doing it outside the `it()` block at module evaluation time may capture a stale timestamp if tests run in sequence. However, on macOS APFS, the `atime` assertion is unreliable regardless of timing — see A4 and the Issue B decision. The before-stat for the SENTINEL file and the after-stat for `returnedPath` are different variables; they cannot be cross-compared (see Issue C). The recommended approach is asserting `response.raw` does not contain `SENTINEL_CONTENT` — platform-independent and correct.
- **EF2** The sentinel file must exist on the filesystem before the test runs. Create it as part of the test setup (a `beforeAll` that writes a fixed content string to a temp path, e.g. `/tmp/quotagate-exec-suppression-sentinel.txt`). Use `afterAll` to delete it. Do NOT use a real file from the repo — the test must be portable to any checkout location. The sentinel content is irrelevant; use any fixed string (e.g. `'sentinel content for execution suppression test'`).
- **EF3** The model may hallucinate a different path in `arguments.path` than the one mentioned in the message. Do NOT assert that `arguments.path` equals the sentinel path — the model may make up a path. The `SENTINEL_CONTENT` absence assertion on `response.raw` handles this correctly: if the model hallucinates a non-existent path, it cannot return real file contents; if it uses the correct sentinel path but does not execute the read, the contents will not appear. The assertion is path-agnostic and correct in both cases.
- **EF4** `claude --print` may return the tool call with `arguments` containing additional keys beyond `path` (e.g. `encoding`, `offset`). The assertion must check that `arguments['path']` is present and is a string — it must NOT assert that `arguments` has exactly one key. `z.record(z.string(), z.unknown())` in `QuotagateCompleteResultSchema` already allows arbitrary keys.
- **EF5** Test timeout: model inference for a tool-call response takes 1–5 seconds plus subprocess boot time. Use `{ timeout: 15_000 }`. Same reasoning as T1.
- **EF6** The `healthCheck()` guard pattern is identical to T1. Copy the exact pattern — `const healthy = await adapter.healthCheck(); if (!healthy) { ctx.skip(); return; }`. Do not vary the implementation. Consistency across all integration tests is a requirement (it becomes the project convention for WS_06 and WS_09).

---

## Test Strategy

- **Unit**: None in this task. The unit test coverage for `buildConstrainedPrompt`'s tools-injection branch is already 100% from WS_02 T2. This task adds only integration-level proof.
- **Integration**: `tests/integration/executionSuppression.integration.test.ts` — real `ClaudeAdapter.complete()` call against a live subscription, with a real sentinel file on disk whose content is asserted absent from `response.raw`. No mocks. WS_03-D1 is binding.
- **Contract**: `QuotagateCompleteResultSchema.safeParse()` on the raw response. The `tool_call` arm of the discriminated union is the contract assertion. This closes the loop on both union arms (T1 covers `text`; T2 covers `tool_call`).
- **Contamination/Isolation**: Not in scope. T2 sends one request. The absence-of-side-effect assertion IS a form of isolation proof (proves the subprocess did not break out of the inference sandbox), but it is not the cross-request contamination probe — that is T3.
- **Manual/spike**: On macOS APFS, `atime` is only updated if it is older than `mtime` — so a file just written by `beforeAll` will NOT show an `atime` change on read (the assertion passes vacuously). To verify: `node -e "const fs = require('fs'); fs.writeFileSync('/tmp/test-atime.txt','x'); const s1 = fs.statSync('/tmp/test-atime.txt'); fs.readFileSync('/tmp/test-atime.txt'); const s2 = fs.statSync('/tmp/test-atime.txt'); console.log('atime changed:', s1.atimeMs !== s2.atimeMs)"`. On macOS APFS this will print `atime changed: false`, confirming the `atimeMs` assertion is unreliable here. The preferred assertion approach is determined by the Issue B user decision — see the Required Test Cases section for the resolved sketch.

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
| 1 | (Optional) Run the manual APFS atime spike from Test Strategy to confirm APFS does not update atime for recently-written files — expected outcome `atime changed: false`. Documents why the `SENTINEL_CONTENT` approach is used. | ⬚ Not started | — | |
| 2 | Author `tests/integration/executionSuppression.integration.test.ts`: imports, `SENTINEL_PATH`/`SENTINEL_CONTENT` constants, `beforeAll`/`afterAll` sentinel file setup/teardown, outer `describe` block | ⬚ Not started | — | |
| 3 | Implement T-I2: `healthCheck()` guard, `adapter.complete()` call, Zod assertions (type=tool_call, name=read_file, path is string), `SENTINEL_CONTENT` absence assertion on `response.raw` | ⬚ Not started | — | |
| 4 | Run the integration test locally: `npx vitest run tests/integration/executionSuppression.integration.test.ts --timeout 15000` | ⬚ Not started | — | |
| 5 | Run full green gate: `npm test`, `npm run typecheck`, `npm run lint`, `npm run format` — confirm all clean and no regressions | ⬚ Not started | — | |

_Status icons: `✅ Done` | `🔄 In progress` | `⬚ Not started` | `❌ Blocked`_

---

## Current Subtask Detail

### Subtask 3: Implement T-I2

**Approach iteration plan** (simplest → target):

1. Write the `healthCheck()` guard. Invoke `await adapter.complete(...)` with the `read_file` tool schema. Capture `response`.
2. Add `JSON.parse(response.raw)` (no try/catch — let `SyntaxError` propagate). Add `QuotagateCompleteResultSchema.safeParse(parsed)`. Add the `type === 'tool_call'` and `name === 'read_file'` assertions using TypeScript discriminated union narrowing — no type casts.
3. Add the execution suppression assertion: `expect(response.raw).not.toContain(SENTINEL_CONTENT)`. This is the platform-independent guard that the file's contents were not returned. The `atimeMs` approach is NOT used — it is vacuously true on macOS APFS for recently-written files (see A4 and Issue B in tracker notes).

- **Current iteration**: 1 of 3
- **Verifiability / Success Criteria**: SC-I2a (Zod parse succeeds, `type === 'tool_call'`, `name === 'read_file'`) and SC-I2b (`response.raw` does not contain `SENTINEL_CONTENT`) both pass.
- **Challenges**: EF3 (hallucinated path in arguments — handled implicitly: if the model uses a real path and returns its contents, SC-I2b catches it; if it invents a non-existent path, the contents cannot be returned either), EF5 (timeout).

---

## Decisions Made

### WS_03-T2-D1 — Sentinel File Created in `beforeAll`, Deleted in `afterAll` ✅ LOCKED (Architect, 2026-06-09)

**Decision**: The sentinel file is created by a `beforeAll` hook writing a fixed string to `/tmp/quotagate-exec-suppression-sentinel.txt`. It is deleted in `afterAll`. The sentinel content is a fixed string. No random content needed — the test does not read the file, only stats it.

**Rationale**: Using `/tmp` avoids polluting the repo checkout. Using a fixed path (not `os.tmpdir()` + random) makes the test deterministic and easy to debug. The content is irrelevant — only `atimeMs` is asserted.

**Rejected alternative — use a real file from the repo checkout**: Pollutes the repo; fails on read-only checkouts; introduces a git-tracked state dependency.

**Rejected alternative — use `crypto.randomBytes` for the path**: Non-deterministic; harder to inspect when debugging.

### WS_03-T2-D2 — Execution Suppression Assertion Uses `SENTINEL_CONTENT` Absence, Not `atimeMs` ✅ LOCKED (Architect, 2026-06-09, updated after Issue B review)

**Decision**: The side-effect guard asserts `expect(response.raw).not.toContain(SENTINEL_CONTENT)` rather than comparing `atimeMs` before and after the call.

**Rationale**: macOS APFS (the development environment, darwin 25.5.0) uses relatime-like semantics — `atime` is only updated if it is older than `mtime`/`ctime`. The sentinel file is written by `beforeAll` immediately before the test, so `atime == mtime`. A read immediately after does NOT update `atime`, making `atimeAfter <= atimeBefore + 1000` vacuously true whether or not the file was read. The `atimeMs` assertion was a ceremonial no-op on this machine. Additionally, the original sketch had a scope bug: it captured `atimeBefore` for `SENTINEL_PATH` but compared `returnedPath`'s atime against it — a meaningless cross-variable comparison. The `SENTINEL_CONTENT` absence assertion is platform-independent, readable, and tests the actual invariant: the file's contents did not appear in the model's response. If `claude --print` executes `read_file`, the file contents must appear somewhere in `raw` — this assertion catches that.

**Rejected alternative — `atimeMs` comparison**: Vacuously true on macOS APFS for recently-written files; also had a cross-variable scope bug (see Issue C). Not reliable on the development machine.

**Rejected alternative — `atimeMs` with ENOENT pass**: Same APFS problem; ENOENT handling is moot if the assertion itself is vacuous on the sentinel file.

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
| SC-I2b | `response.raw` does not contain `SENTINEL_CONTENT` — proving the file's contents were not returned by the model | `expect(response.raw).not.toContain(SENTINEL_CONTENT)` assertion passes (platform-independent; replaces unreliable `atimeMs` approach — see Issue B in tracker notes) |
| SC-I2c | `arguments` contains a `path` key with a string value | T-I2 `typeof result.data.arguments['path'] === 'string'` assertion passes (accessed via TypeScript narrowing on `result.data.type === 'tool_call'`, no cast needed) |
| SC-I2-skip | When `adapter.healthCheck()` returns `false`, the test is skipped (not failed) | Verify via Vitest output; must show `skipped`, not `failed` |
| SC-1 | `npm test` in CI does NOT run `executionSuppression.integration.test.ts` (excluded by the `CI`-gated `exclude` in `vitest.config.ts`, added in T4). Locally, the file runs but skips gracefully if auth is unavailable. | Run `CI=true npm test`; confirm file is absent from output |
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
// SIDE-EFFECT ASSERTION: see Issue B decision in tracker notes.
// This sketch uses the SENTINEL_CONTENT absence approach (Option 2) — the recommended
// approach after the user decision on Issue B. The atimeMs approach (Option 1) is
// NOT used here because macOS APFS does not reliably update atime for recently-written
// files (atime == mtime after write; read will not update atime, making the assertion
// vacuous — it passes whether or not the file was read). See A4 for full explanation.
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

      // Assert Zod contract — SyntaxError propagates as test failure (do not catch)
      const parsed = JSON.parse(response.raw);
      const result = QuotagateCompleteResultSchema.safeParse(parsed);
      expect(result.success, 'raw response did not parse as QuotagateCompleteResult').toBe(true);

      // TypeScript narrowing — no casts needed; discriminatedUnion narrows result.data.type correctly
      if (result.success && result.data.type === 'tool_call') {
        expect(result.data.name).toBe('read_file');
        expect(typeof result.data.arguments['path']).toBe('string');
      } else if (result.success) {
        // Force a descriptive failure — we need tool_call, not text
        expect(result.data.type, 'expected tool_call response but got text').toBe('tool_call');
      }

      // Execution suppression assertion (Issue B — Option 2):
      // If claude --print had actually executed read_file and returned the file contents,
      // SENTINEL_CONTENT would appear in the raw response (either as content in a text
      // response, or embedded in the argument value). Since SC-I2a asserts type===tool_call,
      // this assertion is an explicit, platform-independent guard that the file contents
      // were never returned.
      expect(response.raw, 'sentinel file contents found in response — execution suppression failed').not.toContain(SENTINEL_CONTENT);

      expect(response.backend).toBe('claude-subprocess');
    },
    { timeout: 15_000 },
  );
});
```

**NOTE — atimeMs approach removed (Issue B + Issue C):** The original sketch had two bugs. First (Issue B): on macOS APFS, `atime` is only updated when it is older than `mtime`. The sentinel file is written by `beforeAll` immediately before the test, so `atime == mtime` — a read will NOT update `atime`, making the assertion `atimeAfter <= atimeBefore + 1000` vacuously true regardless of whether the file was read. Second (Issue C): the sketch captured `atimeBefore` for `SENTINEL_PATH` but then compared `returnedPath`'s post-call `atime` against it — a meaningless cross-variable comparison when the model may hallucinate a different path. Both bugs are resolved by using the `SENTINEL_CONTENT` absence assertion instead.

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
