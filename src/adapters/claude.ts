import { spawn } from 'node:child_process';

import type { CLIAdapter } from './base.js';
import { TransportError } from '../errors.js';
import type { AdapterRequest, AdapterResponse, OpenAIMessage, OpenAITool } from '../types.js';

// Minimum env vars confirmed by empirical spike (WS_02-D2-allowlist, 2026-06-09):
// - PATH: required for subprocess binary resolution by the OS
// - USER: required for claude subscription auth (os.homedir() falls back to passwd lookup,
//         but the auth token lookup path requires USER identity)
// HOME is intentionally excluded: empirical spike confirmed claude --print authenticates
// successfully without $HOME (spike step 3, 2026-06-09). Node-based CLIs fall back to the
// passwd UID entry via os.homedir() when $HOME is absent (POSIX). Would reveal a filesystem
// path if included. Re-validate on Linux CI — confirmed macOS only (darwin 25.5.0).
const ENV_ALLOWLIST = ['PATH', 'USER'] as const;

/* @internal */
export function sanitisedEnv(): Record<string, string> {
  const result: Record<string, string> = {};
  for (const key of ENV_ALLOWLIST) {
    const value = process.env[key];
    if (value !== undefined) {
      result[key] = value;
    }
  }
  return result;
}

const CONSTRAINT_INSTRUCTIONS =
  'Pure inference endpoint for the Quotagate proxy.\n' +
  '\n' +
  'Given a conversation history and optional function schemas, determines\n' +
  'the appropriate response — either a function call declaration or a\n' +
  'direct text response.\n' +
  '\n' +
  'CRITICAL BEHAVIOUR RULES:\n' +
  '- Returns ONLY a raw JSON object. No prose, no markdown, no backticks.\n' +
  '- Never executes any function, even if the function name is recognisable.\n' +
  '- Never uses bash, edit_file, computer_use, or any other Claude Code tool.\n' +
  '- Never reads files, accesses the network, or takes any action.\n' +
  '- This is a pure reasoning task. Reason and declare. Do not act.\n' +
  '\n' +
  'Return format when a function should be called:\n' +
  '{"type": "tool_call", "name": "<function_name>", "arguments": {...}}\n' +
  '\n' +
  'Return format when no function is needed:\n' +
  '{"type": "text", "content": "<response>"}';

/* @internal */
export function buildConstrainedPrompt(
  messages: OpenAIMessage[],
  tools: OpenAITool[] | undefined,
  toolChoice: string,
): string {
  const parts: string[] = [CONSTRAINT_INSTRUCTIONS];

  const normalizedTools = tools && tools.length > 0 ? tools : undefined;

  if (normalizedTools !== undefined) {
    parts.push('\nAvailable functions (toolChoice: ' + toolChoice + '):');
    for (const tool of normalizedTools) {
      const fn = tool.function;
      parts.push(
        '- name: ' +
          fn.name +
          '\n  description: ' +
          (fn.description ?? '') +
          '\n  parameters: ' +
          JSON.stringify(fn.parameters ?? {}),
      );
    }
  }

  parts.push('\nConversation:');
  for (const message of messages) {
    const contentText = message.content === null ? '[tool call]' : message.content;
    parts.push(message.role + ': ' + contentText);
  }

  return parts.join('\n');
}

export class ClaudeAdapter implements CLIAdapter {
  readonly name = 'claude-subprocess';

  async complete(req: AdapterRequest): Promise<AdapterResponse> {
    return this._completeViaSubprocess(req);
  }

  private _completeViaSubprocess(req: AdapterRequest): Promise<AdapterResponse> {
    const prompt = buildConstrainedPrompt(req.messages, req.tools, req.toolChoice ?? 'auto');

    return new Promise((resolve, reject) => {
      const child = spawn('claude', ['--print'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: sanitisedEnv(),
      });

      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];

      child.stdout.on('data', (chunk: Buffer) => {
        stdoutChunks.push(chunk);
      });

      child.stderr.on('data', (chunk: Buffer) => {
        stderrChunks.push(chunk);
      });

      child.stdin!.write(prompt);
      child.stdin!.end();

      child.on('error', (err: Error) => {
        reject(new TransportError(`claude --print spawn failed: ${err.message}`));
      });

      child.on('close', (code: number | null) => {
        const stdout = Buffer.concat(stdoutChunks).toString('utf8');
        const stderrContent = Buffer.concat(stderrChunks).toString('utf8');

        if (code !== 0 && stdout.trim() === '') {
          reject(
            new TransportError(`claude --print exited with code ${code}; stderr: ${stderrContent}`),
          );
          return;
        }

        resolve({ raw: stdout, backend: 'claude-subprocess' as const });
      });
    });
  }

  async healthCheck(): Promise<boolean> {
    return new Promise((resolve, reject) => {
      const child = spawn('claude', ['auth', 'status'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: sanitisedEnv(),
      });

      child.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'ENOENT') {
          resolve(false);
        } else {
          reject(err);
        }
      });

      child.on('close', (code: number | null) => {
        resolve(code === 0);
      });
    });
  }

  async install(): Promise<void> {
    throw new Error('install() not implemented in Phase 1 — MCP registration is Phase 2');
  }
}
