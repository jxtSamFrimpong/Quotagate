import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { parse } from 'yaml';
import { z, ZodError } from 'zod';

import { QuotagateError } from './errors.js';

const ModelEntrySchema = z.object({
  backend: z.string(),
  priority: z.number().optional(),
});

// mcp stub accepts any Phase-2 keys silently; fallback_to_subprocess_after_failures is Phase-2.
export const QuotagateConfigSchema = z.object({
  models: z.record(z.string(), ModelEntrySchema),
  retry: z.object({
    max_attempts: z.number().int().positive(),
    fallback_to_subprocess_after_failures: z.number().int().positive().optional(),
  }),
  mcp: z.record(z.string(), z.unknown()).optional(),
});

export type QuotagateConfig = z.infer<typeof QuotagateConfigSchema>;
export type ModelEntry = z.infer<typeof ModelEntrySchema>;

const DEFAULT_CONFIG_PATH = path.join(os.homedir(), '.quotagate', 'config.yaml');

// All failures (ENOENT, YAML, Zod) are re-thrown as QuotagateError — raw errors never escape.
export function loadConfig(configPath?: string): QuotagateConfig {
  const resolvedPath = configPath ?? DEFAULT_CONFIG_PATH;

  let content: string;
  try {
    content = fs.readFileSync(resolvedPath, 'utf8');
  } catch (err) {
    const nodeErr = err as NodeJS.ErrnoException;
    if (nodeErr.code === 'ENOENT') {
      throw new QuotagateError(
        `No config found at ${resolvedPath}. Create it with:\n\n` +
          `  models:\n` +
          `    claude-sonnet-4-6: { backend: claude, priority: 1 }\n` +
          `  retry:\n` +
          `    max_attempts: 3\n`,
      );
    }
    throw new QuotagateError(`Could not read config at ${resolvedPath}: ${nodeErr.message}`);
  }

  let rawObject: unknown;
  try {
    rawObject = parse(content);
  } catch (err) {
    const summary = err instanceof Error ? err.message.split('\n')[0] : 'unknown YAML error';
    throw new QuotagateError(`config.yaml is not valid YAML: ${summary}`);
  }

  try {
    return QuotagateConfigSchema.parse(rawObject);
  } catch (err) {
    if (err instanceof ZodError) {
      const detail = err.errors
        .map((e) => `${e.path.join('.') || '(root)'}: ${e.message}`)
        .join('; ');
      throw new QuotagateError(`config.yaml failed validation: ${detail}`);
    }
    throw new QuotagateError(`config.yaml failed validation: unexpected error`);
  }
}
