import { describe, expect, it } from 'vitest';

import { buildAdapterRequest } from '../src/argumentBuilder.js';
import type { OpenAIChatRequest } from '../src/types.js';

const model = 'claude-sonnet-4-6';
const baseMessages: OpenAIChatRequest['messages'] = [{ role: 'user', content: 'Hi' }];

describe('buildAdapterRequest', () => {
  it('T-1: messages pass through unmodified; no constraint text, no added system message', () => {
    const body: OpenAIChatRequest = { model, messages: baseMessages };
    const result = buildAdapterRequest(body);

    expect(result.messages).toEqual(baseMessages);

    // Separation-of-concerns guard: constraint instructions live in --system-prompt (claude.ts),
    // never in the translated AdapterRequest.
    for (const msg of result.messages) {
      if (msg.content !== null) {
        expect(msg.content).not.toMatch(/API proxy/);
        expect(msg.content).not.toMatch(/Return only the JSON object/);
      }
    }

    // No system-role message was injected by the builder.
    const injectedSystem = result.messages.filter(
      (m) => m.role === 'system' && !baseMessages.some((b) => b === m),
    );
    expect(injectedSystem).toHaveLength(0);
  });

  it('T-2: tools:[] deep-equals tools:undefined output (A2 / EF2)', () => {
    const withEmpty = buildAdapterRequest({ model, messages: baseMessages, tools: [] });
    const withUndefined = buildAdapterRequest({ model, messages: baseMessages, tools: undefined });
    expect(withEmpty).toEqual(withUndefined);
  });

  it('T-3: no extra keys on result; unsupported fields are dropped (SC-3 / EF3)', () => {
    const body = {
      model,
      messages: baseMessages,
      temperature: 0.7,
      n: 3,
    } as unknown as OpenAIChatRequest;
    const result = buildAdapterRequest(body);
    const allowed = new Set(['messages', 'tools', 'toolChoice']);
    for (const key of Object.keys(result)) {
      expect(allowed.has(key)).toBe(true);
    }
    expect(Object.prototype.hasOwnProperty.call(result, 'temperature')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(result, 'n')).toBe(false);
  });

  it('T-4: toolChoice pass-through — omitted → undefined; explicit "none" forwarded verbatim (OD-1 / EF1)', () => {
    const withOmitted = buildAdapterRequest({ model, messages: baseMessages });
    expect(withOmitted.toolChoice).toBeUndefined();
    // Builder never injects "auto" — that default belongs to the adapter (claude.ts L90).
    expect(withOmitted.toolChoice).not.toBe('auto');

    const withNone = buildAdapterRequest({ model, messages: baseMessages, tool_choice: 'none' });
    expect(withNone.toolChoice).toBe('none');
  });

  it('T-5: multi-message conversation order preserved (SC-1)', () => {
    const messages: OpenAIChatRequest['messages'] = [
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there' },
    ];
    const result = buildAdapterRequest({ model, messages });
    expect(result.messages).toHaveLength(3);
    expect(result.messages[0]).toEqual({ role: 'system', content: 'You are helpful.' });
    expect(result.messages[1]).toEqual({ role: 'user', content: 'Hello' });
    expect(result.messages[2]).toEqual({ role: 'assistant', content: 'Hi there' });
  });
});
