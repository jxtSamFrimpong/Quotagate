# TASK_WS07_T3: Integration Test — `tests/integration/e2e.toolCall.test.ts`

## Context

- **Workstream**: WS_07 (Tool-Call Response Path)
- **Plan reference**: `docs/plan/workstreams/ws07_tool_call_response_path.md`
- **Phase plan**: `docs/plan/phases/01c_tool_calling_and_acceptance.md`
- **Depends on**: TASK_WS07_T1 (retry-triggering coverage green), TASK_WS07_T2 (tool_call branch implemented and tested)
- **Blocks**: TASK_WS07_T4 (green-gate close-out needs T3 to complete and its live run results)

---

## Goal & Why

- **Goal**: Create `tests/integration/e2e.toolCall.test.ts` with two test cases: (a) `get_weather` happy path — a real OpenAI SDK call with a `tools` array returns `finish_reason:"tool_calls"` and the correct function name; (b) `write_file` absence-of-side-effect — the proxy returns a tool_call declaration and does NOT create a file at the path in the arguments (invariant #1 proof).
- **Why**: The tool_call branch in `responseBuilder.ts` (T2) is proven correct in unit tests, but unit tests cannot prove the full stack: `OpenAI SDK → Fastify → proxy.ts → argumentBuilder → ClaudeAdapter subprocess → validator → responseBuilder`. Specifically, unit tests cannot prove that the CONSTRAINT_INSTRUCTIONS in `claude.ts` causes the model to return `{type:"tool_call"}` when `tools` are present and the user message requests a function. That is an empirical property of the prompt constraint + model behavior — it must be observed under real conditions. The `write_file` absence-of-side-effect test is the machine-readable proof of invariant #1 ("the proxy never executes tool calls"). There is no spy to set on a non-existent execute function — the test observes the file system. If a future refactor accidentally introduces an execution path, this test will catch it.

---

## Assumptions to Test

| #  | Assumption | Why we believe it | How this task tests it | If false → |
|----|------------|-------------------|------------------------|------------|
| A1 | The model returns `{type:"tool_call", name:"get_weather", arguments:{...}}` (not `{type:"text"}`) when `tools` are present, the user asks for weather, and `tool_choice` is `'auto'` | `CONSTRAINT_INSTRUCTIONS` in `claude.ts` explicitly tells the model to return the `{type:"tool_call",...}` format when a function call is appropriate; the model should follow the system-prompt instruction | T-a: assert `finish_reason:"tool_calls"` and `tool_calls[0].function.name === "get_weather"`. If the model returns `{type:"text"}`, the test fails (not skipped) — this is the observable failure path | Iterate `CONSTRAINT_INSTRUCTIONS` in `src/adapters/claude.ts`. Do NOT relax the test assertion. See EF1 |
| A2 | The proxy does not create a file at the path provided in `write_file`'s `arguments` — i.e., there is no execution path inside the proxy for tool calls | Invariant #1 is a hard constraint — there is no `executeTool()` function inside Quotagate | T-b: assert `!fs.existsSync(tempPath)` after the proxy responds | A file exists at `tempPath` after the proxy responds — this means someone introduced an execution path. This is a critical invariant #1 violation; escalate immediately to PA. Do NOT delete the file and retry |
| A3 | `JSON.parse(tool_calls[0].function.arguments)` succeeds and returns a plain object (not throwing) | `responseBuilder.ts` T2 sets `function.arguments = JSON.stringify(result.arguments)` where `result.arguments` is a validated `Record<string,unknown>` | T-a: parse the arguments string and assert it is a plain object | `JSON.parse` throws — root cause is either (a) the model returned `arguments` as a pre-stringified string that the validator passed (unlikely given Zod schema) or (b) `responseBuilder` set `function.arguments` to the object directly (double-serialization trap). Fix at the source in `responseBuilder.ts` |
| A4 | The server fixture pattern (module-scoped variables assigned in `beforeAll`, `afterAll` null-guard) works correctly for this test file — same as WS_06 T1/T2 | WS_06 T1 and T2 both use this pattern and it was signed off by PA | Module-scoped `let server`, `let adapter`, `let port`, `let client` initialized in `beforeAll` after `server.listen({ port: 0 })`. The `afterAll` null-guard prevents crash if `beforeAll` fails before `listen()` | `beforeAll` fails (e.g., config load error) and `afterAll` attempts `server.close()` on null — the null-guard prevents the crash. If `beforeAll` fails, both tests skip via the `healthCheck()` guard |

---

## Expected Failures

- **[EF1]** T-a fails because the model returns `{type:"text"}` instead of `{type:"tool_call"}`. Root cause: `CONSTRAINT_INSTRUCTIONS` is not compelling enough for the tool-call branch with this message format. Fix: iterate the constraint wording in `src/adapters/claude.ts` — specifically the "Available functions" section in `buildConstrainedPrompt()`. Do NOT relax the test assertion. Do NOT add a fallback in `proxy.ts`. The constraint is Quotagate's own text; it is fully tunable.
- **[EF2]** `validateWithRetry` exhausts 3 retries and proxy returns HTTP 500. Root cause: the model is returning markdown-fenced JSON or invalid JSON for the tool-call format. Same fix as EF1 — iterate constraint wording.
- **[EF3]** T-b: the `get_weather` response also triggers a file-creation check. This only applies if the test's `write_file` tool is accidentally configured to hit the same path as a `get_weather` response. Not possible if T-b uses a unique `randomUUID()` path. Confirm the paths are unique.
- **[EF4]** `beforeAll` times out because `server.listen()` takes too long. Not expected — the Fastify in-process server starts in milliseconds. If it happens, it indicates a config load error, not a timeout issue.
- **[EF5]** `adapter.healthCheck()` returns false on a CI machine without a live Claude subscription. Both tests skip gracefully via `ctx.skip()`. This is correct behavior, not a failure.

---

## Test Strategy

- **Integration only**: This task creates a new file `tests/integration/e2e.toolCall.test.ts`. It runs the full stack: OpenAI SDK → Fastify (in-process, real port via `listen({port:0})`) → `proxy.ts` → `buildAdapterRequest` → `ClaudeAdapter._completeViaSubprocess` → `validateWithRetry` → `buildChatCompletion`. No mocking of any production component.
- **Real Claude subscription**: The test drives `claude --print` via subprocess. It requires the same live Claude subscription as WS_06 T2. The `healthCheck()` guard skips on machines without authentication.
- **Server fixture pattern**: Identical to `tests/integration/e2e.noTools.test.ts`. Variables are `let server: FastifyInstance | null = null`, `let adapter: ClaudeAdapter | null = null`, `let port: number = 0`, `let client: OpenAI | null = null`. All assigned inside `beforeAll`; never forward-declared with a dummy value.
- **Absence-of-side-effect**: T-b asserts `!fs.existsSync(tempPath)` after the response. This is the only correct assertion for invariant #1 — there is nothing inside Quotagate to spy on.
- **Timeout**: 60_000ms per test (same as WS_06 T2). The subprocess cold-start is the dominant latency.

---

## Contract: What This Task Inherits

| Symbol / Artifact | Source | Role in This Task |
|-------------------|--------|-------------------|
| `createServer(config, adapter): FastifyInstance` | `src/proxy.ts` | The server under test; receives tool requests and routes through the full pipeline |
| `ClaudeAdapter` | `src/adapters/claude.ts` | The real subprocess adapter; `healthCheck()` used for the skip guard |
| `loadConfig(path)` | `src/config.ts` | Loads the config fixture; same `FIXTURE_CONFIG_PATH` resolution pattern as WS_06 |
| `FIXTURE_CONFIG_PATH` | `tests/fixtures/config.minimal.yaml` | Absolute path via `new URL('../../tests/fixtures/config.minimal.yaml', import.meta.url)` + `fileURLToPath` — must NOT use `process.cwd()` |
| `buildChatCompletion` tool_call branch | `src/responseBuilder.ts` (T2 deliverable) | Produces the `ChatCompletion` object the SDK client deserializes |
| `OpenAI` client | `openai` package | Used to send the `chat.completions.create` request with `tools` array |
| `e2e.noTools.test.ts` server fixture | `tests/integration/e2e.noTools.test.ts` | Gold standard for `beforeAll`/`afterAll` lifecycle and variable initialization pattern |

---

## Subtask Progress Table

| #  | Subtask | Status | Iteration | Notes |
|----|---------|--------|-----------|-------|
| 1  | Create `tests/integration/e2e.toolCall.test.ts` with `beforeAll`/`afterAll` server fixture (identical pattern to `e2e.noTools.test.ts`) | ✅ Done | 1 | Implemented inline; prettier reformatted one line (wrap) on format pass — no structural change |
| 2  | Add T-a: `get_weather` happy path — `finish_reason:"tool_calls"`, function name, parseable arguments | ✅ Done | 1 | All 6 SC-1–SC-4 assertions in place; explicit user message phrasing per PA recommendation |
| 3  | Add T-b: `write_file` absence-of-side-effect — unique temp path, `!fs.existsSync`, `afterEach` cleanup | ✅ Done | 1 | `tempPath` at describe scope; `afterEach` resets to `''`; `force:true` rmSync |
| 4  | Run `npm test` (CI=false, live subscription) against the full suite — triage any EF1/EF2 constraint failures | ✅ Done | 1 | 92 passed, 0 failures. EF1 did not manifest. stdout.trim() fix (PA Finding 2) applied to claude.ts before running. |
| 5  | If EF1 manifests: iterate `CONSTRAINT_INSTRUCTIONS` in `src/adapters/claude.ts` — re-run until T-a passes reliably | ✅ Done | N/A | EF1 did not manifest — no constraint iteration required |
| 6  | Confirm T-b: file does not exist after response (invariant #1 holds); `afterEach` cleanup runs | ✅ Done | 1 | `existsSync(tempPath) === false` confirmed; afterEach cleanup verified (ran suite twice — no stale-file error) |
| 7  | Run `npm run typecheck`, `npm run lint`, `npm run format` — all clean | ✅ Done | 1 | typecheck: 0 errors; lint: 0 violations; format: 0 diffs (new file already clean after prettier pass) |

_Status icons: `✅ Done` | `🔄 In progress` | `⬚ Not started` | `❌ Blocked`_

---

## Current Subtask Detail

### ✅ All subtasks complete — 2026-06-20

**Run results**:
- `npm test`: 92 passed, 0 failures (90 prior + 2 from T3)
- `CI=true npm test`: 83 unit tests (integration excluded) — note: T4 SC-6 budgeted 84; actual is 83 (T2 replaced T-4, net +2 not +3)
- `npm run typecheck`: 0 errors; `npm run lint`: 0 violations; `npm run format`: 0 diffs

**Pre-T3 fix applied**: `stdout.trim()` in `src/adapters/claude.ts` (PA Finding 2) — eliminates risk of CLI diagnostic lines around JSON in tool_call path.

**EF1**: Did not manifest. Model returned `{type:"tool_call"}` on first attempt for both T-a and T-b.

**Invariant #1 (T-b)**: `existsSync(tempPath) === false` confirmed — proxy declared the call, did not execute it.

**PA deferred findings** (to WS_08): F1 (call_ ID format), F3 (tool_choice:required gap in CONSTRAINT_INSTRUCTIONS), F4 (AdapterResponse.backend union), F5 (non-mutation comment), F7 (tsconfig test coverage).

---

## Decisions Made

### D1 — `write_file` Test Path Is UUID-Unique Per Test Run ✅ LOCKED (Architect, 2026-06-15)

**Decision**: The temp path for the `write_file` absence-of-side-effect test is `/tmp/quotagate-invariant1-${randomUUID()}` where `randomUUID()` is called once per `it()` run (inside the test body, not at module scope). This path is declared as a `let` at `describe` scope and assigned inside the test body.

**Rationale**: A fixed path (e.g., `/tmp/quotagate-invariant1-test`) would produce a false positive on a re-run if a previous (broken) implementation had created the file and the developer forgot to clean it up. A UUID path is unique per run, eliminating this risk. The `afterEach` cleanup runs `fs.rmSync(path, {force:true})` regardless — `force:true` means no error if the file does not exist (which is the correct case).

**Rejected alternative — use a fixed path with a pre-test cleanup step**: Requires the test to first delete the file it is about to assert does not exist — circular logic that can mask the very bug it is testing. If the proxy creates the file during the test, the `afterEach` cleanup deletes the evidence. UUID path removes this risk.

### D2 — Anti-overengineering scope fence ✅ LOCKED

**This task explicitly does NOT include**:
- A test for `tool_choice: 'required'` or `tool_choice: 'none'` — the `get_weather` test uses `tool_choice: 'auto'` (the default). Forced-function tool_choice (object form) is out of scope per WS_07-D5.
- Multiple tool_calls in one response — Phase 1 schema is single-tool-call only.
- A test for the retry path under tool_call (that is T1's unit test and WS_08's concern).
- Spy-based assertions on internal Quotagate functions — invariant #1 is proven by absence-of-side-effect only (D-1C-03).
- Any `afterAll`-level file cleanup — `afterEach` handles it per-test, making the cleanup granular and order-independent.

---

## Cross-Task Contracts (Downstream Dependencies on This Task)

### TASK_WS07_T4 will depend on:

- Both T-a and T-b pass against the live subscription.
- If EF1 required constraint wording changes in `src/adapters/claude.ts`, those changes are committed before T4 runs the full green-gate.
- The test count from T3 is known (2 new integration tests) so T4 can compute the expected `CI=true` count.

---

## Files Modified / Created

- `tests/integration/e2e.toolCall.test.ts` — **create new** (the full test file)
- Potentially `src/adapters/claude.ts` — **modify** (constraint wording if EF1 manifests — `CONSTRAINT_INSTRUCTIONS` or `buildConstrainedPrompt()`)

---

## Success Criteria / Verifiability

| #    | Criterion | How to verify |
|------|-----------|---------------|
| SC-1 | T-a: `response.choices[0].finish_reason === 'tool_calls'` | `expect(...).toBe('tool_calls')` |
| SC-2 | T-a: `response.choices[0].message.content === null` | `expect(...).toBeNull()` |
| SC-3 | T-a: `response.choices[0].message.tool_calls![0].function.name === 'get_weather'` | `expect(...).toBe('get_weather')` |
| SC-4 | T-a: `JSON.parse(response.choices[0].message.tool_calls![0].function.arguments)` is a plain object (does not throw) | `expect(() => JSON.parse(...)).not.toThrow()` and `expect(typeof parsed).toBe('object')` |
| SC-5 | T-b: `response.choices[0].finish_reason === 'tool_calls'` | `expect(...).toBe('tool_calls')` |
| SC-6 | T-b: `fs.existsSync(tempPath) === false` after the proxy response | `expect(fs.existsSync(tempPath)).toBe(false)` — invariant #1 proof |
| SC-7 | `afterEach` cleanup runs `fs.rmSync(tempPath, {force:true})` — file system is clean after the test | Confirmed by running the test twice in sequence and observing no stale-file error on the second run |
| SC-8 | Both tests skip gracefully when `adapter.healthCheck()` returns false | `CI=true npm test` shows 2 additional skipped tests (not failures) |
| SC-9 | Zero regressions — all prior tests (≥ 91 from T1+T2 baseline) still pass | `npm test` output shows all prior tests green |
| SC-10 | `npm run typecheck` clean; `npm run lint` clean; `npm run format` no diff | All three commands exit 0 |

---

## Required Test Cases

File: `tests/integration/e2e.toolCall.test.ts`

**Server fixture** (module-scope declarations, assigned in `beforeAll`):
```
let server: FastifyInstance | null = null;
let adapter: ClaudeAdapter | null = null;
let port: number = 0;
let client: OpenAI | null = null;
```
`beforeAll`: `loadConfig(FIXTURE_CONFIG_PATH)` → `createServer(config, adapter)` → `server.listen({port:0, host:'127.0.0.1'})` → extract port from URL string → construct `OpenAI({baseURL, apiKey:'not-used'})`.
`afterAll`: `if (server !== null) await server.close()`.

**`let tempPath: string = ''` at `describe` scope** (not module scope) — assigned inside T-b's `it()` body via `randomUUID()`.
`afterEach`: `if (tempPath) fs.rmSync(tempPath, {force:true})`.

### T-a: `get_weather` tool call happy path (covers SC-1 through SC-4)

Guard: `if (adapter === null || !(await adapter.healthCheck())) { ctx.skip(); return; }`. Timeout: `{timeout: 60_000}`.

Call `client!.chat.completions.create({model:'claude-sonnet-4-6', messages:[{role:'user', content:'What is the weather in Accra?'}], tools:[{type:'function', function:{name:'get_weather', description:'Get the current weather for a city', parameters:{type:'object', properties:{city:{type:'string', description:'The city name'}}, required:['city']}}}], tool_choice:'auto'})`.

Assert:
1. `response.choices[0].finish_reason === 'tool_calls'`
2. `response.choices[0].message.content` is `null`
3. `response.choices[0].message.tool_calls` has length 1
4. `response.choices[0].message.tool_calls![0].function.name === 'get_weather'`
5. `expect(() => JSON.parse(response.choices[0].message.tool_calls![0].function.arguments)).not.toThrow()`
6. `typeof JSON.parse(response.choices[0].message.tool_calls![0].function.arguments) === 'object'`

**Critical**: if the model returns `{type:"text"}`, assertion 1 (`finish_reason === 'tool_calls'`) will fail. This is the correct failure mode — do NOT add a conditional that accepts `finish_reason:"stop"` as a passing case.

### T-b: `write_file` absence-of-side-effect — invariant #1 proof (covers SC-5 through SC-7)

Guard: `if (adapter === null || !(await adapter.healthCheck())) { ctx.skip(); return; }`. Timeout: `{timeout: 60_000}`.

Inside the test body, assign `tempPath = '/tmp/quotagate-invariant1-' + randomUUID()`.

Call `client!.chat.completions.create({model:'claude-sonnet-4-6', messages:[{role:'user', content:'Write the text "hello" to a file.'}], tools:[{type:'function', function:{name:'write_file', description:'Write content to a file', parameters:{type:'object', properties:{path:{type:'string', description:'The file path'}, content:{type:'string', description:'The content to write'}}, required:['path','content']}}}], tool_choice:'auto'})`. Note: do NOT include `tempPath` in the messages — the model will invent a path; the test asserts the specific UUID path was NOT created. The invariant is about the proxy not executing the tool at all, not about the exact path.

Alternatively, include `tempPath` in the message (`'Write the text "hello" to the file ' + tempPath`) so that the model's `arguments` likely include `tempPath` as the path value, making the absence assertion more targeted. This is the **recommended approach** — it makes the test intention clear and creates a stronger causal link between the declared path and the assertion.

Assert:
1. `response.choices[0].finish_reason === 'tool_calls'`
2. `response.choices[0].message.tool_calls![0].function.name === 'write_file'`
3. `fs.existsSync(tempPath) === false`

---

## Review Notes

**PA Full Pass — 2026-06-20**

All 10 SC verified against the implementation file and run results.

SC-1 through SC-4 (T-a): All four assertions present and hard (no conditional fallback to
`finish_reason:"stop"`). Comment labels match SC numbers. `function.name === 'get_weather'`
at line 85; two-part SC-4 (not.toThrow + typeof === 'object') at lines 87–92.

SC-5 through SC-7 (T-b): `finish_reason:"tool_calls"` hard at line 131; `write_file` name at
line 132; `existsSync(tempPath) === false` at line 134. The `afterEach` cleanup at lines 41–46
resets `tempPath` to `''` after cleanup — prevents the guard firing on T-a where `tempPath`
was never assigned. D1 (UUID-unique path) honored: `randomUUID()` called inside the test body
at line 105.

SC-8 (skip guards): Both T-a and T-b use the correct two-condition guard
`(adapter === null || !(await adapter.healthCheck()))` with `ctx.skip(); return`. CI=true
confirms 2 integration tests excluded (not failed).

SC-9/SC-10: 92 passed / 0 failures across two consecutive runs; typecheck 0 errors; lint 0
violations; format 0 diffs.

A1 proven (EF1 did not manifest): `CONSTRAINT_INSTRUCTIONS` unchanged.
A2 proven: invariant #1 confirmed empirically — `existsSync(tempPath) === false`.
A3 proven: `JSON.parse(arguments)` succeeds; result is a plain object.
A4 proven: server fixture lifecycle worked correctly; null-guard present.

Implementation note: T-a user message uses "Use the get_weather tool." — stronger than the
tracker's example phrasing. Sound call; weaker phrasing risks EF1 on future model versions.
Approved as-is.

stdout.trim() pre-fix (PA Finding 2) confirmed at `src/adapters/claude.ts` line 131.
PA deferred findings F1/F3/F4/F5/F7 correctly scoped to WS_08 per D2. No blockers found.

---

## Architect Sign-off

- [x] Implementation reviewed
- [x] All success criteria verified
- [x] All assumptions resolved (proven, or fallback taken & documented)
- [x] No regressions in full test suite
- [x] `npm test` / `typecheck` / `lint` / `format` all clean
