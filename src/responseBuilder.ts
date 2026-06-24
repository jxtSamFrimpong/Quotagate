import { randomUUID } from 'node:crypto';

import type { ChatCompletion } from 'openai/resources/chat/completions';

import type { QuotagateCompleteResult } from './types.js';

export function buildChatCompletion(
  result: QuotagateCompleteResult,
  model: string,
): ChatCompletion {
  if (result.type === 'tool_call') {
    return {
      id: 'chatcmpl-' + randomUUID(),
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: null,
            refusal: null,
            tool_calls: [
              {
                // Phase 3: real OpenAI call_ IDs use base62 (mixed-case alphanumeric);
                // UUID hex is sufficient for Phase 1 uniqueness but not byte-for-byte identical.
                id: 'call_' + randomUUID().replace(/-/g, '').slice(0, 24),
                type: 'function',
                function: {
                  name: result.name,
                  arguments: JSON.stringify(result.arguments),
                },
              },
            ],
          },
          finish_reason: 'tool_calls',
          logprobs: null,
        },
      ],
    };
  }

  return {
    id: 'chatcmpl-' + randomUUID(),
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: result.content,
          refusal: null,
        },
        finish_reason: 'stop',
        logprobs: null,
      },
    ],
  };
}
