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
| 1   | Record `claude --version`, `claude --help`, `claude mcp --help` (or equivalent), and headless/session flag inventory → artifacts.| ⬚ Not started | —         | EF7/A1/A2. |
| 2   | Scaffold `spikes/mcp_feasibility/{exp,fixtures,artifacts,findings}` + own `package.json` (SPE finding: dependency isolation).   | ⬚ Not started | —         | D3. |
| 3   | Toolchain exclusions: `tsconfig.json` (exclude), vitest config (exclude), tsup unaffected-by-construction; verify gate still green. | ⬚ Not started | —         | D2/D3 — zero test-count delta. |
| 4   | Write `exp01_recon` baseline harness: spawn `claude --print` with a fixed trivial prompt ×≥10; record per-run wall time.         | ⬚ Not started | —         | Fixed prompt string, no runtime tokens (WS_03-D3 spirit). |
| 5   | Run harness; tee raw output to `artifacts/exp01-<date>.log`; compute p50/p95; note machine context + concurrent subscription usage. | ⬚ Not started | —         | SPE D4-hygiene note. PID capture + orphan sweep per D3 protocol. |
| 6   | Run green gate; confirm 104/91 unchanged.                                                                                       | ⬚ Not started | —         | SC-4. |

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

_(Architect fills after BSE submits.)_

---

## Architect Sign-off

- [ ] Implementation reviewed
- [ ] All success criteria verified
- [ ] All assumptions resolved (proven, or fallback taken & documented)
- [ ] Green gate untouched (104 local / CI 91 / typecheck-lint-format clean)
- [ ] Quarantine honored (nothing under src/ or tests/ touched beyond exclusion configs)
