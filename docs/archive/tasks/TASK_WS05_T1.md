# TASK_WS05_T1: Config Loader (`src/config.ts`)

## Context

- **Workstream**: WS_05 (Fastify Proxy & Config)
- **Plan reference**: `docs/plan/workstreams/ws05_fastify_proxy_and_config.md`
- **Phase plan**: `docs/plan/phases/01b_openai_translation_pipeline.md`
- **Depends on**: WS_01 T3 (types contract stable). OD-1/OD-2/OD-3 + DD-1 are resolved
  (WS_05-D5…D8 in the plan) — this task is unblocked and ready to start.
- **Blocks**: WS_05-T2 (needs `QuotagateConfig` type); WS_05-T4 (needs `loadConfig`); WS_06
  integration test (uses `loadConfig("tests/fixtures/config.minimal.yaml")`).

---

## Goal & Why

- **Goal**: Implement `src/config.ts` — a Zod-validated config loader that reads `config.yaml`,
  parses it with `yaml` (WS_05-D5), validates the result against a typed Zod schema
  (`QuotagateConfig`), and throws a descriptive `QuotagateError` on any failure. Export
  `loadConfig(path?: string): QuotagateConfig` and the `QuotagateConfig` type for downstream
  consumers.

- **Why**: `config.ts` is Quotagate's "fail fast, fail loud" gate. Every misconfiguration —
  missing `models` key, wrong type, bad YAML — that would otherwise surface as a cryptic runtime
  crash on the first HTTP request is caught here, at startup, with a clear error message. The
  Zod schema also establishes the `QuotagateConfig` type that `proxy.ts`, `index.ts`, and the
  future `router.ts` all import — getting the shape right now prevents a breaking type change
  later. Spec §3.9 defines the config structure this schema must reflect, including the MCP stub
  keys that must not reject a developer's Phase-2-ready config file.

---

## Assumptions to Test

| #  | Assumption                                                                              | Why we believe it                                                                             | How this task tests it                                                                         | If false →                                                                                      |
|----|-----------------------------------------------------------------------------------------|-----------------------------------------------------------------------------------------------|------------------------------------------------------------------------------------------------|-------------------------------------------------------------------------------------------------|
| A1 | The chosen YAML parser (OD-1) correctly parses a YAML file into a plain JS object       | Standard behavior for `yaml`/`js-yaml`; used widely                                          | Unit test: parse the `config.minimal.yaml` fixture; assert `result.models` is the right shape  | Switch to JSON (OD-1 option c) and update all fixture/docs references                           |
| A2 | Zod `.strip()` (the default) silently drops unknown top-level keys                      | Zod default is strip-by-default on `z.object()`                                               | Unit test: fixture with an unknown top-level key; assert it is absent from the parsed result    | Use `z.object({...}).passthrough()` and document the choice                                      |
| A3 | `QuotagateError` wrapping of raw fs/Zod errors does not lose the path info needed for a useful message | Straightforward string interpolation                                              | Unit test: call `loadConfig("nonexistent.yaml")`; assert the error message contains the path   | Adjust the error message template to include `path.resolve(pathArg)`                             |
| A4 | The `mcp` stub schema (`z.record(z.unknown()).optional()`) passes a Phase-2 MCP config  | Zod's `z.record(z.unknown())` accepts any object                                               | Unit test: fixture with realistic MCP keys (matching spec §3.9); assert no Zod error           | Widen or narrow the MCP schema and document the reasoning                                        |

---

## Expected Failures

- **[EF1] File not found** — `fs.readFileSync` throws `ENOENT`. This is the common first-run case:
  the default `~/.quotagate/config.yaml` does not exist on a fresh machine and Quotagate does not
  create it (WS_05-D6/D8, fail-loud). Handled by: catch and re-throw as a `QuotagateError` whose
  message names the resolved path and shows the minimal config to create, e.g. `"No config found at
  <resolved ~/.quotagate/config.yaml>. Create it with:\n\n  models:\n    claude-sonnet-4-6: { backend:
  claude, priority: 1 }\n  retry:\n    max_attempts: 3\n"`. Do NOT auto-create the directory or file.
  The raw `NodeJS.ErrnoException` must not escape.
- **[EF2] Malformed YAML** — the YAML parser throws on invalid syntax. Handled by: catch the parse
  exception and re-throw as `QuotagateError("config.yaml is not valid YAML: [non-leaking message]")`.
  Do not embed the parser's raw error object in the public message.
- **[EF3] Schema validation failure** — `ZodError` from `.parse()`. Handled by: catch `ZodError`
  and re-throw as `QuotagateError("config.yaml failed validation: [field path] [issue]")`. The Zod
  error path array is useful in the message, but the full stack trace is not.
- **[EF4] `models` key present but empty** — `{}` passes Zod `z.record(...)` with zero entries;
  this is technically valid per schema. A proxy with no models resolves every alias to unknown →
  every request returns HTTP 400. This is an operational misconfiguration, not a schema error; the
  Zod schema does not reject it. Document this in the pitfalls note.

---

## Test Strategy

- **Unit**: All tests in `tests/config.test.ts`. No real filesystem reads in fast-path tests —
  use a `tests/fixtures/config.minimal.yaml` fixture file (created as part of this task). The
  fixture is small and deterministic.
- **Integration**: None in this task. WS_06 exercises `loadConfig` with a real fixture as part of
  the end-to-end boot sequence.
- **Contract**: The exported `QuotagateConfig` TypeScript type is the primary contract; T2, T4, and
  WS_06 all import it. Assert in tests that the parsed result is assignable to `QuotagateConfig`
  (TypeScript compile-time check — if the Zod inferred type and the interface diverge, `tsc` will
  catch it).
- **Manual/spike**: N/A for this task (no live adapter or network).

---

## Resolved Decisions (2026-06-11)

All decisions affecting this task are resolved and locked in the WS_05 plan (WS_05-D5…D8):

- **OD-1 → `yaml`** (WS_05-D5) — add `yaml` to `dependencies`; `import { parse } from "yaml"`.
- **OD-2 → `~/.quotagate/config.yaml`** (WS_05-D6) — default path is
  `path.join(os.homedir(), ".quotagate", "config.yaml")` (use `os.homedir()`, never a literal `~`).
- **OD-3 → include `priority?: number`** (WS_05-D7) — model entry is `{ backend: string; priority?: number }`.
- **DD-1 → fail loud, no auto-write** (WS_05-D8) — absent config throws a create-it `QuotagateError`; no disk write.

---

## Contract: What This Task Inherits

| Symbol / Artifact          | Source                  | Role in This Task                                                                |
|----------------------------|-------------------------|----------------------------------------------------------------------------------|
| `QuotagateError`           | `src/errors.ts`         | All config-load errors are re-thrown as this type; never raw fs/Zod errors       |
| `AdapterRequest`/`AdapterResponse` | `src/types.ts`  | Not directly used here; included to confirm config is import-independent of adapters |
| Spec §3.9 `config.yaml` structure | `docs/schematics/quotagate-spec.md` | Defines the field names and YAML structure the Zod schema must match  |

---

## Subtask Progress Table

| #  | Subtask                                                                                         | Status        | Iteration | Notes |
|----|-------------------------------------------------------------------------------------------------|---------------|-----------|-------|
| 1  | Add `yaml` to `dependencies` (`npm install yaml`) — runtime dep, not dev (WS_05-D5)             | ✅ Done       | 1         | `yaml@^2.9.0` in `dependencies`; `npm install` exited 0 |
| 2  | Define `QuotagateConfigSchema` Zod schema in `src/config.ts`; export inferred `QuotagateConfig` type | ✅ Done  | 1         | Schema covers models, retry, mcp stub (z.record(z.unknown()).optional()); `fallback_to_subprocess_after_failures` optional |
| 3  | Implement `loadConfig(path?)`: resolve default path, read file, parse YAML, Zod-validate, wrap errors as `QuotagateError` | ✅ Done | 1 | All three failure paths (ENOENT, YAML parse, ZodError) re-thrown as QuotagateError; raw errors never escape |
| 4  | Create `tests/fixtures/config.minimal.yaml` fixture (minimal valid config matching spec §3.9)   | ✅ Done       | 1         | Plus `config.no_models.yaml`, `config.unknown_key.yaml`, `config.with_mcp.yaml` |
| 5  | Write `tests/config.test.ts`: valid fixture parses; missing `models` throws `QuotagateError`; unknown fields stripped; MCP keys pass; file-not-found throws with path in message | ✅ Done | 1 | T-2 assertion corrected during gate run: `not.toBeInstanceOf(ZodError)` instead of `Error.prototype.constructor` |
| 6  | Green gate: `npm test` · `typecheck` · `lint` · `format`                                        | ✅ Done       | 1         | 61 tests (56 baseline + 5 new); typecheck clean; lint clean; format no diff |

_Status icons: `✅ Done` | `🔄 In progress` | `⬚ Not started` | `❌ Blocked`_

---

## Current Subtask Detail

### Subtask 1: Add YAML parser dependency

**Approach iteration plan**:

1. Add `yaml` (WS_05-D5) to `dependencies` (not `devDependencies` — it is a runtime dep needed by
   `loadConfig` in production): `npm install yaml`.
2. Verify `npm install` succeeds and `tsc --noEmit` is still clean.
3. (Decision already locked as WS_05-D5 in the plan — no further logging needed.)

- **Current iteration**: ready to start (OD-1/OD-2 resolved)
- **Verifiability**: `package.json` shows the dep; `npm install` exits 0; `tsc --noEmit` is clean.
- **Challenges**: None anticipated; this is a straightforward dep add.

---

## Decisions Made

### [D1] — Error wrapping: all config failures throw `QuotagateError` ✅ LOCKED (Architect, 2026-06-11)

**Decision**: `loadConfig` catches `ENOENT` (file not found), YAML parse errors, and `ZodError`
and re-throws each as `new QuotagateError("...")` with a human-readable message. The raw
error is not re-thrown and not embedded in the public message beyond a minimal summary.

**Rationale**: CLAUDE.md convention: "Boundary errors map to OpenAI-shaped error responses
(`proxy.ts`), never raw stack traces to the caller." The config boundary is the same principle:
the startup path must surface actionable messages, not internal implementation details (Zod issue
arrays, node `errno` codes). `QuotagateError` is the single error type all boundary layers catch.

**Rejected alternative — let raw errors propagate**: Raw `ZodError` and `NodeJS.ErrnoException`
have unhelpful default messages for a developer who just ran `quotagate start`. They also break
the single-error-type convention established in `src/errors.ts`.

### [D2] — Anti-overengineering scope fence ✅ LOCKED

**This task explicitly does NOT include**:

- Config hot-reload — Phase 4. Config is loaded once at startup.
- Auto-creating `~/.quotagate/` or writing a default config — deferred (WS_05-D8, fail-loud). The
  default path `~/.quotagate/config.yaml` itself IS in Phase 1 scope (WS_05-D6).
- Validation of `mcp.*` field values — Phase 2 (when the MCP client is built).
- `retry.fallback_to_subprocess_after_failures` — present in spec §3.9; not read in Phase 1 (no
  MCP transport yet to fall back from). Stubbed as optional in the schema.

---

## Cross-Task Contracts (Downstream Dependencies on This Task)

### `TASK_WS05_T2` will depend on:

- `QuotagateConfig` type — imported in `src/proxy.ts` as the first parameter of `createServer`.
  The `models` field shape must be stable; any change requires a Decision Log entry.

### `TASK_WS05_T4` will depend on:

- `loadConfig` export — called with no argument in `src/index.ts`. Must accept `undefined` and
  resolve the default path internally.
- `QuotagateError` thrown on failure — `index.ts` must catch this and call `process.exit(1)` with
  a human-readable message.

### `WS_06` will depend on:

- `loadConfig("tests/fixtures/config.minimal.yaml")` — the optional path override must work.
  The fixture created in subtask 4 will be the same fixture WS_06 reuses.

---

## Files Modified / Created

- `src/config.ts` — **create new** (Zod schema, `loadConfig`, `QuotagateConfig` type export)
- `tests/config.test.ts` — **create new** (unit tests for all branches)
- `tests/fixtures/config.minimal.yaml` — **create new** (minimal valid YAML fixture for tests)
- `package.json` — **modify** (add YAML parser to `dependencies`)

---

## Success Criteria / Verifiability

| #    | Criterion                                                                                      | How to verify                                       |
|------|------------------------------------------------------------------------------------------------|-----------------------------------------------------|
| SC-1 | `loadConfig("tests/fixtures/config.minimal.yaml")` returns a `QuotagateConfig` with no Zod errors | T-1 passes                                     |
| SC-2 | `loadConfig` with a YAML missing the `models` key throws `QuotagateError` (not `ZodError`)    | T-2 passes; `instanceof QuotagateError` asserted   |
| SC-3 | `loadConfig` with file-not-found throws `QuotagateError` with the resolved path in message    | T-3 passes; message string-contains the path       |
| SC-4 | Extra unknown top-level keys in the fixture are absent from the parsed result                  | T-4 passes                                          |
| SC-5 | Fixture with realistic MCP keys (from spec §3.9) parses without Zod error                     | T-5 passes                                          |
| SC-6 | `QuotagateConfig` TypeScript type is exported and assignable from the Zod inferred type        | `npm run typecheck` clean; zero `any` casts        |
| SC-7 | `npm test` green; test count does not decrease from 56-test WS_04 baseline                    | `npm test` output                                   |
| SC-8 | `npm run typecheck` clean; `npm run lint` clean; `npm run format` no diff                      | Each command exits 0 / no diff                      |

---

## Required Test Cases

File: `tests/config.test.ts`

### T-1: valid minimal fixture parses into typed `QuotagateConfig` (covers SC-1, SC-6)

Call `loadConfig("tests/fixtures/config.minimal.yaml")`. Assert: return value is an object;
`result.models` is a `Record<string, { backend: string; priority?: number }>` with at least one key; `result.retry.max_attempts`
is a number. TypeScript type check: variable assigned as `QuotagateConfig` (compile-time, no cast).

### T-2: missing `models` field throws `QuotagateError` (covers SC-2)

Create an in-memory YAML string (or a fixture file) with `retry: { max_attempts: 3 }` but no
`models` key. Call `loadConfig` with that path. Assert: thrown error is `instanceof QuotagateError`;
error message contains "validation" or "models" (does not need to be exact — must not be a raw
`ZodError`).

### T-3: file not found throws `QuotagateError` with path in message (covers SC-3)

Call `loadConfig("/tmp/does_not_exist_quotagate_test.yaml")`. Assert: thrown error is
`instanceof QuotagateError`; `error.message` contains `"/tmp/does_not_exist_quotagate_test.yaml"`.

### T-4: unknown top-level key is stripped from result (covers SC-4)

Call `loadConfig` with a fixture that has an unknown top-level key (e.g., `unknown_key: true`).
Assert: the returned object does not have `unknown_key` as a property.

### T-5: fixture with spec §3.9 MCP keys parses without error (covers SC-5)

Call `loadConfig` with a fixture that includes the MCP block from spec §3.9
(`mcp: { claude_server_startup_timeout_s: 10, health_check_interval_s: 30 }`). Assert: no error
thrown; `result.mcp` is defined (or `undefined` if the schema marks it optional and the value is
accepted — either is acceptable as long as it does not throw).

---

## Review Notes

**Reviewed by**: Principal Architect, 2026-06-11
**Verdict**: APPROVED WITH ADVISORIES

Gate confirmed live: 61 tests / typecheck clean / lint clean / format no diff.

---

### Blocking Findings

None.

---

### Advisory Findings (non-blocking — should address in a follow-up or the relevant downstream task)

**ADV-1 — `nodePath` alias is unnecessary noise**

`import nodePath from 'node:path'` exists solely to avoid shadowing a local named `path`. But the
parameter is named `configPath`, so there is no actual shadowing. The alias adds cognitive overhead
for every reader who has to check why `path` was renamed. The correct fix is straightforward:
`import path from 'node:path'` and leave the parameter name unchanged. This is a readability issue
per the Principle of Least Astonishment — a reader should not have to stop and ask "why is this
called nodePath?". Suggested fix for the BSE in T2 or as a standalone cleanup commit: rename the
import back to `path`.

**ADV-2 — T-5 assertion gap: `result.mcp` is never asserted as defined**

T-5 asserts only `expect(result).toBeDefined()`, which passes even if the YAML parser silently
dropped the `mcp` block or if the schema coerced it to `undefined`. The fixture contains an
explicit `mcp:` block, so the test should confirm what it claims to prove: that MCP keys survive
the parse round-trip. A minimal additional assertion `expect(result.mcp).toBeDefined()` would
catch a regression where `mcp` becomes accidentally required or the `z.record().optional()` is
replaced with a stricter schema that rejects the fixture. The assertion adds one line and eliminates
the gap between what the test name says and what the test checks. Suggested fix: add
`expect(result.mcp).toBeDefined()` immediately after the existing assertion in T-5. This is
advisory rather than blocking because A4 (the `z.record(z.unknown()).optional()` acceptance) is
confirmed by the gate passing; the gap is test expressiveness, not a correctness defect.

**ADV-3 — `ModelEntrySchema` not exported; downstream test construction will need the inferred type
only**

T2 (`proxy.ts`) and T4 (`index.ts`) will construct `QuotagateConfig` literals in tests. The
inferred `QuotagateConfig` type (exported) is sufficient for TypeScript assignability checks.
However, if a downstream test ever needs to build a `ModelEntry` value and get type feedback, it
will construct `{ backend: string; priority?: number }` inline — which is fine structurally but
adds fragility if the schema changes and the inline literal is not updated. There are two acceptable
resolutions: (a) export `ModelEntrySchema` so downstream tests can import the Zod type directly, or
(b) add a `ModelEntry` type alias (`export type ModelEntry = z.infer<typeof ModelEntrySchema>`) as a
named export. Option (b) costs one line and closes the gap without exposing the Zod artifact. I
recommend option (b) as a preparatory step before T2, where the type will first be needed. Either
way, this is advisory — the current gate is clean, and a future BSE can resolve this when T2 tests
are authored and the absence of the export causes friction.

---

### Observations (no action required)

**OBS-1 — `err as NodeJS.ErrnoException` cast is safe for this call site**

The concern raised about the cast: `fs.readFileSync` with the `'utf8'` encoding flag can only throw
a `NodeJS.ErrnoException` in Node 20+ (the ENOENT, EACCES, and all other fs errors are typed as
`ErrnoException` by `@types/node`). The non-ENOENT branch (`Could not read config at …:
${nodeErr.message}`) handles EACCES and every other errno correctly — `nodeErr.message` on an
EACCES produces a human-readable string like `"EACCES: permission denied, open '/path'"`, which is
informative without leaking internals. The cast is justified and the fallthrough branch is correct.

**OBS-2 — YAML error summary truncation at `split('\n')[0]` is an adequate boundary**

The first line of a `yaml` parse error contains the failure type and character offset (e.g.,
`"Implicit keys need to be on a single line at line 3, column 5"`), which is actionable for a
developer. Truncating at `\n` prevents multi-line raw parser output from appearing in a public
error message while retaining the essential location signal. This satisfies EF2's "non-leaking
message" requirement. No change needed.

**OBS-3 — `DEFAULT_CONFIG_PATH` computed at module load time is acceptable for Phase 1**

`os.homedir()` is evaluated once when the module is first imported. In the current test suite, no
test manipulates `HOME` or `USERPROFILE`, so there is no isolation risk today. If a future test
needs to override the default path it passes an explicit `configPath` argument — the function
signature already supports this. The module-load evaluation is correct for a startup-gate pattern
where the config path is a deployment constant, not a per-request variable. No change needed.

**OBS-4 — `backend: z.string()` open-string is the correct Phase 1 choice**

Locking `backend` to an enum of `"claude" | "gemini" | "codex"` today would be premature: Phase 2
adds Gemini and Codex adapters, and the spec does not enumerate the exact string set in §3.9. An
open string allows a developer to add a provider name in config before the adapter lands, avoiding a
config-breaking schema change. The right time to narrow this to an enum is when the adapter set
stabilises (likely at Phase 2 completion). No change needed in Phase 1.

**OBS-5 — `QuotagateConfigSchema` export is correct and necessary**

WS_06's integration test boot sequence may need to assert schema-level properties. Exporting the
schema (alongside the inferred type) is the right call — it costs nothing and enables downstream
consumers to do programmatic schema introspection without reimplementing the shape. Confirmed
correct.

**OBS-6 — Synchronous I/O is correct at the startup gate**

CLAUDE.md's "async-first" rule applies to adapter/transport I/O on the request path, not to
module-import-time initialization. `loadConfig` is called once during `quotagate start`, before
the Fastify server begins accepting connections. Using `fs.readFileSync` here is the right call:
it makes the failure mode synchronous and immediate, which is exactly what a fail-loud startup
gate should do. Using `fs.promises.readFile` at startup would require the caller to `await` the
call, adding async plumbing to `index.ts` for no benefit. The distinction between "startup
initialization" and "request-path I/O" should be documented in `index.ts` when T4 is implemented,
so future maintainers do not reflexively convert this to async.

---

### Success Criteria Verification

| # | Criterion | Result |
|---|-----------|--------|
| SC-1 | `loadConfig("tests/fixtures/config.minimal.yaml")` returns `QuotagateConfig` | PASS — T-1 passes; gate green |
| SC-2 | Missing `models` key → `QuotagateError` (not `ZodError`) | PASS — T-2 passes; `instanceof QuotagateError` + `not.toBeInstanceOf(ZodError)` both assert |
| SC-3 | File not found → `QuotagateError` with resolved path in message | PASS — T-3 passes; message `.toContain(missingPath)` asserts |
| SC-4 | Unknown top-level key stripped from result | PASS — T-4 passes; `not.toHaveProperty('unknown_key')` asserts |
| SC-5 | Spec §3.9 MCP keys parse without error | PASS — T-5 passes (assertion gap noted in ADV-2, non-blocking) |
| SC-6 | `QuotagateConfig` TypeScript type exported; `tsc --noEmit` clean; zero `any` casts | PASS — type exported; typecheck exits 0; no `any` in the file |
| SC-7 | `npm test` green; test count ≥56 | PASS — 61 tests, all passing |
| SC-8 | typecheck · lint · format all clean | PASS — all three commands exit clean; format reports no diff |

### Assumptions Verification

| # | Assumption | Verdict |
|---|-----------|---------|
| A1 | `yaml` parses YAML into a plain JS object | CONFIRMED — T-1 passes with the fixture round-trip |
| A2 | Zod `.strip()` drops unknown top-level keys | CONFIRMED — T-4 passes; `unknown_key` absent from result |
| A3 | `QuotagateError` wrapping retains path info | CONFIRMED — T-3 passes; path in message asserted |
| A4 | `z.record(z.unknown()).optional()` accepts Phase-2 MCP keys | CONFIRMED — T-5 passes; no Zod error thrown |

### Scope Fence Verification

Checked `src/config.ts` line by line. None of the following are present:
- Config hot-reload — absent
- Auto-creating `~/.quotagate/` or default config file — absent (D8 honored)
- Validation of `mcp.*` field values — absent (stub only)
- `retry.fallback_to_subprocess_after_failures` validation logic — stubbed as optional, not read
- Any `proxy.ts` or `index.ts` code — absent

Scope fence is clean.

---

## Architect Sign-off

- [x] Implementation reviewed
- [x] All success criteria verified
- [x] All assumptions resolved (proven, or fallback taken & documented)
- [x] No regressions in full test suite
- [x] `npm test` / `typecheck` / `lint` / `format` all clean
