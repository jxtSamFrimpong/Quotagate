import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import OpenAI from 'openai';
import type { ChatCompletion } from 'openai/resources/chat/completions';
import { loadConfig } from '../../src/config.js';
import { createServer } from '../../src/proxy.js';
import { ClaudeAdapter } from '../../src/adapters/claude.js';

// Absolute path to the config fixture, resolved relative to this file rather than
// process.cwd() — guards against any Vitest working-directory variation. Mirrors the
// e2e.noTools.test.ts / contamination.sequential.http fixture so the server loads model
// `claude-sonnet-4-6` and retry.max_attempts = 3.
const FIXTURE_CONFIG_PATH = fileURLToPath(
  new URL('../../tests/fixtures/config.minimal.yaml', import.meta.url),
);

// WS_03-D3 (D2): fixed UUID code words — never crypto.randomUUID() at runtime. Each
// concurrent request injects its OWN word and asks Claude to echo it; the response for
// each side must carry its own word and NO trace of the other's, proving the full HTTP
// stack (proxy.ts → router.ts → ClaudeAdapter → subprocess) holds no cross-request state
// under parallelism (invariants #3, #10, #11). Both constants are deliberately DISTINCT
// from each other, from the sequential file's TOKEN (a1b2c3d4-…), and from the WS_03
// adapter-level token (8f3a1c2d-…), so a cross-file leak could never be masked by a
// shared value. Do not change without updating the decision log.
const CW_A = 'c4d5e6f7-1a2b-4c3d-8e4f-5a6b7c8d9e0f';
const CW_B = 'd5e6f7a8-2b3c-4d5e-9f6a-7b8c9d0e1f2a';

describe('concurrent contamination (HTTP path)', () => {
  let server: FastifyInstance | null = null;
  let adapter: ClaudeAdapter | null = null;
  let client: OpenAI | null = null;

  beforeAll(async () => {
    const config = loadConfig(FIXTURE_CONFIG_PATH);
    adapter = new ClaudeAdapter();
    server = createServer(config, { claude: adapter });

    // listen({ port: 0 }) returns a URL string in Fastify v5 — not a number.
    const addr = await server.listen({ port: 0, host: '127.0.0.1' });
    const port = parseInt(new URL(addr).port, 10);

    client = new OpenAI({ baseURL: `http://127.0.0.1:${port}/v1`, apiKey: 'not-used' });
  });

  afterAll(async () => {
    // Guard against beforeAll failing before listen() — server may still be null.
    if (server !== null) {
      await server.close();
    }
  });

  // SC-4 — Why this test exists and what it guards:
  // On the `claude --print` subprocess transport, each HTTP request spawns a fresh OS
  // process that exits after one response — no shared session/buffer/in-memory state.
  // This test is the regression guard for Phase 2's MCP upgrade, which must re-earn this
  // isolation via `_mcp_lock` serialization + fresh-context-per-call (invariants #10/#11).
  //
  // Scope (D3): this asserts ISOLATION, not true OS-level simultaneity (EF2). The two
  // `create()` calls are issued via Promise.all so Fastify handles them as an OpenAI SDK
  // client would under load, but one subprocess may finish before the other's request
  // reaches the route handler — that is acceptable; on this transport isolation holds
  // regardless of overlap. No timing/simultaneity assertions are made here.
  it(
    'T-1: two concurrent create() calls each return only their own code word',
    // Two subprocess spawns overlap, so wall-clock ≈ a single call plus scheduling under
    // fork-pool pressure — but reuse the sequential file's empirically-tuned 90 s budget.
    { timeout: 90_000 },
    async (ctx) => {
      // EF1: skip the live-Claude case when the CLI is unavailable.
      if (adapter === null || !(await adapter.healthCheck())) {
        ctx.skip();
        return;
      }

      // A2: a short echo instruction is reliable instruction-following with low retry risk.
      const [resA, resB] = await Promise.all([
        client!.chat.completions.create({
          model: 'claude-sonnet-4-6',
          messages: [
            {
              role: 'user',
              content: `Reply with exactly this code word and nothing else: ${CW_A}`,
            },
          ],
        }),
        client!.chat.completions.create({
          model: 'claude-sonnet-4-6',
          messages: [
            {
              role: 'user',
              content: `Reply with exactly this code word and nothing else: ${CW_B}`,
            },
          ],
        }),
      ]);

      const responseA: ChatCompletion = resA;
      const responseB: ChatCompletion = resB;

      const contentA = responseA.choices[0]?.message.content;
      const contentB = responseB.choices[0]?.message.content;

      // Own-content guard (D1, SC-1): proves neither side returned an empty/error body, so
      // the no-cross-content assertions below cannot pass vacuously, and proves no
      // request-swap occurred under concurrency.
      expect(typeof contentA, 'Call A returned no string content').toBe('string');
      expect(contentA!.length, 'Call A returned empty content').toBeGreaterThan(0);
      expect(contentA, 'Call A response is missing its own code word CW_A').toContain(CW_A);

      expect(typeof contentB, 'Call B returned no string content').toBe('string');
      expect(contentB!.length, 'Call B returned empty content').toBeGreaterThan(0);
      expect(contentB, 'Call B response is missing its own code word CW_B').toContain(CW_B);

      // No-cross-content (D1, SC-2): each response must show no trace of the other request's
      // code word. EF3 — a hit here is a real contamination signal, not test noise.
      expect(contentA, 'CW_B leaked into Call A response — contamination detected').not.toContain(
        CW_B,
      );
      expect(contentB, 'CW_A leaked into Call B response — contamination detected').not.toContain(
        CW_A,
      );
    },
  );
});
