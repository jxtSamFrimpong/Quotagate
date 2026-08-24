// WS_10 T2 / exp02_hello_server.mjs — minimal stdio MCP server exposing ONE echo tool.
//
// Purpose: prove Direction-B topology (Quotagate hosts the tool server; Claude Code
// consumes it). This is evidence, not product — the follow-on workstream re-authors it
// as src/mcp/toolServer.ts (WS_10-D1).
//
// Usage: node spikes/mcp_feasibility/exp/exp02_hello_server.mjs

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const server = new McpServer({
  name: 'ws10-hello-server',
  version: '0.0.1',
});

server.registerTool(
  'ws10_hello_echo',
  {
    title: 'Hello Echo',
    description:
      'Echoes back the provided text. Used by the WS_10 feasibility investigation to ' +
      'prove a custom MCP tool server can be registered with and invoked by Claude Code.',
    inputSchema: { text: z.string().describe('Text to echo back verbatim') },
  },
  async ({ text }) => ({
    content: [{ type: 'text', text: `ECHO:${text}` }],
  }),
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error('[ws10-hello-server] ready on stdio');
