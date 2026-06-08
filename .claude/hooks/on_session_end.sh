#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
# on_session_end.sh — Hook: SessionEnd  (Quotagate)
#
# Fires when a session ends. Reminds the agent to refresh the
# CLAUDE.md Session State so the next session can resume from it alone.
# ═══════════════════════════════════════════════════════════════════

set -euo pipefail

REPO_ROOT="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
ACTIVE_DIR="$REPO_ROOT/docs/active"

ACTIVE_TASKS=""
if [ -d "$ACTIVE_DIR" ] && [ "$(ls -A "$ACTIVE_DIR" 2>/dev/null | grep -v TEMPLATE)" ]; then
    ACTIVE_TASKS=$(ls "$ACTIVE_DIR" | grep -v TEMPLATE | grep -v "^$" || true)
fi

cat << 'EOF'
═══════════════════════════════════════════════════
  HOOK: SessionEnd  (Quotagate)
═══════════════════════════════════════════════════

Session is ending. Update the ## Session State section of
.claude/CLAUDE.md so the next session can resume from it alone:

1. UPDATE "Last Updated" + "Current Session" dates to today
2. UPDATE "What was completed" — everything done this session
   (keep at most 3 detailed entries; fold older into a one-line milestone)
3. UPDATE "What is being worked on" — in-progress work, or "Nothing"
4. UPDATE "Active task trackers" — remaining docs/active/ files, or "None"
5. UPDATE "What is next" — the immediate next task(s)
6. UPDATE "Resolved decisions" — log any decisions locked this session
   (date + choice + rationale + rejected alternative; keep ≤2 inline)
7. UPDATE "Open decisions for user" — any pending decisions
8. Keep the top "> Status" line consistent with the above

Tip: run /house-keeping to archive done trackers, compact old decisions,
refresh Session State, and commit — all in one pass.

EOF

if [ -n "$ACTIVE_TASKS" ]; then
    echo "⚠️  Active task trackers still open (do NOT delete — work in progress):"
    for f in $ACTIVE_TASKS; do echo "  - docs/active/$f"; done
else
    echo "No active task trackers — all tasks completed or none started."
fi
echo ""
echo "═══════════════════════════════════════════════════"
