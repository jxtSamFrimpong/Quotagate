import type { OpenAIMessage, OpenAITool } from '../types.js';

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
