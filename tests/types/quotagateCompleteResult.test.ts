import { describe, expect, it } from 'vitest';
import { AdapterResponse, QuotagateCompleteResultSchema } from '../../src/types.js';

describe('QuotagateCompleteResultSchema', () => {
  it('T-1: parses a valid text result', () => {
    const input = { type: 'text', content: 'hello' };
    const result = QuotagateCompleteResultSchema.parse(input);
    expect(result).toEqual(input);
    // TypeScript must narrow result to the text branch here — accessing .content
    // without a cast confirms narrowing works.
    if (result.type === 'text') {
      expect(result.content).toBe('hello');
    }
  });

  it('T-2: parses a valid tool_call result', () => {
    const input = { type: 'tool_call', name: 'fn', arguments: {} };
    const result = QuotagateCompleteResultSchema.parse(input);
    expect(result).toEqual(input);
    if (result.type === 'tool_call') {
      expect(result.name).toBe('fn');
      expect(result.arguments).toEqual({});
    }
  });

  it('T-3: rejects a text result missing content', () => {
    const input = { type: 'text' };
    expect(() => QuotagateCompleteResultSchema.parse(input)).toThrow();
  });

  it('T-4: rejects a tool_call result missing name', () => {
    const input = { type: 'tool_call' };
    expect(() => QuotagateCompleteResultSchema.parse(input)).toThrow();
  });

  it('T-5: rejects a result missing the discriminant', () => {
    const input = {};
    expect(() => QuotagateCompleteResultSchema.parse(input)).toThrow();
  });
});

it('SC-7 compile-time: AdapterResponse.backend rejects non-literal strings', () => {
  // @ts-expect-error — backend: "wrong" is not assignable to "claude-subprocess"
  const _wrongBackend: AdapterResponse = { raw: 'x', backend: 'wrong' };
  void _wrongBackend;
});
