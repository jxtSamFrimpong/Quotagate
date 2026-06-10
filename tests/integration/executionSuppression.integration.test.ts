import * as fs from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { CLIAdapter } from '../../src/adapters/base.js';
import { ClaudeAdapter } from '../../src/adapters/claude.js';
import { QuotagateCompleteResultSchema } from '../../src/types.js';

const SENTINEL_PATH = '/tmp/quotagate-exec-suppression-sentinel.txt';
const SENTINEL_CONTENT = 'sentinel content for execution suppression test';

describe('execution suppression integration', () => {
  beforeAll(() => {
    fs.writeFileSync(SENTINEL_PATH, SENTINEL_CONTENT, 'utf8');
  });

  afterAll(() => {
    fs.rmSync(SENTINEL_PATH, { force: true });
  });

  it(
    'T-I2: adapter.complete() with read_file tool returns tool_call declaration without reading the sentinel file',
    // Warm runs take 5–7 s; cold-start (fresh Vitest process, first claude invocation) can
    // exceed 15 s — matching T-I1's empirically validated margin. EF-T3-3: when the full
    // integration suite runs concurrently (3 fork workers), 30 s proved insufficient under
    // concurrent fork load. Raised to 60 s to match T-I3 — same rationale, same evidence.
    { timeout: 60_000 },
    async (ctx) => {
      const adapter: CLIAdapter = new ClaudeAdapter();
      const healthy = await adapter.healthCheck();
      if (!healthy) {
        ctx.skip();
        return;
      }

      const response = await adapter.complete({
        messages: [
          {
            role: 'user',
            content: `Read the file at ${SENTINEL_PATH} and tell me its contents.`,
          },
        ],
        tools: [
          {
            type: 'function',
            function: {
              name: 'read_file',
              description: 'Read the contents of a file at the given path.',
              parameters: {
                type: 'object',
                properties: { path: { type: 'string', description: 'The file path to read.' } },
                required: ['path'],
              },
            },
          },
        ],
        toolChoice: 'auto',
      });

      // EF3: let SyntaxError propagate — do not catch; a SyntaxError here means the
      // constraint is not working, not a test infrastructure bug
      const parsed: unknown = JSON.parse(response.raw);
      const result = QuotagateCompleteResultSchema.safeParse(parsed);

      expect(result.success, 'raw response did not parse as QuotagateCompleteResult').toBe(true);

      if (result.success && result.data.type === 'tool_call') {
        expect(result.data.name).toBe('read_file');
        expect(typeof result.data.arguments['path']).toBe('string');
      } else if (result.success) {
        // Force a descriptive failure — do not silently accept text when tool_call is required
        expect(result.data.type, 'expected tool_call response but got text').toBe('tool_call');
      }

      // Core invariant #1 assertion: the file was declared for reading, never executed.
      // SENTINEL_CONTENT appearing in the response would mean the subprocess read the file
      // contents — proving execution suppression has failed.
      expect(
        response.raw,
        'sentinel file contents found in response — execution suppression failed',
      ).not.toContain(SENTINEL_CONTENT);

      expect(response.backend).toBe('claude-subprocess');
    },
  );
});
