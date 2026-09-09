# TASK_WS10_T4: Statefulness & Serialization Probes (A5/A6 → OD-3 feed)

> **RETRO-FIT ELEVATION (PA, 2026-09-08).** This task was executed on 2026-08-30
> without elevation, without a tracker, and without PA review (commit `53b545d`,
> landed directly on `main`). This tracker reconstructs the elevation record
> after the fact from the committed script, log, and findings, records the
> deviations from the WS_10 plan (especially the §Review amendments →T4 items,
> none of which were implemented), and carries the PA review verdict. It does
> NOT authorize new execution — the re-probe prescription in Review Notes needs
> user decisions first (Open items 1–2).

## Context

- **Workstream**: WS_10 (MCP Feasibility Investigation — Phase 2 Head)
- **Plan reference**: `docs/plan/workstreams/ws10_mcp_feasibility_investigation.md`
  (§Task Breakdown T4; IQ-3/IQ-4; assumptions A5/A6; §Review amendments →T4
  items — positive control, ≥5 reset cycles incl. adversarial, server-side
  journaling; §Cross-Task Contracts — fixed-UUID code words; §Success Criteria
  GO conditions for IQ-3/IQ-4; OD-3)
- **Parent phase**: Phase 2 head (D-SEQ-01 continuation)
- **Depends on**: T2 ✅ (PA APPROVE, 2026-08-24). T3 (retro-fit, APPROVE WITH
  FINDINGS — its Layer-1 + stream-parsing conventions are reused here).
- **Blocks**: T7 GO adjudication (IQ-3/IQ-4 are GO-gating); **OD-3 user
  adjudication** (structural vs. verified-reset evidence level for
  invariant #10); follow-on adapter design (`_mcp_lock` lifecycle coverage).
- **As-run date/subject**: 2026-08-30, `artifacts/exp04-statefulness-2026-08-30.log`
  (pid 60296, 10 sequential + 5 concurrent pairs); `artifacts/exp04-findings.md`.

---

## Goal & Why

- **Goal**: Determine, empirically, (a) whether a persistent session retains
  conversation state across invocations and how fresh-context-per-call is
  achieved and *verified* — sequential code-word plant-and-**probe** (recall,
  not echo) across no-reset (positive control) and reset-between variants,
  adversarial extraction attempt, every candidate reset mechanism enumerated
  and tested ≥5 cycles; server-side invocation journaling distinguishing queue
  vs. interleave vs. corrupt (A5); and (b) what actually happens at the session
  boundary under concurrency, observed server-side (A6). Classify: structural /
  verified-reset / unachievable — the exact input OD-3 is adjudicated on.
- **Why**: Invariant #10 ("statelessness is structural, not cleaned up after
  the fact") and #11 (one-in-flight-per-session) are the two load-bearing
  guarantees of the MCP-primary end-state. T4 is the only task that measures
  them. A weak T4 does not merely leave a gap — it risks certifying an
  isolation property the adapter will bet production correctness on.

---

## Assumptions to Test

| #  | Assumption | Why we believe it | How this task tests it | If false → |
| -- | --- | --- | --- | --- |
| A5 | Fresh-context-per-call is achievable (structurally or via verified reset) on a persistent session | Spec §3.1 assumes a reachable mechanism, explicitly "unverified" | Code-word recall probes across reset variants; ≥5 reset cycles incl. ≥1 adversarial extraction | Unachievable → invariant #10 unhonorable on MCP → NO-GO (or OD-3 adjudication) |
| A6 | Concurrent invocations on one session fail loudly (error/queue) rather than silently corrupting | Nothing known; worst case is silent interleaving | Concurrent double-invocation probe **with server-side journaling** (queue vs. interleave vs. corrupt) | Silent corruption → `_mcp_lock` confirmed mandatory + lifecycle coverage defined |

---

## Expected Failures

- **[EF4-carry]** Model narrates instead of invoking — count via stream channel (T3 TD-T3-1). *As-run: no occurrences; all 15 turns produced tool calls.*
- **[EF6]** Session-limit / throttling (D4). *As-run: no limit event in the T4 window; load was 15 live turns — within "tens."*
- **[EF7]** Version drift. *As-run: NOT recorded — same gap as T3 (D-T3-6).*
- **[Worst-case IQ-3]** Silent interleaving/corruption under concurrency — the
  outcome the journaling requirement exists to catch. *As-run: unmeasurable by
  the as-built harness (Blocking B-T4-1).*

---

## Test Strategy (as-planned vs. as-run)

- **As-planned** (→T4 amendments, mandatory): sequential **no-reset arm as
  explicit positive control**, both arms reported jointly; "deterministic"
  quantified as **≥5 reset cycles including ≥1 adversarial extraction**;
  **server-side start/end timestamp journaling** in the fixture tool server
  (client-side observation cannot distinguish queue vs. interleave vs. corrupt);
  fixed-UUID code words per WS_03-D3.
- **As-run**: single persistent session; Test 1 = 10 sequential echo-fidelity
  turns; Test 2 = 5 "concurrent" stdin-pair turns resolved through a shared
  client-side resolver queue; echo-only tool server (no journal); `Date.now()`
  markers; no reset arm of any kind; no recall probe; no adversarial attempt.
  Every →T4 amendment item is unimplemented (see Deviations).

---

## Subtask Progress Table (retro-fit — status as executed 2026-08-30)

| # | Subtask | Status | Iteration | Notes |
| - | --- | --- | --- | --- |
| 1 | Preconditions: `claude --version`; liveness; header record | ❌ Blocked | — | Absent (same gap as T3). |
| 2 | Sequential **no-reset positive control**: plant code word in A; B asks recall ("what was the code word?") directly, then adversarially — *expect* recall (proves the probe can detect retention) | ❌ Blocked | — | NOT DONE. Test 1 plants a marker and checks the *same turn's* tool-call input echoes it while prior-turn prefixes are absent — an echo-fidelity check, not a retention probe. A positive control must demonstrate recall; this arm demonstrates the opposite of retention-detectability and cannot calibrate anything. |
| 3 | Reset-mechanism enumeration + ≥5 reset cycles incl. ≥1 adversarial extraction, joint reporting with the control arm | ❌ Blocked | — | NOT DONE. Zero reset mechanisms enumerated, zero tested. No OD-3-adjudicable evidence produced. |
| 4 | Server-side invocation journaling (start/end timestamps per tool call) distinguishing queue vs. interleave vs. corrupt | ❌ Blocked | — | NOT DONE. `exp03_tool_server.mjs` echo-handler journals nothing; exp04 added no journal. Client-side only. |
| 5 | Concurrent double-invocation probe with per-request result attribution | ❌ Blocked | — | Structurally broken as built (B-T4-1): both waiters share one resolver queue, so the first `result` event resolves **both** promises with the **same** payload and the second turn's result is silently dropped. The 0/5 pattern (A:own∧¬leak, B:¬own∧leak) is exactly what this harness bug produces regardless of session behavior. No conclusion about queuing/contamination is licensed. |
| 6 | Fixed-UUID code words, distinct per experiment file (WS_03-D3 / Cross-Task Contract) | ❌ Blocked | — | `Date.now()`-suffixed markers used instead. Breaks reproducibility/comparability convention. |
| 7 | Teardown (tracked-pid `finally` + signals; sweep recorded) + ephemeral-config-only D3 handling | ✅ Done | iter 1 | pid 60296 confirmed gone; `--mcp-config` ephemeral, no global mutation (D3 backup/diff correctly N/A). No pattern sweep — minor. |
| 8 | Close-out: gate evidence; load/version notes; joint-report write-up | 🔄 In progress | — | Log is honest raw material (lines cited below); findings md over-claims (see B-T4-2). No gate evidence. |

---

## Decisions Made

### [TD-T4-1] — Scope fence ✅ LOCKED

**This task explicitly did NOT include**: benchmarking (T5); failure injection
(T6); findings consolidation / GO adjudication (T7 — `exp04-findings.md`'s
"GO still achievable / Risk MEDIUM" passages are premature and non-binding);
any `_mcp_lock` production code (D1); any `src/`/`tests/` change (D1/D2).

### Referenced (not resolved — owned by user, see Open items)

- **OD-3** (structural vs. verified-reset evidence bar for invariant #10).
  This task produced no evidence toward it.
- **A6 serialization disposition** (reset+lock pairing requirement).

---

## Deviations From Plan (retro-fit record)

- **D-T4-1 (fatal to the verdict — shared-resolver harness bug)**: see subtask 5
  / Blocking B-T4-1. The concurrent arm's data cannot distinguish "session
  queued B behind A with context bleed" from "harness handed both callers the
  same first result." The findings' "queued but second sees first's context"
  mechanism story is therefore conjecture, and "solvable with serialization" is
  doubly unsupported (see D-T4-3).
- **D-T4-2 (fatal to A5 — wrong probe shape)**: retention requires a *recall*
  probe (B asks for A's secret); echo-fidelity (A's turn contains A's marker)
  is satisfied by a goldfish and by a pachyderm alike. The 10/10 sequential
  result is real data about *invocation reliability*, not about *isolation*.
  It says nothing for or against A5.
- **D-T4-3 (reasoning error — serialization ≠ fresh context)**: even taking the
  concurrent pattern at face value ("second sees first's context"), a lock
  alone does not fix it — serialized back-to-back turns still share session
  history. The required pairing is **reset + lock covering call → response →
  reset as one atomic unit** (spec §3.1/§3.8 verbatim), which is OD-3 territory,
  not "a standard mutex." The findings' "Risk: MEDIUM … known pattern, not a
  fundamental blocker" understates the open question it was tasked to feed.
- **D-T4-4 (amendments bypassed)**: positive control, ≥5 reset cycles,
  adversarial extraction, server-side journaling — all four →T4 items absent
  with no documented rationale. This is the elevation process working as
  designed *in reverse*: the items existed precisely to prevent this probe
  shape, and un-elevated execution skipped them.
- **D-T4-5 (convention break)**: `Date.now()` markers vs. the fixed-UUID
  contract — small, but reproducibility conventions are load-bearing in a
  multi-session evidence chain; re-probe must restore them.

---

## Files Modified / Created (commit `53b545d`, all inside quarantine)

- `spikes/mcp_feasibility/exp/exp04_statefulness_probes.mjs` — **create** (harness; concurrent arm structurally flawed, see B-T4-1).
- `spikes/mcp_feasibility/artifacts/exp04-statefulness-2026-08-30.log` — **create** (honest raw log; usable as re-probe baseline for timing only).
- `spikes/mcp_feasibility/artifacts/exp04-findings.md` — **create** (superseded by Review Notes below; do not cite for A5/A6).
- `src/`, `tests/`, product lockfiles, tooling configs — **no changes** (D1/D2/D3 toolchain: same verification as T3 tracker).

---

## Success Criteria / Verifiability

| # | Criterion | How to verify | Status |
| - | --- | --- | --- |
| SC-1 | Sequential no-reset positive control demonstrates recall (probe calibrated) | Artifact recall transcript | ❌ not done |
| SC-2 | ≥5 reset cycles incl. ≥1 adversarial extraction, jointly reported; outcome classified structural / verified-reset / unachievable | Artifact + classification | ❌ not done |
| SC-3 | Concurrent behavior classified queue / interleave / corrupt **via server-side journal** | Journal artifact | ❌ not done (client-side only, attribution broken) |
| SC-4 | Fixed-UUID convention; version + load recorded | Review | ❌ markers dynamic; version absent; load OK (15 turns) |
| SC-5 | D3/D4 hygiene + quarantine | Review | ✅ quarantine/config/teardown OK; gate evidence absent |
| SC-6 | Green gate untouched (D2) | Gate commands | ❓ unverified (Suggested S-T4-2) |

---

## Required Test Cases

None — spike scripts produce artifacts, not assertions (WS_10-D1/D2).

---

## Review Notes (PA, 2026-09-08)

**Verdict: ❌ REJECT** — not of the effort or the raw log (both retained as
useful material), but of every evidentiary claim: the "sequential 10/10 PASS
(A5)" does not measure retention, and the "concurrent 0/5 FAIL (A6), solvable
with serialization" is produced by a broken attribution harness and
mis-prescribed even on its own terms. T7 must cite **neither** claim. What
survives: 15/15 turns drove the tool channel reliably (consistent with T3's
directional A3 evidence), wall-time baselines (~9–19s/turn sequential,
~13–19s/pair concurrent), and a precise specification of what the re-probe must
do differently (Blocking items below — the actual deliverable of this review).

**Blocking findings** (re-probe must satisfy all three before T7 adjudicates IQ-3/IQ-4):

- **B-T4-1 — Fix concurrent attribution + add server-side journal.** One waiter
  per `result` event (FIFO resolver queue — `shift()`, not broadcast); or
  simpler, drive concurrency at the *process* level (two sessions, then two
  turns on one session) so attribution is structural, not bookkeeping. Fixture
  tool server must journal `{callId, tStart, tEnd, markerHash}` per invocation
  to disk — the journal, not client observation, classifies queue vs.
  interleave vs. corrupt. Preserve the current 0/5 log as the "what broken
  attribution looks like" reference.
- **B-T4-2 — Reshape the retention probe to recall + reset + adversarial.**
  Positive control first (no-reset sequential recall, direct then adversarial —
  *expect* leak; if even the control shows no recall, the probe is blind and
  nothing downstream counts). Then enumerate reset candidates (explicit clear
  command if one exists / session restart / resume-new-session flags — T1's
  flag inventory: `--fork-session`, `--session-id`, `--no-session-persistence`
  — is the starting list), ≥5 cycles each incl. ≥1 adversarial extraction per
  candidate, joint reporting. Classify per plan: structural / verified-reset /
  unachievable. Fixed-UUID markers (WS_03-D3).
- **B-T4-3 — Correct the prescription language.** Any write-up of
  second-sees-first-context must state the reset+lock atomic-unit requirement
  (spec §3.1/§3.8) and route explicitly to **OD-3**, never to "standard
  mutex, Risk MEDIUM." `exp04-findings.md`'s Implications/Required-Engineering/
  Verdict-Update sections are superseded by this note.

**Suggested findings**:

- **S-T4-1 — Plan wording is sound; no plan edit proposed.** A6's "fail loudly
  (error/queue) rather than silently corrupting" already anticipates the right
  taxonomy; the failure was execution fidelity to the →T4 amendments, not plan
  content. (Per instructions: plan touched only for unambiguous corrections —
  none qualify; everything else is logged here as findings.)
- **S-T4-2 — Close-out hygiene.** Single green-gate run + `claude --version`
  in the re-probe header (shared with S-T3-3; one run covers both).

**Faulty-assumption correction logged (findings file, not plan)**: "concurrent
requests are queued … This is NOT a bug — it's how persistent sessions work"
(§Analysis) asserts an unmeasured mechanism from unattributable data. The
honest statement is: *concurrent behavior on one session is unmeasured; the
harness could not attribute responses to requests.* Likewise "GO still
achievable" preempts T7's exclusive adjudication right.

---

## Architect Sign-off

- [x] Implementation reviewed (script + logs, first-hand; live re-run deliberately NOT performed)
- [ ] All success criteria verified (SC-1..SC-4 open; SC-6 unverified)
- [ ] All assumptions resolved (A5/A6 both unmeasured — re-probe required)
- [ ] No regressions in full test suite (unverified — S-T4-2)
- [x] Quarantine honored (`spikes/` only; product files untouched; ephemeral config only)

*PA sign-off withheld — REJECT verdict stands until the B-T4-1..3 re-probe
lands and is reviewed. No Review Notes written into BSE-owned sections — this
entire tracker is the PA review record.*

---

## PA Re-probe Review (2026-09-08 — Tandem with TASK_WS10_T34_REPROBE PA Review)

**Verdict update: 🔶 APPROVE WITH FINDINGS** (up from ❌ REJECT — all three
Blocking items cleared; residual non-blocking findings remain).

- **B-T4-1 CLEARED → A6 PROVEN (queue / fail-loudly direction).** FIFO resolver
  + server journal confirmed in committed code; staggered run authoritative
  (journal 6/6 own-markers-only, client 2/2 clean); run-1 journal QUEUE 3/3
  retained with void-client honestly disclosed; crash-run disclosed with no
  orphan. Caveats: S-R4 (durMs≈0 limits span-overlap resolution — serialization
  proven by single-result turns + backlog, not by span non-overlap), S-R5
  (pair-1 third tool_use block unattributed but journal-bounded).
- **B-T4-2 CLEARED → A5 PROVEN (structural + verified-reset; fork excluded).**
  Positive control FIRST and calibrated (2/2 recall — probe sighted); R-A 5/5
  no-recall → STRUCTURAL; R-B 5/5 no-recall + crossCycle null → VERIFIED-RESET;
  R-C 5/5 RECALL → fork INHERITS (honest negative, settles fork out of the
  reset set). Fixed-UUID discipline restored (SIDB fix disclosed with the
  iter-1 UUID-tail overflow + 120s burn). Per-arm CI 57–100% cited.
  Script defect noted for future runs only: S-R1 (committed FULL mode shadowed
  `controlCalibrated` — evidence already collected and first-hand verified, so
  non-blocking to this verdict).
- **B-T4-3 CLEARED.** Findings route conditionally to OD-3 as reset+lock atomic
  unit (spec §3.1/§3.8); no "standard mutex" language; no second-sees-first-
  context observed. `exp04-findings.md` remains superseded as ruled.
- **Residual:** SC-6 gate evidence pending the post-17:10 Accra re-run.

**Sign-off**: SC-1..SC-3 now met (re-probe) · SC-4 markers restored · SC-5
quarantine OK · SC-6 pending re-run. Original REJECT is lifted and replaced —
T7 may cite the re-probe (never the 08-30 exp04 verdict claims).
