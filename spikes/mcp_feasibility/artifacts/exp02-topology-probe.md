# WS_10 T2 / exp02 — IQ-1 topology reconciliation probe (2026-08-24)

## Preconditions
- CLI version re-recorded: 2.1.240 (Claude Code) — unchanged from T1 (EF7 clear).
- Live subscription confirmed reset: `claude --print "Reply with the word OK."` → "OK".
- Pre-existing user-level registrations observed via `claude mcp list`: notion (HTTP, needs auth),
  azure-devops (npx, connected). D3 config-mutation protocol mandatory; cleanup must not
  disturb these.

## Spec §3.8 verbatim excerpt (docs/schematics/quotagate-spec.md ~lines 402–451)
```python
result = await self.mcp_client.call_tool(
    "quotagate_complete",
    {"messages": messages, "tools": tools, "tool_choice": tool_choice}
)
```
(with `_complete_via_mcp` calling it over a persistent connection, `backend="claude-mcp"`)

This sketch reads naturally in EITHER direction:
- Direction A (spec §3.1/§4.1 literal): Claude Code runs AS the MCP server
  (`claude mcp serve`, found in T1); Quotagate is the MCP client.
- Direction B (Mechanism B, §3.2): Quotagate hosts the `quotagate_complete`
  tool server; a headless Claude Code session consumes it.

## Probe result: `claude mcp serve` (Direction A)
JSON-RPC initialize handshake succeeded:
  {"result":{"protocolVersion":"2024-11-05","capabilities":{"tools":{}},
   "serverInfo":{"name":"claude/tengu","version":"2.1.240"}}}
`tools/list` returned ONLY Claude Code built-ins (Agent/Task, Bash, Read, ...).

## Finding
Direction A exposes Claude's own execution tools — there is NO quotagate_complete
tool and no mechanism shown to register a custom tool into serve-mode. Consuming this
topology would hand the proxy an EXECUTION surface (invariant #1 violation: the proxy
must never execute tool calls) and no structured-response channel.

**Working topology for T2 remainder (Direction B / Mechanism B)**: Quotagate hosts the
quotagate_complete tool server; a persistent headless Claude Code session is registered
to consume it. To be proven by the registration surfaces below.
