#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
# on_post_tool_use.sh — Hook: PostToolUse  (Quotagate)
#
# Fires after a successful Edit, Write, or Bash tool use. For Bash, only
# nudges when the command is a build/test/typecheck/lint command. Reads
# the tool JSON on stdin. Prefers `jq` for parsing, falls back to grep.
#
# (Improvement over AlterEgo: jq-first parsing + Node-aware command match.)
# ═══════════════════════════════════════════════════════════════════

set -euo pipefail

REPO_ROOT="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
ACTIVE_DIR="$REPO_ROOT/docs/active"

# No active tasks = nothing to nudge about.
ACTIVE_COUNT=0
if [ -d "$ACTIVE_DIR" ]; then
    ACTIVE_COUNT=$(ls "$ACTIVE_DIR" 2>/dev/null | grep -c "^TASK_" || true)
fi
[ "$ACTIVE_COUNT" -eq 0 ] && exit 0

INPUT=$(cat)

# Extract fields — jq if available, else a tolerant grep/sed fallback.
if command -v jq >/dev/null 2>&1; then
    TOOL_NAME=$(printf '%s' "$INPUT" | jq -r '.tool_name // empty' 2>/dev/null || echo "")
    COMMAND=$(printf '%s' "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null || echo "")
else
    TOOL_NAME=$(printf '%s' "$INPUT" | grep -o '"tool_name"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/' || echo "")
    COMMAND=$(printf '%s' "$INPUT" | grep -o '"command"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"command"[[:space:]]*:[[:space:]]*"\([^"]*\)"/\1/' || echo "")
fi

# File mutations are always relevant.
if echo "$TOOL_NAME" | grep -qiE "^(Edit|Write|MultiEdit|NotebookEdit)$"; then
    echo "[PostToolUse] File modified. Update the active task tracker if this completed or advanced a subtask."
    exit 0
fi

# Bash: only nudge for build/test/typecheck/lint/run commands.
if echo "$TOOL_NAME" | grep -qiE "^Bash$"; then
    if echo "$COMMAND" | grep -qE "(vitest|npm (run )?(test|build|typecheck|lint|format)|npm test|tsc|tsup|eslint|prettier|node )"; then
        echo "[PostToolUse] Build/test command ran. Update the active task tracker if this completed or advanced a subtask, and confirm the green gate (tests/typecheck/lint)."
        exit 0
    fi
fi
