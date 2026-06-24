import { fileURLToPath } from 'node:url';

import { loadConfig } from './config.js';
import { ClaudeAdapter } from './adapters/claude.js';
import { createServer } from './proxy.js';
import { QuotagateError } from './errors.js';

// EF3: healthCheck throws (non-ENOENT spawn failure) — propagate as unhandled rejection.
// This is a bug in the adapter, not an operator error; the unhandled-rejection handler
// in Node prints the error and exits non-zero. Acceptable for Phase 1.
export async function main(argv?: string[]): Promise<void> {
  const cmd = argv?.[0];

  switch (cmd) {
    case 'start': {
      let config;
      try {
        config = loadConfig();
      } catch (err) {
        // EF1: loadConfig throws QuotagateError — print message (no stack trace), exit 1.
        if (err instanceof QuotagateError) {
          process.stderr.write(err.message + '\n');
          process.exit(1);
        }
        throw err;
      }

      const adapter = new ClaudeAdapter();
      const healthy = await adapter.healthCheck();

      if (!healthy) {
        // EF2: healthCheck returned false — actionable guidance, exit 1.
        process.stderr.write(
          "Claude CLI is not installed or not authenticated. Run 'claude auth status' to verify.\n",
        );
        process.exit(1);
      }

      const adapters = { claude: adapter };
      const server = createServer(config, adapters);

      try {
        await server.listen({ port: 8080, host: '127.0.0.1' });
      } catch (err) {
        // EF4: listen failed (e.g. port already in use) — message must include port, exit 1.
        const msg = err instanceof Error ? err.message : String(err);
        process.stderr.write(`Failed to start server on port 8080: ${msg}\n`);
        process.exit(1);
      }

      console.log('Quotagate running on localhost:8080. Backend: claude');
      break;
    }

    case 'status':
    case 'backends': {
      console.log('not implemented in Phase 1');
      break;
    }

    default: {
      // EF5: unknown or missing subcommand.
      const label = cmd !== undefined ? cmd : '(none)';
      process.stderr.write(`Unknown command: ${label}. Available: start\n`);
      process.exit(1);
    }
  }
}

// Only invoke when this file is the direct Node entry point, not when imported by tests.
// fileURLToPath normalizes the ESM import.meta.url to a filesystem path for comparison.
// void is correct here: unhandled rejections (EF3) surface via Node's unhandledRejection handler.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void main(process.argv.slice(2));
}
