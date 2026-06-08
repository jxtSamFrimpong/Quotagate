#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
# on_subagent_stop.sh — Hook: SubagentStop  (Quotagate)
#
# Fires when principal-architect or backend-systems-engineer finishes.
# Reminds the agent to capture what the subagent accomplished into the
# active task tracker.
# ═══════════════════════════════════════════════════════════════════

set -euo pipefail

REPO_ROOT="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
ACTIVE_DIR="$REPO_ROOT/docs/active"

ACTIVE_COUNT=0
if [ -d "$ACTIVE_DIR" ]; then
    ACTIVE_COUNT=$(ls "$ACTIVE_DIR" 2>/dev/null | grep -c "^TASK_" || true)
fi

if [ "$ACTIVE_COUNT" -gt 0 ]; then
    cat << 'EOF'
[SubagentStop] Subagent finished. If it advanced an active task:
  - Update the tracker in docs/active/ with what was accomplished
  - Update subtask status (⬚ → 🔄 → ✅)
  - Record any decisions made (id + choice + rationale + rejected alternative)
  - If it was the Architect: did it produce a diagnosis/proposal, or Review
    Notes + Sign-off? If the BSE: is the green gate verified?
EOF
    echo "  Active trackers: $(ls "$ACTIVE_DIR" | grep "^TASK_" | tr '\n' ', ')"
fi
