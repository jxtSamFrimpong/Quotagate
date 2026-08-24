# TASK_WS10_T2: Hello-World Tool Server Across Registration Surfaces + Persistent Headless Drive

## Context

- **Workstream**: WS_10 (MCP Feasibility Investigation — Phase 2 Head)
- **Plan reference**: `docs/plan/workstreams/ws10_mcp_feasibility_investigation.md` (§Task Breakdown T2; §Locked Decisions D1–D4 — especially the **config-mutation safety protocol** and **process teardown guarantees** folded into D3; §Review amendments →T2 items; §Cross-Task Contracts; §Known Pitfalls)
- **Parent phase**: Phase 2 head (D-SEQ-01 continuation)
- **Depends on**: T1 ✅ (PA APPROVE, 2026-08-24) — scaffold exists, CLI truth recorded, harness conventions established
- **Blocks**: T3–T6 (a working registered consumable tool server is their common fixture). **If T2 fails on every registration surface, stop and escalate early** — T3–T6 have no subject matter without one, and the verdict is likely NO-GO-WITH-ALTERNATIVE (OD-2).
- **⚠️ Execution precondition (not a blocker to this elevation)**: the developer's Claude subscription hit its monthly spend limit on 2026-08-24 (resets ~9am Africa/Accra — root-caused in `TASK_WS10_T1.md` Review Notes). Every meaningful step below requires live Claude. **Do not execute until the reset is confirmed** (one throwaway `claude --print "Reply OK"` succeeds). Elevation itself is unaffected.

---

## Goal & Why

- **Goal**: Prove the core premise end-to-end at minimum fidelity: build a hello-world stdio MCP
  tool server on `@modelcontextprotocol/sdk` (installed in the **spike-local** `package.json`,
  never the product lockfile), register it with Claude Code via **each candidate surface**
  (ephemeral `--mcp-config` flag; project `.mcp.json`; `claude mcp add` scopes local/user/project),
  verify connect + tool listing per surface, drive a **persistent headless session
  programmatically ≥10 turns**, and deregister/cleanup per D3. Settle the **IQ-1 topology
  reconciliation sub-question first** (quote spec §3.8 verbatim; time-boxed `claude mcp serve`
  probe). Record surface-by-surface results — the raw evidence OD-1 will be adjudicated on.
- **Why**: This is A1 and A2 — the two assumptions the entire D-TRANSPORT end-state rests on. If no
  registration surface works, everything downstream is moot and we want that knowledge in hour
  two, not week two. If several work, the *choice* between them (scriptability, reversibility,
  blast radius) becomes OD-1's evidence base. The ≥10-turn drive additionally proves A2: an
  unattended persistent session is drivable at all — the mechanism T3–T6 build their probes on.

---

## Assumptions to Test

| #   | Assumption                                                                                                  | Why we believe it                                                        | How this task tests it                                                                                     | If false → |
| --- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- | ---------- |
| A1  | Claude Code can register and connect to a third-party stdio MCP tool server via a scriptable config surface | Documented MCP-client capability; `claude mcp add` surface confirmed at 2.1.240 (T1) | Register hello-world server via each surface; verify connect + tool listing; record per-surface outcome    | D-TRANSPORT's premise fails as specified → NO-GO-WITH-ALTERNATIVE branch (OD-2); stop-and-escalate rule above |
| A2  | A persistent, unattended headless session is drivable programmatically (input in, structured events out)    | `--print` + `--input-format stream-json` exist (T1 inventory); drivability unverified | Sustain one session across ≥10 programmatic turns against the best-working surface, no human interaction   | Process persistence impossible → subprocess stays; invariant-#6 reconciliation needed |

---

## Expected Failures

- **[EF2]** Persistent-session permission prompts stall automation (agent requests approval to run
  the registered tool — a stalled session looks exactly like a hang). Mitigation: pre-grant
  permissions per-invocation in the experiment's own scope (`--permission-mode`, `--allowedTools`);
  never widen global trust settings (invariant #9 spirit). Before recording any transport failure,
  distinguish "stuck awaiting approval" from "broken transport".
- **[EF5]** Env inversion: when Claude Code spawns *our* tool server, the child inherits Claude's
  environment — the Phase-1 `sanitisedEnv()` story flips. Log what the child sees (at minimum
  HOME/PATH) in the artifact; it matters for the follow-on `toolServer.ts` design.
- **[EF7]** CLI version drift mid-workstream (auto-update). Re-record `claude --version` at T2 open;
  expected **2.1.240** (T1 baseline). A change here invalidates comparability with T1's evidence —
  record prominently if so.
- **[Live-subscription precondition]** Spend-limit refusal until ~9am Accra reset (see Context).
  Not an architectural failure — a precondition gate. Confirm liveness with one throwaway prompt
  before starting timed work.
- **[EF6]** Throttle during the multi-turn drive (D4): back off once per failure, record, shrink the
  turn count rather than hammering. Abort after 3 consecutive failures.

---

## Test Strategy

- **No Vitest tests** (WS_10-D1/D2). Deliverables: one runnable tool-server script, one
  registration/drive harness script, and their artifact logs under the T1 scaffold layout
  (`exp/`, `artifacts/`) — no adjacent directories invented (Cross-Task Contract).
- **Evidence bar**: a surface "works" only when its artifact shows connect + successful tool
  listing (and, for the drive, ≥10 clean turns). Single anecdotes are smoke tests, not verdicts;
  every claim cites `artifacts/exp02-<date>.log`.
- **Harness conventions reused from `exp01_baseline.mjs`** (established, do not re-litigate):
  PID capture logged at spawn; teardown in `finally` + SIGINT/SIGTERM handlers with SIGTERM→SIGKILL
  escalation; watchdog timeout per invocation; artifact tee pattern; orphan sweep **derived from
  tracked pids** (existence-probe each pid, then a pattern sweep for stragglers).
- **Green gate unchanged (D2)**: `npm test` stays **104/104 local**, `CI=1` == **91**;
  typecheck/lint/format clean. Spike-local dependency installs must keep the product lockfile
  untouched (verified by a clean `git status` outside `spikes/`).

---

## Subtask Progress Table

| #   | Subtask                                                                                                                                                                                                                            | Status        | Iteration | Notes |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | --------- | ----- |
| 1   | Preconditions: re-record `claude --version` (EF7 — expect 2.1.240); confirm live-subscription reset with one throwaway `claude --print` prompt; record both in artifact header.                                                     | ⬚ Not started | —         |       |
| 2   | Install `@modelcontextprotocol/sdk` into `spikes/mcp_feasibility/package.json` (SPE finding: spike-local deps, never the product lockfile); write `exp/exp02_hello_server.mjs` — minimal stdio MCP server exposing ONE trivial echo-style tool named `ws10_hello_echo` (TD3). | ⬚ Not started | —         |       |
| 3   | Standalone server proof: spawn the server directly and complete an MCP handshake + tool list over stdio from a tiny client probe — the server works *before* any registration is attempted.                                        | ⬚ Not started | —         |       |
| 4   | Topology reconciliation FIRST (IQ-1 sub-question): quote **spec §3.8 verbatim** into the topology findings notes and record that it reads naturally in *either* direction (Goal-3 amendment must cite the ambiguity precisely); time-boxed (~10 min) `claude mcp serve` smoke probe to settle which direction the wire runs; state the working assumption (Mechanism B: Quotagate hosts the server, Claude Code consumes) explicitly. | ⬚ Not started | —         |       |
| 5   | Surface A — ephemeral `--mcp-config <json>` (with `--strict-mcp-config`): launch headless session pointed at the spike config; verify connect + tool listing. Zero persistent mutation — lowest blast radius, tried first (TD1).     | ⬚ Not started | —         |       |
| 6   | Surface B — project `.mcp.json` in the spike directory: register, connect, list tools. Note approval/pending-approval behavior (`claude mcp get/list` shows ⏸ Pending approval for unapproved servers — capture how approval works headlessly, EF2 relevance). | ⬚ Not started | —         |       |
| 7   | Surfaces C/D/E — `claude mcp add` scopes **local**, **user**, **project** (`-s` each): these touch `~/.claude.json` (local/user) or write cwd `.mcp.json` (project). Full D3 config-mutation protocol applies (subtasks 8–9). Capture exact commands + outputs for OD-1 scriptability evidence. | ⬚ Not started | —         |       |
| 8   | Config-mutation safety protocol execution (D3, mandatory for subtask 7's `~/.claude.json` touches): (i) backup `~/.claude.json` → `artifacts/claude.json.backup-<ISO timestamp>` before first write; (ii) JSON-parse-validate immediately after EVERY mutation, restore-from-backup + abort on parse failure; (iii) restore backup on any experiment error during a config-touching step (not deferred to end-of-task cleanup). | ⬚ Not started | —         |       |
| 9   | Post-task config verification: record a diff of `~/.claude.json` (before vs. after) in artifacts confirming only the test registration was added — and later removed. Unexplained delta = blocking finding for this task.           | ⬚ Not started | —         |       |
| 10  | Persistent headless drive (A1+A2): pick the best-working surface; drive one session programmatically ≥10 turns (`--print --input-format stream-json --output-format stream-json`, permissions pre-granted per TD4); log turn-by-turn outcomes incl. any EF2 stall-vs-hang adjudication. | ⬚ Not started | —         |       |
| 11  | Process teardown guarantees (D3): PID capture at every spawn (server + Claude sessions) logged to artifact; kill in `finally` + SIGINT/SIGTERM handlers with escalation; post-task orphan sweep derived from tracked pids + pattern sweep, result recorded alongside the config diff. Surviving orphan killed manually + noted as finding. | ⬚ Not started | —         |       |
| 12  | Cleanup & deregistration per D3: remove every registration made (all scopes + `.mcp.json` + temp configs); re-run `claude mcp list` to confirm empty of spike entries.                                                             | ⬚ Not started | —         |       |
| 13  | Close-out: green gate (104/104 local · CI=91 · typecheck/lint/format clean); write surface-by-surface results table (surface → command/scriptable? → connect ✓/✗ → list ✓/✗ → reversibility notes → artifact citation) into `artifacts/exp02-<date>.log` summary — the OD-1 feed; note EF5 env observations. | ⬚ Not started | —         |       |

> **Sizing & split rule**: sized ~1 hour. Per plan §Review amendments (→ all tasks): if wall time
> exceeds ~90 minutes, split into two trackers rather than silently overrun — most likely split
> point is after subtask 6 (surfaces proven) vs. 7+ (`~/.claude.json` mutation work + drive).

---

## Decisions Made

### [TD1] — Registration surfaces tried in ascending blast-radius order ✅ PRE-LOCKED (PA, 2026-08-24)

Order: (A) `--mcp-config` ephemeral → (B) spike-dir project `.mcp.json` → (C/D/E) `claude mcp add`
scopes local → user → project. Rationale: the cheapest-to-reverse surfaces produce the connect/list
evidence first with zero global mutation; `~/.claude.json` is only touched once a working server
exists, and then under the full D3 protocol. Honors WS_10-D3's preference for project-scoped config
over mutating global config.

### [TD2] — Working topology assumption: Mechanism B (Quotagate hosts; Claude Code consumes), stated up front ✅ PRE-LOCKED (PA, 2026-08-24)

All registration work proceeds on the inverse-of-spec-literal direction, because that is what
Mechanism B (§3.2) and the planned `src/mcp/toolServer.ts` imply — while the §3.8 passage is quoted
verbatim as genuinely bidirectional (subtask 4). The time-boxed `claude mcp serve` probe exists to
close the loop empirically; if it exposes custom tools cleanly, that is a finding to *record*, not
a pivot — the amendment drafting belongs to T7 (Goal 3).

### [TD3] — Hello-world tool name is `ws10_hello_echo`, NOT `quotagate_complete` ✅ PRE-LOCKED (PA, 2026-08-24)

The real `quotagate_complete` fixture (spec §3.5 shape) is T3's deliverable per the Cross-Task
Contracts — a distinct name keeps T2's evidence unambiguous and prevents accidental coupling
between "registration works" and "the constraint fixture exists".

### [TD4] — Permissions pre-granted per-invocation in experiment scope only ✅ PRE-LOCKED (PA, 2026-08-24)

EF2 mitigation: `--permission-mode` / `--allowedTools` passed per session invocation, scoped to the
experiment. Never widened global trust settings — invariant #9's spirit holds during
experimentation, where discipline is easiest to skip.

### Open items referenced (NOT resolved here)

- **OD-1** (canonical registration surface for `installer.ts`) — T2 produces the evidence table
  (subtask 13); resolution happens AFTER the evidence, elevated by PA with the findings report.
  No surface is crowned in this tracker.
- **OD-2 / OD-3** — out of T2 scope entirely.

---

## Files Modified / Created

- `spikes/mcp_feasibility/exp/exp02_hello_server.mjs` — **create** (hello-world stdio MCP server).
- `spikes/mcp_feasibility/exp/exp02_register_drive.mjs` (or equivalent harness) — **create**
  (registration probes + persistent drive; reuses exp01 conventions).
- `spikes/mcp_feasibility/package.json` — **modify** (add `@modelcontextprotocol/sdk`; spike-local
  only — product lockfile must show zero delta).
- `spikes/mcp_feasibility/artifacts/exp02-<date>.log`, `claude.json.backup-<ISO timestamp>`,
  config-diff record — **create**.
- Temporary registration artifacts (`.mcp.json`, `--mcp-config` JSON) — **create and remove within
  the task**; nothing persists outside the quarantine zone.
- `src/`, `tests/` — **no changes** (D1/D3). Green-gate exclusion configs untouched since T1.

---

## Success Criteria / Verifiability

| #    | Criterion                                                                                                                            | How to verify |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------- |
| SC-1 | Hello-world stdio MCP server runs standalone: handshake + tool list succeed via direct client probe, SDK installed spike-locally.    | Artifact shows handshake/list transcript; `git status` shows zero product-lockfile delta. |
| SC-2 | Every attempted surface has a recorded per-surface outcome (connect + tool listing ✓/✗, exact command, reversibility note, artifact citation) in the summary table. | Summary table in `artifacts/exp02-<date>.log`; one row per surface attempted. |
| SC-3 | At least one surface proves end-to-end: registered → connected → tool listed by Claude Code.                                         | Cited artifact lines for that surface. |
| SC-4 | Persistent headless session driven ≥10 programmatic turns, unattended, with turn-by-turn outcomes logged.                            | Drive section of artifact lists ≥10 turns with statuses. |
| SC-5 | IQ-1 topology sub-question settled early: findings notes contain spec §3.8 quoted verbatim + either-direction observation + `serve` probe outcome. | Topology notes present in artifact/findings draft. |
| SC-6 | D3 cleanup honored: all registrations removed; post-task `~/.claude.json` diff recorded showing only test registration added-then-removed (or no net delta); backup created before first write. | Backup file + diff record in `artifacts/`. |
| SC-7 | Process hygiene: PIDs logged at spawn; teardown ran via `finally`/signal handlers; post-task orphan sweep recorded (CLEAN, or orphan killed + finding noted). | Sweep output in artifact. |
| SC-8 | Green gate unchanged: local 104/104, CI=91, typecheck/lint/format clean.                                                              | Gate commands run at close. |

---

## Required Test Cases

None — spike scripts produce artifacts, not assertions (WS_10-D1/D2).

---

## Review Notes

_Pending PA review._

---

## Architect Sign-off

- [ ] Implementation reviewed
- [ ] All success criteria verified (SC-1..SC-8)
- [ ] All assumptions resolved (A1/A2)
- [ ] Green gate untouched at execution (104 local / CI 91)
- [ ] Quarantine honored (nothing under src/ or tests/ touched; product lockfile unchanged; config mutations backed up, validated, restored, diffed)
