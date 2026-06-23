import { describe, expect, it } from 'vitest';

import { buildConstrainedPrompt } from '../../src/adapters/claude.js';
import type { OpenAIMessage, OpenAITool } from '../../src/types.js';

describe('buildConstrainedPrompt', () => {
  it('T-1: tool schemas and conversation serialized when tools provided (constraint instructions delivered via --system-prompt, not here)', () => {
    const messages: OpenAIMessage[] = [{ role: 'user', content: 'what is 2+2?' }];
    const tools: OpenAITool[] = [
      {
        type: 'function',
        function: { name: 'calc', description: 'calculator', parameters: {} },
      },
    ];

    const result = buildConstrainedPrompt(messages, tools, 'auto');

    // Constraint instructions are delivered via --system-prompt by _completeViaSubprocess,
    // not prepended here — assert they are absent from the serialized payload.
    expect(result).not.toContain('API proxy');
    expect(result).not.toContain('Return only the JSON object');
    // Tool schema and conversation content must still be present.
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

  it('T-8: buildConstrainedPrompt contains only conversation (no constraint instructions — they are delivered via --system-prompt)', () => {
    const result = buildConstrainedPrompt([{ role: 'user', content: 'y' }], undefined, 'none');

    // Constraint instructions belong to the --system-prompt channel, not the stdin payload.
    // Asserting absence here ensures the separation of concerns is preserved: if someone
    // accidentally re-introduces CONSTRAINT_INSTRUCTIONS into buildConstrainedPrompt, this
    // test will catch the regression.
    expect(result).not.toContain('API proxy');
    expect(result).not.toContain('Return only the JSON object');
    // Conversation content must be present.
    expect(result).toContain('y');
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

  it('T-11: system role message content appears in output without exception', () => {
    const messages: OpenAIMessage[] = [
      { role: 'system', content: 'You are a helpful proxy.' },
      { role: 'user', content: 'hello' },
    ];

    const result = buildConstrainedPrompt(messages, undefined, 'none');

    expect(result).toContain('You are a helpful proxy.');
    expect(result).toContain('hello');
  });

  it('T-12: tool role message content appears in output without exception', () => {
    const messages: OpenAIMessage[] = [
      { role: 'user', content: 'call fn' },
      { role: 'tool', content: '{"result": 42}', tool_call_id: 'call_abc123' },
    ];

    const result = buildConstrainedPrompt(messages, undefined, 'none');

    expect(result).toContain('tool:');
    expect(result).toContain('{"result": 42}');
    expect(result).toContain('call fn');
  });

  it('T-14: toolChoice "required" includes unconditional directive; "auto" does not (F3, SC-F3-1..SC-F3-4)', () => {
    const tools: OpenAITool[] = [
      {
        type: 'function',
        function: { name: 'do_thing', description: 'does a thing', parameters: {} },
      },
    ];
    const messages: OpenAIMessage[] = [{ role: 'user', content: 'hello' }];

    const requiredResult = buildConstrainedPrompt(messages, tools, 'required');
    const autoResult = buildConstrainedPrompt(messages, tools, 'auto');

    // required path must contain the unconditional directive
    expect(requiredResult).toContain('You MUST invoke one of the available functions');
    expect(requiredResult).toContain(
      'regardless of whether the conversation explicitly calls for it',
    );
    // auto path must NOT contain the unconditional directive
    expect(autoResult).not.toContain('You MUST invoke one of the available functions');
    // conversation content must be present in both
    expect(requiredResult).toContain('hello');
    expect(autoResult).toContain('hello');
    // directive must appear before the conversation turn (F3 placement — SC-F3-2)
    const directiveIdx = requiredResult.indexOf('You MUST invoke');
    const conversationIdx = requiredResult.indexOf('Conversation:');
    expect(directiveIdx).toBeLessThan(conversationIdx);
  });

  it('T-13: buildConstrainedPrompt output contains only serialized conversation and tools (return-format examples are in --system-prompt, not here)', () => {
    const result = buildConstrainedPrompt([{ role: 'user', content: 'x' }], undefined, 'none');

    // Return-format example JSON is part of CONSTRAINT_INSTRUCTIONS, delivered via
    // --system-prompt. Asserting absence here is the inverse contract of T-8: if the
    // format examples leak back into the stdin payload, injection detection may retrigger.
    expect(result).not.toContain('"type": "text"');
    expect(result).not.toContain('"type": "tool_call"');
    // Conversation must still be serialized.
    expect(result).toContain('Conversation:');
    expect(result).toContain('x');
  });
});
