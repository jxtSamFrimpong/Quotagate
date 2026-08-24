import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import type { ChatCompletion } from 'openai/resources/chat/completions';
import { loadConfig } from '../../src/config.js';
import { createServer } from '../../src/proxy.js';
import type { CLIAdapter } from '../../src/adapters/base.js';

// Absolute path to the config fixture, resolved relative to this file rather than
// process.cwd() — guards against any Vitest working-directory variation. Mirrors the
// e2e.noTools.test.ts / contamination.sequential.http fixture so the server loads model
// `claude-sonnet-4-6` and retry.max_attempts = 3.
const FIXTURE_CONFIG_PATH = fileURLToPath(
  new URL('../../tests/fixtures/config.minimal.yaml', import.meta.url),
);

// WS_03-D3: fixed UUID content constants — never crypto.randomUUID() at runtime. Request
// A resolves on attempt 2 carrying ALPHA-…; request B must carry BRAVO-… and NO trace of
// ALPHA-…, proving the error/retry branch of validateWithRetry resets context across
// requests. Both constants are deliberately DISTINCT from each other, from the sequential
// HTTP file's TOKEN (a1b2c3d4-…), from the concurrent file's code words (c4d5e6f7-/d5e6f7a8-…),
// and from the WS_03 adapter-level token (8f3a1c2d-…), so a cross-file leak could never be
// masked by a shared value. Do not change without updating the decision log.
const CONTENT_A = 'ALPHA-f6a7b8c9-d0e1-4f2a-b3c4-d5e6f7a8b9c0';
const CONTENT_B = 'BRAVO-a9b0c1d2-e3f4-4a5b-8c6d-7e8f9a0b1c2d';

// Locked wording prefix of validator.ts's CORRECTION_NOTE — load-bearing: the retry-path
// assertions prove the note EXISTS on A's attempt-2 input, which makes its absence from
// B's input and response meaningful rather than vacuous.
const CORRECTION_NOTE_PREFIX = 'The previous response was not valid JSON';

// SC-4 — Why this test exists and what it guards:
// On the happy path, each request's messages flow straight through buildAdapterRequest;
// on the ERROR/RETRY path, validateWithRetry appends CORRECTION_NOTE to a rebuilt
// [...original, note] array and feeds it back through complete() — the exact surface
// D-1C-02 names as the contamination risk. This test drives that branch deterministically
// (one vi.fn() double services A ×2 then B ×1; no subprocess spawns) and asserts B's
// complete() input and B's HTTP response carry no trace of A's correction context,
// proving the fresh-process-per-request transport resets state across requests
// (invariants #3, #10). It is the regression guard for Phase 2's MCP upgrade, which must
// re-earn this isolation via `_mcp_lock` serialization + fresh-context-per-call when a
// persistent session could re-introduce the leak (invariants #10/#11).
describe('retry-path contamination (same double drives A and B)', () => {
  // Injected adapter double — OD-1 option (a): the SAME double services request A (×2)
  // and request B (×1), sequenced with exactly three returns below. D2: no healthCheck()
  // skip guard — there is no live dependency, so this case runs unconditionally.
  const stubAdapter = {
    name: 'stub-claude',
    complete: vi.fn(),
    healthCheck: vi.fn(),
    install: vi.fn(),
  } satisfies CLIAdapter;

  let server: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    server = createServer(loadConfig(FIXTURE_CONFIG_PATH), { claude: stubAdapter });

    // D1 — sequenced returns:
    //   Call 1 (A, attempt 1): malformed raw → real JSON.parse failure inside
    //     parseAndValidate → real ValidationError → genuine retry path (EF2).
    //   Call 2 (A, attempt 2): valid text result → A resolves with CONTENT_A.
    //   Call 3 (B, attempt 1): valid text result → B resolves with CONTENT_B.
    stubAdapter.complete
      .mockResolvedValueOnce({ raw: 'not json', backend: 'claude-subprocess' })
      .mockResolvedValueOnce({
        raw: JSON.stringify({ type: 'text', content: CONTENT_A }),
        backend: 'claude-subprocess',
      })
      .mockResolvedValueOnce({
        raw: JSON.stringify({ type: 'text', content: CONTENT_B }),
        backend: 'claude-subprocess',
      });
  });

  afterEach(async () => {
    await server.close();
  });

  it('T-1: A resolves on retry (attempt 2); B receives only its own messages and response', async () => {
    // POST A — malformed first response forces the real retry; must resolve on attempt 2.
    const resA = await server.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      payload: {
        model: 'claude-sonnet-4-6',
        messages: [{ role: 'user', content: 'Request A' }],
      },
      headers: { 'content-type': 'application/json' },
    });

    // SC-1: A resolves on attempt 2 — 200 with a valid chat.completion carrying CONTENT_A.
    expect(resA.statusCode).toBe(200);
    const bodyA = resA.json<ChatCompletion>();
    expect(bodyA.object).toBe('chat.completion');
    expect(bodyA.choices[0].message.role).toBe('assistant');
    expect(bodyA.choices[0].message.content).toBe(CONTENT_A);

    // POST B — unrelated follow-up request serviced by the same double.
    const resB = await server.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      payload: {
        model: 'claude-sonnet-4-6',
        messages: [{ role: 'user', content: 'Request B' }],
      },
      headers: { 'content-type': 'application/json' },
    });

    // SC-2(c) contract half: B resolves cleanly with its own content.
    expect(resB.statusCode).toBe(200);
    const bodyB = resB.json<ChatCompletion>();
    expect(bodyB.object).toBe('chat.completion');
    expect(bodyB.choices[0].message.content).toBe(CONTENT_B);

    // SC-3: exactly 3 adapter calls total — A consumed two (retry), B consumed one.
    expect(stubAdapter.complete).toHaveBeenCalledTimes(3);

    // SC-2(a) precondition / EF2 integrity: the retry GENUINELY ran. A's attempt-2 call
    // received [origA, CORRECTION_NOTE] — proving the note existed and could have leaked.
    const aRetryCall = stubAdapter.complete.mock.calls[1][0] as {
      messages: Array<{ role: string; content: string | null }>;
    };
    expect(aRetryCall.messages).toHaveLength(2);
    expect(aRetryCall.messages[0]?.content).toBe('Request A');
    expect(aRetryCall.messages[1]?.role).toBe('user');
    expect(aRetryCall.messages[1]?.content ?? '').toMatch(new RegExp(`^${CORRECTION_NOTE_PREFIX}`));

    // SC-2(a)+(b) — THE contamination assertion: B's complete() input is exactly B's
    // original messages — no A history, no correction note. A shared-array mutation leak
    // (A1 false) or a closure leak (A2 false) fails here loudly; do NOT soften.
    const bCall = stubAdapter.complete.mock.calls[2][0] as {
      messages: Array<{ role: string; content: string | null }>;
    };
    expect(bCall.messages).toEqual([{ role: 'user', content: 'Request B' }]);
    expect(
      bCall.messages.some(
        (m) => typeof m.content === 'string' && m.content.startsWith(CORRECTION_NOTE_PREFIX),
      ),
    ).toBe(false);

    // SC-2(b) response-side guard: B's HTTP body carries no CORRECTION_NOTE prefix and
    // no trace of A's content — no module-level state survived across requests (A3).
    const bodyBString = resB.body;
    expect(bodyBString).toContain(CONTENT_B);
    expect(bodyBString).not.toContain(CORRECTION_NOTE_PREFIX);
    expect(bodyBString).not.toContain(CONTENT_A);
  });
});
