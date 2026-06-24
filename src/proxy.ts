import Fastify, { FastifyInstance } from 'fastify';

import { resolve } from './router.js';
import { QuotagateError, TransportError, ValidationError } from './errors.js';
import { buildAdapterRequest } from './argumentBuilder.js';
import { validateWithRetry } from './validator.js';
import { buildChatCompletion } from './responseBuilder.js';
import { OpenAIChatRequestSchema } from './types.js';
import type { OpenAIMessage } from './types.js';
import type { CLIAdapter } from './adapters/base.js';
import type { QuotagateConfig } from './config.js';

export function createServer(
  config: QuotagateConfig,
  adapters: Record<string, CLIAdapter>,
): FastifyInstance {
  const server = Fastify({ logger: false });

  // setErrorHandler — exhaustive QuotagateError → HTTP mapping.
  // Only reached by pipeline/adapter failures that throw inside a route handler.
  // The error parameter is `unknown` per Fastify v5; narrow with instanceof before use.
  server.setErrorHandler((error, _request, reply) => {
    // Fastify-internal errors (e.g. JSON parse failure) carry a numeric statusCode.
    // Re-map client-error codes (< 500) to 400 with an OpenAI-shaped body so that
    // malformed request bodies produce 400, not 500 — matching the real OpenAI API.
    if (
      typeof error === 'object' &&
      error !== null &&
      'statusCode' in error &&
      typeof (error as { statusCode: unknown }).statusCode === 'number' &&
      (error as { statusCode: number }).statusCode < 500
    ) {
      void reply.status(400).send({
        error: {
          message: 'Request body is malformed or cannot be parsed',
          type: 'invalid_request_error',
          code: 'invalid_request',
        },
      });
      return;
    }

    if (error instanceof ValidationError) {
      void reply.status(500).send({
        error: {
          message: error.message,
          type: 'validation_error',
          code: 'validation_error',
        },
      });
      return;
    }

    if (error instanceof TransportError) {
      void reply.status(500).send({
        error: {
          message: error.message,
          type: 'transport_error',
          code: 'transport_error',
        },
      });
      return;
    }

    if (error instanceof QuotagateError) {
      void reply.status(500).send({
        error: {
          message: error.message,
          type: 'proxy_error',
          code: 'proxy_error',
        },
      });
      return;
    }

    // Catch-all: unexpected Error (not a QuotagateError subtype).
    // Do NOT leak internal message or stack trace — use a generic message only.
    void reply.status(500).send({
      error: {
        message: 'An internal error occurred',
        type: 'internal_error',
        code: 'internal_error',
      },
    });
  });

  // POST /v1/chat/completions
  server.post('/v1/chat/completions', async (request, reply) => {
    const parsed = OpenAIChatRequestSchema.safeParse(request.body);

    if (!parsed.success) {
      void reply.status(400).send({
        error: {
          message: parsed.error.errors.map((e) => e.message).join('; '),
          type: 'invalid_request_error',
          code: 'invalid_request',
        },
      });
      return;
    }

    // 400 guards are pre-pipeline request validation rejections — they send directly and
    // do not flow through setErrorHandler, which handles pipeline/adapter failures.

    if (parsed.data.stream === true) {
      void reply.status(400).send({
        error: {
          message: 'Streaming is not supported',
          type: 'invalid_request_error',
          code: 'streaming_not_supported',
        },
      });
      return;
    }

    const adapter = resolve(parsed.data.model, config, adapters);
    if (adapter === null) {
      void reply.status(400).send({
        error: {
          message: `Model '${parsed.data.model}' is not supported`,
          type: 'invalid_request_error',
          code: 'model_not_supported',
        },
      });
      return;
    }

    const adapterReq = buildAdapterRequest(parsed.data);
    const response = await adapter.complete(adapterReq);

    const invoker = (msgs: OpenAIMessage[]) =>
      adapter.complete(buildAdapterRequest({ ...parsed.data, messages: msgs }));

    const result = await validateWithRetry(
      response.raw,
      parsed.data.messages,
      invoker,
      config.retry.max_attempts,
    );
    const completion = buildChatCompletion(result, parsed.data.model);
    return reply.send(completion);
  });

  return server;
}
