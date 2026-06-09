# Phase X: [Phase Name]

> A phase scopes ~1 week of work to a coherent goal. It sets goals, records phase-level architecture
> decisions, and maps to a set of workstreams. Keep it goal-level — the detail lives in the
> workstreams it points to.

## Phase Overview

- **Objective**: [High-level summary of what this phase achieves]
- **Target Timeline**: [e.g. ~1 week / specific dates]
- **Status**: [Proposed | In Progress | Completed]
- **Depends on**: [Prior phase(s) / prerequisites, or "None"]

---

## Goals

[Define goals per area of the system. Check them off as workstreams complete.]

### Proxy / Server

- [ ] [Goal]

### Adapters / Transport

- [ ] [Goal]

### Constraint Mechanism (quotagate_complete / CLAUDE.md)

- [ ] [Goal]

### Testing & Quality

- [ ] [Goal — include the green gate: tests / typecheck / lint]

---

## Architecture & Design Decisions

[Phase-level decisions only. Each records choice + rationale + rejected alternative. Decisions that
constrain a single workstream live in that workstream's "Locked Decisions" instead.]

### [Decision ID] — [Decision Name]

- **Problem**: [The problem being solved]
- **Selected Approach**: [What was chosen and why]
- **Rejected Alternative(s)**: [What lost and why — load-bearing]

---

## Assumptions This Phase Rests On

[Quotagate is feasibility-driven. List the unproven assumptions this phase depends on, and how/when
each is de-risked. Anything BLOCKING gets a spike before dependent workstreams start.]

| Assumption                                                                | Risk if false                              | De-risked by     | Status |
| ------------------------------------------------------------------------- | ------------------------------------------ | ---------------- | ------ |
| [e.g. Claude Code can run as an MCP server exposing a raw-inference tool] | [Fallback to --print subprocess transport] | [Spike WS_XX-T0] | ⬚      |

---

## Out of Scope (anti-overengineering fence)

- [Concern deferred to a later phase, and which phase owns it]
- [e.g. streaming → Phase 3; multi-backend → Phase 2; marketplace → spec §7, not built]

---

## Workstreams Mapping

| Workstream ID | Workstream Name | Timeframe | Status        | Plan Link                        |
| ------------- | --------------- | --------- | ------------- | -------------------------------- |
| WS_01         | [Name]          | [~1 day]  | ⬚ Not started | [link](../workstreams/ws01_*.md) |
| WS_02         | [Name]          | [~1 day]  | ⬚ Not started | [link](../workstreams/ws02_*.md) |

_Status: `✅ Completed` | `🔄 In Progress` | `⬚ Not started` | `❌ Blocked`_

---

## Success Criteria (phase-level)

- [ ] [The observable outcome that means this phase is done]
- [ ] [The proving test / demo — e.g. "OpenAI SDK against localhost:8080 returns valid completions"]

---

## Future Enhancements & Roadmap

- **Next Phase**: [Link/name]
- **Deferred features**: [Tracked in `../workstreams/deferments.md`]
