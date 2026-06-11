import {
  QuotagateCompleteResultSchema,
  type AdapterResponse,
  type OpenAIMessage,
  type QuotagateCompleteResult,
} from './types.js';
import { ValidationError } from './errors.js';

/**
 * parseAndValidate — pure parse-and-validate core (OD-5 LOCKED).
 *
 * Takes the raw string returned by adapter.complete() (AdapterResponse.raw),
 * parses it as JSON, and validates it against QuotagateCompleteResultSchema.
 *
 * Returns a typed QuotagateCompleteResult on success.
 * Throws ValidationError on any failure (malformed JSON or schema mismatch).
 *
 * Invariants (all locked decisions):
 * - OD-5: Pure core — no invoker, no attempt counter, no adapter knowledge.
 *   The retry orchestrator (validateWithRetry) is T3, wrapping this function.
 * - OD-6: Does NOT strip markdown fences or normalize output. Fenced output
 *   fails JSON.parse → ValidationError → retry (T3). Normalizing would mask
 *   a constraint regression.
 * - OD-7: A schema-valid {type:"tool_call",...} resolves faithfully. The
 *   responseBuilder is the single rejection point for the unsupported branch.
 * - Error containment: SyntaxError and ZodError never escape this boundary.
 *   Only ValidationError exits as a failure.
 * - Error messages are content-free: raw / model output is never embedded in
 *   the ValidationError message (WS_04-D3 contamination guard).
 */
export function parseAndValidate(raw: string): QuotagateCompleteResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ValidationError('Invalid JSON: raw output could not be parsed as JSON');
  }

  const result = QuotagateCompleteResultSchema.safeParse(parsed);
  if (!result.success) {
    throw new ValidationError(
      'Schema validation failed: raw output did not match QuotagateCompleteResultSchema',
    );
  }

  return result.data;
}

/**
 * CORRECTION_NOTE — static, content-free correction prompt appended on each retry.
 *
 * Invariants (all locked — WS_04-D3):
 * - Content is static: it never embeds anything from the malformed prior response.
 * - Wording is locked: WS_08's contamination test will assert its structure.
 * - Appended once per retry, rebuilt from the original messages array — never accumulated.
 */
const CORRECTION_NOTE: OpenAIMessage = {
  role: 'user',
  content:
    'The previous response was not valid JSON or did not match the required schema. ' +
    'Please respond with a single raw JSON object in one of these forms: ' +
    '{"type":"text","content":"<string>"} or ' +
    '{"type":"tool_call","name":"<string>","arguments":{...}}',
};

const MAX_ATTEMPTS = 3;

/**
 * validateWithRetry — retry orchestrator wrapping parseAndValidate (OD-5 LOCKED).
 *
 * Attempts to parse and validate `raw`. On ValidationError, appends CORRECTION_NOTE
 * to `messages` and calls `invoker` to get a fresh response, up to MAX_ATTEMPTS total.
 *
 * Invariants:
 * - OD-5: Wraps parseAndValidate; does NOT reimplement parse/validate logic.
 * - A3 / EF4: Only ValidationError triggers a retry. Any other throwable from `invoker`
 *   (e.g., TransportError) propagates immediately, unwrapped.
 * - A2 / EF6: Corrected messages are always [...messages, CORRECTION_NOTE] — rebuilt
 *   from the original each attempt. Never accumulated across retries.
 * - WS_04-D3: CORRECTION_NOTE is static and content-free.
 * - OD-7 / A4: A schema-valid {type:"tool_call"} on attempt 1 is a SUCCESS; the
 *   orchestrator never inspects result.type.
 * - No `attempt` in the public signature — the counter is internal to the for loop.
 */
export async function validateWithRetry(
  raw: string,
  messages: OpenAIMessage[],
  invoker: (messages: OpenAIMessage[]) => Promise<AdapterResponse>,
): Promise<QuotagateCompleteResult> {
  let currentRaw = raw;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return parseAndValidate(currentRaw);
    } catch (err) {
      if (!(err instanceof ValidationError)) throw err; // non-ValidationError propagates unwrapped
      if (attempt === MAX_ATTEMPTS) throw err; // exhausted — surface the failure
      const corrected = [...messages, CORRECTION_NOTE]; // single note, rebuilt from original each retry
      currentRaw = (await invoker(corrected)).raw; // invoker seam — transport behind the callback
    }
  }
  // Statically unreachable — TypeScript cannot prove the loop exhausts via the catch branch;
  // this satisfies the type checker without a cast or non-null assertion.
  throw new ValidationError('Retry exhausted');
}
