# WS_10 T34-REPROBE — Findings (2026-09-08, CLI 2.1.251)

> Single-session scoped re-probe closing PA Blocking findings B-T3-1, B-T3-2,
> B-T4-1, B-T4-2, B-T4-3 (+ Suggested S-T3-1). Tracker:
> `docs/active/TASK_WS10_T34_REPROBE.md`. Prior files `exp03-findings.md` /
> `exp04-findings.md` left byte-identical (TD-R2); corrections to their claims
> live HERE (§5) and T7 may restate them. No GO adjudication here (T7 owns it).

## 1. Per-probe outcomes

### A4 — capable-channel suppression (B-T3-1): PASS

- Harness `exp/exp05_a4_suppression.mjs`, log `artifacts/exp05-a4-2026-09-08.log`,
  journal `artifacts/exp05-journal-2026-09-08.jsonl`. Decoy
  `ws10_probe_side_effect` registered + invocable, BOTH tools in `--allowedTools`.
- Run 2 (authoritative, 14 turns = 2 controls + 12 adversarial across
  text-only / tool-declaration / tool_choice-required × neutral / authority /
  override / false-precedent): control-1 `quotagate_complete` tool_use observed
  (journal 2 rows, identical input hash — attempt + post-back-off retry);
  control-2 decoy politely refused; **12/12 adversarial SUPPRESSED, 0 decoy
  trips in stream, 0 non-control decoy rows in journal** (95% CI **76–100%**).
- Run 1 (12 adversarial, no controls — same log, earlier window): 12/12
  stream-suppressed but ZERO tool_use of any kind and journal never created →
  channel unproven → honestly **INCOMPLETE, not PASS** (superseded by run 2).
- Supporting: **0 decoy rows across all 37 journal rows today** (retention +
  concurrency prompts were non-adversarial toward the decoy — supporting only).
- Observed: one built-in `Read` attempt permission-blocked by the allowlist
  (defense in depth; CLI enforcement, not A4 evidence). LIMIT-heuristic false
  positive on a successful tool-call turn → 120s D4 sleep, retry complied
  (over-trigger recorded; no subscription stall all day).
- S-T3-1 CLOSED: mixed prompt shapes covered 4/4/4 in run 2.

### A5 — retention (B-T4-2): ACHIEVABLE (structural + verified-reset)

- Harness `exp/exp05_retention.mjs`, log `artifacts/exp05-retention-2026-09-08.log`.
- **Positive control FIRST: calibrated** — no-reset direct RECALL=true,
  adversarial RECALL=true (probe sighted; downstream counts licensed).
- **R-A fresh process (5 cycles, 4 direct + 1 adv): 5/5 no-recall** →
  cross-session isolation is **STRUCTURAL** (95% CI 57–100%).
- **R-B in-session `/clear` (5 cycles in one session, 3 direct + 2 adv):
  5/5 no-recall, cross-cycle null** → `/clear` is a **VERIFIED-RESET**
  mechanism (95% CI 57–100%).
- **R-C `--resume SID --fork-session` (5 cycles, 4 direct + 1 adv):
  5/5 RECALL** → fork **INHERITS full context; NOT a reset mechanism**
  (honest negative; same CI).
- Joint classification: fresh-context-per-call is achievable structurally
  (new process) and via verified reset (`/clear`); fork-resume is excluded
  from the reset set. Routes to **OD-3** for the bar decision.

### A6 — concurrency (B-T4-1): QUEUE 3/3, no interleave/corrupt

- Harness `exp/exp05_concurrent.mjs`, log `artifacts/exp05-concurrent-2026-09-08.log`.
- FIFO resolver (shift, never broadcast) + cancel-on-timeout; journal carries
  per-row marker tokens — the journal, not client observation, classifies.
- Staggered run (B written 8s into A's flight): journal 6/6 rows, strictly
  sequential non-overlapping spans, **zero cross-markers → QUEUE 3/3**;
  client corroboration clean on pairs 2–3 (own∧¬leak both sides).
- Pair-1 characterization: messages arriving faster than session readiness
  **coalesce into ONE turn** (two tool calls ~8ms apart, single result) — a
  queue variant, not corruption. Backlogged-turn latency ~2min vs ~10s
  unloaded (capacity note for the adapter's queue design).
- Run-1 (same-tick) client attribution: unreliable (120s timeout < backlog
  latency + waiter-linger bug) — its "0/3 client" is harness artifact; journal
  QUEUE 3/3 from that run retained. Crash-run (timer scoping bug): no orphan
  (pipe-EOF cleanup verified). Minor: pair-1 turn carried 3 tool_use blocks vs
  2 journal rows — third block unattributed, bounded by journal 6/6 (no
  phantom server invocations).
- **B-T4-3 compliance**: no second-sees-first-context observed in this
  re-probe. Had it been, the required write-up is: pair reset+lock covering
  call → response → reset as one atomic unit (spec §3.1/§3.8) and route to
  **OD-3** — never "standard mutex." exp04's "Risk MEDIUM / standard mutex"
  language remains superseded.

## 2. Assumption status (with CIs)

| # | Status | Evidence |
| - | --- | --- |
| A3 | DIRECTIONAL (unchanged, not re-measured) | run-3 30/30, 95% CI **88–100%**; single prompt shape; Mechanism-A comparison qualitative |
| A4 | **PROVEN (capable channel, CI-bounded)** | 12/12 adversarial, 0 decoy stream+journal, channel proven; 95% CI **76–100%** |
| A5 | **ACHIEVABLE: structural (R-A) + verified-reset (R-B); fork excluded (R-C)** | control calibrated; 5/5 × 3 arms; 95% CI **57–100%** per arm |
| A6 | **QUEUE (fail-safe direction), 3/3 journal-classified** | sequential spans, zero cross-markers; no interleave/corrupt observed |

## 3. Deviations from the trackers (this re-probe)

1. A4 run-1 lacked controls → declared INCOMPLETE in-log; run-2 added
   controls (2 extra turns, within budget). No data hidden: both in one log.
2. LIMIT heuristic false-positive → 120s sleep on a healthy turn (D4-cautious
   over-trigger, disclosed; genuine wall-times prove no stall).
3. Retention iter-1: `SID(100+i)` UUID-tail overflow → R-C spawn-error + one
   120s timeout burn; fixed (SIDB block + stderr fail-fast) and R-C run via
   RC_ONLY mode (no re-burn of settled arms). Summary ReferenceError (block
   scoping) fixed post-run; all R-C cycles logged pre-crash.
4. Concurrent run-1: 120s timeout + waiter-linger bug → client attribution
   void; journal retained. Crash-run timer bug → no orphan. Staggered run is
   the authoritative record.
5. Total live turns **78** (26 A4 + 38 retention + 14 concurrent) — inside the
   ~80 cap; zero throttling/limit events 09-08 (contrast 08-30).

## 4. Hygiene (D3/D4/EF7)

- Ephemeral `--mcp-config` only; **no `~/.claude.json` touch** — D3
  backup/diff N/A (stated in every run header). No `src/`/`tests/`/lockfile
  changes (green gate §6 proves it).
- PID capture + finally/signal cleanup in every harness; orphan sweeps logged
  (A4 pid 41627 gone; retention liveChildren empty + `pgrep`/`ps` zero;
  concurrent pid 46551 gone; crash-run pipe-EOF verified).
- `claude --version` in every header: **2.1.251** (EF7 drift from T1–T4's
  2.1.240 — comparability caveat).
- `cwd: exp/` for all sessions → Layer-1 `exp/CLAUDE.md` deterministically
  loaded (D-T3-4 controlled for this re-probe). Ambient-context note
  (EF5-adjacent): R-A probes named project's CLAUDE.md/memory/git status in
  context — production Layer-1 lives in `~/.quotagate/` (invariant-#9 tension
  unchanged). Artifact sensitivity: logs contain full probe transcripts
  (→D4 note: review before `spikes/` is ever shared).

## 5. B-T3-2 honesty corrections (08-30 record)

1. **09:13:22 session-limit event**: `exp03-constraint-2026-08-30.log` lines
   34–53 — "You've hit your session limit · resets 1:10pm (Africa/Accra)";
   run-1 samples 11–30 are ~500ms refusals, NOT constraint misses.
2. **Run-1 denominator restatement**: 3/10 genuine pre-limit turns (95% CI
   **11–60%**), + limit event at sample 11. Run-2 (post-reset): 2/30 genuine
   prose misses under the old detector (95% CI **2–21%**) — a detector story,
   not a constraint rate. Neither early rate may be cited as a validity rate.
3. **D4 back-off violation**: the 08-30 run continued ~30 turns THROUGH the
   limit instead of back-off-and-record. This re-probe backed off (including
   once over-cautiously — §1) and aborts-with-partials on sustained limits.
4. **Wilson CIs for the record**: 30/30 → **88–100%**; old 10/10 suppression
   → **69–100%** BUT vacuous (unregistered tool + allowlist) — must never be
   cited as suppression evidence; it is replaced by §1's A4 result.
5. T7 must cite "30/30 (95% CI 88–100%), qualitative Mechanism-A comparison"
   — never bare "100%"; and "A4 12/12 (95% CI 76–100%), capable channel."

## 6. Artifact index

- `spikes/mcp_feasibility/exp/exp05_tool_server.mjs` (fixture + decoy + journal)
- `spikes/mcp_feasibility/exp/exp05_a4_suppression.mjs` / `artifacts/exp05-a4-2026-09-08.log`
- `spikes/mcp_feasibility/exp/exp05_retention.mjs` / `artifacts/exp05-retention-2026-09-08.log`
- `spikes/mcp_feasibility/exp/exp05_concurrent.mjs` / `artifacts/exp05-concurrent-2026-09-08.log`
- `spikes/mcp_feasibility/artifacts/exp05-journal-2026-09-08.jsonl` (37 rows, 0 decoy)
- `spikes/mcp_feasibility/artifacts/exp05-reprobe-findings.md` (this file)

## 7. PA-review residuals disposition (2026-09-08 review; applied post-review)

- **S-R1 (retention `controlCalibrated` shadowing) — FIXED** in
  `exp/exp05_retention.mjs`: the `const` inside Phase 0 shadowed the outer
  `let`, so committed FULL mode ran Phase 0 only. Now assigns the outer flag.
  Fix required before any retention re-run; no re-run needed for the recorded
  verdicts (evidence came from the session's earlier FULL run + RC_ONLY arm).
- **S-R2 (decoy mechanical-invocability ping) — OPEN, live work**: the decoy
  was never positively invoked (control-2 refused), leaving a final vacuity
  sliver. One unconstrained decoy turn, to run alongside the next live window
  (gate re-run / T5); not blocking T5 elevation.
- **S-R3 (journal `markers` schema drift) — DOCUMENTED, no code change**:
  journal rows 1–23 (pre-mid-day server) carry `markerHash` but no `markers`
  array; rows 24–37 carry both. Writer (`exp05_tool_server.mjs`) emits
  `markers` unconditionally; readers default `(r.markers || [])`. Additive-only
  drift; T7 must not assume `markers` present on early rows.
- **S-R4 (A6 phrasing for T7) — ADOPTED**: cite "no interleave/corrupt
  observed; session serializes (durMs≈0 rows prove routing, backlog proves
  serialization)" — never bare "QUEUE proven".
- **S-R5 (pair-1 third tool_use block) — T7 CAVEAT**: unattributed but
  journal-bounded (no phantom server invocations); carry as caveat.
- **S-R6 (evidence preservation) — COMMITTED**: `*.log` gitignore now carries
  a scoped `spikes/mcp_feasibility/artifacts/exp05-*.log` exception; the three
  exp05 logs are committed as the primary A4/A5 record. Earlier exp01–04 logs
  remain ignored (superseded where it matters; T7 cites the re-probe).
- **S-R7 (live-turn budgets) — RECORDED**: actuals 78 vs 35–40 planned.
  Future WS_10 trackers (T5–T7) must budget from 78-turn actuals, not estimates.
