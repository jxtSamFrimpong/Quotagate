import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { loadConfig } from '../../src/config.js';
import { createServer } from '../../src/proxy.js';
import { ClaudeAdapter } from '../../src/adapters/claude.js';

// Absolute path to the config fixture, resolved relative to this file rather than
// process.cwd() — guards against any Vitest working-directory variation (EF4).
const FIXTURE_CONFIG_PATH = fileURLToPath(
  new URL('../../tests/fixtures/config.minimal.yaml', import.meta.url),
);

let server: FastifyInstance | null = null;
let adapter: ClaudeAdapter | null = null;
let port: number = 0;

// D1: Separate file with its own fixture — error-path tests must not serialize behind
// the slow 60s happy-path test in e2e.noTools.test.ts. These tests complete in <1s
// (both guards fire before adapter.complete() is called, so no subprocess is spawned).

describe('e2e error paths', () => {
  beforeAll(async () => {
    const config = loadConfig(FIXTURE_CONFIG_PATH);
    adapter = new ClaudeAdapter();
    server = createServer(config, adapter);

    // Fastify v5 listen() returns a URL string — extract port from it.
    const addr = await server.listen({ port: 0, host: '127.0.0.1' });
    port = parseInt(new URL(addr).port, 10);
  });

  afterAll(async () => {
    // Null-guard: beforeAll may fail before listen() sets server.
    if (server !== null) {
      await server.close();
    }
  });

  it(
    'T-3a: stream: true returns HTTP 400 with streaming_not_supported',
    // D3: 10s timeout — if this exceeds 10s the stream guard is NOT firing (the
    // request entered the adapter pipeline), which indicates a bug in proxy.ts.
    { timeout: 10_000 },
    async (ctx) => {
      // A1: guard fires before adapter.complete(), so healthCheck() determines
      // only whether the adapter binary is available — not whether subprocess
      // is invoked for this request.
      if (adapter === null || !(await adapter.healthCheck())) {
        ctx.skip();
        return;
      }

      // D2: raw fetch — avoids TypeScript overload complications on the stream
      // path and directly asserts the HTTP boundary contract.
      const response = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          messages: [{ role: 'user', content: 'Hello' }],
          stream: true,
        }),
      });

      // SC-1
      expect(response.status).toBe(400);
      expect(response.headers.get('content-type')).toContain('application/json');

      // A2: Fastify auto-serializes the send({ error: {...} }) call to JSON.
      const body = (await response.json()) as {
        error: { message: string; type: string; code: string };
      };

      // SC-2: exact match — the string in proxy.ts lines 103 is the locked value (EF2).
      expect(body.error.message).toBe('Streaming is not supported');
      // SC-3
      expect(body.error.code).toBe('streaming_not_supported');
      expect(body.error.type).toBe('invalid_request_error');
    },
  );

  it(
    'T-3b: unknown model returns HTTP 400 with model_not_supported',
    { timeout: 10_000 },
    async (ctx) => {
      if (adapter === null || !(await adapter.healthCheck())) {
        ctx.skip();
        return;
      }

      // A3: 'not-a-real-model' is absent from config.minimal.yaml by construction —
      // the fixture only registers 'claude-sonnet-4-6'.
      const response = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'not-a-real-model',
          messages: [{ role: 'user', content: 'Hello' }],
        }),
      });

      // SC-4
      expect(response.status).toBe(400);
      expect(response.headers.get('content-type')).toContain('application/json');

      // EF3: The message includes the variable model name — do not assert the exact
      // message string. Assert only the stable code field.
      const body = (await response.json()) as {
        error: { message: string; type: string; code: string };
      };

      // SC-5
      expect(body.error.code).toBe('model_not_supported');
      expect(body.error.type).toBe('invalid_request_error');
    },
  );
});
