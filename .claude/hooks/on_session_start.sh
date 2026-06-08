#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
# on_session_start.sh — Hook: SessionStart  (Quotagate)
#
# Fires when a session starts. Surfaces the current Status line, any
# active task trackers, and the "What is next" handoff so the session
# orients instantly without re-reading the whole repo.
#
# (Improvement over AlterEgo, which had no SessionStart hook.)
# ═══════════════════════════════════════════════════════════════════

set -euo pipefail

REPO_ROOT="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
CLAUDE_MD="$REPO_ROOT/.claude/CLAUDE.md"
ACTIVE_DIR="$REPO_ROOT/docs/active"

echo "═══════════════════════════════════════════════════"
echo "  HOOK: SessionStart — Quotagate orientation"
echo "═══════════════════════════════════════════════════"
echo ""
echo "Source of truth: quotagate-spec.md (architecture) + .claude/CLAUDE.md (working state)."
echo ""

# Status line (the > Status: ... block near the top of CLAUDE.md)
if [ -f "$CLAUDE_MD" ]; then
    echo "── Status (from .claude/CLAUDE.md) ──"
    sed -n '/^> \*\*Status\*\*/,/^$/p' "$CLAUDE_MD" | sed 's/^> //'
    echo ""
    echo "── What is next ──"
    sed -n '/^\*\*What is next\*\*/,/^\*\*Resolved decisions\*\*/p' "$CLAUDE_MD" \
        | grep -vE '^\*\*Resolved decisions' || true
    echo ""
fi

# Active trackers
if [ -d "$ACTIVE_DIR" ]; then
    ACTIVE=$(ls "$ACTIVE_DIR" 2>/dev/null | grep -v TEMPLATE | grep -v "^$" || true)
    if [ -n "$ACTIVE" ]; then
        echo "── Active task trackers (work in progress — do NOT delete) ──"
        for f in $ACTIVE; do echo "  - docs/active/$f"; done
    else
        echo "── Active task trackers: none (docs/active/ holds only TEMPLATE.md) ──"
    fi
fi
echo "═══════════════════════════════════════════════════"
