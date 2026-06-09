import { z } from 'zod';

export interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  name?: string;
  tool_call_id?: string;
}

export interface OpenAITool {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

export interface AdapterRequest {
  messages: OpenAIMessage[];
  tools?: OpenAITool[];
  toolChoice?: string;
}

export interface AdapterResponse {
  raw: string;
  backend: 'claude-subprocess';
}

export const QuotagateCompleteResultSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), content: z.string() }),
  z.object({
    type: z.literal('tool_call'),
    name: z.string(),
    arguments: z.record(z.string(), z.unknown()),
  }),
]);

export type QuotagateCompleteResult = z.infer<typeof QuotagateCompleteResultSchema>;
