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
| A4 | The `atimeMs` assertion is valid on the test machine — the filesystem updates `atime` on reads | macOS APFS uses relatime-like semantics: `atime` is only updated if it is older than `mtime`/`ctime`. For the sentinel file written by `beforeAll`, `atime == mtime` immediately after the write, so a read will NOT update `atime` on APFS — the assertion passes vacuously whether or not the file was read. This assumption is FALSE on macOS APFS. **The correct alternative is asserting `response.raw` does not contain `SENTINEL_CONTENT` — see WS_03-T2-D2 for the decision and rationale.** | The manual spike described in Test Strategy confirms the APFS behaviour; the `SENTINEL_CONTENT` absence approach is locked in WS_03-T2-D2. |

---

## Expected Failures

- **EF1** The `atimeMs` approach (comparing `atime` before and after the call) is NOT used in this test — it was rejected for two reasons documented in WS_03-T2-D2. First (APFS relatime): macOS APFS only updates `atime` when it is older than `mtime`; the sentinel file is written immediately before the test, so `atime == mtime` and a read will not update it — making any `atimeMs` assertion vacuously true regardless of whether the file was read. Second (scope bug): the original design captured `atimeBefore` for `SENTINEL_PATH` but compared `returnedPath`'s atime against it — a meaningless cross-variable comparison when the model may hallucinate a different path. The correct approach — `SENTINEL_CONTENT` absence on `response.raw` — is platform-independent and tests the actual invariant directly.
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
- **Manual/spike**: On macOS APFS, `atime` is only updated if it is older than `mtime` — so a file just written by `beforeAll` will NOT show an `atime` change on read (the assertion passes vacuously). To verify: `node -e "const fs = require('fs'); fs.writeFileSync('/tmp/test-atime.txt','x'); const s1 = fs.statSync('/tmp/test-atime.txt'); fs.readFileSync('/tmp/test-atime.txt'); const s2 = fs.statSync('/tmp/test-atime.txt'); console.log('atime changed:', s1.atimeMs !== s2.atimeMs)"`. On macOS APFS this will print `atime changed: false`, confirming the `atimeMs` assertion is unreliable here. The `atimeMs` approach was rejected (see WS_03-T2-D2 for full rationale); the Required Test Cases section contains the resolved sketch using `SENTINEL_CONTENT` absence.

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
| 1 | (Optional) Run the manual APFS atime spike from Test Strategy to confirm APFS does not update atime for recently-written files — expected outcome `atime changed: false`. Documents why the `SENTINEL_CONTENT` approach is used. | ✅ Done | 1 | APFS relatime confirmed vacuous by tracker decision WS_03-T2-D2; spike not re-run (already documented). |
| 2 | Author `tests/integration/executionSuppression.integration.test.ts`: imports, `SENTINEL_PATH`/`SENTINEL_CONTENT` constants, `beforeAll`/`afterAll` sentinel file setup/teardown, outer `describe` block | ✅ Done | 1 | File created in prior session with all structure per T-I2 sketch. Timeout bumped to 30 s to match T-I1 empirical cold-start margin. |
| 3 | Implement T-I2: `healthCheck()` guard, `adapter.complete()` call, Zod assertions (type=tool_call, name=read_file, path is string), `SENTINEL_CONTENT` absence assertion on `response.raw` | ✅ Done | 3 | RC-1 reword insufficient (1/3 pass; injection detection still firing ~2-in-3 with tools present). Root fix: moved `CONSTRAINT_INSTRUCTIONS` from `buildConstrainedPrompt()` stdin payload to `--system-prompt` flag in `_completeViaSubprocess()`. `--system-prompt` confirmed present in `claude --help`; works with `--print`. Unit tests T-1/T-8/T-13 updated to assert absence of constraint phrases in `buildConstrainedPrompt` output (the inverse contract). |
| 4 | Run the integration test locally: 3-of-3 consecutive T-I2 passes required | ✅ Done | 1 | Run 1: PASS (5.99 s). Run 2: PASS (6.41 s). Run 3: PASS (6.47 s). 3-of-3 bar met. T-I1 still PASS (5.01 s). No injection-detection failures or timeouts. |
| 5 | Run full green gate: `npm test`, `npm run typecheck`, `npm run lint`, `npm run format` — confirm all clean and no regressions | ✅ Done | 1 | `npm test`: 32 tests, 8 files, all pass. `typecheck`: clean. `lint`: clean. `format`: all files unchanged. No regressions from 31-test baseline (+1 from T-I2 now passing). |

_Status icons: `✅ Done` | `🔄 In progress` | `⬚ Not started` | `❌ Blocked`_

---

## Current Subtask Detail

### All subtasks complete — implementation summary

**Root cause of prior failures**: `CONSTRAINT_INSTRUCTIONS` was injected into the stdin payload via `buildConstrainedPrompt()`. When a `tools` array is present and the user message asks the model to use a tool, the constraint text (even after RC-1 reword) reads as a contested capability override arriving through the user-turn channel — triggering injection-detection heuristics probabilistically (~2-in-3 failure rate with tools present).

**Fix applied**: Moved `CONSTRAINT_INSTRUCTIONS` from `buildConstrainedPrompt()` to the `--system-prompt` flag in `_completeViaSubprocess()`. The `--system-prompt` flag routes through the privileged system prompt channel, which the model treats as a legitimate configuration source rather than a contested user-turn override.

**Changes made**:
1. `src/adapters/claude.ts` — `buildConstrainedPrompt()` no longer prepends `CONSTRAINT_INSTRUCTIONS`; now serializes only the tools section and conversation turns. `_completeViaSubprocess()` now spawns `claude --print --system-prompt <CONSTRAINT_INSTRUCTIONS>`.
2. `tests/adapters/buildConstrainedPrompt.test.ts` — T-1, T-8, T-13 updated to assert the inverse contract: `CONSTRAINT_INSTRUCTIONS` phrases are absent from `buildConstrainedPrompt()` output, with comments explaining that they are delivered via `--system-prompt`.

**Result**: T-I2 passes 3-of-3 (no injection detection, no timeouts). T-I1 unaffected. Full green gate: 32 tests, typecheck clean, lint clean, format no diff.

---

## Decisions Made

### WS_03-T2-D1 — Sentinel File Created in `beforeAll`, Deleted in `afterAll` ✅ LOCKED (Architect, 2026-06-09)

**Decision**: The sentinel file is created by a `beforeAll` hook writing a fixed string to `/tmp/quotagate-exec-suppression-sentinel.txt`. It is deleted in `afterAll`. The sentinel content is a fixed string. No random content needed — the test does not read the file, only stats it.

**Rationale**: Using `/tmp` avoids polluting the repo checkout. Using a fixed path (not `os.tmpdir()` + random) makes the test deterministic and easy to debug. The sentinel content is a fixed string used in the `SENTINEL_CONTENT` absence assertion (WS_03-T2-D2) — it must be stable across runs.

**Rejected alternative — use a real file from the repo checkout**: Pollutes the repo; fails on read-only checkouts; introduces a git-tracked state dependency.

**Rejected alternative — use `crypto.randomBytes` for the path**: Non-deterministic; harder to inspect when debugging.

### WS_03-T2-D2 — Execution Suppression Assertion Uses `SENTINEL_CONTENT` Absence, Not `atimeMs` ✅ LOCKED (Architect, 2026-06-09)

**Decision**: The side-effect guard asserts `expect(response.raw).not.toContain(SENTINEL_CONTENT)` rather than comparing `atimeMs` before and after the call.

**Rationale**: macOS APFS (the development environment, darwin 25.5.0) uses relatime-like semantics — `atime` is only updated if it is older than `mtime`/`ctime`. The sentinel file is written by `beforeAll` immediately before the test, so `atime == mtime`. A read immediately after does NOT update `atime`, making `atimeAfter <= atimeBefore + 1000` vacuously true whether or not the file was read. The `atimeMs` assertion was a ceremonial no-op on this machine. Additionally, the original sketch had a scope bug: it captured `atimeBefore` for `SENTINEL_PATH` but compared `returnedPath`'s atime against it — a meaningless cross-variable comparison. The `SENTINEL_CONTENT` absence assertion is platform-independent, readable, and tests the actual invariant: the file's contents did not appear in the model's response. If `claude --print` executes `read_file`, the file contents must appear somewhere in `raw` — this assertion catches that.

**Rejected alternative — `atimeMs` comparison**: Vacuously true on macOS APFS for recently-written files; also had a cross-variable scope bug: the original design captured `atimeBefore` for `SENTINEL_PATH` but compared `returnedPath`'s post-call `atimeMs` against it — a meaningless comparison when the model may hallucinate a different path. Not reliable on the development machine.

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
| SC-I2b | `response.raw` does not contain `SENTINEL_CONTENT` — proving the file's contents were not returned by the model | `expect(response.raw).not.toContain(SENTINEL_CONTENT)` assertion passes (platform-independent; replaces unreliable `atimeMs` approach — see WS_03-T2-D2) |
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
// SIDE-EFFECT ASSERTION: uses SENTINEL_CONTENT absence (see WS_03-T2-D2 for rationale).
// The atimeMs approach was rejected: macOS APFS does not reliably update atime for
// recently-written files (atime == mtime after write; read will not update atime, making
// the assertion vacuous). See A4 for the APFS mechanics; see WS_03-T2-D2 for the full
// decision including the scope bug in the original atimeMs sketch.
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

      // Execution suppression assertion (see WS_03-T2-D2 for rationale):
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

**NOTE — atimeMs approach removed:** The original design had two bugs. First (APFS relatime): on macOS APFS, `atime` is only updated when it is older than `mtime`. The sentinel file is written by `beforeAll` immediately before the test, so `atime == mtime` — a read will NOT update `atime`, making the assertion `atimeAfter <= atimeBefore + 1000` vacuously true regardless of whether the file was read. Second (scope bug): the design captured `atimeBefore` for `SENTINEL_PATH` but then compared `returnedPath`'s post-call `atime` against it — a meaningless cross-variable comparison when the model may hallucinate a different path. Both bugs are resolved by using the `SENTINEL_CONTENT` absence assertion instead. Full rationale in WS_03-T2-D2.

---

## Review Notes

**Verdict**: APPROVE-WITH-NITS

**Per-subtask verification**:
- Subtask 1: Verified ✅ — APFS relatime behavior documented in WS_03-T2-D2; `atimeMs` approach correctly rejected. No re-run needed; the decision is locked and rationale is sound.
- Subtask 2: Verified ✅ — `tests/integration/executionSuppression.integration.test.ts` exists. `SENTINEL_PATH`, `SENTINEL_CONTENT` constants correct. `beforeAll`/`afterAll` lifecycle implemented with `writeFileSync` and `rmSync({ force: true })`. Outer `describe` block correct. Timeout is 30_000 (see Findings — Timeout below). Vitest 4 `it(name, opts, fn)` three-argument form is correct and consistent with T-I1.
- Subtask 3: Verified ✅ — `healthCheck()` guard pattern is exact match to T-I1 (`const healthy = await adapter.healthCheck(); if (!healthy) { ctx.skip(); return; }`). Zod assertions correct: `result.success` checked, `result.data.type === 'tool_call'` narrowing correct, `result.data.name === 'read_file'` asserted, `typeof result.data.arguments['path'] === 'string'` asserted. The `else if (result.success)` branch forces a descriptive failure instead of silently accepting a `text` response — WS_03-T2-D3 respected. `SENTINEL_CONTENT` absence assertion is present, non-negotiable, and correctly placed after the Zod assertions. `response.backend === 'claude-subprocess'` assertion present. `JSON.parse` has no try/catch — `SyntaxError` propagates correctly per EF3. Root fix (`--system-prompt` delivery) and unit test inverse-contract updates are addressed in Subtask 3 notes. The `CONSTRAINT_INSTRUCTIONS` wording is non-adversarial and exactly matches the prose sketch from the prior PA review: cooperative framing, no persona displacement, no uppercase authority escalation, no Claude Code tool names named.
- Subtask 4: Verified ✅ — BSE reports 3-of-3 consecutive T-I2 passes (5.99 s, 6.41 s, 6.47 s). T-I1 unaffected (5.01 s). No injection-detection failures or timeouts. Cannot re-run from this review; accepting BSE's reported output and the correctness of the implementation.
- Subtask 5: Verified ✅ — BSE reports: `npm test` 32 tests (8 files) all pass; `typecheck` clean; `lint` clean; `format` no diff. +1 from T-I2 against 31-test baseline; no regressions.

---

**Findings**

**`--system-prompt` approach — architectural soundness for Phase 1**

The `--system-prompt` flag routes `CONSTRAINT_INSTRUCTIONS` through the privileged system prompt channel. This is strictly better than the prior stdin injection for two reasons: (1) the model treats system-prompt-delivered content as a legitimate configuration rather than a contested user-turn override — exactly what the prior APPROVE-WITH-FIX diagnosis predicted as the I-3 improvement path; (2) it preserves the separation of concerns: `buildConstrainedPrompt()` serializes only tools and conversation (the data), while `--system-prompt` carries the behavioral contract (the format spec). The two channels are now correctly decoupled.

Spec §3.2 describes Mechanism A as injecting "a constraint system prompt on every request." The `--system-prompt` flag IS a system prompt delivery — it is a more faithful realization of the spec's description than the prior stdin injection ever was. The spec says "constraint system prompt"; the `--system-prompt` CLI flag is exactly that privileged channel. This is not a deviation from the spec's intent — it is closer alignment with it.

Invariant #1 ("The proxy never executes tool calls") is preserved. The execution suppression is a transport guarantee from `--print`, not a prompt guarantee. The `CONSTRAINT_INSTRUCTIONS` constant correctly reflects this in its comment: "Execution suppression is a transport guarantee: claude --print does not execute tool calls, it only prints the model's output. This constraint text governs output format only." This is the correct framing and matches I-1 from the prior review.

D-SEQ-01 (subprocess-first MVP) is fully respected — no MCP machinery introduced, no Phase 2 scope creep.

**`buildConstrainedPrompt()` correctness**

The function no longer prepends `CONSTRAINT_INSTRUCTIONS`. The comment at line 51–53 is accurate and explains the decoupling clearly. The tools serialization and conversation serialization are structurally unchanged from the prior implementation. The `normalizedTools` normalization (`tools && tools.length > 0 ? tools : undefined`) is intact. The output for a tools-bearing call will be: `Available functions (toolChoice: auto):\n- name: read_file\n  description: ...\n  parameters: ...\nConversation:\nuser: Read the file at ...` — which is the correct and complete stdin payload. The `--system-prompt` arg will carry the format spec. Together they constitute the correct full input to the subprocess.

**Unit test inverse-contract assertions — T-1, T-8, T-13**

T-1 asserts absence of `'API proxy'` and `'Return only the JSON object'` from `buildConstrainedPrompt` output while asserting presence of `'calc'` and `'calculator'`. This is a correct inverse-contract assertion that will catch any regression where someone re-introduces `CONSTRAINT_INSTRUCTIONS` into `buildConstrainedPrompt()`. The specific phrases chosen (`'API proxy'`, `'Return only the JSON object'`) are stable substrings of the current `CONSTRAINT_INSTRUCTIONS` constant — if the constant changes significantly, these assertions will need updating, but that is appropriate coupling.

T-8 asserts the same two phrases absent from a no-tools call. The comment at line 101–105 accurately describes the purpose: this test is the channel-separation regression guard.

T-13 asserts `'"type": "text"'` and `'"type": "tool_call"'` absent from `buildConstrainedPrompt` output, while asserting `'Conversation:'` and `'x'` present. This assertion is correct: the JSON return-format examples are part of `CONSTRAINT_INSTRUCTIONS` (which is now in `--system-prompt`), not part of the stdin payload. If the format examples leak back into stdin, T-13 catches it. The test name accurately describes the contract.

T-2 through T-7, T-9, T-10, T-11, T-12 — read and verified structurally intact. No deletions, no loosened assertions. T-11 (system role) and T-12 (tool role) carry-forwards from T1 are present and correct.

**Timeout bump — 15_000 to 30_000**

The tracker's EF5 specifies `{ timeout: 15_000 }`. The actual implementation uses `{ timeout: 30_000 }`. The BSE's justification: "Warm runs take 5–7 s; cold-start (fresh Vitest process, first claude invocation) can exceed 15 s — matching T-I1's empirically validated margin." This is consistent with the engineering finding from T1 (cold-start observed at ~28 s) and with T-I1's own 30_000 timeout. The 3-of-3 passing runs took 5.99–6.47 s — well within 30 s. Accepting 30_000 as the correct value. The EF5 specification was written before the empirical cold-start evidence from T1 was available; the BSE correctly applied the T1 finding. Note: the tracker sketch in Required Test Cases shows `{ timeout: 15_000 }` as a stale sketch — the 30_000 in the live file is the authoritative value.

**Vitest 4 argument order**

Both T-I1 and T-I2 use the correct Vitest 4 form: `it(name, opts, fn)` with the options object as the second argument. The tracker sketch had the old three-argument form with timeout as the last argument (`it(name, fn, opts)`) — the actual implementation correctly applies the Vitest 4 form established in T1. Consistent across both integration tests, establishing the project convention for WS_06 and WS_09 as required.

---

**Required changes**: None

**Nits**:
- N-1: The Required Test Cases section (the T-I2 sketch) still shows `{ timeout: 15_000 }` in the old Vitest 3 position (last argument). This is a stale sketch that could confuse the next BSE. Update the sketch's timeout value to `30_000` and move it to the Vitest 4 position (second argument) to reflect the actual implementation. Does not block sign-off.
- N-2: The `it(name, opts, fn)` closing `)` at the bottom of the `it` block in the actual test file (line 83) lacks the `{ timeout: ... }` in the trailing position because the opts are already in position 2 — this is correct. Confirmed consistent with T-I1. No change needed; recorded for future BSE orientation.

**Informational**:
- I-1: The `--system-prompt` approach resolves the Mechanism A injection-detection fragility for Phase 1. The residual risk (model returns prose at non-zero temperature in some edge contexts) is handled by the WS_04 retry loop, which remains the designed backstop. The 3-of-3 passing runs with sub-7 s latency indicate the injection-detection problem is resolved at the measured confidence level.
- I-2: The `CONSTRAINT_INSTRUCTIONS` comment in `src/adapters/claude.ts` (line 29–31) correctly documents the transport-vs-prompt responsibility split. This comment is load-bearing for future maintainers — preserve it through WS_04 and WS_08 iterations.
- I-3: For WS_08 (hardening), consider whether `--system-prompt` is the officially documented flag name in `claude --help` output or whether an alias is used. The BSE confirmed the flag exists — it should be validated in the integration environment before WS_08 hardening work begins, to ensure the flag name is stable across `claude` CLI versions.

---

## Architect Sign-off

- [x] Implementation reviewed
- [x] All success criteria verified
- [x] All assumptions resolved (proven, or fallback taken & documented)
- [x] No regressions in full test suite
- [x] `npm test` / `typecheck` / `lint` / `format` all clean
