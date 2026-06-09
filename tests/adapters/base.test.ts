import { describe, expect, it } from 'vitest';

import type { AdapterRequest, AdapterResponse } from '../../src/types.js';
import type { CLIAdapter } from '../../src/adapters/base.js';

describe('CLIAdapter structural type check', () => {
  it('StubAdapter satisfies CLIAdapter without the implements keyword', () => {
    // WIZARD NOTE: stub satisfies structural type; return value is intentionally minimal
    class StubAdapter {
      readonly name = 'stub';

      async complete(_req: AdapterRequest): Promise<AdapterResponse> {
        return { raw: '', backend: 'claude-subprocess' as const };
      }

      async healthCheck(): Promise<boolean> {
        return true;
      }

      async install(): Promise<void> {
        return undefined;
      }
    }

    const adapter: CLIAdapter = new StubAdapter();
    expect(adapter.name).toBe('stub');
  });
});
