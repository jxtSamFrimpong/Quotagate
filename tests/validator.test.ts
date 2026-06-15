import { describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';

import { TransportError, ValidationError } from '../src/errors.js';
import { type AdapterResponse, type OpenAIMessage } from '../src/types.js';
import { parseAndValidate, validateWithRetry } from '../src/validator.js';

describe('parseAndValidate', () => {
  // T-1: valid text fixture resolves (SC-1, A1)
  it('T-1: valid text fixture resolves to typed QuotagateCompleteResult', () => {
    const result = parseAndValidate('{"type":"text","content":"Hello"}');
    expect(result).toEqual({ type: 'text', content: 'Hello' });
  });

  // T-2: malformed JSON throws ValidationError, not a raw SyntaxError (SC-2, EF1)
  // Explicitly asserts both sides of the contract: the error IS a ValidationError
  // AND is NOT a SyntaxError — so the catch boundary cannot be removed silently.
  it('T-2: malformed JSON throws ValidationError — SyntaxError must not escape', () => {
    let caught: unknown;
    try {
      parseAndValidate('not json');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ValidationError);
    expect(caught).not.toBeInstanceOf(SyntaxError);
  });

  // T-3: unknown discriminant throws ValidationError (SC-3, EF2)
  it('T-3: unknown type discriminant throws ValidationError', () => {
    expect(() => parseAndValidate('{"type":"image","content":"x"}')).toThrow(ValidationError);
  });

  // T-4a: missing required field on a matched discriminant branch (SC-4, EF2)
  // {"type":"text"} matches the discriminant but lacks the required `content` field.
  it('T-4a: missing required field on matched branch throws ValidationError', () => {
    expect(() => parseAndValidate('{"type":"text"}')).toThrow(ValidationError);
  });

  // T-4b: missing discriminant key — Zod cannot enter the union at all (SC-4, EF2)
  // {"content":"hi"} has no `type` key, so the discriminatedUnion short-circuits immediately.
  it('T-4b: missing discriminant key throws ValidationError', () => {
    expect(() => parseAndValidate('{"content":"hi"}')).toThrow(ValidationError);
  });

  // T-5: schema-valid tool_call resolves faithfully (SC-5, EF3, OD-7)
  // OD-7 LOCKED: the validator returns schema-valid output regardless of type.
  // responseBuilder is the single rejection point for the unsupported branch.
  it('T-5: schema-valid tool_call resolves faithfully — validator does not reject', () => {
    const result = parseAndValidate(
      '{"type":"tool_call","name":"get_weather","arguments":{"city":"Accra"}}',
    );
    expect(result).toEqual({
      type: 'tool_call',
      name: 'get_weather',
      arguments: { city: 'Accra' },
    });
  });

  // T-6: ValidationError message is content-free (SC-6, WS_04-D3 contamination guard)
  // Proves model output is never echoed into the error — which would otherwise
  // leak into the T3 correction note.
  it('T-6: ValidationError message does not contain raw model output (content-free)', () => {
    const sentinel = 'SENTINEL_XQ7Z_BROKEN';
    let caught: unknown;
    try {
      parseAndValidate(sentinel);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ValidationError);
    expect((caught as ValidationError).message).not.toContain(sentinel);
  });

  // T-7a: tool_call with missing `name` field throws ValidationError — ZodError must not escape
  // The discriminant matches ("tool_call"), but the required `name` field is absent,
  // so Zod schema validation fails. Same boundary contract as T-2 (ZodError containment).
  it('T-7a: tool_call missing name field throws ValidationError — ZodError must not escape', () => {
    let caught: unknown;
    try {
      parseAndValidate('{"type":"tool_call","arguments":{"city":"Accra"}}');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ValidationError);
    expect(caught).not.toBeInstanceOf(ZodError);
  });

  // T-7b: tool_call with non-object `arguments` (a string) throws ValidationError
  // z.record(z.string(), z.unknown()) requires an object; a string fails schema validation.
  it('T-7b: tool_call with non-object arguments throws ValidationError', () => {
    expect(() =>
      parseAndValidate('{"type":"tool_call","name":"get_weather","arguments":"city=Accra"}'),
    ).toThrow(ValidationError);
  });

  // T-7c: tool_call with missing `arguments` key throws ValidationError
  // Both `name` and `arguments` are required on the tool_call discriminant branch.
  it('T-7c: tool_call missing arguments key throws ValidationError', () => {
    expect(() => parseAndValidate('{"type":"tool_call","name":"get_weather"}')).toThrow(
      ValidationError,
    );
  });
});

describe('validateWithRetry', () => {
  const baseMessages: OpenAIMessage[] = [{ role: 'user', content: 'Hello' }];

  // T-1: valid attempt-1 raw resolves immediately — invoker never called (SC-1, EF1)
  it('T-1: valid attempt-1 raw resolves without calling invoker', async () => {
    const invoker = vi.fn<[OpenAIMessage[]], Promise<AdapterResponse>>();
    const result = await validateWithRetry('{"type":"text","content":"Hi"}', baseMessages, invoker);
    expect(result).toEqual({ type: 'text', content: 'Hi' });
    expect(invoker).not.toHaveBeenCalled();
  });

  // T-2: malformed attempt-1, good attempt-2 (SC-2, EF2)
  it('T-2: malformed attempt-1, good attempt-2 resolves after one invoker call', async () => {
    const invoker = vi.fn<[OpenAIMessage[]], Promise<AdapterResponse>>().mockResolvedValueOnce({
      raw: '{"type":"text","content":"ok"}',
      backend: 'claude-subprocess',
    });
    const result = await validateWithRetry('not json', baseMessages, invoker);
    expect(result).toEqual({ type: 'text', content: 'ok' });
    expect(invoker).toHaveBeenCalledTimes(1);
    expect(invoker).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ role: 'user' })]),
    );
    expect((invoker.mock.calls[0] as [OpenAIMessage[]])[0]).toHaveLength(baseMessages.length + 1);
  });

  // T-3: three consecutive malformed responses — ValidationError after exactly 3 attempts (SC-3, EF3)
  // invoker is called exactly twice (attempts 2 and 3; attempt 1 uses the original raw).
  // Also asserts the thrown message is content-free (none of the three malformed payloads leaked).
  it('T-3: three malformed responses throw ValidationError; invoker called exactly twice', async () => {
    const invoker = vi
      .fn<[OpenAIMessage[]], Promise<AdapterResponse>>()
      .mockResolvedValueOnce({ raw: 'bad2', backend: 'claude-subprocess' })
      .mockResolvedValueOnce({ raw: 'bad3', backend: 'claude-subprocess' });
    let caught: unknown;
    try {
      await validateWithRetry('bad1', baseMessages, invoker);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ValidationError);
    expect(invoker).toHaveBeenCalledTimes(2);
    expect((caught as ValidationError).message).not.toContain('bad1');
    expect((caught as ValidationError).message).not.toContain('bad2');
    expect((caught as ValidationError).message).not.toContain('bad3');
  });

  // T-4: correction note structure — correct length and content-free (SC-4, SC-5, EF6)
  // The sentinel value is in the first raw; the correction message must not echo it.
  it('T-4: invoker receives messages.length+1 messages; last message is content-free', async () => {
    const sentinel = 'SENTINEL_RETRY_PROBE';
    const invoker = vi.fn<[OpenAIMessage[]], Promise<AdapterResponse>>().mockResolvedValueOnce({
      raw: '{"type":"text","content":"recovered"}',
      backend: 'claude-subprocess',
    });
    await validateWithRetry(sentinel, baseMessages, invoker);
    const receivedMessages = (invoker.mock.calls[0] as [OpenAIMessage[]])[0];
    expect(receivedMessages).toHaveLength(baseMessages.length + 1);
    const correctionMsg = receivedMessages[receivedMessages.length - 1];
    expect(correctionMsg.role).toBe('user');
    expect(correctionMsg.content).not.toContain(sentinel);
  });

  // T-5: TransportError propagates unwrapped — not retried, not wrapped (SC-6, EF4, A3)
  // The !(err instanceof ValidationError) guard is the critical correctness point.
  it('T-5: TransportError from invoker propagates unwrapped — not retried, not wrapped as ValidationError', async () => {
    const invoker = vi
      .fn<[OpenAIMessage[]], Promise<AdapterResponse>>()
      .mockRejectedValueOnce(new TransportError('spawn failed'));
    await expect(validateWithRetry('not json', baseMessages, invoker)).rejects.toBeInstanceOf(
      TransportError,
    );
    expect(invoker).toHaveBeenCalledTimes(1);
  });

  // T-6: schema-valid tool_call on attempt-1 resolves without invoker call (SC-7, EF5, A4, OD-7)
  it('T-6: schema-valid tool_call on attempt-1 resolves without invoker call (OD-7)', async () => {
    const invoker = vi.fn<[OpenAIMessage[]], Promise<AdapterResponse>>();
    const result = await validateWithRetry(
      '{"type":"tool_call","name":"get_weather","arguments":{"city":"Accra"}}',
      baseMessages,
      invoker,
    );
    expect(result).toEqual({
      type: 'tool_call',
      name: 'get_weather',
      arguments: { city: 'Accra' },
    });
    expect(invoker).not.toHaveBeenCalled();
  });

  // T-8: malformed tool_call (missing arguments) on attempt-1, valid tool_call on attempt-2
  // Verifies that a schema-invalid tool_call triggers a retry (the same ValidationError path
  // as a malformed text response), and that the correction messages array is correctly formed.
  it('T-8: malformed tool_call attempt-1, valid tool_call attempt-2 resolves after one invoker call', async () => {
    const invoker = vi.fn<[OpenAIMessage[]], Promise<AdapterResponse>>().mockResolvedValueOnce({
      raw: '{"type":"tool_call","name":"get_weather","arguments":{"city":"Accra"}}',
      backend: 'claude-subprocess',
    });
    const result = await validateWithRetry(
      '{"type":"tool_call","name":"get_weather"}', // missing `arguments` — fails schema
      baseMessages,
      invoker,
    );
    expect(result).toEqual({
      type: 'tool_call',
      name: 'get_weather',
      arguments: { city: 'Accra' },
    });
    expect(invoker).toHaveBeenCalledTimes(1);
    expect((invoker.mock.calls[0] as [OpenAIMessage[]])[0]).toHaveLength(baseMessages.length + 1);
  });
});
