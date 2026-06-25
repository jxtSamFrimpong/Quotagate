import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { FastifyInstance } from 'fastify';
import type { ChatCompletion } from 'openai/resources/chat/completions';

import type { CLIAdapter } from '../src/adapters/base.js';
import { TransportError, ValidationError } from '../src/errors.js';
import { createServer } from '../src/proxy.js';
import type { QuotagateConfig } from '../src/config.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const minimalConfig: QuotagateConfig = {
  models: { 'claude-sonnet-4-6': { backend: 'claude', priority: 1 } },
  retry: { max_attempts: 3 },
};

const stubAdapter = {
  name: 'stub',
  complete: vi.fn(),
  healthCheck: vi.fn(),
  install: vi.fn(),
} satisfies CLIAdapter;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function validPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    model: 'claude-sonnet-4-6',
    messages: [{ role: 'user', content: 'hi' }],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('proxy — createServer factory (WS_05 T2)', () => {
  let server: FastifyInstance;

  beforeEach(() => {
    vi.clearAllMocks();
    server = createServer(minimalConfig, { claude: stubAdapter });
  });

  afterEach(async () => {
    await server.close();
  });

  // -------------------------------------------------------------------------
  // T-0: factory smoke test (SC-1)
  // -------------------------------------------------------------------------
  it('T-0: createServer returns a usable FastifyInstance without calling listen()', async () => {
    // The factory must return a truthy value (the Fastify instance).
    expect(server).toBeTruthy();

    // inject() must not throw — the instance must be capable of handling requests.
    const response = await server.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      payload: validPayload(),
      headers: { 'content-type': 'application/json' },
    });

    // A response object must come back (any status is acceptable; the point is the
    // instance handled the request without throwing at the inject level).
    expect(response).toBeTruthy();
    expect(typeof response.statusCode).toBe('number');
  });

  // -------------------------------------------------------------------------
  // T-1: valid request body accepted by Zod parse (A2)
  // -------------------------------------------------------------------------
  it('T-1: valid request body passes Zod parse — status is not 400', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      payload: validPayload(),
      headers: { 'content-type': 'application/json' },
    });

    // The parse must succeed: the stub pipeline throws 500, not the body parser.
    // A 400 here would mean Zod rejected a structurally valid body — that is a bug.
    expect(response.statusCode).not.toBe(400);
  });

  // -------------------------------------------------------------------------
  // T-2: stream: true guard → HTTP 400 (SC-2)
  // -------------------------------------------------------------------------
  it('T-2: stream:true is rejected with 400 streaming_not_supported', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      payload: validPayload({ stream: true }),
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(400);

    const body = response.json<{ error: { message: string; type: string; code: string } }>();
    expect(body.error.type).toBe('invalid_request_error');
    expect(body.error.code).toBe('streaming_not_supported');
  });

  // -------------------------------------------------------------------------
  // T-3: unknown model alias → HTTP 400 (SC-3)
  // -------------------------------------------------------------------------
  it('T-3: unknown model alias is rejected with 400 model_not_supported', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      payload: validPayload({ model: 'unknown-model-xyz' }),
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(400);

    const body = response.json<{ error: { message: string; type: string; code: string } }>();
    expect(body.error.code).toBe('model_not_supported');
  });

  // -------------------------------------------------------------------------
  // T-3c: model present in config but adapter backend absent from map → HTTP 400 (alias guard second branch)
  // Verifies that resolve() returns null when the config backend is absent from the adapters map.
  // -------------------------------------------------------------------------
  it('T-3c: model in config with non-claude backend is rejected with 400 model_not_supported', async () => {
    const geminiConfig: QuotagateConfig = {
      models: { 'gemini-pro': { backend: 'gemini', priority: 1 } },
      retry: { max_attempts: 3 },
    };
    // Adapters map only has claude; gemini adapter is absent → resolve() returns null → HTTP 400.
    // Use a local stub to make clear: this adapter should never be called (routing returns null first).
    const localStub = {
      name: 'unused',
      complete: vi.fn(),
      healthCheck: vi.fn(),
      install: vi.fn(),
    } satisfies CLIAdapter;
    const localServer = createServer(geminiConfig, { claude: localStub });
    try {
      const response = await localServer.inject({
        method: 'POST',
        url: '/v1/chat/completions',
        payload: { model: 'gemini-pro', messages: [{ role: 'user', content: 'hi' }] },
        headers: { 'content-type': 'application/json' },
      });
      expect(response.statusCode).toBe(400);
      const body = response.json<{ error: { code: string } }>();
      expect(body.error.code).toBe('model_not_supported');
    } finally {
      await localServer.close();
    }
  });

  // -------------------------------------------------------------------------
  // T-3b: malformed body (missing messages) → HTTP 400 (SC-4)
  // -------------------------------------------------------------------------
  it('T-3b: malformed body missing messages is rejected with 400', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      payload: { model: 'claude-sonnet-4-6' },
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(400);

    const body = response.json<{ error: { message: string; type: string; code: string } }>();
    expect(body.error.code).toBe('invalid_request');
  });

  // -------------------------------------------------------------------------
  // T-4: ValidationError from pipeline → HTTP 500, validation_error branch (SC-5)
  //
  // adapter.complete is configured to reject with a ValidationError, which flows through
  // setErrorHandler's ValidationError branch and must produce a well-formed 500 with no
  // stack trace exposed.
  // -------------------------------------------------------------------------
  it('T-4: ValidationError from pipeline → 500 validation_error', async () => {
    stubAdapter.complete.mockRejectedValueOnce(new ValidationError('test validation error'));

    const response = await server.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      payload: validPayload(),
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(500);

    const body = response.json<{
      error: { message: string; type: string; code: string; stack?: unknown };
    }>();
    expect(body.error.code).toBe('validation_error');
    expect(body.error.type).toBe('validation_error');
    expect(typeof body.error.message).toBe('string');
    expect(body.error.message.length).toBeGreaterThan(0);
    expect(body.error.stack).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // T-4b: TransportError from pipeline → HTTP 500, transport_error branch
  //
  // adapter.complete is configured to reject with a TransportError, exercising the
  // TransportError branch of setErrorHandler.
  // -------------------------------------------------------------------------
  it('T-4b: TransportError from pipeline → 500 transport_error', async () => {
    stubAdapter.complete.mockRejectedValueOnce(new TransportError('test transport error'));

    const response = await server.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      payload: validPayload(),
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(500);

    const body = response.json<{
      error: { message: string; type: string; code: string; stack?: unknown };
    }>();
    expect(body.error.code).toBe('transport_error');
    expect(body.error.type).toBe('transport_error');
    expect(body.error.stack).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // T-5: unexpected raw Error from pipeline → HTTP 500, internal_error, internal message not leaked (SC-6)
  //
  // adapter.complete is configured to reject with a plain Error (not a QuotagateError subtype).
  // setErrorHandler's catch-all branch must emit the generic "An internal error occurred" message
  // and must NOT leak the raw error's message or stack trace.
  // -------------------------------------------------------------------------
  it('T-5: unexpected raw Error from pipeline → 500 internal_error, internal message not leaked', async () => {
    stubAdapter.complete.mockRejectedValueOnce(new Error('unexpected internal error'));

    const response = await server.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      payload: validPayload(),
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(500);

    const body = response.json<Record<string, unknown>>();

    // The only allowed top-level key is "error".
    expect(Object.keys(body)).toEqual(['error']);

    const errorObj = body['error'] as Record<string, unknown>;

    expect(errorObj['code']).toBe('internal_error');
    // The generic message must be returned verbatim — the raw error message must NOT appear.
    expect(errorObj['message']).toBe('An internal error occurred');
    expect(errorObj['stack']).toBeUndefined();
  });
});

describe('proxy — pipeline wiring (WS_05 T3)', () => {
  let server: FastifyInstance;

  beforeEach(() => {
    vi.clearAllMocks();
    server = createServer(minimalConfig, { claude: stubAdapter });
  });

  afterEach(async () => {
    await server.close();
  });

  // -------------------------------------------------------------------------
  // T-1: success path → HTTP 200 with valid ChatCompletion shape (SC-1, SC-7)
  // -------------------------------------------------------------------------
  it('T-1: valid adapter response → HTTP 200 with correct ChatCompletion shape', async () => {
    stubAdapter.complete.mockResolvedValueOnce({
      raw: '{"type":"text","content":"Hello, world!"}',
      backend: 'claude-subprocess',
    });

    const response = await server.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      payload: { model: 'claude-sonnet-4-6', messages: [{ role: 'user', content: 'Hi' }] },
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(200);

    const body = response.json<ChatCompletion>();
    expect(body.choices[0].finish_reason).toBe('stop');
    expect(body.choices[0].message.role).toBe('assistant');
    expect(body.choices[0].message.content).toBe('Hello, world!');
    expect(body.id).toMatch(/^chatcmpl-/);

    // Compile-time contract: body is assignable to ChatCompletion without a cast.
    const _typed: ChatCompletion = body;
    void _typed;
  });

  // -------------------------------------------------------------------------
  // T-2: TransportError from adapter → HTTP 500, transport_error, no stack trace (SC-2)
  // Exercises TransportError propagation through the real pipeline post-T3 wiring;
  // T2 block T-4b is the pre-pipeline error-handler unit.
  // -------------------------------------------------------------------------
  it('T-2: TransportError from adapter → HTTP 500 transport_error, no stack trace leaked', async () => {
    stubAdapter.complete.mockRejectedValueOnce(new TransportError('spawn failed'));

    const response = await server.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      payload: validPayload(),
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(500);

    const body = response.json<{ error: { message: string; code: string; stack?: unknown } }>();
    expect(body.error.code).toBe('transport_error');
    expect(typeof body.error.message).toBe('string');
    expect(body.error.message.length).toBeGreaterThan(0);
    expect(body.error.stack).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // T-3: retry path — malformed then valid → HTTP 200; invoker receives corrected messages (SC-3, SC-4)
  // -------------------------------------------------------------------------
  it('T-3: retry path — malformed first response, valid second → HTTP 200; invoker receives corrected messages', async () => {
    stubAdapter.complete
      .mockResolvedValueOnce({ raw: 'not json', backend: 'claude-subprocess' })
      .mockResolvedValueOnce({
        raw: '{"type":"text","content":"Retry worked"}',
        backend: 'claude-subprocess',
      });

    const response = await server.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      payload: { model: 'claude-sonnet-4-6', messages: [{ role: 'user', content: 'Test' }] },
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(200);
    expect(stubAdapter.complete).toHaveBeenCalledTimes(2);

    // The first adapter call must receive the original message only (length 1).
    const firstCallArg = stubAdapter.complete.mock.calls[0][0] as { messages: unknown[] };
    expect(firstCallArg.messages).toHaveLength(1);

    // The second adapter call must receive the original message + CORRECTION_NOTE (length 2).
    const secondCallArg = stubAdapter.complete.mock.calls[1][0] as { messages: unknown[] };
    expect(secondCallArg.messages).toHaveLength(2);

    const body = response.json<ChatCompletion>();
    expect(body.choices[0].message.content).toBe('Retry worked');
  });

  // -------------------------------------------------------------------------
  // T-4: {type:"tool_call"} from adapter → HTTP 200 ChatCompletion with finish_reason:"tool_calls"
  // -------------------------------------------------------------------------
  it('T-4: tool_call result from adapter → HTTP 200 with tool_calls ChatCompletion (stub retired)', async () => {
    stubAdapter.complete.mockResolvedValueOnce({
      raw: '{"type":"tool_call","name":"fn","arguments":{}}',
      backend: 'claude-subprocess',
    });

    const response = await server.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      payload: validPayload(),
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(200);

    const body = response.json<ChatCompletion>();
    expect(body.choices[0].finish_reason).toBe('tool_calls');
    expect(body.choices[0].message.content).toBeNull();
    expect(body.choices[0].message.tool_calls).toHaveLength(1);
    expect(body.choices[0].message.tool_calls![0].function.name).toBe('fn');
  });

  // -------------------------------------------------------------------------
  // WS_08 T3-SC1: retry exhaustion (3× malformed) → HTTP 500 validation_error (SC-1)
  //
  // Three consecutive malformed JSON responses cause the proxy to return HTTP 500
  // with an OpenAI-format error body and no stack trace. Verifies:
  // - All three mockResolvedValueOnce calls are consumed (initial + 2 retries)
  // - stubAdapter.complete called exactly 3 times
  // - HTTP 500 status with validation_error code and type
  // - Error body has correct shape (no stack trace leaked)
  // -------------------------------------------------------------------------
  it('WS_08 T3-SC1: retry exhaustion (3× malformed) → HTTP 500 validation_error', async () => {
    stubAdapter.complete
      .mockResolvedValueOnce({ raw: 'not json', backend: 'claude-subprocess' })
      .mockResolvedValueOnce({ raw: 'still not json', backend: 'claude-subprocess' })
      .mockResolvedValueOnce({ raw: 'malformed again', backend: 'claude-subprocess' });

    const response = await server.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      payload: { model: 'claude-sonnet-4-6', messages: [{ role: 'user', content: 'Test' }] },
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(500);
    expect(stubAdapter.complete).toHaveBeenCalledTimes(3);

    const body = response.json<{
      error: { message: string; type: string; code: string; stack?: unknown };
    }>();
    expect(body.error.code).toBe('validation_error');
    expect(body.error.type).toBe('validation_error');
    expect(typeof body.error.message).toBe('string');
    expect(body.error.message.length).toBeGreaterThan(0);
    expect(body.error.stack).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // WS_08 T3-SC2: correction note content threads through proxy pipeline (SC-2)
  //
  // First adapter call returns malformed JSON; second returns well-formed response.
  // Verifies:
  // - HTTP 200 on successful retry
  // - stubAdapter.complete called exactly 2 times
  // - First call received messages array of length 1 (original only)
  // - Second call received messages array of length 2 (original + correction note)
  // - Second call's last message has role:'user' and content starting with the correction note prefix
  // - Correction note content is present but does NOT leak the malformed raw string
  //
  // NOTE (T3 O-1): the call-count / messages-length retry mechanics below overlap with T-3
  // above (the retry happy-path test). The load-bearing additions unique to this test are the
  // two correction-note content assertions: (1) the CORRECTION_NOTE wording check (the
  // `^The previous response was not valid JSON` prefix) and (2) the content-free guard (the
  // malformed raw must not leak into the correction note). Those two lines are what this test
  // exists to prove beyond T-3.
  // -------------------------------------------------------------------------
  it('WS_08 T3-SC2: correction note content threads through proxy pipeline', async () => {
    stubAdapter.complete
      .mockResolvedValueOnce({ raw: 'not json', backend: 'claude-subprocess' })
      .mockResolvedValueOnce({
        raw: '{"type":"text","content":"recovered"}',
        backend: 'claude-subprocess',
      });

    const response = await server.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      payload: { model: 'claude-sonnet-4-6', messages: [{ role: 'user', content: 'Test' }] },
      headers: { 'content-type': 'application/json' },
    });

    expect(response.statusCode).toBe(200);
    expect(stubAdapter.complete).toHaveBeenCalledTimes(2);

    // First call must receive the original message only (length 1).
    const firstCallArg = stubAdapter.complete.mock.calls[0][0] as { messages: unknown[] };
    expect(firstCallArg.messages).toHaveLength(1);

    // Second call must receive the original message + CORRECTION_NOTE (length 2).
    const secondCallArg = stubAdapter.complete.mock.calls[1][0] as { messages: unknown[] };
    expect(secondCallArg.messages).toHaveLength(2);

    // Last element of the second call must be the correction note (user role).
    const correctionMsg = secondCallArg.messages[1] as {
      role: string;
      content: string;
    };
    expect(correctionMsg.role).toBe('user');
    expect(correctionMsg.content).toMatch(/^The previous response was not valid JSON/);
    // Verify that the malformed raw string is NOT leaked into the content.
    expect(correctionMsg.content).not.toContain('not json');

    const body = response.json<ChatCompletion>();
    expect(body.choices[0].message.content).toBe('recovered');
  });
});
