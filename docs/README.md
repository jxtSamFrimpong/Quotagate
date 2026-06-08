# Quotagate Docs & Planning Hub

This directory is the planning and documentation harness for Quotagate. It implements a three-tier
planning hierarchy — **phase → workstream → task** — plus a decision archive and architecture
schematics. The product/architecture source of truth is **`schematics/quotagate-spec.md`**; the working state
is **`../.claude/CLAUDE.md`**.

## The planning hierarchy

| Tier | Horizon | Granularity | Lives in | Answers |
|---|---|---|---|---|
| **Phase** | ~1 week | Goal-level | `plan/phases/NN_*.md` | *What does a week of work achieve?* |
| **Workstream** | ~1 day | Detailed plan | `plan/workstreams/wsNN_*.md` | *What does a day achieve, with locked decisions & success criteria?* |
| **Task** | ~1 hour | Implementation-ready | `active/TASK_*.md` | *What does an hour build — with goal, assumptions, test strategy, expected failures, success criteria?* |
| **Subtask** | minutes | Atomic | inside a task tracker | *One evaluable step toward the task.* |

- A **Phase** sets goals and records phase-level architecture decisions. It maps to a set of
  workstreams. (Template: `plan/phases/TEMPLATE.md`.)
- A **Workstream** is more detailed than its phase: goals + deliverables, locked decisions (with
  rejected alternatives), a task breakdown, cross-task contracts, and success/quality gates.
  (Template: `plan/workstreams/TEMPLATE.md`.)
- A **Task** is the implementation-ready unit handed to the Backend Systems Engineer. It carries the
  goal & why, the **assumptions it tests**, the **test strategy**, the **expected failures**, locked
  decisions, a subtask progress table, files touched, success criteria, and required test cases.
  (Template: `active/TEMPLATE.md`.)
- **Subtasks** are the atomic, individually-evaluable steps inside a task's progress table.

## Lifecycle

```
Architect authors Phase plan  →  Architect authors Workstream specs  →
Architect elevates a Task stub to implementation-ready (locks Decisions,
  Assumptions, Test Strategy, Success Criteria)  →
BSE implements + fills the Subtask Progress Table  →
Architect writes Review Notes + checks Sign-off  →
/house-keeping archives the done tracker + compacts decisions
```

## Directory map

```
docs/
├── README.md              # This file
├── plan/
│   ├── phases/            # Phase plans (~1 week) + TEMPLATE.md
│   └── workstreams/       # Workstream specs (~1 day) + TEMPLATE.md + deferments.md
├── active/                # Live TASK_*.md trackers (~1 hour) + TEMPLATE.md
├── archive/
│   ├── decisions.md       # Settled decisions moved out of CLAUDE.md by /house-keeping
│   ├── tasks/             # Archived TASK_*.md trackers (history preserved via git mv)
│   └── plans/             # Archived phase/workstream plans
└── schematics/
    ├── README.md          # What schematics are + conventions
    ├── components/        # Component & data-flow schematics
    └── schemas/           # Data-shape / schema schematics
```

## Naming conventions

- Phases: `NN_short_name.md` (e.g. `01_core_proxy.md`).
- Workstreams: `wsNN_short_name.md` (e.g. `ws01_project_bootstrap.md`).
- Tasks: `TASK_WS<NN>_T<n>.md` (e.g. `TASK_WS01_T1.md`).
- Status icons everywhere: `✅ Completed` · `🔄 In Progress` · `⬚ Not started` · `❌ Blocked`.

## Conventions that matter

- **Decisions** are logged per the Decision Log Protocol in `../.claude/CLAUDE.md`. Every locked
  decision records its **choice + rationale + rejected alternative** — rejected alternatives are
  load-bearing; they stop decisions being re-litigated.
- **Anti-overengineering**: phases/workstreams/tasks should reflect the spec's staged plan (Phase 1
  Core Proxy first). Do not pull Phase 2/3 concerns (multi-backend, streaming) or the marketplace
  (spec §7) into earlier work.
- **Empirical first**: Quotagate is feasibility-driven. Where a task rests on an unproven assumption
  (e.g. MCP-server mode), the task's *Assumptions to test* and *Expected failures* sections must name
  it, and a research/spike subtask should de-risk it before implementation proceeds.
