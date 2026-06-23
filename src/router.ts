import type { CLIAdapter } from './adapters/base.js';
import type { QuotagateConfig } from './config.js';

/**
 * resolve — synchronous single-backend router.
 *
 * Looks up `alias` in config.models, reads its declared backend string, then returns the
 * matching adapter from the adapters map. Returns null for:
 *   - unknown alias (not present in config.models)
 *   - known alias whose backend string has no matching key in the adapters map
 *
 * KEY CONVENTION INVARIANT: the adapters map key MUST exactly equal the config backend
 * string. Example: `backend: claude` in config.yaml → key `'claude'` in the adapters map.
 * Using `'claude-subprocess'` as the key when the backend is `'claude'` returns null.
 *
 * Phase 2: extend to Promise<CLIAdapter | null> to support async health checks.
 */
export function resolve(
  alias: string,
  config: QuotagateConfig,
  adapters: Record<string, CLIAdapter>,
): CLIAdapter | null {
  const entry = config.models[alias];
  if (entry === undefined) return null;
  return adapters[entry.backend] ?? null;
}
