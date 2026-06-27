# TASK_WS09_T2: Concurrent Contamination (Real OpenAI SDK Concurrency, HTTP Path)

## Context

- **Workstream**: WS_09 (Full Contamination Test Suite & Phase-1 Sign-Off)
- **Plan reference**: `docs/plan/workstreams/ws09_contamination_and_signoff.md`
- **Phase plan**: `docs/plan/phases/01c_tool_calling_and_acceptance.md` (D-1C-04)
- **Depends on**: WS_08 signed off; T1 fixture pattern (may run in parallel with T1)
- **Blocks**: T4 (Phase-1 sign-off)

---

## Goal & Why

- **Goal**: Create **one new file** `tests/integration/contamination.concurrent.http.integration.test.ts`.
  Fire **two simultaneous** `client.chat.completions.create()` calls with `Promise.all` against a
  real listening Fastify server. Each request injects its **own distinct** code word and asks the
  model to echo it. Assert each response contains **its own** code word AND **not the other's**.
- **Why**: This is the spec §6 concurrent sub-case ("fire A and B in parallel as an OpenAI SDK client
  would"). On the subprocess transport each HTTP request spawns a separate OS process, so isolation
  holds by construction — but only an automated test pins that property so the Phase-2 MCP upgrade
  (which re-introduces a shared session and must re-earn isolation via `_mcp_lock`, invariant #11)
  has a regression guard. Testing at the adapter layer (`Promise.all` of two `adapter.complete()`)
  would skip Fastify's request-handling layer — the actual production concurrency surface (D-1C-04).

---

## Assumptions to Test

| #   | Assumption                                                                                              | Why we believe it                                                              | How this task tests it                                                            | If false →                                                                        |
| --- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| A1  | `Promise.all([createA, createB])` issues two HTTP requests Fastify handles without cross-request state. | Each request spawns a fresh `claude --print` process; no shared module state.  | Fire both, await both, assert each response carries only its own code word.        | A real shared-state leak exists in the spawn/proxy path — investigate WS_02/WS_04. |
| A2  | The model reliably echoes a short code word when explicitly asked to repeat it.                         | Simple instruction-following; low retry risk for an echo.                      | Prompt: "Reply with exactly this code word and nothing else: <CW>".               | Loosen the own-content assertion to `toContain(CW)` (already the design); keep it. |
| A3  | Two concurrent subprocess spawns complete within the test timeout under fork-pool pressure.            | WS_03 sequential needed 90s for two *serial* calls; concurrent ≈ one call wide.| Timeout `90_000`; both spawns overlap so wall-clock ≈ a single call + scheduling. | Raise timeout; or note flakiness and tune (do NOT loosen the assertions).          |

---

## Expected Failures

- **[EF1]** Live Claude unavailable (`healthCheck()` false) → skip via `ctx.skip()`.
- **[EF2]** "Nearly simultaneous" is not guaranteed to overlap at the OS-process level — one
  subprocess may finish before the other's request reaches the route handler. This is **acceptable**:
  the test asserts *isolation*, not *true simultaneity*. On the subprocess transport isolation holds
  regardless of overlap. Document this in the test (do not add timing assertions).
- **[EF3]** A code word coincidentally appears in the *other* response (astronomically unlikely with
  distinct UUIDs) → would be a real contamination signal; do not suppress it.

---

## Test Strategy

- **Integration**: real listening Fastify server + real `ClaudeAdapter` + real `openai` SDK client.
  `Promise.all` of two `create()` calls. Live-Claude; `healthCheck()`-guarded.
- **Contamination/Isolation**: the core of this task — each response must carry its own code word and
  not the other's. **Both halves are required** (own-content guards against a vacuous pass where two
  empty/error bodies trivially "lack the other's token").
- No unit/contract layer; this is purely an end-to-end isolation proof.

---

## Contract: What This Task Inherits

| Symbol / Artifact                | Source                                  | Role in This Task                                  |
| -------------------------------- | --------------------------------------- | -------------------------------------------------- |
| `createServer(config, adapters)` | `src/proxy.ts`                          | Build the live server in `beforeAll`.              |
| `loadConfig` + fixture           | `src/config.ts` + `config.minimal.yaml` | Model `claude-sonnet-4-6`.                          |
| `ClaudeAdapter`                  | `src/adapters/claude.js`                | The real adapter.                                  |
| `OpenAI` SDK client              | `openai` npm (e2e pattern)              | Two concurrent `create()` calls.                   |
| Fixture pattern                  | `tests/integration/e2e.noTools.test.ts` | `beforeAll`/`afterAll` server lifecycle + port.    |

---

## Subtask Progress Table

| #   | Subtask                                                                                              | Status    | Iteration | Notes |
| --- | --------------------------------------------------------------------------------------------------- | --------- | --------- | ----- |
| 1   | Create file; copy e2e fixture; define two fixed UUID constants `CW_A`, `CW_B` (distinct from T1).    | ✅ Done   | 1         | WS_03-D3 convention. `CW_A=c4d5e6f7-…`, `CW_B=d5e6f7a8-…` — distinct from each other, T1's `a1b2c3d4-…`, and WS_03's `8f3a1c2d-…`. |
| 2   | `beforeAll`: real `ClaudeAdapter`, listen({port:0}), OpenAI client. `healthCheck()` skip guard.      | ✅ Done   | 1         | Live-Claude. Mirrors the sequential-HTTP `beforeAll`/`afterAll` lifecycle; `server` null-guarded in `afterAll`. |
| 3   | T-1: `Promise.all` of two echo prompts; await both; assert own-content + no-cross-content per side.   | ✅ Done   | 1         | SC-1, SC-2. D1 satisfied: own-content (`toContain` + non-empty) AND no-cross-content (`not.toContain`) on both sides. |
| 4   | Add in-file comment: fresh-process rationale + Phase-2 `_mcp_lock` regression-guard purpose.          | ✅ Done   | 1         | SC-4. Comment above T-1 covers fresh-process isolation + the Phase-2 MCP `_mcp_lock` regression-guard purpose + the EF2 isolation-not-simultaneity scope fence. |
| 5   | Run `npm test`; confirm CI-excluded path; green gate.                                                | ✅ Done   | 1         | SC-3, SC-5. File under `tests/integration/**` → excluded when `CI` set (vitest.config.ts). Local +1 test; CI stays 91. |

---

## Decisions Made

### [D1] — Assertion requires BOTH own-content AND no-cross-content ✅ LOCKED (Architect, 2026-06-26)

**Decision**: For each response, assert (1) it contains its **own** code word AND (2) it does **not**
contain the **other** request's code word.
**Rationale**: A bare "B has no trace of A" passes vacuously if both responses are empty (degraded
server). The own-content assertion is the guard against a false green and proves no request-swap
occurred under concurrency.
**Rejected alternative — assert only "neither contains the other's token"**: vacuously passable; not
a real isolation proof.

### [D2] — Distinct UUID code words; no `crypto.randomUUID()` at runtime ✅ LOCKED (Architect, 2026-06-26)

**Decision**: `CW_A` and `CW_B` are fixed UUID constants in the file, distinct from each other, from
T1's `TOKEN`, and from the WS_03 adapter-level file's token.
**Rationale**: WS_03-D3 — fixed constants make a coincidental collision astronomically unlikely and
keep the test deterministic and greppable.

### [D3] — Anti-overengineering scope fence ✅ LOCKED

**This task explicitly does NOT include**:

- Asserting true OS-level simultaneity (EF2 — isolation, not simultaneity, is the contract).
- Any `_mcp_lock` / MCP code (Phase 2; D-SEQ-01) — only a documenting comment about it.
- The sequential (T1) or retry-path (T3) sub-cases.

---

## Files Modified / Created

- `tests/integration/contamination.concurrent.http.integration.test.ts` — **create new**.

---

## Success Criteria / Verifiability

| #    | Criterion                                                                                          | How to verify                                          |
| ---- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| SC-1 | Both `create()` calls in the `Promise.all` resolve; response A contains `CW_A`, response B contains `CW_B`. | Test T-1 green (or skipped if `healthCheck()` false).  |
| SC-2 | Response A does NOT contain `CW_B`; response B does NOT contain `CW_A`.                             | Test T-1 contamination assertions.                     |
| SC-3 | File under `tests/integration/**`; `CI=1 npm test` count unchanged (CI stays 91).                  | `CI=1 npx vitest run` count unchanged.                 |
| SC-4 | The file documents the fresh-process rationale + Phase-2 regression-guard purpose in a comment.    | Comment present above T-1.                             |
| SC-5 | `npm run typecheck` clean; `npm run lint` clean; `npm run format` no diff; full local suite green.  | Green gate.                                            |

---

## Required Test Cases

File: `tests/integration/contamination.concurrent.http.integration.test.ts`

### T-1: concurrent HTTP-path isolation (covers SC-1, SC-2)

- `CW_A`, `CW_B`: distinct fixed UUID constants, commented per WS_03-D3.
- `healthCheck()` skip guard.
- Build prompts that force an echo, e.g.
  `messages:[{role:'user', content:`Reply with exactly this code word and nothing else: ${CW_A}`}]`
  (and `CW_B` for B).
- `const [resA, resB] = await Promise.all([client.create(reqA), client.create(reqB)]);`
- Assert `resA.choices[0].message.content` `toContain(CW_A)` and `not.toContain(CW_B)`.
- Assert `resB.choices[0].message.content` `toContain(CW_B)` and `not.toContain(CW_A)`.
- Timeout `90_000`.
- In-file comment (SC-4): "On the `claude --print` subprocess transport, each HTTP request spawns a
  fresh OS process that exits after one response — no shared session/buffer/in-memory state. This
  test is the regression guard for Phase 2's MCP upgrade, which must re-earn this isolation via
  `_mcp_lock` serialization + fresh-context-per-call (invariants #10/#11)."

---

## Review Notes

**Verdict: APPROVE** — Principal Architect, 2026-06-27.

Reviewed `tests/integration/contamination.concurrent.http.integration.test.ts` against the
T2 spec, the §6 concurrent sub-case, invariants #3/#5/#10/#11, and the Engineering Integrity bar.

Honest production-path proof, not vacuous. The test drives the real stack (loadConfig → real
ClaudeAdapter → createServer → listen({port:0}) → real openai SDK over HTTP) and fires the two
calls via Promise.all — the genuine Fastify concurrency surface (D-1C-04), no adapter-layer
bypass and no mock on the path under test. In this review run live Claude was available, so the
test executed for real against two concurrent subprocess spawns and passed (not a skip no-op).

- D1 (both-halves) satisfied robustly: each side asserts typeof==='string', length>0,
  toContain(own), not.toContain(other) (lines 107-122). An empty/error body cannot pass
  vacuously — empty fails length>0; an adapter error rejects the Promise.all and fails the test.
- D2 verified by grep: four mutually distinct full UUIDs — WS_03 `8f3a1c2d-…`, T1 `a1b2c3d4-…`,
  CW_A `c4d5e6f7-…`, CW_B `d5e6f7a8-…`; fixed literals, no runtime randomUUID; neither CW is a
  substring of the other, so the toContain/not.toContain semantics are sound.
- D3 honored: no _mcp_lock/MCP code (documenting comment only, lines 54-63); no timing or
  simultaneity assertions; EF2 isolation-not-simultaneity scope fence documented in-file.
- EF1 skip guard correct; afterAll null-guards `server`; 90s timeout (A3) justified and reused
  from the sequential budget. Flakiness risk low — no-cross-content is structurally guaranteed on
  the subprocess transport; own-content uses toContain per A2.
- Genuine Phase-2 regression guard: when the MCP adapter replaces ClaudeAdapter, a shared-session
  leak would surface CW_B in response A and trip not.toContain at line 117.

Green gate observed: typecheck clean; lint clean; prettier --check clean; CI=1 → 91/91 unchanged
(SC-3); full local → 103/103, 0 skipped (102 after T1 + 1). SC-1..SC-5 all met.

Nits (non-blocking, no change requested): (1) `contentA!.length` deref follows the `typeof`
assertion that would throw first on null — safe and consistent with the T1/e2e precedent;
(2) response-shape assertions intentionally omitted (e2e's job, out of scope per D3).

---

## Architect Sign-off

- [x] Implementation reviewed — file read in full; drives the real HTTP production path, no bypass.
- [x] All success criteria verified — SC-1/SC-2 (live test ran and passed), SC-3 (CI 91 unchanged), SC-4 (mandated comment present), SC-5 (green gate clean).
- [x] All assumptions resolved — A1 proven (no cross-content under live concurrency), A2 honored (toContain echo), A3 held (completed within 90s).
- [x] No regressions in full test suite — full local 103/103, 0 skipped; CI 91/91 unchanged.
- [x] `npm test` / `typecheck` / `lint` / `format` all clean — verified this review (typecheck, eslint, prettier --check, vitest CI + local).
