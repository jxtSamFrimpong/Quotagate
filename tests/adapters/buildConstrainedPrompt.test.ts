import { describe, expect, it } from 'vitest';

import { buildConstrainedPrompt } from '../../src/adapters/claude.js';
import type { OpenAIMessage, OpenAITool } from '../../src/types.js';

describe('buildConstrainedPrompt', () => {
  it('T-1: constraint instructions and tool schemas present when tools provided', () => {
    const messages: OpenAIMessage[] = [{ role: 'user', content: 'what is 2+2?' }];
    const tools: OpenAITool[] = [
      {
        type: 'function',
        function: { name: 'calc', description: 'calculator', parameters: {} },
      },
    ];

    const result = buildConstrainedPrompt(messages, tools, 'auto');

    expect(result).toContain('Returns ONLY a raw JSON object');
    expect(result).toContain('Never executes any function');
    expect(result).toContain('calc');
    expect(result).toContain('calculator');
  });

  it('T-2: user message content appears in output', () => {
    const messages: OpenAIMessage[] = [{ role: 'user', content: 'ping' }];

    const result = buildConstrainedPrompt(messages, undefined, 'none');

    expect(result).toContain('ping');
  });

  it('T-3: assistant message content appears in output', () => {
    const messages: OpenAIMessage[] = [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi there' },
    ];

    const result = buildConstrainedPrompt(messages, undefined, 'none');

    expect(result).toContain('hi there');
  });

  it('T-4: multiple tool schemas are all serialized into the output', () => {
    const tools: OpenAITool[] = [
      {
        type: 'function',
        function: {
          name: 'fn_a',
          description: 'desc_a',
          parameters: { type: 'object', properties: {} },
        },
      },
      {
        type: 'function',
        function: { name: 'fn_b', description: 'desc_b', parameters: {} },
      },
    ];
    const messages: OpenAIMessage[] = [{ role: 'user', content: 'go' }];

    const result = buildConstrainedPrompt(messages, tools, 'auto');

    expect(result).toContain('fn_a');
    expect(result).toContain('fn_b');
  });

  it('T-5: tools: undefined produces no tool schema text', () => {
    const result = buildConstrainedPrompt([{ role: 'user', content: 'x' }], undefined, 'none');

    expect(result).not.toContain('Available functions');
    expect(result).not.toContain('toolChoice');
  });

  it('T-6: tools: [] output is identical to tools: undefined output', () => {
    const messages: OpenAIMessage[] = [{ role: 'user', content: 'x' }];

    const withUndefined = buildConstrainedPrompt(messages, undefined, 'none');
    const withEmpty = buildConstrainedPrompt(messages, [], 'none');

    expect(withUndefined).toBe(withEmpty);
  });

  it('T-7: null content on assistant message is rendered faithfully', () => {
    const messages: OpenAIMessage[] = [
      { role: 'user', content: 'call fn' },
      { role: 'assistant', content: null },
    ];

    const result = buildConstrainedPrompt(messages, undefined, 'none');

    expect(typeof result).toBe('string');
    expect(result).not.toContain('assistant: null');
    expect(result).toContain('assistant: [tool call]');
    expect(result).toContain('call fn');
  });

  it('T-8: constraint instructions present even without tools', () => {
    const result = buildConstrainedPrompt([{ role: 'user', content: 'y' }], undefined, 'none');

    expect(result).toContain('Returns ONLY a raw JSON object');
    expect(result).toContain('Never executes any function');
  });

  it('T-9: input messages array is not mutated', () => {
    const original: { role: 'user'; content: string }[] = [{ role: 'user', content: 'hello' }];

    buildConstrainedPrompt(original as OpenAIMessage[], undefined, 'none');

    expect(original[0].content).toBe('hello');
    expect(original.length).toBe(1);
  });

  it('T-10: tool without description or parameters does not throw and omits undefined fields', () => {
    const tools: OpenAITool[] = [
      {
        type: 'function',
        function: { name: 'bare_fn' },
      },
    ];
    const messages: OpenAIMessage[] = [{ role: 'user', content: 'z' }];

    const result = buildConstrainedPrompt(messages, tools, 'auto');

    expect(result).toContain('bare_fn');
    expect(result).toContain('description: ');
  });
});
