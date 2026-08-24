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

## Surface-by-surface results (OD-1 evidence feed, 2026-08-24)

| Surface | Command shape | Scriptable | Connect | List | Invoke | Reversible | Blast radius |
| --- | --- | --- | --- | --- | --- | --- | --- |
| A `--mcp-config` (+`--strict-mcp-config`) | flag on invocation | ✅ trivially (per-invocation) | ✓ | ✓ | ECHO:SURFACE-A-MARKER | ✅ zero persistence | none |
| B project `.mcp.json` in cwd | file drop | ✅ | ✓ | ✓ | ECHO:SURFACE-B-MARKER | ✅ delete file | cwd-only; approval gate bypassed by --allowedTools |
| C `mcp add -s local` | one command → ~/.claude.json projects[cwd] | ✅ | ✓ | ✓ | ECHO:SURFACE-C-LOCAL-MARKER | ✅ `claude mcp remove -s local` | per-project entry in global file |
| D `mcp add -s user` | one command → ~/.claude.json top-level | ✅ | ✓ | ✓ | ECHO:SURFACE-D-USER-MARKER (foreign cwd) | ✅ `claude mcp remove -s user` | GLOBAL — every project |
| E `mcp add -s project` | one command → ./.mcp.json | ✅ | ✓ | ✓ | ECHO:SURFACE-E-PROJECT-MARKER | ✅ delete file + remove | cwd-only via committed file |

## Drive result (A2)
10/10 turns on ONE persistent headless session (`--input-format stream-json`), p50 5785ms/turn,
clean exit code 0, tracked pid confirmed gone. Artifact: exp02-drive-2026-08-24.log.

## Headline findings for T3–T6 / installer design
1. Mechanism-B topology PROVEN end-to-end: Quotagate-hosted tool server consumed by headless Claude.
2. `claude mcp serve` exposes ONLY built-in execution tools — spec §4.1 literal reading is unusable
   (invariant #1); amendment proposal required.
3. Warm-turn latency (~5.8s) ≈ cold-spawn round-trip (~4.9–5.2s): the D-TRANSPORT win is NOT raw
   latency on this machine — it is session persistence/structure. T5 must quantify carefully.
4. --allowedTools grants headless approval past project-scope pending gates (EF2 mitigation proven).
5. All five surfaces scriptable + reversible; OD-1 adjudication material complete.
