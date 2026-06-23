import { describe, expect, it, vi } from 'vitest';

import type { CLIAdapter } from '../src/adapters/base.js';
import type { QuotagateConfig } from '../src/config.js';
import { resolve } from '../src/router.js';

// Minimal stub — only the properties that resolve() cares about (none; it's interface-typed).
function makeAdapter(): CLIAdapter {
  return {
    name: 'stub',
    complete: vi.fn(),
    healthCheck: vi.fn(),
    install: vi.fn(),
  };
}

function makeConfig(models: QuotagateConfig['models']): QuotagateConfig {
  return { models, retry: { max_attempts: 3 } };
}

describe('resolve', () => {
  it('SC-R1: known alias with matching backend key returns the correct adapter', () => {
    const adapter = makeAdapter();
    const config = makeConfig({ 'claude-sonnet-4-6': { backend: 'claude' } });
    const adapters = { claude: adapter };

    const result = resolve('claude-sonnet-4-6', config, adapters);

    expect(result).toBe(adapter);
  });

  it('SC-R2: unknown alias (not in config.models) returns null', () => {
    const config = makeConfig({ 'claude-sonnet-4-6': { backend: 'claude' } });
    const adapters = { claude: makeAdapter() };

    const result = resolve('gpt-4o', config, adapters);

    expect(result).toBeNull();
  });

  it('SC-R3: known alias whose backend key is absent from adapters map returns null', () => {
    // config declares backend: "gemini" but only a "claude" adapter is registered —
    // simulates registering a model without providing its adapter.
    const config = makeConfig({ 'gemini-pro': { backend: 'gemini' } });
    const adapters = { claude: makeAdapter() };

    const result = resolve('gemini-pro', config, adapters);

    expect(result).toBeNull();
  });

  it('SC-R4: wrong key convention returns null (key must equal backend string exactly)', () => {
    // KEY CONVENTION INVARIANT: the adapters map key must exactly match the config backend
    // string. Using 'claude-subprocess' as the key when backend is 'claude' is wrong — these
    // are two different strings and resolve() must return null, not guess at equivalence.
    const config = makeConfig({ 'claude-sonnet-4-6': { backend: 'claude' } });
    const adapters = { 'claude-subprocess': makeAdapter() }; // wrong key — backend is 'claude'

    const result = resolve('claude-sonnet-4-6', config, adapters);

    expect(result).toBeNull();
  });

  it('SC-R5: resolve is a pure synchronous function — returns CLIAdapter | null directly', () => {
    const adapter = makeAdapter();
    const config = makeConfig({ 'claude-sonnet-4-6': { backend: 'claude' } });
    const adapters = { claude: adapter };

    const result = resolve('claude-sonnet-4-6', config, adapters);

    // A Promise would be an object and result.then would be a function.
    // A CLIAdapter is also an object — assert it is NOT a Promise.
    expect(result).not.toBeNull();
    expect(typeof (result as unknown as Promise<unknown>).then).not.toBe('function');
    expect(result).toBe(adapter);
  });
});
