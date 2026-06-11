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
| 1  | Add `yaml` to `dependencies` (`npm install yaml`) — runtime dep, not dev (WS_05-D5)             | ⬚ Not started | —         |       |
| 2  | Define `QuotagateConfigSchema` Zod schema in `src/config.ts`; export inferred `QuotagateConfig` type | ⬚ Not started | —     |       |
| 3  | Implement `loadConfig(path?)`: resolve default path, read file, parse YAML, Zod-validate, wrap errors as `QuotagateError` | ⬚ Not started | — | |
| 4  | Create `tests/fixtures/config.minimal.yaml` fixture (minimal valid config matching spec §3.9)   | ⬚ Not started | —         |       |
| 5  | Write `tests/config.test.ts`: valid fixture parses; missing `models` throws `QuotagateError`; unknown fields stripped; MCP keys pass; file-not-found throws with path in message | ⬚ Not started | — | |
| 6  | Green gate: `npm test` · `typecheck` · `lint` · `format`                                        | ⬚ Not started | —         |       |

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

_(Architect fills after BSE submits.)_

---

## Architect Sign-off

- [ ] Implementation reviewed
- [ ] All success criteria verified
- [ ] All assumptions resolved (proven, or fallback taken & documented)
- [ ] No regressions in full test suite
- [ ] `npm test` / `typecheck` / `lint` / `format` all clean
