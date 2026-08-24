# TASK_WS10_T1: Recon & Baseline (Environment Truth + Spike Scaffolding)

## Context

- **Workstream**: WS_10 (MCP Feasibility Investigation — Phase 2 Head)
- **Plan reference**: `docs/plan/workstreams/ws10_mcp_feasibility_investigation.md` (§Task Breakdown T1; §Locked Decisions D1–D4; §Review amendments)
- **Parent phase**: Phase 2 head (D-SEQ-01 continuation) — Phase 1 signed off 2026-08-24
- **Depends on**: None — first act of Phase 2
- **Blocks**: T2–T7 (scaffold + environment truth + baseline harness are their common ground)

---

## Goal & Why

- **Goal**: Establish the factual baseline every later experiment depends on and stand up the
  quarantined spike scaffolding: (1) inventory the installed Claude Code CLI (`--version`, `mcp`
  subcommand surface, headless/session flags); (2) scaffold `spikes/mcp_feasibility/{exp,fixtures,
  artifacts,findings}` with its own `package.json` and toolchain exclusions (D3); (3) build and run
  the cold-spawn `claude --print` latency harness recording p50/p95 — the comparison baseline for
  T5's warm-session benchmark.
- **Why**: T2–T6 all assume a known CLI surface and a ready quarantine zone. Recording the CLI
  version now (EF7) makes later evidence comparable. The cold-spawn baseline must exist *before*
  the warm-session numbers do, or IQ-5 has no denominator.

---

## Assumptions to Test

| #   | Assumption | Why we believe it | How this task tests it | If false → |
| --- | ---------- | ----------------- | ---------------------- | ---------- |
| A1 | The installed CLI exposes an MCP-related subcommand/flag surface discoverable via `--help` | Documented capability; version-dependent | Inventory output captured to artifacts | Record absence as a finding — it feeds IQ-1/EF1 directly |
| A2 | Headless/non-interactive flags exist that permit unattended operation | `--print` already used in production adapter | Flag inventory in artifacts | Persistent-session tasks (T2+) need replanning |
| A3 | Cold-spawn latency is measurable with reasonable variance at modest N | Spec §3.1 cites ~50–200ms boot cost | Harness records p50/p95 over ≥10 identical requests (D4 budget) | High variance → increase N within budget; note in artifacts |

---

## Expected Failures

- **[EF1]** No MCP surface found at this CLI version → record it; not a blocker for T1 itself.
- **[EF7]** CLI auto-updated since Phase 1 → record the current version; it becomes the workstream's reference version.
- **[EF6]** Throttle during baseline runs → back off and record (D4).

---

## Test Strategy

- **No Vitest tests** (D1/D2). Deliverables: inventory artifacts, scaffolded directory, one runnable
  experiment script (`exp01_baseline.*`) + its artifact log.
- **Green gate unchanged**: `npm test` stays **104/104 local**, `CI=1` == **91**; typecheck/lint/
  format clean. Scaffold exclusions must keep it that way (D3).

---

## Subtask Progress Table

| #   | Subtask                                                                                                                        | Status        | Iteration | Notes |
| --- | ------------------------------------------------------------------------------------------------------------------------------ | ------------- | --------- | ----- |
| 1   | Record `claude --version`, `claude --help`, `claude mcp --help` (or equivalent), and headless/session flag inventory → artifacts.| ✅ Completed  | 1         | CLI **2.1.240** (EF7 recorded; re-check in T7). A1 PROVEN: `claude mcp` subcommand exists (add/add-json/get/list/remove/**serve**, scopes local/user/project). A2 PROVEN: `-p/--print`, `--output-format`, `--input-format stream-json`, `--resume`/`--continue`/`--fork-session`/`--session-id`/`--no-session-persistence`, `--permission-mode`. Note: no literal `--mcp-server` flag; server mode is `claude mcp serve` (Goal-3 amendment material). Artifact: `cli-inventory-2026-08-24.log`. |
| 2   | Scaffold `spikes/mcp_feasibility/{exp,fixtures,artifacts,findings}` + own `package.json` (SPE finding: dependency isolation).   | ✅ Completed  | 1         | D2/D3 honored: private ESM `package.json` inside spike (product lockfile untouched); dirs exp/fixtures/artifacts/findings in place. |
| 3   | Toolchain exclusions: `tsconfig.json` (exclude), vitest config (exclude), tsup unaffected-by-construction; verify gate still green. | ✅ Completed  | 1         | tsconfig: explicit `"exclude"` added (include was already src-only); vitest: `'spikes/**'` added to exclude (both CI/non-CI arms); eslint ignores gained `'spikes/**'` so lint can never trip on quarantine. tsup entry is literal `['src/index.ts']` — unaffected by construction. Gate verified green post-edit (subtask 6). |
| 4   | Write `exp01_recon` baseline harness: spawn `claude --print` with a fixed trivial prompt ×≥10; record per-run wall time.         | ✅ Completed  | 1         | `exp/exp01_baseline.mjs`: fixed prompt constant `"Reply with the word OK."` ×10 sequential; performance.now() wall times; p50/p95 summary + machine context; tee to artifacts. Iteration note: first run failed (`--print` needs prompt as positional arg) — fixed; that run also exercised the D4 back-off path (recorded in artifact). |
| 5   | Run harness; tee raw output to `artifacts/exp01-<date>.log`; compute p50/p95; note machine context + concurrent subscription usage. | ✅ Completed  | 1         | **10/10 ok · p50=4948ms · p95=7749ms · mean=5223ms** (min 4141 / max 7749) on darwin-arm64 Apple M4 (10 cpus), node v22.18.0; no concurrent subscription use. D3 protocol: PIDs logged at spawn (4441…5506), SIGINT/SIGTERM handlers + finally teardown, orphan sweep CLEAN (`pgrep -f "claude.*--print"` → none). No throttle observed (EF6 not triggered). Finding for IQ-5 context: measured wall time is full round-trip (~4–8s), far above the spec §3.1 ~50–200ms *boot-cost* figure — T5 must separate boot overhead from model inference time. |
| 6   | Run green gate; confirm 104/91 unchanged.                                                                                       | ✅ Completed  | 1         | typecheck clean · lint clean · prettier check clean · `npm test` **104/104** (22 files) · `CI=1 npx vitest run` **exactly 91** (13 files). Zero test-count delta (D2). `git status` shows only tsconfig/vitest/eslint exclusion edits + untracked spikes/. |


---

## Decisions Made

### [D1] — Baseline prompt is fixed and trivial ✅ LOCKED (Architect plan §Test Strategy)

A single hardcoded short prompt ("Reply with the word OK.") run identically across all samples.
Latency variance from prompt size would contaminate the p50/p95 that T5 compares against.

### [D2] — Scaffold carries its own package.json ✅ LOCKED (SPE review finding)

`@modelcontextprotocol/sdk` and any spike-only deps install inside `spikes/mcp_feasibility/`,
never the product lockfile — keeps D2's zero-delta gate claim honest.

---

## Files Modified / Created

- `spikes/mcp_feasibility/**` — **create** (scaffold, harness script, artifacts).
- `tsconfig.json`, vitest config — **modify** (exclusions only).
- `.claude/CLAUDE.md` — no changes required beyond Session State status upkeep by BSE convention.

---

## Success Criteria / Verifiability

| #    | Criterion                                                                                     | How to verify |
| ---- | --------------------------------------------------------------------------------------------- | ------------- |
| SC-1 | CLI version + flag/MCP-surface inventory recorded under `spikes/mcp_feasibility/artifacts/`.  | Artifact exists and names the version. |
| SC-2 | Spike scaffold present with own `package.json`; excluded from tsc/vitest/tsup.                | Exclusion configs diff cleanly; imports resolve only within spikes/. |
| SC-3 | Baseline p50/p95 cold-spawn wall time recorded with sample count, machine context, raw log.   | `artifacts/exp01-*.log` + summary line. |
| SC-4 | Green gate unchanged: local 104/104, CI=91, typecheck/lint/format clean.                      | Gate commands run at close. |
| SC-5 | Process hygiene per WS_10-D3: PIDs logged; post-run orphan sweep result recorded.             | Artifacts show sweep output. |

---

## Required Test Cases

None — spike scripts produce artifacts, not assertions (WS_10-D1/D2).

---

## Review Notes

**Verdict: ✅ APPROVE** (PA, 2026-08-24) — with one dated environmental caveat recorded below.

Reviewed all deliverables first-hand:

- **Harness code** (`exp01_baseline.mjs`): D1 fixed-prompt constant ✓; PID capture at spawn ✓; teardown via `finally` + SIGINT/SIGTERM handlers with SIGTERM→SIGKILL escalation ✓; 120s watchdog ✓; D4 back-off-once-per-sample + abort after 3 consecutive failures ✓; throttle heuristic inspects body phrasing even on exit 0 ✓; nearest-rank percentile math correct ✓; machine context recorded ✓.
- **Quarantine verified by diff**: only `tsconfig.json` / `vitest.config.ts` / `eslint.config.js` exclusion edits + new files under `spikes/mcp_feasibility/` (own `package.json`, private ESM). Zero `src/`/`tests/` changes (D1/D3). eslint hardening of spikes/** is a welcome addition beyond spec.
- **Inventory artifact substantive**: version 2.1.240 captured (EF7); `claude mcp serve` discovered (no literal `--mcp-server` flag — Goal-3 amendment material); headless flag inventory (`--input-format stream-json`, `--fork-session`, `--session-id`, `--no-session-persistence`) directly feeds IQ-2/IQ-4.
- **Baseline numbers credible**: p50 4948ms / p95 7749ms over 10/10 clean sequential runs with inter-run pause; orphan sweep CLEAN recorded in-artifact.
- **Gate re-run by PA at review time**: typecheck/lint/format clean · `CI=1 npx vitest run` = exactly 91 · full local run: **96/104 — all 8 failures are live-Claude integration tests**, root-caused by direct CLI probe to a **subscription monthly-spend-limit refusal** ("resets 9am"), NOT a code regression: no non-live test failed, no src/test deltas exist, and the BSE's own gate run earlier at task close was 104/104 green before the cumulative live spawns of the day exhausted the budget. Per tracker EF1/A3 convention: environment, not code; re-verify the live subset after the limit resets (or re-auth). Recorded here so the next session does not misread this as a regression.
- **Non-blocking nit**: `exp01_baseline.mjs:192` prints a hardcoded "all tracked children exited" line unconditionally rather than deriving it from tracked state — cosmetic; the authoritative check is the genuine pgrep sweep two lines later.

---

## Architect Sign-off

- [x] Implementation reviewed
- [x] All success criteria verified (SC-1..SC-5; SC-4 gate green at task close — see dated caveat above)
- [x] All assumptions resolved (A1/A2 proven via inventory artifact; A3 proven via baseline)
- [x] Green gate untouched at execution (104 local / CI 91; post-limit-reset live re-check noted)
- [x] Quarantine honored (nothing under src/ or tests/ touched beyond exclusion configs)
