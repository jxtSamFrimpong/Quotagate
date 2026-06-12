import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import OpenAI from 'openai';
import type { ChatCompletion } from 'openai/resources/chat/completions';
import { loadConfig } from '../../src/config.js';
import { createServer } from '../../src/proxy.js';
import { ClaudeAdapter } from '../../src/adapters/claude.js';

// Absolute path to the config fixture, resolved relative to this file rather than
// process.cwd() — guards against any Vitest working-directory variation (EF1).
const FIXTURE_CONFIG_PATH = fileURLToPath(
  new URL('../../tests/fixtures/config.minimal.yaml', import.meta.url),
);

let server: FastifyInstance | null = null;
let adapter: ClaudeAdapter | null = null;
let port: number = 0;
let client: OpenAI | null = null;

describe('e2e no-tools', () => {
  beforeAll(async () => {
    const config = loadConfig(FIXTURE_CONFIG_PATH);
    adapter = new ClaudeAdapter();
    server = createServer(config, adapter);

    // EF2: listen({ port: 0 }) returns a URL string in Fastify v5 — not a number.
    const addr = await server.listen({ port: 0, host: '127.0.0.1' });
    port = parseInt(new URL(addr).port, 10);

    const baseURL = `http://127.0.0.1:${port}/v1`;
    client = new OpenAI({ baseURL, apiKey: 'not-used' });
  });

  afterAll(async () => {
    // EF4: guard against beforeAll failing before listen() — server may still be null.
    if (server !== null) {
      await server.close();
    }
  });

  it(
    'T-1: fixture smoke: server is TCP-reachable',
    // Same 60 s budget as the other integration tests — healthCheck() + subprocess
    // cold-start both contribute to the wall-clock cost here.
    { timeout: 60_000 },
    async (ctx) => {
      if (adapter === null || !(await adapter.healthCheck())) {
        ctx.skip();
        return;
      }

      // Raw fetch — any HTTP status is acceptable; we only care that the TCP connection
      // succeeded (no TypeError) and a JSON body is returned.
      const response = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          messages: [{ role: 'user', content: 'ping' }],
        }),
      });

      expect(response.headers.get('content-type')).toContain('application/json');
    },
  );

  it('T-2: happy path — full Phase 1B stack, six assertions', { timeout: 60_000 }, async (ctx) => {
    if (adapter === null || !(await adapter.healthCheck())) {
      ctx.skip();
      return;
    }

    // client is non-null here: beforeAll set it after listen() succeeded
    const response: ChatCompletion = await client!.chat.completions.create({
      model: 'claude-sonnet-4-6',
      messages: [{ role: 'user', content: 'Hello' }],
    });

    // SC-1: finish_reason
    expect(response.choices[0].finish_reason).toBe('stop');
    // SC-2: role
    expect(response.choices[0].message.role).toBe('assistant');
    // SC-3: content is a non-empty string
    expect(typeof response.choices[0].message.content).toBe('string');
    expect(response.choices[0].message.content!.length).toBeGreaterThan(0);
    // SC-4: id prefix
    expect(response.id).toMatch(/^chatcmpl-/);
    // SC-5: object type
    expect(response.object).toBe('chat.completion');
    // SC-6: usage is absent (never fabricated — spec §7.4)
    expect(response.usage).toBeUndefined();
  });
});
