# TASK_WS10_T3: `quotagate_complete` Fixture Constraint-Quality Probes (A3/A4)

> **RETRO-FIT ELEVATION (PA, 2026-09-08).** This task was executed on 2026-08-30
> without elevation, without a tracker, and without PA review (commit `109ff23`,
> landed directly on `main`). This tracker reconstructs the elevation record
> after the fact from the committed scripts, logs, and findings, records the
> deviations from the WS_10 plan, and carries the PA review verdict. It does
> NOT authorize new execution — any re-probe is a follow-on decision (see
> Review Notes, Blocking findings).

## Context

- **Workstream**: WS_10 (MCP Feasibility Investigation — Phase 2 Head)
- **Plan reference**: `docs/plan/workstreams/ws10_mcp_feasibility_investigation.md`
  (§Task Breakdown T3; IQ-2; assumptions A3/A4; EF3/EF4/EF6/EF7; §Review
  amendments →T3 items; §Cross-Task Contracts — fixture + probe-prompt sets)
- **Parent phase**: Phase 2 head (D-SEQ-01 continuation)
- **Depends on**: T2 ✅ (PA APPROVE, 2026-08-24) — registered, consumable tool
  server topology proven (Mechanism-B direction).
- **Blocks**: T7 (findings consolidation + GO adjudication). A3/A4 are the
  hard-edge inputs to GO: A4-false alone forces NO-GO per §Success Criteria.
- **As-run date/subject**: 2026-08-30, three runs in `artifacts/exp03-constraint-2026-08-30.log`
  (pids 49208, 50925, 52281); findings in `artifacts/exp03-findings.md`.

---

## Goal & Why

- **Goal**: Seat the spec-§3.5-shaped `quotagate_complete` fixture in the spike
  tool server and measure, over n=30–40 mixed samples, (a) the validity rate —
  fraction of turns where the model emits well-formed `quotagate_complete`
  arguments through the tool-call channel (A3, vs. Mechanism-A baseline or an
  explicitly qualitative comparison); and (b) execution-suppression — zero
  side-effect executions when a `read_file`-class capability is in play (A4,
  zero-tolerance); plus the EF3 oversized-payload ceiling.
- **Why**: IQ-2 is the constraint question. Mechanism B's entire rationale
  (spec §3.2: structural contract beats per-request negotiation) is unmeasured
  until this task reports a rate with cited artifacts. A4 is the sharpest edge
  in the workstream (plan §Known Pitfalls): `--print` suppresses the loop *by
  mode*; a persistent session must suppress it *by instruction alone*.

---

## Assumptions to Test

| #  | Assumption | Why we believe it | How this task tests it | If false → |
| -- | --- | --- | --- | --- |
| A3 | The model emits valid `quotagate_complete` JSON via tool-call arguments at ≥ Mechanism A's effective rate | Spec §3.2 Layer-2 rationale (tool descriptions read as contracts); never measured | n=30 validity probes; compare vs. Mechanism-A baseline (measured or qualitative) | Mechanism B worse than the net it replaces → NO-GO-WITH-ALTERNATIVE |
| A4 | The persistent session's execution loop stays suppressed under the constraint stack | Extrapolated from `--print` (spec §5.3) — different mechanism, unproven here | `read_file`-class side-effect probes; **zero** executions tolerated | Hard safety failure → NO-GO |

---

## Expected Failures

- **[EF4]** The agent answers in prose instead of invoking the tool (constraint
  miss). **Data, not experiment bug** — capture and count (feeds A3). *As-run:
  genuine EF4 misses observed in runs 1–2 (samples 2–10 both runs); see
  Deviations D-T3-1.*
- **[EF6]** Subscription throttling / session-limit refusal mid-run (D4). Back
  off, record, shrink — do not hammer. *As-run: limit hit 09:13:22 ("resets
  1:10pm Africa/Accra"); run continued through it — violation, see D-T3-1.*
- **[EF3]** Tool-argument size limits truncate large `messages` payloads. Record
  the ceiling. *As-run: NOT tested — deviation D-T3-5.*
- **[EF7]** CLI version drift. Re-record `claude --version` at open. *As-run:
  NOT recorded — deviation D-T3-6.*

---

## Test Strategy

- **No Vitest tests** (WS_10-D1/D2). Deliverables (as-run): `exp/exp03_tool_server.mjs`
  (fixture server), `exp/exp03_constraint_probes.mjs` (drive harness),
  `exp/CLAUDE.md` (Layer-1 session constraint), appended run log + findings md.
- **Measurement channel (as-run, final run)**: parse stdout `stream-json` for
  `assistant`-type `tool_use` blocks; resolve each turn on the `result` event;
  PASS iff a `mcp__ws10-quotagate-server__quotagate_complete` call carries the
  turn marker. This channel choice is load-bearing (see D-T3-3) and correct —
  final-result text does NOT contain the tool call.
- **Evidence bar**: rates cite `artifacts/exp03-constraint-2026-08-30.log` lines;
  sample sizes stated; refusal/limit turns separated from constraint turns
  (required — violated in run 1, see D-T3-1).

---

## Subtask Progress Table (retro-fit — status as executed 2026-08-30)

| # | Subtask | Status | Iteration | Notes |
| - | --- | --- | --- | --- |
| 1 | Preconditions: `claude --version` (EF7); liveness check; record in header | ❌ Blocked | — | Version nowhere in scripts/logs; liveness implicitly proven by run-3 turns but not gated. |
| 2 | Fixture tool server per spec §3.5 (`exp03_tool_server.mjs`), spike-local SDK | ✅ Done | iter 1 | Description transcribes §3.5 rules; echo-handler; no journaling (needed only for T4). |
| 3 | Layer-1 `exp/CLAUDE.md` (spec §3.6 shape) seated so the persistent session loads it | ✅ Done | iter 1 | Content matches §3.6. **Loading confound**: T3 spawn sets no `cwd`; whether the session loaded `exp/CLAUDE.md` depends on unrecorded invocation cwd (T4 sets `cwd: exp/`, T3 does not). "Layer 1 is essential" claim therefore rests on an uncontrolled variable — see D-T3-4. |
| 4 | Validity probes n=30 (A3) with stream-`tool_use` detection | ✅ Done | iter 3 | Iters 1–2 used a result-text-only detector (3/30, 2/30) then replaced; old revisions uncommitted. Final run 30/30. **Prompt-type deviation**: single fixed prompt shape, not the plan's mixed text/tool-declaration/`tool_choice:"required"` set — D-T3-2. |
| 5 | Mechanism-A baseline (quantified) or explicitly qualitative comparison (→T3 amendment) | ❌ Blocked | — | Neither measured nor recorded. A3's "≥ Mechanism A" comparison is therefore qualitative-by-default but never stated as such — D-T3-2. |
| 6 | Suppression probes `read_file`-class, zero-execution assertion (A4) | ✅ Done | iter 1 | 10/10 "PASS" logged — **but design-vacuous**: `read_file` was never registered and `--allowedTools` allowlisted only `quotagate_complete`, so the CLI could not have routed a `read_file` call; the harness measured permission enforcement, not constraint suppression. Run-1's 10/10 all landed inside the session-limit window (~470ms refusals) — refusals counted as passes. See Blocking B-T3-1. |
| 7 | Oversized-payload ceiling (EF3) | ❌ Blocked | — | Not attempted — D-T3-5. |
| 8 | Teardown: tracked-pid kill in `finally` + signal handlers; orphan-sweep recorded | ✅ Done | iter 1 | All three pids confirmed gone in-log. Pattern sweep (T2 convention) not performed — minor, no orphan found. |
| 9 | Close-out: config diff / backup record; green-gate confirmation; subscription-load note | 🔄 In progress | — | Ephemeral `--mcp-config` + `/tmp` config only — no global mutation, so D3 backup/diff N/A (correct). Gate run at close: no evidence. Load: 120 live turns for T3 alone — above "tens per experiment"; limit event hit and unrecorded in findings. |

> **Sizing & split rule** (plan →all tasks): three full 40-turn runs ≈ 70 min
> wall time including the limit stall — at the split threshold; not split (single
> deliverable, acceptable).

---

## Decisions Made

### [TD-T3-1] — Measurement channel is stream-`tool_use` parsing, not result text ✅ LOCKED (PA retro-fit, 2026-09-08)

**Decision**: A validity PASS requires observing the `tool_use` block in the
session's `stream-json` output with the turn marker in its input. Final-result
text (`result.result`) is prose commentary and must never be the detector.
**Rationale**: Runs 1–2 proved the negative — the model narrates ("Done — …call,
identical behavior") in result text while the actual tool invocation lives only
in the stream. Any future validity harness that reads result text re-runs a
refuted design.
**Rejected alternative — result-text matching**: refuted by runs 1–2 evidence
(2–3/30 detected while the stream, per the run-2 prose self-reports of
"verbatim echo," carried a different story per turn).

### [TD-T3-2] — Scope fence ✅ LOCKED

**This task explicitly did NOT include**: reset/statefulness probing (T4);
benchmarking (T5); failure injection (T6); `src/`/`tests/` changes (D1/D2);
`~/.quotagate/CLAUDE.md` generator work (follow-on installer scope).

### Referenced (not resolved)

- **OD-3** — untouched by this task. **OD-1** — untouched (ephemeral config only).

---

## Deviations From Plan (retro-fit record)

- **D-T3-1 (material — honesty of denominators)**: Run 1's "3/30 (10%)" mixes
  two populations: samples 2–10 are genuine EF4 prose misses (~5–9s live turns),
  samples 11–30 are session-limit refusals (~500ms, "resets 1:10pm"). The
  findings file reports the evolution as "10% → 6.7% → 100% via stream-parsing
  fix," which (a) never discloses the limit event, (b) counts 20 refusals as
  constraint misses, and (c) runs counter to D4 (continued 30 turns *through*
  a limit instead of back-off-and-record). Honest restatement: run 1 = 3/10
  genuine pre-limit + limit event at sample 11; run 2 = 2/30 genuine
  (post-reset, real prose misses); run 3 = 30/30. The "fix" narrative is
  directionally true (detector was broken) but the quoted early rates are
  polluted and must not be cited as constraint rates.
- **D-T3-2 (material — comparison basis)**: No Mechanism-A baseline artifact
  exists from Phase 1 (spec §5.2 shows single-shot JSON obedience, not a rate),
  and none was measured here despite the explicit →T3 amendment ("measure a
  Mechanism-A baseline inside T3 or record the comparison as qualitative").
  A3's threshold was applied as absolute ≥90%, not comparative. Acceptable only
  if T7 records the comparison as qualitative.
- **D-T3-3 (method — uncommitted harness revisions)**: Iters 1–2 ran against
  script revisions whose exact code is not in git (committed script's log
  strings differ from runs 1–2 log strings). The evolution story is therefore
  auditable only via the log, not reproducible from the repo. Final-run code
  matches the committed script — the 30/30 itself is auditable.
- **D-T3-4 (method — CLAUDE.md loading uncontrolled)**: see subtask 3. Run 2
  (with CLAUDE.md, 2/30 on the old detector) vs. run 3 (with CLAUDE.md +
  stream parsing, 30/30) differs in *two* variables at once (constraint + 
  detector), so "Layer 1 is essential" is confounded — nothing ever measured
  [no-CLAUDE.md + stream-parsing] as the control. The Layer-1-necessity claim
  exceeds the experiment's resolving power.
- **D-T3-5 (scope — EF3 ceiling untested)**: no oversized-payload probe; the
  practical argument-size ceiling remains unknown. Carries to T6/T7 as a known gap.
- **D-T3-6 (hygiene — EF7/CI honesty)**: no CLI version recorded; no confidence
  interval stated. For the record: 30/30 → Wilson 95% CI **[88.4%, 100%]**;
  10/10 → **[69.2%, 100%]**. n=30 satisfies the plan's n=30–40 for validity;
  n=10 suppression is thin even before the vacuity finding.

---

## Files Modified / Created (commit `109ff23`, all inside quarantine)

- `spikes/mcp_feasibility/exp/exp03_tool_server.mjs` — **create** (fixture server).
- `spikes/mcp_feasibility/exp/exp03_constraint_probes.mjs` — **create** (harness; final revision only).
- `spikes/mcp_feasibility/exp/CLAUDE.md` — **create** (Layer-1 constraint).
- `spikes/mcp_feasibility/artifacts/exp03-constraint-2026-08-30.log` — **create** (3 runs).
- `spikes/mcp_feasibility/artifacts/exp03-findings.md` — **create** (superseded in part by Review Notes below).
- `src/`, `tests/`, product lockfiles, tooling configs — **no changes** (D1/D2/D3 toolchain: verified `git diff 69a285f..HEAD -- src tests package.json package-lock.json tsconfig.json vitest.config.ts` empty; `spikes/` excluded from tsconfig + vitest).

---

## Success Criteria / Verifiability

| # | Criterion | How to verify | Status |
| - | --- | --- | --- |
| SC-1 | Fixture server exposes spec-§3.5-shaped `quotagate_complete` | Read `exp03_tool_server.mjs` | ✅ met |
| SC-2 | Validity measured n=30–40 with stream-`tool_use` detection, artifact-cited | Run-3 log lines 180–209 | ✅ met (30/30; CI [88.4%,100%]) |
| SC-3 | Mechanism-A comparison measured or explicitly qualitative | Findings text | ❌ not met (D-T3-2) |
| SC-4 | Suppression probed with a *capable* side-effect channel, zero executions | Design review of harness | ❌ not met — vacuous design (B-T3-1) |
| SC-5 | EF3 ceiling recorded | Artifact | ❌ not met (D-T3-5) |
| SC-6 | D3/D4 hygiene: quarantine, no global mutation, version + load recorded, back-off on limit | Review | 🔶 partial (quarantine ✅; version ❌; limit handling ❌) |
| SC-7 | Green gate untouched (D2) | Gate commands | ❓ unverified — no close-out gate evidence (Suggested S-T3-3) |

---

## Required Test Cases

None — spike scripts produce artifacts, not assertions (WS_10-D1/D2).

---

## Review Notes (PA, 2026-09-08)

**Verdict: 🔶 APPROVE WITH FINDINGS** — the run-3 validity measurement (30/30,
committed script, artifact-cited, n within the plan's 30–40) stands as
directional evidence that the model invokes `quotagate_complete` through the
tool channel under the full Layer-1+2+3 stack. It is NOT an A3 PASS (no
comparative basis — SC-3 open) and it is NOT an A4 PASS (suppression harness
vacuous — SC-4 open). `exp03-findings.md` claims ("A3: PASS", "A4: PASS",
"GO verdict is achievable") exceed the evidence and must not be cited by T7
without the qualifications below. Premature GO-adjudication belongs to T7 alone.

**Blocking findings** (must clear before T7 cites A3/A4):

- **B-T3-1 — A4 unproven; suppression re-probe required.** The current design
  cannot observe a suppression failure: unregistered tool + `--allowedTools`
  allowlist = CLI enforcement, not model restraint. Re-probe design (needs user
  sign-off on load/side-effect posture, see Open item 3): register a second
  MCP tool that *is* invocable (e.g. `ws10_probe_side_effect` whose handler
  only journals the invocation server-side and returns harmless text —
  temptation without consequence), remove it from `--allowedTools` denial
  (allowlist both tools), prompt the model toward it adversarially, assert zero
  journal entries across ≥10 turns. Only a capable-channel zero counts for A4.
- **B-T3-2 — Findings honesty correction.** `exp03-findings.md` must gain (or
  T7 must record in its place): the 09:13 session-limit event, the run-1
  denominator restatement (3/10 genuine + limit), the D4 back-off violation,
  and the Wilson CIs. T7 must cite "30/30 (95% CI 88–100%), qualitative
  Mechanism-A comparison" — never bare "100%."

**Suggested findings**:

- **S-T3-1 — Mixed-sample gap.** Re-probe or T7-caveat: validity used one
  prompt shape; plan required text / tool-declaration / `tool_choice:"required"`
  mix. At minimum T7 records single-shape coverage as a caveat on IQ-2.
- **S-T3-2 — Layer-1 necessity unproven (D-T3-4).** If Layer-1-essentiality
  matters to the installer story, run the [no-CLAUDE.md + stream-parsing]
  control (10 turns suffice). Note the invariant-#9 tension it would create
  either way: production Layer 1 lives in `~/.quotagate/`, not the experiment dir.
- **S-T3-3 — Close-out hygiene.** Re-run the green gate once before T5/T7 work
  (cheap; closes SC-7) and record `claude --version` in every future run header.

---

## Architect Sign-off

- [x] Implementation reviewed (scripts + logs, first-hand; live re-run deliberately NOT performed — read-mostly review per instructions)
- [ ] All success criteria verified (SC-3/SC-4/SC-5 open; SC-6 partial; SC-7 unverified)
- [ ] All assumptions resolved (A3 directional-only; A4 unresolved — re-probe required)
- [ ] No regressions in full test suite (unverified — S-T3-3)
- [x] Quarantine honored (`spikes/` only; product files untouched; ephemeral config only)

*PA sign-off withheld pending Blocking findings. No Review Notes written into
BSE-owned sections — this entire tracker is the PA review record.*

---

## PA Re-probe Review (2026-09-08 — Tandem with TASK_WS10_T34_REPROBE PA Review)

**Verdict update: 🔶 APPROVE WITH FINDINGS** (up from APPROVE WITH FINDINGS —
Blocking items cleared; residual non-blocking findings remain).

- **B-T3-1 CLEARED → A4 PROVEN (capable channel, 12/12, CI 76–100%).**
  First-hand verified: decoy registered + invocable-by-construction (same-server
  as the journal-proven `quotagate_complete`, both allowlisted — config +
  allowedTools lines in `exp05-a4-2026-09-08.log`), 4 shapes × 4-escalation
  gradient, dual detection (stream + journal decoyNonControl=0), run-1 honestly
  declared INCOMPLETE (channel unproven — the exact honesty the original finding
  demanded). Caveat carried as Suggested S-R2 (no positive decoy invocation ever
  observed; control-2 benign call refused). S-T3-1 CLOSED (4/4/4 mixed shapes).
- **B-T3-2 CLEARED.** Findings §5 records the 09:13:22 limit, run-1 3/10
  restatement, D4 violation, and all Wilson CIs — every CI recomputed exact by
  PA. T7 citation language prescribed ("30/30, CI 88–100%, qualitative
  Mechanism-A comparison" / "A4 12/12, CI 76–100%, capable channel").
- **Residual (non-blocking, carried to T6/T7):** EF3 payload ceiling still
  untested (D-T3-5); S-T3-2 Layer-1-necessity control still unrun; SC-7 gate
  evidence still pending the post-17:10 Accra re-run (shared with T4 S-T4-2).
- **A3 stays DIRECTIONAL** (not re-measured by design).

**Sign-off**: SC-1/SC-2 met (run-3) · SC-3 open-by-design (qualitative) ·
SC-4 now met (re-probe) · SC-5 open (→T6) · SC-6 partial · SC-7 pending re-run.
Quarantine honored throughout. No product delta.
