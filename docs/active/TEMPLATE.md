# TASK_WS<ID>\_T<n>: [Task Name]

<!--
  TASK TRACKER TEMPLATE  (Quotagate)
  ----------------------------------
  A task is ~1 hour of implementation-ready work: one coherent deliverable, broken into atomic,
  individually-evaluable subtasks. This template extends AlterEgo's with three Quotagate-specific
  sections — "Assumptions to Test", "Expected Failures", and "Test Strategy" — because Quotagate is
  feasibility-driven and many tasks de-risk an unproven assumption (MCP-server mode, execution
  suppression, statelessness) rather than just ship code.

  Lifecycle: Architect elevates a stub to implementation-ready (locks Decisions, Assumptions, Test
  Strategy, Success Criteria, Required Test Cases) → BSE implements + fills the Subtask Progress
  Table → Architect writes Review Notes + checks Sign-off. The BSE does NOT fill Review Notes/Sign-off.

  Sections marked [OPTIONAL] may be dropped for lightweight tasks (e.g. a research/spike task may
  have no Files Modified, but MUST have Assumptions + Expected Failures + Test Strategy).
-->

## Context

- **Workstream**: WS\_<ID> ([Name])
- **Plan reference**: `docs/plan/workstreams/ws<ID>_*.md`
- **Phase plan**: `docs/plan/phases/NN_*.md`
- **Depends on**: [Upstream tasks, or "None"]
- **Blocks**: [Downstream tasks, or "None"]

---

## Goal & Why

- **Goal**: [The concrete deliverable(s) and target file(s) — what this hour produces.]
- **Why**: [Why it matters — the architectural value; what downstream work it unblocks; how it
  serves the spec's invariants/goals. State the *reason for the goal*, not just the goal.]

---

## Assumptions to Test

<!-- Quotagate-specific. The hypotheses this task validates. For each: the assumption, why we believe
     it, how this task tests it, and what we do if it is FALSE. A spike/research task is mostly this. -->

| #   | Assumption                                                        | Why we believe it                      | How this task tests it            | If false →                              |
| --- | ----------------------------------------------------------------- | -------------------------------------- | --------------------------------- | --------------------------------------- |
| A1  | [e.g. quotagate_complete over MCP returns raw JSON with no prose] | [Experiment 5.2 showed it for --print] | [Call the tool, assert Zod parse] | [Fall back to prompt-engineering layer] |

---

## Expected Failures

<!-- The failure modes we EXPECT to encounter or must handle — error paths, malformed model output,
     transport drops, races. Naming them up front turns surprises into planned-for cases and feeds
     the Test Strategy. Distinguish "expected & handled" from "would be a real bug". -->

- **[EF1]** [e.g. MCP call times out mid-request] → [handled by: fall through to --print subprocess (spec §4.4)]
- **[EF2]** [e.g. model returns JSON wrapped in ```json fences] → [handled by: validator strips/parses, else retry]
- **[EF3]** [e.g. concurrent requests interleave on one session] → [must NOT happen: serialization guard (invariant #11)]

---

## Test Strategy

<!-- HOW this task is proven, not just the list of cases. Name the layers and why each is used. -->

- **Unit**: [What is unit-tested in isolation; mocks/stubs used.]
- **Integration**: [What is exercised end-to-end; which real components vs. stubs.]
- **Contract**: [Schema/shape assertions at the seams — OpenAI request/response, quotagate_complete args.]
- **Contamination/Isolation** (if transport-touching): [Sequential + concurrent + retry-path leak tests per spec §6.]
- **Manual/spike** (if applicable): [Exact command(s) to run and what to observe.]

---

## [OPTIONAL] Open Decisions for User

<!-- Only if a genuinely blocking decision can't be resolved from spec + codebase + existing decisions.
     Prefer to LOCK with a justified lean. Remove if none. -->

- **[DECISION-ID]**: [Question + recommended lean + rationale + what is blocked.]

---

## [OPTIONAL] Contract: What This Task Inherits

| Symbol / Artifact | Source        | Role in This Task       |
| ----------------- | ------------- | ----------------------- |
| `[Symbol]`        | [file / task] | [How this task uses it] |

---

## Subtask Progress Table

<!-- Subtasks are ATOMIC, individually-evaluable steps. Each should be independently checkable. -->

| #   | Subtask       | Status        | Iteration | Notes |
| --- | ------------- | ------------- | --------- | ----- |
| 1   | [Atomic step] | ⬚ Not started | —         |       |
| 2   | [Atomic step] | ⬚ Not started | —         |       |
| 3   | [Atomic step] | ⬚ Not started | —         |       |

_Status icons: `✅ Done` | `🔄 In progress` | `⬚ Not started` | `❌ Blocked`_

---

## Current Subtask Detail

### Subtask N: [Active subtask]

**Approach iteration plan** (simplest → target):

1. [Simplest working prototype / mock]
2. [Real logic]
3. [Edge cases / integration]

- **Current iteration**: [e.g. 1 of 3]
- **Verifiability / Success Criteria**: [What defines a pass — cross-ref SC-N]
- **Challenges**: [Issues/blockers]

---

## Decisions Made

<!-- Each: stable ID, status tag (✅ LOCKED Architect / ✅ DECIDED user), choice, rationale, REJECTED
     ALTERNATIVES (load-bearing — they stop re-litigation). -->

### [D1] — [Decision Title] ✅ LOCKED (Architect, <date>) | ✅ DECIDED (user, <date>)

**Decision**: [The locked choice, precisely.]
**Rationale**: [Why correct for this phase.]
**Rejected alternative — [name]**: [What it was and why it lost.]

### [D2] — Anti-overengineering scope fence ✅ LOCKED

**This task explicitly does NOT include**:

- [Out-of-scope concern — and which task/subsystem/phase owns it]

---

## [OPTIONAL] Cross-Task Contracts (Downstream Dependencies on This Task)

### [TASK_...] will depend on:

- `[Symbol / behavior]` — [how it is consumed; what it must NOT do]

---

## Files Modified / Created

- `[path/to/file]` — **create new** | **modify** ([what changes])

---

## Success Criteria / Verifiability

<!-- Numbered, individually verifiable. Include the green-gate rows. -->

| #    | Criterion                                      | How to verify             |
| ---- | ---------------------------------------------- | ------------------------- |
| SC-1 | [Observable behavior]                          | [Exact check / test name] |
| SC-2 | `npm run typecheck` clean; no unused exports   | Zero errors               |
| SC-3 | `npm run lint` clean; `npm run format` no diff | Zero issues               |
| SC-4 | Coverage ≥ [N]% on new module                  | `npm run test:cov`        |
| SC-5 | Zero regressions in existing suite             | `npm test` green          |

---

## Required Test Cases

<!-- Named cases cross-referencing Success Criteria. Architect seeds during elevation; implementer
     realizes them as Vitest tests. -->

File: `tests/.../<module>.test.ts`

### T-1: [case name] (covers SC-N)

[What it constructs, what it asserts.]

---

## Review Notes

_(Architect fills after BSE submits — verdict APPROVE / APPROVE-WITH-NITS / REQUEST-CHANGES, findings
classified required-change / nit / informational, mapped to SC / decision IDs.)_

---

## Architect Sign-off

<!-- Checked only on a clean APPROVE (or after APPROVE-WITH-NITS fixes land). -->

- [ ] Implementation reviewed
- [ ] All success criteria verified
- [ ] All assumptions resolved (proven, or fallback taken & documented)
- [ ] No regressions in full test suite
- [ ] `npm test` / `typecheck` / `lint` / `format` all clean
