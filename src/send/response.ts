/** Upper bound for the response body that is read at all. */
export const MAX_RESPONSE_BYTES = 64 * 1024;
export const MAX_ERROR_TEXT_CHARS = 300;

/** Fixed, user-safe messages; they never contain header values or response data. */
export const FIXED_MESSAGES = {
  'network-error': 'The target could not be reached.',
  timeout: 'The target did not respond in time.',
  'unknown-target': 'The target is not configured for this project.',
  'no-permission': 'The extension has no permission for this target address.',
  'invalid-request': 'The send request was invalid.',
  'in-flight': 'A send to this target is already running.',
  'internal-error': 'Sending failed internally.',
} as const;

export type FailureKind = keyof typeof FIXED_MESSAGES;

export type SendOutcome =
  /** `message` and `url` come from the webhook response; foreign data, shown as text and an http(s) link only. */
  | { kind: 'success'; status: number; message?: string; url?: string }
  | { kind: 'http-error'; status: number; text: string }
  | { kind: FailureKind; message: string };

export const failure = (kind: FailureKind): SendOutcome => ({ kind, message: FIXED_MESSAGES[kind] });

function safeLink(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  try {
    const u = new URL(value.trim());
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : undefined;
  } catch {
    return undefined;
  }
}

/** Pure: 2xx is success; a JSON object body may carry `message` (string) and `url` (http/https only). */
export function evaluateResponse(status: number, bodyText: string): SendOutcome {
  if (status < 200 || status > 299) {
    return { kind: 'http-error', status, text: bodyText.slice(0, MAX_ERROR_TEXT_CHARS) };
  }
  const outcome: SendOutcome = { kind: 'success', status };
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    return outcome;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return outcome;
  const { message, url } = parsed as Record<string, unknown>;
  if (typeof message === 'string' && message !== '') outcome.message = message;
  const link = safeLink(url);
  if (link) outcome.url = link;
  return outcome;
}

/** Reads at most `limit` bytes of the body as text; the rest is discarded. */
export async function readLimitedText(res: Response, limit = MAX_RESPONSE_BYTES): Promise<string> {
  if (!res.body) return (await res.text()).slice(0, limit);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < limit) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value.length > limit - total ? value.subarray(0, limit - total) : value);
    total += chunks[chunks.length - 1]!.length;
  }
  await reader.cancel().catch(() => undefined);
  const all = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    all.set(c, offset);
    offset += c.length;
  }
  return new TextDecoder().decode(all);
}
