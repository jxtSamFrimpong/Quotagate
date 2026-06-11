import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { FastifyInstance } from 'fastify';

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
    server = createServer(minimalConfig, stubAdapter);
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
  // T-3c: model present in config but wrong backend → HTTP 400 (alias guard second branch)
  // -------------------------------------------------------------------------
  it('T-3c: model in config with non-claude backend is rejected with 400 model_not_supported', async () => {
    const geminiConfig: QuotagateConfig = {
      models: { 'gemini-pro': { backend: 'gemini', priority: 1 } },
      retry: { max_attempts: 3 },
    };
    const localServer = createServer(geminiConfig, stubAdapter);
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
