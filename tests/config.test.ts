import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';

import { QuotagateError } from '../src/errors.js';
import { type QuotagateConfig, loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  // T-1: valid minimal fixture parses into typed QuotagateConfig (SC-1, SC-6, A1)
  // Exercises the full happy path: file read → YAML parse → Zod validate → typed return.
  it('T-1: valid minimal fixture returns typed QuotagateConfig', () => {
    const result: QuotagateConfig = loadConfig('tests/fixtures/config.minimal.yaml');
    expect(result.models).toBeDefined();
    const keys = Object.keys(result.models);
    expect(keys.length).toBeGreaterThanOrEqual(1);
    const entry = result.models[keys[0]];
    expect(typeof entry?.backend).toBe('string');
    expect(typeof result.retry.max_attempts).toBe('number');
  });

  // T-2: YAML missing `models` key → QuotagateError, not ZodError (SC-2, EF3, A3)
  // The raw ZodError must not escape the loadConfig boundary.
  it('T-2: missing models key throws QuotagateError — ZodError must not escape', () => {
    let caught: unknown;
    try {
      loadConfig('tests/fixtures/config.no_models.yaml');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(QuotagateError);
    expect(caught).not.toBeInstanceOf(ZodError);
    const msg = (caught as QuotagateError).message;
    expect(msg.toLowerCase()).toMatch(/validation|models/);
  });

  // T-3: file not found → QuotagateError with resolved path in message (SC-3, EF1, A3)
  // The raw ENOENT NodeJS.ErrnoException must not escape.
  it('T-3: nonexistent path throws QuotagateError containing the path', () => {
    const missingPath = '/tmp/does_not_exist_quotagate_test.yaml';
    let caught: unknown;
    try {
      loadConfig(missingPath);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(QuotagateError);
    expect((caught as QuotagateError).message).toContain(missingPath);
  });

  // T-4: unknown top-level key is stripped from result (SC-4, A2)
  // Zod's default strip mode silently drops keys not declared in the schema.
  it('T-4: unknown top-level key is stripped — not present on parsed result', () => {
    const result = loadConfig('tests/fixtures/config.unknown_key.yaml');
    expect(result).not.toHaveProperty('unknown_key');
    expect(result.models).toBeDefined();
  });

  // T-5: fixture with Phase-2 MCP keys parses without error (SC-5, A4)
  // The mcp stub schema (z.record(z.unknown())) must silently accept any MCP keys
  // from spec §3.9 so a Phase-2-ready config file works today.
  it('T-5: fixture with spec §3.9 MCP keys parses without throwing', () => {
    const result = loadConfig('tests/fixtures/config.with_mcp.yaml');
    expect(result).toBeDefined();
    expect(result.mcp).toBeDefined();
  });
});
