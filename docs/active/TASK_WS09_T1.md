# TASK_WS09_T1: Sequential Contamination (HTTP Path) + Retry-Exhaustion SDK Surface

## Context

- **Workstream**: WS_09 (Full Contamination Test Suite & Phase-1 Sign-Off)
- **Plan reference**: `docs/plan/workstreams/ws09_contamination_and_signoff.md`
- **Phase plan**: `docs/plan/phases/01c_tool_calling_and_acceptance.md`
- **Depends on**: WS_08 signed off (retry loop + router integrated; green gate clean)
- **Blocks**: T4 (Phase-1 sign-off — depends on this passing)

---

## Goal & Why

- **Goal**: Create **one new file** `tests/integration/contamination.sequential.http.integration.test.ts`
  containing two `describe` blocks:
  1. **Sequential contamination over the HTTP path** — a live-Claude probe: OpenAI SDK call A
     injects a fixed UUID code word; call B is a generic probe; assert B's response contains no
     trace of A's token. This is the WS_03 adapter-level sequential test re-proven through the full
     stack (OpenAI SDK → real listening Fastify server → `ResolveR` → `ClaudeAdapter` → subprocess).
  2. **Retry-exhaustion SDK surface** — a deterministic (no live-Claude) case: an injected `vi.fn()`
     adapter double returns malformed JSON 3×; the `openai` SDK client surfaces the resulting HTTP
     500 as an `APIError` carrying the OpenAI-shaped error body (`type`/`code` = `validation_error`,
     no stack leak). This is the Goal-2 "SDK surface" assertion folded into T1.
- **Why**: The adapter-level sequential test (WS_03) proves the *adapter* is stateless; it cannot
  prove the *full proxy stack* is stateless — `proxy.ts`/`router.ts`/Fastify could introduce a
  request cache, pool, or module-level variable that leaks. This test catches that. It is also the
  Phase-2 regression guard for the day MCP's persistent session replaces the fresh-process
  construction (invariant #10). The retry-exhaustion SDK-surface case confirms the OpenAI error
  contract (invariant #5) holds end-to-end through a real `openai` client, not just `server.inject()`.

---

## Assumptions to Test

| #   | Assumption                                                                                                   | Why we believe it                                                                        | How this task tests it                                                                  | If false →                                                                                  |
| --- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| A1  | A real `openai` SDK client against `http://127.0.0.1:${port}/v1` works, per the e2e pattern.                 | `e2e.noTools.test.ts` / `e2e.toolCall.test.ts` do exactly this.                          | Reuse the `server.listen({port:0})` + `new OpenAI({baseURL, apiKey})` fixture verbatim. | Fall back to raw `fetch` for the live cases; SDK-surface case still needs the SDK (see A2).  |
| A2  | The `openai` SDK throws an `APIError` (status 500) when the proxy returns a 500 OpenAI-shaped body.          | The SDK maps non-2xx to `APIError` subclasses; 500 → `InternalServerError`/`APIError`.   | Wrap the `create()` call in `expect(...).rejects` and inspect `err.status` / `err.code`.| If it does not throw, assert on the response another way (see Required Test Cases T-2 note). |
| A3  | A single server can host BOTH a live `ClaudeAdapter` (describe 1) and a `vi.fn()` double (describe 2).       | `createServer` takes the adapter map per-instance; two describes can each build a server.| Build a separate server in each describe's `beforeAll` with its own adapter map.         | Use two files; but two describes in one file with separate fixtures is the simpler correct shape.|
| A4  | `claude --print` echoes the UUID token back in call A only when asked to remember it (not in call B).        | WS_03 adapter-level test relied on exactly this and passed.                              | Call A asks to remember TOKEN; call B is an unrelated arithmetic probe.                  | The probe wording is tuned (B asks something with no path to TOKEN); see Known Pitfalls.     |

---

## Expected Failures

- **[EF1]** Live Claude unavailable (`healthCheck()` false) → the **describe-1** (sequential) cases
  skip via `ctx.skip()`. The **describe-2** (retry-exhaustion double) case does NOT skip — it has no
  live dependency.
- **[EF2]** Call A response not Zod-parseable as `QuotagateCompleteResult` → fail at the parse
  assertion (EF-style guard), not at the TOKEN assertion, so the failure points at the constraint,
  not at a false contamination signal. (Mirrors the WS_03 test's parse-first guard.)
- **[EF3]** The `openai` SDK surfaces the 500 but without the `code` field populated → assert on
  `err.status === 500` first, then `err.error?.code`/`err.code` as available from the SDK's error
  shape. Do not hard-fail if the SDK nests the body differently; assert the stable facts (status 500,
  OpenAI envelope present, no `stack`).

---

## Test Strategy

- **Unit**: none (this is integration).
- **Integration (describe 1)**: real listening Fastify server + real `ClaudeAdapter` + real `openai`
  SDK client. Two serial `client.chat.completions.create()` calls (A then B). Live-Claude;
  `healthCheck()`-guarded.
- **Integration (describe 2)**: real listening Fastify server + **injected `vi.fn()` adapter double**
  (`{ complete, healthCheck, install } satisfies CLIAdapter`) + real `openai` SDK client. The double
  returns `{ raw: 'not json', backend: 'claude-subprocess' }` three times. Deterministic, no live
  dependency, NOT skipped.
- **Contract**: describe-2 asserts the OpenAI error envelope (`error.type`, `error.code`, no `stack`)
  as surfaced by the SDK — the output invariant (#5).
- **Contamination/Isolation**: describe-1 is the sequential leak test through the HTTP path.

---

## Contract: What This Task Inherits

| Symbol / Artifact                           | Source                                 | Role in This Task                                                                  |
| ------------------------------------------- | -------------------------------------- | --------------------------------------------------------------------------------- |
| `createServer(config, adapters)`            | `src/proxy.ts`                         | Build the server in each describe's `beforeAll`.                                   |
| `loadConfig(FIXTURE_CONFIG_PATH)`           | `src/config.ts`                        | Load `tests/fixtures/config.minimal.yaml` (model `claude-sonnet-4-6`).            |
| `ClaudeAdapter`                             | `src/adapters/claude.js`               | The real adapter for describe-1.                                                   |
| `{ complete, healthCheck, install } stub`   | pattern from `tests/proxy.test.ts:20`  | The `vi.fn()` double for describe-2.                                               |
| `OpenAI` SDK client                         | `openai` npm pkg (used in `e2e.*`)     | The HTTP client for both describes.                                               |
| `QuotagateCompleteResultSchema`             | `src/types.js`                         | Parse-guard for call A's raw response (EF2).                                       |
| Fixture pattern                             | `tests/integration/e2e.noTools.test.ts`| Verbatim `beforeAll`/`afterAll` server-lifecycle + port-extraction shape.          |

---

## Subtask Progress Table

| #   | Subtask                                                                                                    | Status        | Iteration | Notes |
| --- | --------------------------------------------------------------------------------------------------------- | ------------- | --------- | ----- |
| 1   | Create the file; copy the `e2e.noTools.test.ts` fixture shape; define `TOKEN` UUID constant.               | ⬚ Not started | —         | New file under `tests/integration/`. |
| 2   | Describe-1 `beforeAll`: real `ClaudeAdapter`, listen({port:0}), OpenAI client. `healthCheck()` skip guard. | ⬚ Not started | —         | Live-Claude. |
| 3   | Describe-1 T-1: call A (remember TOKEN) → parse-guard → call B (probe) → assert B has no TOKEN.             | ⬚ Not started | —         | SC-1. |
| 4   | Describe-2 `beforeAll`: `vi.fn()` double server, OpenAI client. No skip guard.                             | ⬚ Not started | —         | Deterministic. |
| 5   | Describe-2 T-2: 3× malformed → `create()` rejects with `APIError` 500, OpenAI envelope, no stack.          | ⬚ Not started | —         | SC-2. |
| 6   | Run `npm test`; confirm CI-excluded (path under `tests/integration/**`); run green gate.                   | ⬚ Not started | —         | SC-3..SC-5. |

---

## Decisions Made

### [D1] — Sequential HTTP test is a NEW companion file, not an edit of the adapter-level test ✅ LOCKED (Architect, 2026-06-26)

**Decision**: Create `tests/integration/contamination.sequential.http.integration.test.ts`. Do **not**
modify the existing `tests/integration/contamination.sequential.integration.test.ts` (the WS_03
adapter-level guard). Both coexist.
**Rationale**: The adapter-level test is the unit-isolation guard; the HTTP-path test is the Phase-1C
acceptance criterion. They prove different layers; both must survive into Phase 2.
**Rejected alternative — rename/extend the WS_03 file**: would conflate two layers in one file and
lose the adapter-only regression signal.

### [D2] — Retry-exhaustion SDK surface lives here, NOT in a new file ✅ LOCKED (Architect, 2026-06-26)

**Decision**: The Goal-2 SDK-surface case (3× malformed → `APIError`) is a second `describe` in this
file. The proxy-level retry-exhaustion proof already exists (`tests/proxy.test.ts` `WS_08 T3-SC1`);
T1 adds only the *real-SDK-client surface* assertion, which needs a real listening port — already up
here.
**Rationale**: Avoids a near-duplicate file for one thin assertion; reuses the live fixture.
**Rejected alternative — a separate `e2e.retryExhaustion.test.ts`**: redundant fixture for one case.

### [D3] — Anti-overengineering scope fence ✅ LOCKED

**This task explicitly does NOT include**:

- The concurrent sub-case (T2 owns it).
- The retry-path contamination sub-case (T3 owns it; blocked on OD-1).
- Re-authoring the proxy-level retry-exhaustion test (already exists in `proxy.test.ts`).
- Any MCP / `_mcp_lock` code (Phase 2; D-SEQ-01).

---

## Files Modified / Created

- `tests/integration/contamination.sequential.http.integration.test.ts` — **create new**.

---

## Success Criteria / Verifiability

| #    | Criterion                                                                                                   | How to verify                                            |
| ---- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| SC-1 | Describe-1: call A (remember TOKEN) parses as `QuotagateCompleteResult`; call B's response does NOT contain TOKEN. | Test T-1 green (or skipped if `healthCheck()` false).    |
| SC-2 | Describe-2: 3× malformed double → `client.chat.completions.create()` rejects; the error has `status === 500`, OpenAI-shaped body (`type`/`code` = `validation_error`), and no `stack` field. | Test T-2 green (always runs — no live dep).              |
| SC-3 | File lives under `tests/integration/**`; `CI=1 npm test` does NOT count it (CI stays 91).                    | `CI=1 npx vitest run` test count unchanged.              |
| SC-4 | `npm run typecheck` clean; no unused imports.                                                                | Zero errors.                                             |
| SC-5 | `npm run lint` clean; `npm run format` no diff; full local `npm test` green, no regressions.                 | Green gate.                                              |

---

## Required Test Cases

File: `tests/integration/contamination.sequential.http.integration.test.ts`

### T-1: sequential HTTP-path contamination (covers SC-1)

- Fixed UUID constant `TOKEN` (e.g. a distinct UUID, NOT `crypto.randomUUID()`; comment its purpose
  per WS_03-D3). Use a **different** UUID from the WS_03 adapter-level file and from T2.
- `healthCheck()` skip guard at the top (`ctx.skip()` if false).
- Call A: `client.chat.completions.create({ model:'claude-sonnet-4-6', messages:[{role:'user',
  content:`Remember this code word for later: ${TOKEN}. Acknowledge you have noted it.`}] })`.
  Assert `response.choices[0].message.content` is a non-empty string (parse-guard equivalent at the
  HTTP layer — the SDK already validated the chat.completion shape).
- Call B: `create({ ..., messages:[{role:'user', content:'What is 2 plus 2? Reply with just the number.'}] })`.
  Assert `B.choices[0].message.content` does **NOT** contain `TOKEN`.
- Timeout `90_000` (two serial subprocess spawns under concurrent fork pressure — matches the WS_03
  file's empirically-tuned budget).

### T-2: retry-exhaustion surfaces as an OpenAI SDK APIError (covers SC-2)

- Separate `describe` with its own `beforeAll` building a server from a `vi.fn()` double:
  `stubAdapter.complete.mockResolvedValue({ raw:'not json', backend:'claude-subprocess' })`
  (or three `mockResolvedValueOnce` — `mockResolvedValue` is simpler and equally correct since all 3
  attempts return malformed).
- No `healthCheck()` skip — deterministic.
- `await expect(client.chat.completions.create({ model:'claude-sonnet-4-6',
  messages:[{role:'user',content:'Test'}] })).rejects.toMatchObject({ status: 500 })`.
- Capture the thrown error; assert the OpenAI envelope is present and `code`/`type` are
  `'validation_error'` (read from `err.error?.code` or `err.code` per the SDK's `APIError` shape —
  inspect the SDK's error object during implementation and assert the stable fields).
- Assert no `stack` leaks into the surfaced body.
- Assert `stubAdapter.complete` was called exactly 3 times (`config.retry.max_attempts` = 3 via the
  fixture; proves D4 wiring holds through the SDK surface too).

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
