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

// OpenAIChatRequest — hand-rolled Zod schema for Phase-1B fields (OD-3 LOCKED).
// Sub-schemas are implementation details of the composite; only the composite is exported.
// The inferred type is the builder's input (argumentBuilder.ts) and WS_05's parse target (proxy.ts).
const _OpenAIMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant', 'tool']),
  content: z.string().nullable(),
  name: z.string().optional(),
  tool_call_id: z.string().optional(),
});

const _OpenAIToolSchema = z.object({
  type: z.literal('function'),
  function: z.object({
    name: z.string(),
    description: z.string().optional(),
    parameters: z.record(z.string(), z.unknown()).optional(),
  }),
});

export const OpenAIChatRequestSchema = z.object({
  model: z.string(),
  messages: z.array(_OpenAIMessageSchema),
  tools: z.array(_OpenAIToolSchema).optional(),
  tool_choice: z.enum(['auto', 'required', 'none']).optional(),
  stream: z.boolean().optional(),
});

export type OpenAIChatRequest = z.infer<typeof OpenAIChatRequestSchema>;
