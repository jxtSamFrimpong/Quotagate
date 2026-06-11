import { describe, expect, it } from 'vitest';

import type { ChatCompletion } from 'openai/resources/chat/completions';

import { QuotagateError } from '../src/errors.js';
import { buildChatCompletion } from '../src/responseBuilder.js';

describe('buildChatCompletion', () => {
  it('T-1: id format and uniqueness (SC-1 / A3)', () => {
    const out1 = buildChatCompletion({ type: 'text', content: 'Hi' }, 'claude-sonnet-4-6');
    expect(out1.id).toMatch(/^chatcmpl-[0-9a-f-]{36}$/);

    const out2 = buildChatCompletion({ type: 'text', content: 'Hi' }, 'claude-sonnet-4-6');
    expect(out1.id).not.toBe(out2.id);
  });

  it('T-2: full text-branch contract (SC-2 / SC-3 / A2)', () => {
    const out = buildChatCompletion({ type: 'text', content: 'Hi' }, 'claude-sonnet-4-6');
    expect(out.object).toBe('chat.completion');
    expect(typeof out.created).toBe('number');
    expect(out.model).toBe('claude-sonnet-4-6');
    expect(out.choices).toHaveLength(1);
    expect(out.choices[0].index).toBe(0);
    expect(out.choices[0].finish_reason).toBe('stop');
    expect(out.choices[0].message.role).toBe('assistant');
    expect(out.choices[0].message.content).toBe('Hi');
    expect(out.choices[0].logprobs).toBeNull();
  });

  it('T-3: return type satisfies openai ChatCompletion — compile-time contract (SC-4 / invariant #5)', () => {
    // This typed assignment is the invariant-#5 guard: tsc enforces the full ChatCompletion shape.
    // Do NOT replace with a hand-rolled type — that would defeat the compile-time contract.
    const out: ChatCompletion = buildChatCompletion({ type: 'text', content: 'Hi' }, 'm');
    expect(out).toBeDefined();
  });

  it('T-4: tool_call branch throws QuotagateError with descriptive message (SC-5 / OD-4 / EF1)', () => {
    expect(() => buildChatCompletion({ type: 'tool_call', name: 'f', arguments: {} }, 'm')).toThrow(
      QuotagateError,
    );
    expect(() => buildChatCompletion({ type: 'tool_call', name: 'f', arguments: {} }, 'm')).toThrow(
      /not yet implemented/i,
    );
  });

  it('T-5: empty content is preserved, not rejected (SC-6 / EF2)', () => {
    const out = buildChatCompletion({ type: 'text', content: '' }, 'm');
    expect(out.choices[0].message.content).toBe('');
  });
});
