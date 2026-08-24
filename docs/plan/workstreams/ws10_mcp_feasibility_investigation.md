# Workstream WS_10: MCP Feasibility Investigation (Phase 2 Head)

> A workstream scopes ~1 day of work and is more detailed than its parent phase: concrete goals +
> deliverables, locked decisions (with rejected alternatives), a task breakdown, cross-task
> contracts, and success/quality gates. It is the bridge from phase goals to hour-sized tasks.

## Workstream Overview

- **Parent Phase**: Phase 2 head (per `.claude/CLAUDE.md` Session State "What is next" and
  [D-SEQ-01](../phases/01a_transport_and_constraint.md)). _Note: the Phase-2 phase plan
  (`02_*.md`) has not been authored yet; this workstream is written directly against the spec
  (§3.1, §3.2, §6 Phase 2) and Session State. Its outcome feeds the Phase-2 plan._
- **Timeframe**: ~1 day (T1–T7, each ~1 hour)
- **Status**: ✅ Reviewed — implementation-ready (SPE APPROVE WITH SUGGESTIONS, 2026-08-24; both blocking findings folded into D3, suggested items logged for tracker elevation). T1 elevated to `docs/active/TASK_WS10_T1.md`.
- **Dependencies**: None upstream — Phase 1 is signed off (WS_09 T4, PA APPROVE, 2026-08-24;
  gate 104/104 local · CI 91 · typecheck/lint/format clean). This is the first act of Phase 2 and
  writes **zero production code** (D1).

---

## Goals & Deliverables

- **Goal 1**: Answer, empirically, the six investigation questions (§Investigation Questions) that
  determine whether the D-TRANSPORT end-state (spec §3.1: MCP primary, `--print` fallback) is
  achievable with today's Claude Code CLI — or what degraded form of it is.
  - Deliverable: `spikes/mcp_feasibility/findings/WS10_findings.md` — the consolidated evidence
    report: one section per investigation question, each citing named experiment artifacts
    (scripts, raw logs, measurements) produced by T1–T6, ending in exactly one verdict:
    **GO / NO-GO / NO-GO-WITH-ALTERNATIVE**, with reasoning recorded.
- **Goal 2**: Produce spike scaffolding that the follow-on MCP-upgrade workstream(s) can consume or
  discard cheaply.
  - Deliverable: `spikes/mcp_feasibility/` — quarantined experiment scripts (Node, ESM,
    `@modelcontextprotocol/sdk`), the fixed `quotagate_complete` tool-definition fixture, and a
    latency-benchmark harness. All excluded from `src/`, the Vitest suites, and the build (D3).
- **Goal 3**: Reconcile the spec with reality wherever the investigation contradicts it.
  - Deliverable: a dated amendment **proposal** (in the findings report, not yet applied) for any
    spec passage invalidated by evidence — most notably the §3.1/§4.1 wording ("start CLI as MCP
    server (`claude --mcp-server`)") versus whatever topology the experiments actually validate.
    Spec edits are applied only after the user accepts the findings (Decision Log Protocol).

**Explicit scope fence — what this workstream is NOT**: No `src/` changes. No production MCP
adapter; no `toolServer.ts` / `toolDefinition.ts` / `claudeMd.ts` in `src/mcp/`; no `installer.ts`;
no `_mcp_lock` in production code; no changes to `ClaudeAdapter`, `proxy.ts`, `router.ts`,
`validator.ts`, or any test file under `tests/`. The full migration (Mechanism B wiring, installer,
MCP client, serialization, MCP-path contamination tests) is follow-on workstream material,
elevated only from a GO verdict. Writing production code inside a feasibility spike is Phase III
thinking applied to a Phase I question — we do not build the bridge before we know the river can be
crossed.

---

## Why This Workstream Matters

Phase 1 proved the *product* (an OpenAI-faithful proxy over `claude --print`) on the transport we
knew worked, and deliberately deferred the transport we did not. The spec itself flagged this as
the **BLOCKING feasibility check** (§3.1): the entire MCP-primary architecture rests on Claude Code
— primarily an MCP *host/client* — being able to consume a custom `quotagate_complete` tool server,
and on a reachable fresh-context-per-call mechanism. Every one of those assumptions remains
unverified. Invariant #6 ("MCP primary, subprocess fallback — never subprocess-only in production")
makes the subprocess-only state explicitly temporary: the ratchet cannot advance until this
investigation reports.

The economics matter too. The motivation for D-TRANSPORT is eliminating the ~50–200ms per-request
boot cost of Approach A, yet nobody has measured what a warm persistent session actually costs or
saves on this machine against this subscription. If the investigation shows the persistent path is
slower or operationally fragile, we want that knowledge before wiring an installer, an MCP client,
and a serialization lock around it.

Finally, this is cheap insurance: seven hours of experiments either de-risks a multi-day upgrade or
saves us from building one on sand. That asymmetry is the entire argument for doing this first.

---

## Investigation Questions

Each question must be answered by a named experiment with recorded evidence — not by reading
documentation alone. Documentation tells us what *should* work; only the CLI on this machine, this
version, against the live subscription, tells us what *does*.

### IQ-1 — Topology & registration surface

Can a custom Node MCP tool server (`quotagate_complete`, built on `@modelcontextprotocol/sdk`,
stdio transport) be **registered with, connected by, listed by, and invoked by** Claude Code?

Sub-questions:

- Which config surfaces actually work: project-scoped `.mcp.json` in the working directory;
  `claude mcp add` (user/local/project scopes → `~/.claude.json`); direct `~/.claude.json`
  editing? Which are scriptable **and cleanly reversible** (the future `install()` needs both)?
- **Topology reconciliation**: spec §3.1/§4.1 literally describe Claude Code running *as* an MCP
  server (`claude --mcp-server`) exposing `quotagate_complete` to Quotagate's MCP client. The
  design implied by Mechanism B (§3.2) and the CLAUDE.md planned layout (`src/mcp/toolServer.ts` —
  *our* server) is the inverse: Quotagate hosts the tool server; Claude Code persists as the
  headless host/agent consuming it; the tool invocation serves as the structured-response channel.
  Determine which topology the actual CLI supports. If reality is the inverse of the spec's literal
  wording, draft the amendment (Goal 3).
- Does a persistent headless Claude Code session exist that runs unattended (non-interactive flags,
  permissions pre-granted) for the minutes-to-hours lifetime a proxy backend needs?

### IQ-2 — Constraint quality through the MCP tool call (Mechanism B)

Does the model, inside a persistent Claude Code session with the tool registered and CLAUDE.md-style
session constraints active, **reliably emit valid `quotagate_complete` JSON as tool-call arguments**
— and only as tool-call arguments?

Sub-questions:

- Validity rate over N≥20 mixed samples (text-only requests, tool-declaration requests,
  `tool_choice:"required"` requests): fraction returned as well-formed `{type, ...}` tool arguments
  vs. prose / markdown fences / wrong-channel output — compared against Mechanism A's effective
  success rate observed in Phase 1 integration testing.
- **Execution suppression re-validation (critical)**: unlike `--print`, a persistent session has
  the agent execution loop *available*. If the caller's `tools` declare `read_file`, does the agent
  ever attempt to execute tools / bash / file reads itself instead of declaring? Any single
  observed side effect is a hard finding (A4 → NO-GO territory).
- Do oversized conversations survive tool-argument size limits intact? Record the practical
  ceiling.

### IQ-3 — Serialization (invariant #11)

Can **one request in flight per session** be enforced and *observed*?

- When two invocations are driven concurrently at the session boundary, what happens — queuing,
  interleaving, corruption, or error? We expect the worst; we need to know *which* worst.
- Is there a session-level signal (busy state, concurrent-call error) an adapter could wrap in an
  `_mcp_lock`-equivalent queue covering the full lifecycle (call → response → reset)?

### IQ-4 — Context statefulness (invariant #10)

Does a persistent session **retain conversation state across tool invocations**, and how is
fresh-context-per-call achieved and verified?

- Probe: invocation A plants a distinctive code word (fixed UUID, WS_03-D3 convention); invocation
  B asks "what was the code word?" — directly, then adversarially. Repeat across sequential and
  reset-between variants.
- Enumerate every candidate reset mechanism and test each: explicit clear command if one exists,
  session restart, resume/new-session flags, or whatever else the runtime offers.
- Classify the outcome: **structural** fresh-context (isolated by construction), **verified-reset**
  (state demonstrably cleared between serialized calls), or **unachievable**.

### IQ-5 — Latency & cost vs. cold `--print`

How do warm persistent-session invocations compare to today's cold spawns?

- Benchmark p50/p95 wall time for identical requests via (a) `claude --print` cold spawn and
  (b) the persistent session. Record sample sizes and machine context.
- Note subscription-side signals: rate-limit responses, throttling, quota warnings under a modest
  sustained burst (dozens, not thousands — this is a paid personal subscription).

### IQ-6 — Failure detection & fallback mechanics

Can the adapter **detect MCP-path failure and fall back to `--print`** without leaking subprocess
assumptions through `CLIAdapter`?

- Inject failures: tool-server process killed mid-request; startup timeout; tool not found
  (deregistered); malformed tool result; hung invocation. For each: what does the client surface
  (exception type? timeout? silent hang?), and can it map onto `TransportError` semantics?
- Confirm the existing seam is honest: `CLIAdapter.complete(): Promise<AdapterResponse>` +
  `healthCheck()` + `install()` (`src/adapters/base.ts`). Can an MCP-primary/fallback adapter
  satisfy this contract with **no interface change**, with `backend` distinguishing `claude-mcp`
  from `claude-subprocess` as spec §3.8 sketches? Any pressure the experiments exert on the
  interface is a finding to record, not a change to make here.

---

## Assumptions-to-Test

| #  | Assumption | Why we believe it | How this workstream tests it | If false → |
| -- | --- | --- | --- | --- |
| A1 | Claude Code can register and connect to a third-party stdio MCP tool server via a scriptable config surface | Documented MCP-client capability; unproven on this machine/version | T2: hello-world tool server; register via each surface; connect; list tools | D-TRANSPORT's premise fails as specified → NO-GO-WITH-ALTERNATIVE branch (OD-2) |
| A2 | A persistent, unattended headless session is drivable programmatically (input in, structured events out) | Headless modes exist; automation-friendliness unverified | T2/T3: sustain a session across ≥10 programmatic turns without human interaction | Process persistence impossible → subprocess stays; invariant-#6 reconciliation needed |
| A3 | The model emits valid `quotagate_complete` JSON via tool-call arguments at ≥ Mechanism A's effective rate | Spec §3.2 Layer-2 rationale ("models treat tool descriptions as contracts"); never measured | T3: N≥20 mixed samples; compare validity rate vs. Phase-1 retry observations | Mechanism B is worse than the net it replaces → NO-GO-WITH-ALTERNATIVE |
| A4 | The persistent session's execution loop stays suppressed while the constraint stack is active | Extrapolated from `--print` (spec §5.3) — but `--print` suppresses the loop *by mode*, not by constraint | T3: `read_file`-style side-effect probes; zero executions tolerated across all samples | Hard safety failure; persistent sessions unusable as pure inference endpoints → NO-GO |
| A5 | Fresh-context-per-call is achievable (structurally or via verified reset) on a persistent session | Spec §3.1 assumes a reachable mechanism, explicitly "unverified" | T4: code-word probes across reset variants | Unachievable → invariant #10 cannot be honored on MCP → NO-GO (or OD-3 adjudication) |
| A6 | Concurrent invocations on one session fail loudly (error/queue) rather than silently corrupting | Nothing known; worst case is silent interleaving | T4: concurrent double-invocation probe | Silent corruption → `_mcp_lock` confirmed mandatory; informs its lifecycle coverage |
| A7 | Warm-session round-trip meaningfully beats the ~50–200ms cold-spawn overhead | Spec §3.1 Approach-B rationale | T5: p50/p95 benchmark, persistent vs. cold spawn | No meaningful win → feed into GO adjudication; does not veto alone (invariant #6 governs) |
| A8 | MCP-path failures surface as catchable errors mappable to `TransportError`, within the unchanged `CLIAdapter` contract | Interface designed transport-honest (Engineering Integrity clause) | T6: five failure injections; catalogue observable error surface | Silent hangs or needed interface changes → blocking finding for the upgrade |

---

## Expected Failures

Anticipated failure modes the experiments should expect to hit — planning for them keeps a 1-hour
task from becoming a debugging spiral:

- **[EF1]** `claude --mcp-server` (spec §4.1 literal) does not exist or exposes no custom tools —
  the most likely single finding, and precisely why the feasibility check was flagged BLOCKING.
  Expected resolution: topology inversion (Quotagate hosts the tool server; IQ-1).
- **[EF2]** Persistent-session permission prompts stall automation (agent requests approval to run
  a tool). Mitigation: pre-configure permissions in the *experiment's own project scope*; never
  widen global trust settings (spirit of invariant #9).
- **[EF3]** Tool-argument size limits truncate large `messages` payloads. Record the ceiling; it
  constrains the follow-on adapter design.
- **[EF4]** The agent occasionally answers in prose instead of invoking the tool (constraint miss).
  That is data, not an experiment bug — capture and count it (feeds A3).
- **[EF5]** Env/auth inversion: the tool server spawned *by Claude Code* inherits Claude's
  environment, not Quotagate's allowlisted one — the Phase-1 `sanitisedEnv()` story flips. Note
  what the child process sees (HOME/PATH-dependent surprises expected).
- **[EF6]** Subscription throttling during the benchmark burst (IQ-5). Back off, record, shrink the
  burst rather than hammering a personal subscription.
- **[EF7]** CLI version drift mid-workstream (auto-update between tasks). Record `claude --version`
  in T1 and again in T7; a version change invalidates comparability.

---

## Test Strategy

This is a **spike strategy, not a product test strategy**. There are no new Vitest tests in this
workstream (D2); the green gate is expected to be untouched throughout.

- **Experiment scripts**: small standalone Node/ESM scripts in `spikes/mcp_feasibility/exp/`,
  named `exp01_recon.*` … `exp06_failinject.*`, one per investigation-question cluster (mapped in
  the task table). Each prints structured results to stdout and tees raw output to
  `spikes/mcp_feasibility/artifacts/<exp>-<date>.log`.
- **Where artifacts live**: `spikes/mcp_feasibility/` (repo root, committed — evidence must survive
  into the next session):
  - `exp/` — runnable scripts
  - `fixtures/` — the fixed `quotagate_complete` tool-definition JSON (spec §3.5 shape) and
    probe-prompt sets (code words per the WS_03-D3 fixed-UUID convention)
  - `artifacts/` — raw logs, timings, captured transcripts
  - `findings/WS10_findings.md` — the Goal-1 deliverable
- **Excluded from tooling**: the directory is excluded from `tsconfig.json` compilation, Vitest
  discovery, and `tsup` builds (D3). Scripts may be loose about typing — they will be deleted or
  rewritten as production code later; rigor goes into the *measurements*, not the types.
- **Live dependency**: all experiments run against the developer's real Claude subscription on the
  dev machine; none run in CI. If auth lapses mid-stream, re-authenticate before concluding a
  failure is architectural.
- **What counts as evidence**: a question is *answered* when the findings report cites a specific
  artifact (script + log) demonstrating the behavior, with sample sizes for anything statistical.
  "It worked once when I tried it" is anecdote, not evidence; "17/20 valid emissions, see
  artifacts/exp03-2026-08-25.log" is evidence.

---

## Success Criteria & Verdict Outcomes

The workstream completes when the findings report answers all six investigation questions with
cited evidence and records exactly one verdict:

### ✅ GO

**Conditions (all must hold)**:
- **IQ-1**: a working registration + invocation topology exists and is scriptable/reversible.
- **IQ-2**: tool-argument JSON validity ≥ Mechanism A's effective rate, and **zero** execution
  side effects observed.
- **IQ-3**: serialization is enforceable at the session boundary (fail-loudly or queue — either is
  workable).
- **IQ-4**: fresh-context is **structural**, *or* a verified-reset mechanism passes the code-word
  probes deterministically. If only verified-reset: OD-3 must be resolved before any follow-on
  workstream is elevated — the spec permits reset only as best-effort fallback paired with
  serialization, never as the contract.
- **IQ-5**: measurements recorded. Any result qualifies as evidence; even a *loss* to `--print`
  does not veto alone (invariant #6 governs regardless) but feeds the GO adjudication.
- **IQ-6**: failures are detectable and mappable to `TransportError` within the unchanged
  `CLIAdapter` contract.

**Triggers**: elevate the MCP-upgrade implementation workstream(s) — production `src/mcp/`
(toolServer/toolDefinition/claudeMd), `installer.ts`, MCP-primary adapter with `_mcp_lock`, fallback
composition, and MCP-path contamination tests keeping the WS_09 suite green (**104 local / CI 91**
— the regression guard; a contamination failure after migration means the upgrade broke context
isolation, and the fix belongs in the adapter, not the tests). Author the Phase-2 phase plan
incorporating the findings and any accepted spec amendments.

### ⚠️ NO-GO-WITH-ALTERNATIVE

**Conditions**: the core premise fails *in part* — e.g., registration works but constraint
reliability is below Mechanism A; fresh-context exists only reactively and unreliably; or the only
viable surface differs materially from the spec's assumption (including the Claude Agent SDK route).

**Triggers**: findings report enumerates surviving alternative(s) with evidence (Agent SDK surface
mini-spike; enhanced Mechanism A retained primary; serialized sessions with verified reset); a
drafted amendment for the affected spec sections (§3.1/§3.2); **OD-2/OD-3 go to the user for
adjudication before any implementation workstream is elevated**. No migration code is written until
the alternative is chosen.

### ❌ NO-GO

**Conditions**: no registration/invocation topology exists at all (A1 false everywhere); **or**
persistent sessions execute side effects despite the constraint stack (A4 false — hard safety
failure); **or** invariant #10 is unachievable in any form on a persistent session.

**Triggers**: escalate to the user with full evidence. Subprocess remains the transport pending a
provider-side surface change. Document an explicit, dated reconciliation of invariant #6 (in the
manner D-SEQ-01 reconciled it for Phase 1: staged, justified, with a revisit trigger — e.g.,
"re-probe on Claude Code release notes mentioning MCP server mode"). The spike directory and
findings remain as the record for whoever reopens this.

---

## Locked Decisions

### WS_10-D1 — Zero Production Code; Findings Are the Deliverable ✅ LOCKED (Architect, 2026-08-24)

**Decision**: This workstream writes no source under `src/`, modifies no existing module, adds no
tests to the suites, and changes no configuration consumed by production. Deliverables are
experiment scripts, artifacts, and the findings report.

**Rationale**: The investigation's output is *knowledge*, and its quality bar is evidentiary, not
functional. Prematurely building the MCP adapter would bias the experiments (code already written
wants to be justified) and violate D-SEQ-01's staging logic, which made feasibility — not momentum —
the gate for Phase 2.

**Rejected alternative — build a minimal MCP adapter alongside the spikes to "save time"**: The
classic trap. If the investigation returns NO-GO, that code is waste plus a temptation to soften
the verdict ("well, we already built it"). If it returns GO, the follow-on workstream will rewrite
it properly anyway, against requirements the investigation will have sharpened. Slow is smooth.

### WS_10-D2 — Contamination Suite Untouched; Green Gate Is a Ratchet ✅ LOCKED (Architect, 2026-08-24)

**Decision**: No file under `tests/` changes. At every task close the gate holds:
`npm test` green at **104/104 local**, `CI=1` subset exactly **91**, typecheck/lint/format clean,
zero test-count delta.

**Rationale**: The WS_09 contamination suite is the Phase-2 regression guard precisely because it
is stable and unambiguous. A feasibility workstream that perturbs it destroys the baseline the very
next workstream depends on. Also honors the Engineering Integrity clause: subprocess-phase
abstractions (`CLIAdapter`, `AdapterResponse.backend`) must survive the MCP upgrade unmodified —
this workstream proves or disproves that by experiment, not by editing the seam.

**Rejected alternative — add integration tests exercising the spike scripts**: Spikes are
disposable by design; testing them institutionalizes throwaway code. Evidence lives in artifacts,
not assertions.

### WS_10-D3 — Spike Code Quarantined Under `spikes/mcp_feasibility/`; Excluded From Build/Test Tooling ✅ LOCKED (Architect, 2026-08-24)

**Decision**: All experiment code lives in `spikes/mcp_feasibility/` at the repo root. It is
excluded from `tsconfig.json` compilation, Vitest discovery, and `tsup`. Nothing under `src/` may
import from it, and vice versa. Registration experiments use reversible config surfaces and are
cleaned up (deregistered) at each task's end; project-scoped `.mcp.json` inside the spike directory
is preferred over mutating global config.

**Config-mutation safety protocol (mandatory when a surface requires touching `~/.claude.json`)**
— this file backs the developer's daily-driver Claude Code setup; a malformed edit or crashed
cleanup takes down their real workflow, not just the spike:
1. **Backup before first write**: copy `~/.claude.json` to
   `spikes/mcp_feasibility/artifacts/claude.json.backup-<ISO timestamp>` before the experiment's
   first mutation.
2. **Validate after every write**: JSON-parse the file immediately after each mutation; a parse
   failure triggers immediate restore from backup and aborts the experiment step.
3. **Restore on failure**: any experiment error during a config-touching step restores the backup
   before exiting (not left to end-of-task cleanup).
4. **Post-task diff**: record a diff of `~/.claude.json` (before vs. after) in the task artifacts,
   confirming only the test registration was added — and later removed. An unexplained delta is a
   blocking finding for that task.

**Process teardown guarantees** — persistent headless sessions and spike tool servers are OS
processes that outlive a crashed or Ctrl-C'd script, sit holding stdio, and may quietly draw on the
live subscription:
1. **PID capture at spawn**: every script that spawns Claude Code or the tool server records child
   PIDs to its artifact log at spawn time.
2. **Kill in `finally` / signal handlers**: cleanup runs in `finally` blocks and on SIGINT/SIGTERM —
   never only on the happy path.
3. **Post-task orphan sweep**: each task ends with a process sweep (e.g., `pgrep -f` against the
   spike's marker pattern); the sweep result is recorded in that task's artifacts alongside the
   config diff. A surviving orphan is killed manually and noted as a finding.

**Rationale**: Quarantine keeps the green gate trivially honest (D2) and makes the eventual
disposition of the spike explicit — promote to `src/` through a proper review, or delete. The
cleanup rule honors invariant #9 (never directly mutate provider config directories without a
documented, reversible mechanism) during experimentation, where discipline is easiest to skip and
most important to keep.

**Rejected alternative — put spikes under `docs/` or inline in `tests/`**: Wrong home for runnable
code; pollutes test discovery; blurs the line between evidence and product.

### WS_10-D4 — Investigation Is Read-Mostly Against the Live Subscription; Modest, Recorded Load ✅ LOCKED (Architect, 2026-08-24)

**Decision**: Experiments run against the developer's own authenticated subscription on the dev
machine. Load generation stays modest (tens of requests per experiment), every benchmark records
its request count, and throttling triggers back-off-and-record rather than retry-harder.

**Rationale**: This is a personal paid subscription, not a test fixture. Beyond basic courtesy,
throttling behavior is itself an IQ-5 finding worth capturing cleanly — hammering would contaminate
the measurement we came for.

**Rejected alternative — synthetic/mock backend for benchmarks**: A mock measures nothing about
what we actually need to know (warm-session latency, subscription behavior). Feasibility questions
are empirical by definition.

---

## Open Decisions (OD-*)

### OD-1 — Canonical registration surface for the future `installer.ts` ⬚ OPEN (decided empirically, then elevated)

**Question**: If multiple registration surfaces prove functional (e.g., both project `.mcp.json`
and `claude mcp add` → `~/.claude.json`), which becomes the canonical target `install()`
implements?

**Considerations**: Project `.mcp.json` is scoped to the working directory (clean multi-project
story, no global mutation, trivially reversible) but only applies when Quotagate's cwd is right;
`claude mcp add --scope user` registers globally (works from anywhere) but mutates user-level state
that must be idempotently managed and cleanly removed. Scriptability + reversibility + blast radius
are the criteria.

**Unblocks**: the follow-on installer workstream. T2 produces the evidence; PA elevates the
decision with the findings report.

### OD-2 — If NO-GO-WITH-ALTERNATIVE: is the Agent SDK surface investigated inside this workstream or deferred? ⬚ OPEN (user)

**Question**: Spec §6 Phase-1A notes once floated "whether the Claude Agent SDK is a cleaner surface
than the CLI." If the CLI topology fails partially, do we spend another ~half-day spiking the Agent
SDK here (before the Phase-2 plan is authored), or defer that spike and author Phase 2 around the
best-known alternative now?

**Trade-off**: investigating now keeps Phase 2 planning on settled ground but extends the
feasibility phase; deferring gets Phase 2 moving sooner at the risk of a second stall later.

**Unblocks**: the NO-GO-WITH-ALTERNATIVE branch of §Success Criteria. Needs the user only if that
verdict occurs.

### OD-3 — What evidence level satisfies invariant #10 for GO: structural fresh-context, or verified reset? ⬚ OPEN (user)

**Question**: The spec (§3.1) says `/clear`-style resets are "acceptable best-effort fallback …
never as the primary guarantee" — yet it also anticipates exactly the case where no structural
mechanism exists. If IQ-4 finds only a verified-reset mechanism (deterministic across probes, but
reactive cleanup by nature), does that qualify for GO (with the follow-on adapter required to pair
reset + `_mcp_lock` + periodic probe verification), or does invariant #10 demand structural
isolation and therefore a NO-GO-WITH-ALTERNATIVE?

**Why the user decides**: this is a genuine tension between two binding texts — §8 #10
("Statelessness is structural, not cleaned up after the fact") versus §3.1's best-effort allowance.
It constrains what "done" means for the entire upgrade and should not be resolved by the
implementer mid-flight.

**Unblocks**: final GO adjudication whenever IQ-4 lands on verified-reset.

---

## Task Breakdown

| Task ID | Description | Est. Duration | Status        | Task Tracker Link              |
| ------- | ----------- | ------------- | ------------- | ------------------------------ |
| T1      | Recon & baseline: inventory `claude --version`, `claude mcp --help`, all headless/session flags; scaffold `spikes/mcp_feasibility/` (exp/, fixtures/, artifacts/, findings/); toolchain exclusions (D3); baseline cold-spawn latency harness recording `--print` p50/p95; record CLI version for EF7. | ~1 hour | ⬚ Not started | `../../active/TASK_WS10_T1.md` |
| T2      | Hello-world stdio MCP tool server via `@modelcontextprotocol/sdk`; register via each candidate surface (project `.mcp.json`, `claude mcp add` scopes, direct config edit); verify connect + tool listing; drive a persistent headless session programmatically ≥10 turns (A1, A2); deregister/cleanup per D3. Record surface-by-surface results (feeds OD-1). | ~1 hour | ⬚ Not started | `../../active/TASK_WS10_T2.md` |
| T3      | `quotagate_complete` fixture (spec §3.5 shape) into the tool server; end-to-end invocation probes: N≥20 mixed samples (text / tool-declaration / `tool_choice:"required"`), count valid tool-argument JSON vs. wrong-channel output (A3, EF4); side-effect suppression probes (`read_file` class) with zero-execution assertion (A4); oversized-payload ceiling check (EF3). | ~1 hour | ⬚ Not started | `../../active/TASK_WS10_T3.md` |
| T4      | Statefulness & serialization: sequential code-word plant-and-probe across invocations; adversarial extraction attempt; enumerate and test reset mechanisms (clear command / restart / flags); concurrent double-invocation probe (A5, A6). Classify outcome: structural / verified-reset / unachievable (feeds OD-3). | ~1 hour | ⬚ Not started | `../../active/TASK_WS10_T4.md` |
| T5      | Latency & cost benchmark: identical-request p50/p95, persistent warm session vs. cold `--print`; modest burst with throttle observation and back-off (A7, D4, EF6); machine context + sample sizes recorded. | ~1 hour | ⬚ Not started | `../../active/TASK_WS10_T5.md` |
| T6      | Failure injection & fallback catalogue: kill server mid-request, startup timeout, tool-not-found, malformed result, hung invocation; catalogue observable error surfaces and their `TransportError` mappability; confirm unchanged-`CLIAdapter` fit including `backend` field semantics (A8, IQ-6). | ~1 hour | ⬚ Not started | `../../active/TASK_WS10_T6.md` |
| T7      | Findings consolidation & adjudication: write `findings/WS10_findings.md` (one section per IQ, artifact citations, sample sizes); draft spec amendments if reality diverged (Goal 3); re-record CLI version; run the untouched green-gate confirmation (D2); record exactly one verdict (GO / NO-GO-WITH-ALTERNATIVE / NO-GO) and elevate OD-1..OD-3 as applicable; propose the follow-on workstream outline or the escalation path. | ~1 hour | ⬚ Not started | `../../active/TASK_WS10_T7.md` |

_Status: `✅ Completed` | `🔄 In Progress` | `⬚ Not started` | `❌ Blocked`_

### Review amendments to incorporate at tracker elevation (SPE review, APPROVE WITH SUGGESTIONS, 2026-08-24)

Blocking items are already folded into WS_10-D3 above. The following suggested findings MUST be
reflected in the named trackers when they are elevated (they refine experiment design, not scope):

- **→ T2**: quote spec §3.8's sketch verbatim in the topology findings and note it reads naturally
  in *either* direction, so the Goal-3 amendment cites the ambiguity precisely. Spike dependencies
  (`@modelcontextprotocol/sdk`) get their own `package.json` inside `spikes/mcp_feasibility/` —
  never the product lockfile.
- **→ T3**: verify whether a quantified Mechanism-A validity-rate artifact exists from Phase 1; if
  not, measure a Mechanism-A baseline inside T3 or record the comparison as qualitative. Raise
  sample size to n=30–40 (n=20 gives ±~18pp CI — too wide).
- **→ T4**: make the sequential no-reset arm an explicit **positive control** for the code-word
  probe and report both arms jointly; quantify "deterministically" as ≥5 reset cycles including ≥1
  adversarial extraction (this is what OD-3 will be adjudicated on). Journal invocation
  start/end timestamps **server-side** in the fixture tool server — client-side observation cannot
  distinguish queue vs interleave vs corrupt.
- **→ T6**: add three failure injections: server crash **between** requests (reconnect behavior),
  non-protocol bytes on stdout corrupting stdio framing, registration removed mid-session. Define
  the hung-invocation watchdog timeout up front (30s hard cap).
- **→ all tasks**: add the split-rule — any task exceeding ~90 minutes of wall time splits into two
  trackers rather than silently overrun.
- **→ D4 hygiene (T5 especially)**: run benchmark bursts outside heavy personal CLI use and note
  concurrent same-day subscription usage in artifacts. Findings transcripts may contain full
  conversations — note artifact sensitivity before `spikes/` is ever shared.

_T1 is first (environment truth + scaffolding unblock everything). T2 depends on T1. T3–T6 depend
on T2 (a working registered tool server is their common fixture) and are otherwise independent —
they may run in any order, though T4 before T5 is recommended so the benchmark runs on a transport
whose isolation behavior is already characterized. T7 depends on all of T1–T6. If T2 fails on every
registration surface, stop and escalate early: T3–T6 have no subject matter without a consumable
tool server, and the verdict is likely NO-GO-WITH-ALTERNATIVE (OD-2)._

---

## Cross-Task Contracts

### Spike directory layout (produced by T1 → consumed by T2–T7)

`spikes/mcp_feasibility/{exp,fixtures,artifacts,findings}` as defined in §Test Strategy. T1 owns
the skeleton and the toolchain exclusions; T2–T7 must place artifacts under this layout, not invent
adjacent directories. Consumers must NOT import anything from `spikes/` in `src/` or `tests/`.

### `quotagate_complete` tool-definition fixture (produced by T2/T3 → consumed by T3–T6)

`spikes/mcp_feasibility/fixtures/quotagate_complete.tool.json` — name, description, and parameter
schema transcribed from spec §3.5 verbatim (constraint language included). It is the single source
during the investigation so validity rates (T3) and failure modes (T6) are measured against one
definition. The follow-on workstream re-authors it as `src/mcp/toolDefinition.ts` — the fixture is
evidence, not product.

### Probe-prompt sets & code-word convention (produced by T3/T4 → consumed by T4, T5)

Fixed UUID constants per the WS_03-D3 convention (no runtime-generated tokens), distinct per
experiment file, commented with purpose. Shared by the statefulness probes (T4) so plant/probe
results are reproducible across runs and comparable with the Phase-1 contamination suite's token
discipline.

### Findings report structure (produced by all → consolidated in T7)

One section per IQ-1…IQ-6, each with: question restated, verdict sentence, evidence citations
(`exp/NN` script + `artifacts/…log` + sample size), caveats. Then: spec-amendment proposals
(dated, quoting the invalidated passage), the single overall verdict with its trigger mapping from
§Success Criteria, and the elevated OD list. This structure is what the next session reads instead
of re-running the experiments — write it for that reader.

---

## Known Pitfalls & Implementation Notes

- **The `--print` guarantee does not transfer.** Execution suppression in Phase 1 comes from
  `--print`'s mode, not from prompt virtue (spec §5.3 proved the mode suppresses the loop). A
  persistent session has the loop armed; the constraint stack must suppress it by instruction
  alone. Treat every persistent-mode sample as potentially side-effecting until probed otherwise
  (A4 is the sharpest edge in this whole investigation).
- **Topology confusion wastes hours.** Before writing any registration code, settle which direction
  the wire runs (IQ-1 sub-question): Claude Code-as-MCP-server (spec literal) vs. Claude Code-as-
  host-of-our-server (Mechanism B implication). The two fail differently and the spec's §3.8 sketch
  (`self.mcp_client.call_tool(...)`) reads naturally in *either* direction — resolve it
  experimentally in T2 before building on it.
- **Permission prompts are the silent killer of headless sessions** (EF2). A stalled session looks
  like a hang; distinguish "stuck awaiting approval" from "broken transport" before recording a
  failure. Pre-grant permissions in the experiment's project scope only.
- **Env inversion (EF5)**: when Claude Code spawns our tool server, the child inherits Claude's
  environment — the opposite of Phase 1's allowlisted spawn. Anything environment-sensitive in the
  spike scripts (homedir lookups, PATH resolution) may behave differently under this parent. Note
  observed env in artifacts; it matters for the follow-on `toolServer.ts` design.
- **Do not trust single successes or single failures.** Constraint reliability (A3) is a rate, not
  an event; isolation (A5/A6) needs repeated probes including adversarial ones. One clean run is a
  smoke test; N runs with logged artifacts is evidence.
- **Version drift (EF7)**: Claude Code auto-updates. Re-record `claude --version` in T7; if it
  changed mid-workstream, flag comparability caveats in the findings rather than silently mixing
  eras of evidence.
- **Gate discipline (D2)**: run the full gate at each task close. It should be boring — if it ever
  isn't, something leaked out of quarantine, and that leak is itself a finding to fix before
  continuing.

---
