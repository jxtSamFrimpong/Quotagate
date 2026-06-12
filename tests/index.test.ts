import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { QuotagateError } from '../src/errors.js';
import type { QuotagateConfig } from '../src/config.js';

// ---------------------------------------------------------------------------
// vi.hoisted() — values initialized before vi.mock() factory hoisting runs.
// Without this, the factory closures capture uninitialized `let` bindings and
// throw "Cannot access before initialization".
// ---------------------------------------------------------------------------

const { mockLoadConfig, mockHealthCheck, mockListen } = vi.hoisted(() => {
  return {
    mockLoadConfig: vi.fn<() => QuotagateConfig>(),
    mockHealthCheck: vi.fn<() => Promise<boolean>>(),
    mockListen: vi.fn<() => Promise<void>>(),
  };
});

// ---------------------------------------------------------------------------
// Module mocks — factories close over the hoisted references above.
// ---------------------------------------------------------------------------

vi.mock('../src/config.js', () => ({
  loadConfig: mockLoadConfig,
}));

vi.mock('../src/adapters/claude.js', () => ({
  // Must be a regular function (not arrow) so `new ClaudeAdapter()` works as a constructor.
  ClaudeAdapter: vi.fn(function () {
    return {
      name: 'claude-subprocess',
      healthCheck: mockHealthCheck,
      complete: vi.fn(),
      install: vi.fn(),
    };
  }),
}));

vi.mock('../src/proxy.js', () => ({
  createServer: vi.fn(() => ({
    listen: mockListen,
    close: vi.fn<() => Promise<void>>(),
  })),
}));

// ---------------------------------------------------------------------------
// Import the unit under test — after vi.mock() so mocked deps are in place.
// ---------------------------------------------------------------------------

import { main } from '../src/index.js';

// ---------------------------------------------------------------------------
// Fixture: a valid config returned by loadConfig on the happy path.
// ---------------------------------------------------------------------------

const validConfig: QuotagateConfig = {
  models: { 'claude-sonnet-4-6': { backend: 'claude', priority: 1 } },
  retry: { max_attempts: 3 },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CLI entrypoint — main() (WS_05 T4)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default happy-path stubs; individual tests override as needed.
    mockLoadConfig.mockReturnValue(validConfig);
    mockHealthCheck.mockResolvedValue(true);
    mockListen.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // T-1: healthCheck returns false → process.exit(1), stderr contains guidance
  // -------------------------------------------------------------------------
  it('T-1: healthCheck() === false → process.exit(1); stderr contains actionable guidance', async () => {
    mockHealthCheck.mockResolvedValueOnce(false);

    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((_code?: number | string | null | undefined) => {
        throw new Error('process.exit called');
      });

    await expect(main(['start'])).rejects.toThrow('process.exit called');

    expect(exitSpy).toHaveBeenCalledWith(1);

    const written = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(written).toMatch(/not installed|not authenticated/i);
  });

  // -------------------------------------------------------------------------
  // T-2: loadConfig throws QuotagateError → process.exit(1), no unhandled rejection
  // -------------------------------------------------------------------------
  it('T-2: loadConfig() throws QuotagateError → process.exit(1); error not re-thrown', async () => {
    mockLoadConfig.mockImplementation(() => {
      throw new QuotagateError('config.yaml not found at /project/config.yaml');
    });

    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((_code?: number | string | null | undefined) => {
        throw new Error('process.exit called');
      });

    // Must not propagate as an unhandled rejection — process.exit(1) is the terminal action.
    await expect(main(['start'])).rejects.toThrow('process.exit called');

    expect(exitSpy).toHaveBeenCalledWith(1);

    const written = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(written).toContain('config.yaml not found');
  });

  // -------------------------------------------------------------------------
  // T-3: unknown subcommand → process.exit(1); output names the bad command
  // -------------------------------------------------------------------------
  it('T-3: unknown subcommand "deploy" → process.exit(1); output contains "deploy" or "Unknown command"', async () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((_code?: number | string | null | undefined) => {
        throw new Error('process.exit called');
      });

    await expect(main(['deploy'])).rejects.toThrow('process.exit called');

    expect(exitSpy).toHaveBeenCalledWith(1);

    const written = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(written).toMatch(/deploy|Unknown command/i);
  });

  // -------------------------------------------------------------------------
  // T-4: happy path → server.listen called with correct address; process.exit NOT called
  // -------------------------------------------------------------------------
  it('T-4: happy path → server.listen({ port: 8080, host: "127.0.0.1" }); process.exit not called', async () => {
    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((_code?: number | string | null | undefined) => {
        throw new Error('process.exit called unexpectedly');
      });

    await expect(main(['start'])).resolves.toBeUndefined();

    expect(mockLoadConfig).toHaveBeenCalledWith();
    expect(mockListen).toHaveBeenCalledWith({ port: 8080, host: '127.0.0.1' });
    expect(exitSpy).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // T-5: quotagate status stub → no crash; process.exit not called with non-zero
  // -------------------------------------------------------------------------
  it('T-5: main(["status"]) → resolves without throwing; process.exit not called', async () => {
    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((_code?: number | string | null | undefined) => {
        throw new Error('process.exit called unexpectedly');
      });

    await expect(main(['status'])).resolves.toBeUndefined();

    expect(exitSpy).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // T-6: server.listen() rejects → process.exit(1); stderr contains port number (covers EF4)
  // -------------------------------------------------------------------------
  it('T-6: server.listen() rejects → process.exit(1); stderr contains port number', async () => {
    mockListen.mockRejectedValueOnce(new Error('address already in use'));

    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((_code?: number | string | null | undefined) => {
        throw new Error('process.exit called');
      });

    await expect(main(['start'])).rejects.toThrow('process.exit called');

    expect(exitSpy).toHaveBeenCalledWith(1);

    const written = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(written).toContain('8080');
  });
});
