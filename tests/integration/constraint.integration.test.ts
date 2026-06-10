import { describe, it, expect } from 'vitest';
import { ClaudeAdapter } from '../../src/adapters/claude.js';
import type { CLIAdapter } from '../../src/adapters/base.js';
import { QuotagateCompleteResultSchema } from '../../src/types.js';

describe('constraint integration', () => {
  it(
    'T-I1: adapter.complete() returns Zod-valid {type:"text"} for a no-tools message',
    // Warm runs take 5–7 s; cold-start (fresh Vitest process, first claude invocation) can
    // exceed 15 s. 30 s gives cold starts a reliable margin without masking genuine hangs.
    { timeout: 30_000 },
    async (ctx) => {
      const adapter: CLIAdapter = new ClaudeAdapter();
      const healthy = await adapter.healthCheck();
      if (!healthy) {
        ctx.skip();
        return;
      }

      const response = await adapter.complete({
        messages: [{ role: 'user', content: 'Reply with only the word "pong". No other text.' }],
      });

      // EF3: let SyntaxError propagate — do not catch; a SyntaxError here means the
      // constraint is not working, not a test infrastructure bug
      const parsed: unknown = JSON.parse(response.raw);
      const result = QuotagateCompleteResultSchema.safeParse(parsed);

      expect(result.success, 'raw response did not parse as QuotagateCompleteResult').toBe(true);
      if (result.success && result.data.type === 'text') {
        expect(result.data.content.length).toBeGreaterThan(0);
      } else if (result.success) {
        // Force a descriptive failure if the type is wrong — do not silently pass
        expect(result.data.type, 'expected text response but got tool_call').toBe('text');
      }
      expect(response.backend).toBe('claude-subprocess');
    },
  );
});
