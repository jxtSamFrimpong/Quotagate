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

// Execution suppression is a transport guarantee: claude --print does not execute tool calls,
// it only prints the model's output. This constraint text governs output format only — do not
// add capability-suppression language here; it triggers injection-detection heuristics.
const CONSTRAINT_INSTRUCTIONS =
  'You are processing a completion request for an API proxy. Reason about the conversation\n' +
  'and the available functions, then return a single JSON object in one of two formats.\n' +
  '\n' +
  'If the conversation calls for invoking one of the available functions, return:\n' +
  '{"type": "tool_call", "name": "<function_name>", "arguments": {...}}\n' +
  '\n' +
  'If the conversation calls for a direct text response, return:\n' +
  '{"type": "text", "content": "<response>"}\n' +
  '\n' +
  'Return only the JSON object. No prose, no markdown fences, no explanation.';

/* @internal */
export function buildConstrainedPrompt(
  messages: OpenAIMessage[],
  tools: OpenAITool[] | undefined,
  toolChoice: string,
): string {
  // CONSTRAINT_INSTRUCTIONS is delivered via --system-prompt (privileged channel) in
  // _completeViaSubprocess — not prepended here. This function serializes tools and
  // conversation only so the system-prompt channel stays clean and decoupled from the
  // user-turn payload.
  const parts: string[] = [];

  const normalizedTools = tools && tools.length > 0 ? tools : undefined;

  if (normalizedTools !== undefined) {
    parts.push('Available functions (toolChoice: ' + toolChoice + '):');
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

  parts.push('Conversation:');
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
      // CONSTRAINT_INSTRUCTIONS routes through --system-prompt (privileged system channel),
      // not through stdin. This prevents the model's injection-detection heuristics from
      // treating the format specification as an adversarial payload — stdin-injected capability
      // constraints trigger safety heuristics; system-prompt-delivered ones do not.
      const child = spawn('claude', ['--print', '--system-prompt', CONSTRAINT_INSTRUCTIONS], {
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

        resolve({ raw: stdout.trim(), backend: 'claude-subprocess' as const });
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
