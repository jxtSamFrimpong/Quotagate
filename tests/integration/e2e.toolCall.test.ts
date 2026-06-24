import { afterAll, afterEach, beforeAll, describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { existsSync, rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import OpenAI from 'openai';
import type { ChatCompletion } from 'openai/resources/chat/completions';
import { loadConfig } from '../../src/config.js';
import { createServer } from '../../src/proxy.js';
import { ClaudeAdapter } from '../../src/adapters/claude.js';

const FIXTURE_CONFIG_PATH = fileURLToPath(
  new URL('../../tests/fixtures/config.minimal.yaml', import.meta.url),
);

let server: FastifyInstance | null = null;
let adapter: ClaudeAdapter | null = null;
let port: number = 0;
let client: OpenAI | null = null;

describe('e2e tool-calls', () => {
  beforeAll(async () => {
    const config = loadConfig(FIXTURE_CONFIG_PATH);
    adapter = new ClaudeAdapter();
    server = createServer(config, { claude: adapter });

    const addr = await server.listen({ port: 0, host: '127.0.0.1' });
    port = parseInt(new URL(addr).port, 10);

    client = new OpenAI({ baseURL: `http://127.0.0.1:${port}/v1`, apiKey: 'not-used' });
  });

  afterAll(async () => {
    if (server !== null) {
      await server.close();
    }
  });

  let tempPath: string = '';

  afterEach(() => {
    if (tempPath) {
      rmSync(tempPath, { force: true });
      tempPath = '';
    }
  });

  it(
    'T-a: get_weather happy path — finish_reason:tool_calls, function name, parseable arguments',
    { timeout: 60_000 },
    async (ctx) => {
      if (adapter === null || !(await adapter.healthCheck())) {
        ctx.skip();
        return;
      }

      const response: ChatCompletion = await client!.chat.completions.create({
        model: 'claude-sonnet-4-6',
        messages: [
          { role: 'user', content: 'What is the weather in Accra? Use the get_weather tool.' },
        ],
        tools: [
          {
            type: 'function',
            function: {
              name: 'get_weather',
              description: 'Get the current weather for a city',
              parameters: {
                type: 'object',
                properties: { city: { type: 'string', description: 'The city name' } },
                required: ['city'],
              },
            },
          },
        ],
        tool_choice: 'auto',
      });

      // SC-1
      expect(response.choices[0].finish_reason).toBe('tool_calls');
      // SC-2
      expect(response.choices[0].message.content).toBeNull();
      // SC-3
      expect(response.choices[0].message.tool_calls).toHaveLength(1);
      expect(response.choices[0].message.tool_calls![0].function.name).toBe('get_weather');
      // SC-4: arguments deserialise to a plain object without throwing
      expect(() =>
        JSON.parse(response.choices[0].message.tool_calls![0].function.arguments),
      ).not.toThrow();
      expect(typeof JSON.parse(response.choices[0].message.tool_calls![0].function.arguments)).toBe(
        'object',
      );
    },
  );

  it(
    'T-b: write_file absence-of-side-effect — invariant #1 proof (proxy never executes tool calls)',
    { timeout: 60_000 },
    async (ctx) => {
      if (adapter === null || !(await adapter.healthCheck())) {
        ctx.skip();
        return;
      }

      tempPath = '/tmp/quotagate-invariant1-' + randomUUID();

      const response: ChatCompletion = await client!.chat.completions.create({
        model: 'claude-sonnet-4-6',
        messages: [{ role: 'user', content: `Write the text "hello" to the file ${tempPath}.` }],
        tools: [
          {
            type: 'function',
            function: {
              name: 'write_file',
              description: 'Write content to a file',
              parameters: {
                type: 'object',
                properties: {
                  path: { type: 'string', description: 'The file path' },
                  content: { type: 'string', description: 'The content to write' },
                },
                required: ['path', 'content'],
              },
            },
          },
        ],
        tool_choice: 'auto',
      });

      // SC-5
      expect(response.choices[0].finish_reason).toBe('tool_calls');
      expect(response.choices[0].message.tool_calls![0].function.name).toBe('write_file');
      // SC-6: invariant #1 — the proxy declared the call but did NOT execute it
      expect(existsSync(tempPath)).toBe(false);
    },
  );
});
