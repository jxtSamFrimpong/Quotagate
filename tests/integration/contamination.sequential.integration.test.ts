import { describe, expect, it } from 'vitest';
import { ClaudeAdapter } from '../../src/adapters/claude.js';
import type { CLIAdapter } from '../../src/adapters/base.js';
import { QuotagateCompleteResultSchema } from '../../src/types.js';

// WS_03-D3: fixed UUID constant — never crypto.randomUUID()
// This token is designed to be unique enough that coincidental appearance is
// astronomically unlikely. Do not change this value without updating the decision log.
const TOKEN = '8f3a1c2d-9e4b-4f7a-b6c5-1d2e3f4a5b6c';

describe('sequential contamination probe', () => {
  it(
    'T-I3: call B response contains no trace of call A token',
    // EF-T3-1: two serial model calls — each call requires a fresh subprocess spawn.
    // EF-T3-3: when the full integration suite runs concurrently (3 fork workers), T-I3 bears
    // the two-call overhead under concurrent fork pressure; 60 s proved insufficient empirically.
    // Raised to 90 s — provides ~45 s per call budget under concurrent load.
    { timeout: 90_000 },
    async (ctx) => {
      const adapter: CLIAdapter = new ClaudeAdapter();
      const healthy = await adapter.healthCheck();
      if (!healthy) {
        ctx.skip();
        return;
      }

      // Call A: inject the TOKEN into the conversation context
      const responseA = await adapter.complete({
        messages: [
          {
            role: 'user',
            content: `Remember this code word for later: ${TOKEN}. Acknowledge you have noted it.`,
          },
        ],
      });

      // Assert Call A Zod-parses correctly (EF5: fail here if constraint is broken, not at TOKEN assertion)
      const parsedA = JSON.parse(responseA.raw);
      const resultA = QuotagateCompleteResultSchema.safeParse(parsedA);
      expect(resultA.success, 'Call A response did not parse as QuotagateCompleteResult').toBe(
        true,
      );
      expect(resultA.data?.type).toBe('text');

      // Call B: generic probe with no reference to the TOKEN or Call A
      const responseB = await adapter.complete({
        messages: [
          {
            role: 'user',
            content:
              'What is 2 plus 2? Respond only with the JSON format specified in your instructions.',
          },
        ],
      });

      // Assert Call B Zod-parses correctly
      const parsedB = JSON.parse(responseB.raw);
      const resultB = QuotagateCompleteResultSchema.safeParse(parsedB);
      expect(resultB.success, 'Call B response did not parse as QuotagateCompleteResult').toBe(
        true,
      );
      expect(resultB.data?.type).toBe('text');

      // Contamination assertion: TOKEN must be absent from Call B's raw response
      expect(
        responseB.raw,
        'TOKEN found in Call B response — contamination detected',
      ).not.toContain(TOKEN);
    },
  );
});
