#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
# on_pre_compact.sh — Hook: PreCompact  (Quotagate)
#
# Fires before context compaction. Dumps the current Session State and
# any active task trackers so critical context survives compaction, and
# restates the compaction rules. A PreCompact hook can ONLY inject
# reminder text — it cannot edit files (that is /house-keeping's job).
# ═══════════════════════════════════════════════════════════════════

set -euo pipefail

REPO_ROOT="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
ACTIVE_DIR="$REPO_ROOT/docs/active"
CLAUDE_MD="$REPO_ROOT/.claude/CLAUDE.md"

cat << 'EOF'
═══════════════════════════════════════════════════
  HOOK: PreCompact — Preserving Critical Context  (Quotagate)
═══════════════════════════════════════════════════

Context is about to be compacted. Preserve the following:

EOF

if [ -f "$CLAUDE_MD" ]; then
    echo "── Current Session State (from .claude/CLAUDE.md) ──"
    sed -n '/^## Session State/,$ p' "$CLAUDE_MD"
    echo ""
fi

if [ -d "$ACTIVE_DIR" ]; then
    for f in "$ACTIVE_DIR"/TASK_*.md; do
        if [ -f "$f" ]; then
            echo "── Active Task: $(basename "$f") ──"
            cat "$f"
            echo ""
        fi
    done
fi

cat << 'EOF'
═══════════════════════════════════════════════════
IMPORTANT: After compaction, you MUST retain:
  - Which task/subtask is currently in progress
  - The iteration plan and current iteration number
  - Any decisions made this session
  - Any blockers, open questions, or feasibility checks pending
  - Any user instructions/corrections

COMPACTION RULES (enforce during compaction):
  - TASK COMPACTION: max 3 detailed entries in "What was completed".
    If over 3, fold the oldest into a one-line milestone summary.
  - DECISION COMPACTION: max 2 dated "Resolved decisions" blocks inline.
    If over 2, MOVE the oldest block(s) to docs/archive/decisions.md
    (append, oldest-first). Only settled decisions get archived.
    NOTE: the actual move is done by /house-keeping, not by compaction.
═══════════════════════════════════════════════════
EOF
