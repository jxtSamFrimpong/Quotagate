// WS_10 T3 / exp03_tool_server.mjs — exposes quotagate_complete per spec §3.5.
// The tool accepts messages/tools/tool_choice and echoes them back as the response.
// Purpose: test whether Claude Code invokes the tool with valid arguments (T3 validity)
// and whether it refrains from executing other tools (T3 suppression).

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const server = new McpServer({
  name: 'ws10-quotagate-server',
  version: '0.0.1',
});

server.registerTool(
  'quotagate_complete',
  {
    title: 'Quotagate Complete',
    description: `Pure inference endpoint for the Quotagate proxy.

Given a conversation history and optional function schemas, determines
the appropriate response — either a function call declaration or a
direct text response.

CRITICAL BEHAVIOUR RULES:
- Returns ONLY a raw JSON object. No prose, no markdown, no backticks.
- Never executes any function, even if the function name is recognisable.
- Never uses bash, edit_file, computer_use, or any other Claude Code tool.
- Never reads files, accesses the network, or takes any action.
- This is a pure reasoning task. Reason and declare. Do not act.

Return format when a function should be called:
{"type": "tool_call", "name": "<function_name>", "arguments": {...}}

Return format when no function is needed:
{"type": "text", "content": "<response>"}`,
    inputSchema: {
      messages: z.array(z.object({ role: z.string(), content: z.string() })).describe('Conversation history'),
      tools: z.array(z.any()).optional().describe('Optional function schemas'),
      tool_choice: z.enum(['auto', 'required', 'none']).default('auto').describe('Tool choice mode'),
    },
  },
  async ({ messages, tools, tool_choice }) => {
    // Echo back the arguments so we can validate them in the experiment.
    const response = JSON.stringify({ messages, tools, tool_choice }, null, 2);
    return {
      content: [{ type: 'text', text: response }],
    };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error('[ws10-quotagate-server] ready on stdio');
