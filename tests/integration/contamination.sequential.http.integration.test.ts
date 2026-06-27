import { afterAll, beforeAll, describe, it, expect, vi } from 'vitest';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import OpenAI, { APIError } from 'openai';
import type { ChatCompletion } from 'openai/resources/chat/completions';
import { loadConfig } from '../../src/config.js';
import { createServer } from '../../src/proxy.js';
import { ClaudeAdapter } from '../../src/adapters/claude.js';
import type { CLIAdapter } from '../../src/adapters/base.js';

// Absolute path to the config fixture, resolved relative to this file rather than
// process.cwd() — guards against any Vitest working-directory variation. Mirrors the
// e2e.noTools.test.ts fixture so both describes load model `claude-sonnet-4-6` and
// retry.max_attempts = 3.
const FIXTURE_CONFIG_PATH = fileURLToPath(
  new URL('../../tests/fixtures/config.minimal.yaml', import.meta.url),
);

// WS_03-D3: fixed UUID constant — never crypto.randomUUID(). This is the code word
// call A asks Claude to remember; call B must show no trace of it, proving the full
// HTTP stack (proxy.ts → router.ts → ClaudeAdapter → subprocess) is stateless per
// request (invariants #3, #10). Deliberately DIFFERENT from the WS_03 adapter-level
// token (8f3a1c2d-…) and reserved away from T2/T3 so a cross-file leak could never be
// masked by a shared value. Do not change without updating the decision log.
const TOKEN = 'a1b2c3d4-5e6f-4a7b-8c9d-0e1f2a3b4c5d';

// ---------------------------------------------------------------------------
// Describe 1 — sequential contamination over the full HTTP path (live-Claude)
// ---------------------------------------------------------------------------
describe('sequential contamination (HTTP path)', () => {
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

  it(
    'T-1: call B response contains no trace of call A token (full HTTP stack)',
    // Two serial subprocess spawns under concurrent fork pressure — matches the
    // WS_03 adapter-level file's empirically-tuned 90 s budget (~45 s per call).
    { timeout: 90_000 },
    async (ctx) => {
      // EF1: skip the live-Claude case when the CLI is unavailable.
      if (adapter === null || !(await adapter.healthCheck())) {
        ctx.skip();
        return;
      }

      // Call A: inject the TOKEN into the conversation context over the HTTP path.
      const responseA: ChatCompletion = await client!.chat.completions.create({
        model: 'claude-sonnet-4-6',
        messages: [
          {
            role: 'user',
            content: `Remember this code word for later: ${TOKEN}. Acknowledge you have noted it.`,
          },
        ],
      });

      // Parse-guard at the HTTP layer (EF2): the OpenAI SDK already validated the
      // chat.completion shape, so a non-empty string content is the equivalent guard —
      // a broken constraint fails here, not at the TOKEN assertion below.
      const contentA = responseA.choices[0]?.message.content;
      expect(typeof contentA, 'Call A returned no string content').toBe('string');
      expect(contentA!.length, 'Call A returned empty content').toBeGreaterThan(0);

      // Call B: unrelated arithmetic probe with no path to the TOKEN or to call A.
      const responseB: ChatCompletion = await client!.chat.completions.create({
        model: 'claude-sonnet-4-6',
        messages: [{ role: 'user', content: 'What is 2 plus 2? Reply with just the number.' }],
      });

      const contentB = responseB.choices[0]?.message.content;
      expect(typeof contentB, 'Call B returned no string content').toBe('string');

      // Contamination assertion: the TOKEN must be absent from call B's response.
      expect(contentB, 'TOKEN found in Call B response — contamination detected').not.toContain(
        TOKEN,
      );
    },
  );
});

// ---------------------------------------------------------------------------
// Describe 2 — retry-exhaustion surfaces as an OpenAI SDK APIError (deterministic)
// ---------------------------------------------------------------------------
describe('retry-exhaustion SDK surface', () => {
  let server: FastifyInstance | null = null;
  let client: OpenAI | null = null;

  // Injected adapter double — returns malformed JSON on every call, so the proxy's
  // validateWithRetry exhausts all 3 attempts (retry.max_attempts = 3) and the route
  // throws a ValidationError → HTTP 500. No live dependency; this case never skips.
  const stubAdapter = {
    name: 'stub-claude',
    complete: vi.fn(),
    healthCheck: vi.fn(),
    install: vi.fn(),
  } satisfies CLIAdapter;

  beforeAll(async () => {
    vi.clearAllMocks();
    stubAdapter.complete.mockResolvedValue({ raw: 'not json', backend: 'claude-subprocess' });

    const config = loadConfig(FIXTURE_CONFIG_PATH);
    server = createServer(config, { claude: stubAdapter });

    const addr = await server.listen({ port: 0, host: '127.0.0.1' });
    const port = parseInt(new URL(addr).port, 10);

    // maxRetries: 0 — the OpenAI SDK retries 5xx responses up to 2× by default, which
    // would multiply the proxy's own 3 retry attempts and break the "exactly 3 times"
    // assertion below. Disabling SDK-side retries isolates the proxy's retry mechanic
    // (WS_08-D4) as the only source of repeated adapter.complete() calls.
    client = new OpenAI({
      baseURL: `http://127.0.0.1:${port}/v1`,
      apiKey: 'not-used',
      maxRetries: 0,
    });
  });

  afterAll(async () => {
    if (server !== null) {
      await server.close();
    }
  });

  it('T-2: 3× malformed → SDK surfaces a 500 APIError with the OpenAI error envelope', async () => {
    const err = await client!.chat.completions
      .create({ model: 'claude-sonnet-4-6', messages: [{ role: 'user', content: 'Test' }] })
      .then(
        () => {
          throw new Error('Expected create() to reject with an APIError, but it resolved');
        },
        (e: unknown) => e,
      );

    // The SDK maps the non-2xx response to an APIError carrying the parsed body.
    expect(err).toBeInstanceOf(APIError);
    const apiErr = err as APIError;

    // Stable facts (EF3): status 500 + OpenAI envelope present, asserted first.
    expect(apiErr.status).toBe(500);

    // `err.error` is the body's `error` object: { message, type, code }. The SDK
    // populates `err.code`/`err.type` from it (see openai/core/error.js).
    expect(apiErr.code).toBe('validation_error');
    expect(apiErr.type).toBe('validation_error');

    const envelope = apiErr.error as Record<string, unknown> | undefined;
    expect(envelope, 'OpenAI error envelope missing from APIError').toBeDefined();
    expect(envelope!['code']).toBe('validation_error');
    expect(envelope!['type']).toBe('validation_error');
    expect(typeof envelope!['message']).toBe('string');
    expect((envelope!['message'] as string).length).toBeGreaterThan(0);

    // Invariant #5: no stack trace leaks into the surfaced body.
    expect(envelope!['stack']).toBeUndefined();

    // WS_08-D4: retry.max_attempts = 3 (from the fixture) drives exactly 3 adapter
    // calls through the SDK surface — same wiring proven at proxy level in proxy.test.ts.
    expect(stubAdapter.complete).toHaveBeenCalledTimes(3);
  });
});
