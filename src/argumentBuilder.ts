import type { AdapterRequest, OpenAIChatRequest } from './types.js';

export function buildAdapterRequest(body: OpenAIChatRequest): AdapterRequest {
  const tools = body.tools && body.tools.length > 0 ? body.tools : undefined;

  const result: AdapterRequest = { messages: body.messages };
  if (tools !== undefined) result.tools = tools;
  if (body.tool_choice !== undefined) result.toolChoice = body.tool_choice;

  return result;
}
