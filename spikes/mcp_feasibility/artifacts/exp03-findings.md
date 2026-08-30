# WS_10 T3 — Constraint Quality Probes (2026-08-30)

## Test Evolution

### Initial Test (without CLAUDE.md, without stream parsing)
- Validity: 3/30 (10%) - FAIL
- Issue: Test only checked final result text, not tool_use events in stream
- Claude answered in prose instead of calling the tool

### With CLAUDE.md (still without stream parsing)
- Validity: 2/30 (6.7%) - FAIL
- Claude WAS calling the tool (visible in prose responses), but test couldn't detect it
- Tool calls were happening but not captured in final result text

### Fixed Test (with CLAUDE.md + stream parsing for tool_use events)
- **Validity: 30/30 (100%) - PASS ✅**
- **Suppression: 10/10 (100%) - PASS ✅**
- Test now correctly detects tool_use events in the stream-json output
- Every validity probe resulted in a proper tool call with the marker
- Zero attempts to execute read_file

## Key Findings

1. **CLAUDE.md Layer 1 is essential**: Without it, Claude prefers to answer in prose rather than call the tool. With it, tool invocation is 100% reliable.

2. **Stream parsing is critical**: The tool calls happen, but they're not visible in the final result text. We must parse the stream for `tool_use` events to detect them.

3. **Full Mechanism B works**: The three-layer constraint stack (CLAUDE.md + tool definition + tool arguments) functions exactly as designed in the spec.

4. **Suppression is perfect**: Zero attempts to execute other tools, even when explicitly instructed to do so.

## Verdict

- **A3: PASS** (100% ≥ 90% threshold)
- **A4: PASS** (zero executions)
- **Mechanism B is viable** with full three-layer constraint stack
- **GO verdict is achievable** pending T4 (statefulness/serialization) results
