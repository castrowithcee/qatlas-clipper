import { z } from 'zod';

export const PAYLOAD_VERSION = 1;

export const payloadSchema = z.strictObject({
  project: z.strictObject({ id: z.string(), name: z.string() }),
  target: z.strictObject({ id: z.string(), name: z.string() }),
  url: z.string(),
  title: z.string(),
  fields: z.record(z.string(), z.string()),
  content_markdown: z.string(),
  note: z.string(),
  captured_at: z.string(),
  version: z.literal(PAYLOAD_VERSION),
});

export type Payload = z.infer<typeof payloadSchema>;

export interface PayloadInput {
  project: { id: string; name: string; fields: { key: string }[] };
  target: { id: string; name: string };
  url: string;
  title: string;
  /** Edited or read values by field key; keys that are not project fields are dropped. */
  values: Record<string, string>;
  contentMarkdown: string;
  note: string;
  now?: () => Date;
}

/** Pure; every project field is present (empty string if there is no value). */
export function buildPayload(input: PayloadInput): Payload {
  const fields: Record<string, string> = {};
  for (const f of input.project.fields) fields[f.key] = input.values[f.key] ?? '';
  return {
    project: { id: input.project.id, name: input.project.name },
    target: { id: input.target.id, name: input.target.name },
    url: input.url,
    title: input.title,
    fields,
    content_markdown: input.contentMarkdown,
    note: input.note,
    captured_at: (input.now ?? (() => new Date()))().toISOString(),
    version: PAYLOAD_VERSION,
  };
}
