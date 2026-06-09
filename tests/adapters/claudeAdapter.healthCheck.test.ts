import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Must be hoisted above all imports from the module under test so Vitest's
// mock hoisting can intercept the 'node:child_process' import in claude.ts.
vi.mock('node:child_process', () => ({ spawn: vi.fn() }));

import { spawn } from 'node:child_process';
import { ClaudeAdapter } from '../../src/adapters/claude.js';

// ---------------------------------------------------------------------------
// Helper: build a minimal fake ChildProcess with controllable event emission.
// ---------------------------------------------------------------------------
interface MockChildOptions {
  errorEvent?: NodeJS.ErrnoException;
  closeCode?: number | null;
}

function makeMockChild(opts: MockChildOptions): ChildProcess {
  const emitter = new EventEmitter();

  // Attach minimal stream-shaped properties so TypeScript and the SUT are happy.
  const child = emitter as unknown as ChildProcess;
  (child as unknown as Record<string, unknown>)['stdin'] = {
    write: vi.fn(),
    end: vi.fn(),
  };
  (child as unknown as Record<string, unknown>)['stdout'] = new EventEmitter();
  (child as unknown as Record<string, unknown>)['stderr'] = new EventEmitter();

  // Schedule the chosen event after the Promise constructor has had a chance
  // to attach its handlers — setImmediate fires after the current micro-task
  // queue is drained.
  if (opts.errorEvent !== undefined) {
    const err = opts.errorEvent;
    setImmediate(() => {
      emitter.emit('error', err);
    });
  } else if (opts.closeCode !== undefined) {
    const code = opts.closeCode ?? null;
    setImmediate(() => {
      emitter.emit('close', code);
    });
  }

  return child;
}

// ---------------------------------------------------------------------------

describe('ClaudeAdapter.healthCheck', () => {
  let adapter: ClaudeAdapter;
  const spawnMock = spawn as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    adapter = new ClaudeAdapter();
    vi.clearAllMocks();
  });

  it('T-1: healthCheck returns true when probe exits 0', async () => {
    spawnMock.mockReturnValue(makeMockChild({ closeCode: 0 }));

    const result = await adapter.healthCheck();

    expect(result).toBe(true);
  });

  it('T-2: healthCheck returns false (not throws) when claude binary is missing (ENOENT)', async () => {
    const enoentErr = Object.assign(new Error('spawn claude ENOENT'), {
      code: 'ENOENT',
    }) as NodeJS.ErrnoException;
    spawnMock.mockReturnValue(makeMockChild({ errorEvent: enoentErr }));

    let result: boolean | undefined;
    let threw = false;
    try {
      result = await adapter.healthCheck();
    } catch {
      threw = true;
    }

    expect(threw).toBe(false);
    expect(result).toBe(false);
  });

  it('T-3: install() throws with a message referencing Phase 1 and/or Phase 2', async () => {
    const error = await adapter.install().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/Phase [12]/);
  });

  it('T-4: healthCheck returns false (not throws) when probe exits non-zero', async () => {
    spawnMock.mockReturnValue(makeMockChild({ closeCode: 1 }));

    let result: boolean | undefined;
    let threw = false;
    try {
      result = await adapter.healthCheck();
    } catch {
      threw = true;
    }

    expect(threw).toBe(false);
    expect(result).toBe(false);
  });
});
