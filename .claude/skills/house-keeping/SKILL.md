---
name: house-keeping
description: End-of-session housekeeping for the Quotagate repo. Archives completed task trackers, compacts old resolved decisions out of CLAUDE.md, syncs schematics if the architecture changed, refreshes the Session State handoff, and commits everything. Use when the user says "house-keeping", "tidy up", "wrap up the session", "archive done trackers", or asks to clean up docs/active + CLAUDE.md before stopping.
---

# House-Keeping

Performs the deliberate, tool-running cleanup that compaction hooks **cannot** do themselves (a
`PreCompact` hook can only inject reminder text — it never edits files). Run this when a unit of work
is finished and you want the repo and `.claude/CLAUDE.md` left in a clean, resumable state.

Do the steps **in order**. Report what changed at the end. If a step has nothing to do, say so and
move on — do not invent work.

> **Git note:** this repo may not be initialized yet (`git rev-parse` to check). If it is **not** a
> git repo, do Steps 1–4, and in Step 1 use plain `mv` (not `git mv`); in Step 5, offer to run
> `git init` and create the initial commit, but do not init without the user's go-ahead.

---

## Step 1 — Archive completed task trackers

Goal: `docs/active/` should hold only in-progress trackers (plus `TEMPLATE.md`).

1. List `docs/active/TASK_*.md` (ignore `TEMPLATE.md`).
2. For each tracker, read its status to form a recommendation. A tracker _looks_ **done** when its
   own status says so — `✅`/`Complete`/`Signed-off`/`APPROVE`, all subtasks checked, the green gate
   verified, and no open/blocked work left.
3. **Always ask the user before moving any tracker** — never archive one unprompted, even if it
   clearly looks done. Present all candidates in **one** `AskUserQuestion` (multiSelect), each with
   filename, status line, and your archive/keep recommendation. Only confirmed trackers get moved.
4. Move each confirmed tracker. In a git repo: `git mv docs/active/<file> docs/archive/tasks/<file>`
   (preserves history). Not a git repo: `mv docs/active/<file> docs/archive/tasks/<file>`.
5. Never delete a tracker. Never archive one the user did not confirm.

If `docs/active/` already holds only `TEMPLATE.md`, report "no trackers to archive" and skip the prompt.

---

## Step 2 — Compact old resolved decisions out of CLAUDE.md

Apply the **Decision Log Protocol** in `.claude/CLAUDE.md` (`## Decision Log Protocol`). Only
**Resolved/settled** decisions are eligible — never touch **Open decisions for user** or the
**Inherited DECIDED architecture** pointer (those reference the spec and stay).

**Scope:** "decisions" means _every settled decision and locked principle_ leaving the inline body of
CLAUDE.md — both the explicit dated `Resolved-decision` blocks **and** any decision embedded in a
"What was completed" entry that Step 4's fold is about to compact away. Whatever gets compacted out
must first land in `docs/archive/decisions.md`, so nothing decision-bearing is lost. **Do this step
before / together with Step 4's fold.**

1. Identify eligible decisions:
   - The dated **Resolved-decision blocks** in Session State; keep the **2 most recent** inline,
     archive older ones.
   - The **settled decisions / locked principles** inside the completion entries Step 4 will fold.
2. Ensure `docs/archive/decisions.md` exists (it is seeded in this repo). If missing, create it with
   `# Decision Archive` + a one-line note that decisions are moved out by `/house-keeping`, oldest first.
3. **Append** (never prepend) each decision, preserving its **date, the choice, the rationale, and any
   rejected alternative**. Keep chronological order. Move explicit blocks verbatim; for a decision
   harvested from prose, capture choice + rationale faithfully (don't invent).
4. **Remove** the archived explicit blocks from `.claude/CLAUDE.md` and replace them with a short
   pointer line to `docs/archive/decisions.md`. This is a move, not a copy.
5. If there are ≤2 explicit blocks **and** Step 4 folds nothing decision-bearing, there is nothing to
   archive — say so and move on.

---

## Step 3 — Sync schematics (only if architecture changed this session)

Quotagate is architecture-heavy; keep `docs/schematics/` and the spec from drifting.

1. If this session changed a component contract, data-flow, or schema (e.g. the adapter transport,
   the `quotagate_complete` tool schema, the OpenAI response shape, the serialization model), check
   whether a schematic under `docs/schematics/components/` or `docs/schematics/schemas/` needs an
   update, or whether a new one should exist.
2. If `quotagate-spec.md` itself changed in a way the schematics or this file should reflect, note the
   reconciliation. **The spec is the source of truth** — schematics elaborate it, never contradict it.
3. If nothing architectural changed, report "no schematic drift" and move on. Do not manufacture
   diagrams for routine implementation work.

---

## Step 4 — Refresh the Session State handoff

Update `## Session State` in `.claude/CLAUDE.md` so the next session can resume from it alone. Mirror
the `SessionEnd` hook checklist:

1. Set **Last Updated** (top) and **Current Session** date to **today**.
2. **What was completed** — add this session's work. Keep at most **3 detailed entries**; fold older
   ones into a one-line milestone summary.
3. **What is being worked on** — current in-progress work, or "Nothing".
4. **Active task trackers** — whatever remains in `docs/active/` after Step 1 (or "None").
5. **What is next** — the immediate next task(s).
6. **Resolved decisions** — keep ≤2 dated blocks inline (Step 2 moved the rest).
7. **Open decisions for user** — keep current; do not archive these (unresolved).
8. Keep the top `> Status` line consistent with the above.

---

## Step 5 — Commit

Make the cleanup durable.

1. If not a git repo, offer `git init` (+ a sensible `.gitignore`: `node_modules/`, `dist/`,
   `.quotagate/`, `*.log`) before committing. Get the user's go-ahead.
2. `git status` and `git diff --stat` to see everything that changed.
3. If on `main`/`master`, create a branch first (repo policy). Otherwise commit on the current branch.
4. Stage with `git add -A` (any `git mv`s are already staged) and commit with a short imperative
   subject in the repo's house style, optionally `(N tests)` if the count is known —
   e.g. `Housekeeping: archive <trackers>; compact decisions; sync CLAUDE.md`.
5. HEREDOC for a multi-line body. Do **not** add the Claude attribution footer unless asked. Do
   **not** push unless asked.

---

## Report

Finish with a short summary: trackers archived, decision blocks moved, schematics touched, the commit
SHA + subject, and anything you deliberately left alone (a tracker with open work, "no decisions to
compact", "no schematic drift").
