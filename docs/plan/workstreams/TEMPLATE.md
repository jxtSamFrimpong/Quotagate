# Workstream WS_<ID>: [Workstream Name]

> A workstream scopes ~1 day of work and is more detailed than its parent phase: concrete goals +
> deliverables, locked decisions (with rejected alternatives), a task breakdown, cross-task
> contracts, and success/quality gates. It is the bridge from phase goals to hour-sized tasks.

## Workstream Overview
- **Parent Phase**: [link to `../phases/NN_*.md`]
- **Timeframe**: [~1 day]
- **Status**: [Proposed | In Progress | Completed]
- **Dependencies**: [Upstream workstreams/tasks, or "None"]

---

## Goals & Deliverables
- **Goal 1**: [Description]
  - Deliverable: [The concrete artifact/file/behavior that will exist]
- **Goal 2**: [Description]
  - Deliverable: [...]

---

## Why This Workstream Matters
[What it unblocks; why now; what later work depends on it. Tie back to the spec/phase.]

---

## Locked Decisions
[Decisions scoped to this workstream. Each: ID + status + choice + rationale + rejected alternative.]

### [WS-ID-Dn] — [Decision Title] ✅ LOCKED (Architect | user, <date>)
**Decision**: [The locked choice, precisely.]
**Rationale**: [Why it is correct for this phase.]
**Rejected alternative — [name]**: [What it was and why it lost.]

---

## Task Breakdown

| Task ID | Description | Est. Duration | Status | Task Tracker Link |
|---------|-------------|---------------|--------|-------------------|
| T1      | [Description] | [~1 hour] | ⬚ Not started | `../../active/TASK_WS<ID>_T1.md` |
| T2      | [Description] | [~1 hour] | ⬚ Not started | `../../active/TASK_WS<ID>_T2.md` |

*Status: `✅ Completed` | `🔄 In Progress` | `⬚ Not started` | `❌ Blocked`*

*[Dependency notes: which tasks are parallel vs. sequential.]*

---

## Cross-Task Contracts
[The seams between tasks in this workstream — types/APIs/files one task produces and another consumes,
so they are not re-derived. E.g. the `CLIAdapter` interface shape, the `AdapterResponse` type, the
`quotagate_complete` argument schema.]

### [Symbol / contract]
[Definition + which task owns it + which tasks consume it + what consumers must NOT do.]

---

## Success & Evaluation Criteria
- **Functional requirements**:
  - [ ] [Observable behavior]
- **Named tests that prove this workstream done**:
  - [ ] `tests/...` — [what it asserts]
- **Quality gates**:
  - [ ] `npm test` green; no test-count regression
  - [ ] `npm run typecheck` clean
  - [ ] `npm run lint` clean; `npm run format` produces no diff
  - [ ] Coverage ≥ [N]% on new modules

---

## Known Pitfalls & Implementation Notes
[Gotchas the implementer should know up front — async/subprocess traps, MCP lifecycle edge cases,
event-loop blocking, OpenAI-format quirks, etc.]
