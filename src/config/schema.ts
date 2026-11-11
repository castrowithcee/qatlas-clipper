import { z } from 'zod';
import { DETECT_VALUES } from '../extract/detect';
import { PAGE_KINDS } from '../extract/pageTypes';
import { ConfigError } from './errors';

export const CURRENT_SCHEMA_VERSION = 1;

const nonEmpty = z.string().trim().min(1, 'must not be empty');
const id = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/, 'must be 1-64 characters of letters, digits, "-" or "_"');

// RFC 9110 token: header names are data from imports, so keep them strictly syntactic.
const headerName = z.string().regex(/^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/, 'is not a valid HTTP header name');

// Plain http: is only accepted for localhost, so header values never travel unencrypted over a network.
const targetUrl = z
  .string()
  .refine((v) => {
    try {
      const u = new URL(v);
      return u.protocol === 'https:' || (u.protocol === 'http:' && u.hostname === 'localhost');
    } catch {
      return false;
    }
  }, 'must be an absolute https: URL (http: is only allowed for localhost)');

// Lowercase ASCII hostname with at least two labels; no scheme, path, port, spaces or wildcards.
const HOSTNAME = /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;

export const domainSchema = z
  .string()
  .refine((v) => HOSTNAME.test(v), 'must be a lowercase host name such as "example.com" (no scheme, path, port or spaces)')
  .refine((v) => !v.startsWith('www.') || !HOSTNAME.test(v), 'must not start with "www."; subdomains are covered automatically');

export const scopeSchema = z
  .strictObject({
    allSites: z.boolean(),
    domains: z.array(domainSchema),
    // Page kind from the fixed list (schema.org types including subtypes); the page must carry one in its JSON-LD.
    pageKind: z.enum(PAGE_KINDS).optional(),
    // Custom schema.org type such as "Product" for types outside the list; also required in the JSON-LD if set.
    pageType: nonEmpty.optional(),
  })
  .superRefine((s, ctx) => {
    if (s.allSites && s.domains.length > 0) {
      ctx.addIssue({ code: 'custom', path: ['domains'], message: 'must be empty when the project applies to all sites' });
    }
    if (!s.allSites && s.domains.length === 0) {
      ctx.addIssue({ code: 'custom', path: ['domains'], message: 'needs at least one domain unless the project applies to all sites' });
    }
  });

// Source order is fixed by priority: site-mapping selector (implicit, from siteMappings), detect value,
// schema.org path, meta tag, manual input. Absent keys mean "not used".
export const FIELD_FORMATS = ['text', 'markdown', 'html'] as const;
export type FieldFormat = (typeof FIELD_FORMATS)[number];

export const fieldSchema = z.strictObject({
  key: id,
  label: nonEmpty,
  required: z.boolean(),
  // An absent value means "markdown" for clicked elements and "text" for all other values (see fieldFormatOf).
  format: z.enum(FIELD_FORMATS).optional(),
  sources: z.strictObject({
    detect: z.enum(DETECT_VALUES).optional(),
    schemaOrgPath: nonEmpty.optional(), // e.g. "Article.author.name"
    metaTag: z.strictObject({ attribute: z.enum(['name', 'property']), name: nonEmpty }).optional(),
    manual: z
      .discriminatedUnion('type', [
        z.strictObject({ type: z.literal('text') }),
        z.strictObject({ type: z.literal('choice'), values: z.array(nonEmpty).min(1) }),
      ])
      .optional(),
  }),
});

export const targetSchema = z.strictObject({
  id,
  name: nonEmpty,
  url: targetUrl,
  // Names only. Values live in a separate storage key and are never exported.
  headers: z.array(headerName),
  purpose: z.string(),
});

export const CONTENT_FORMATS = ['none', 'markdown', 'html'] as const;
export type ContentFormat = (typeof CONTENT_FORMATS)[number];

export const projectSchema = z.strictObject({
  id,
  name: nonEmpty,
  scope: scopeSchema,
  fields: z.array(fieldSchema),
  // domain -> field key -> CSS selector
  siteMappings: z.record(nonEmpty, z.record(nonEmpty, nonEmpty)),
  targets: z.array(targetSchema),
  // Page content sent with the payload; an absent value means "markdown" (see contentFormatOf).
  content: z.enum(CONTENT_FORMATS).optional(),
});

export const configSchema = z
  .strictObject({
    schemaVersion: z.literal(CURRENT_SCHEMA_VERSION),
    // Order is meaningful: project order decides the order and preselection of matching projects.
    projects: z.array(projectSchema),
  })
  .superRefine((cfg, ctx) => {
    const dup = (path: (string | number)[], message: string) => ctx.addIssue({ code: 'custom', path, message });
    const projectIds = new Set<string>();
    const targetIds = new Set<string>();
    cfg.projects.forEach((p, pi) => {
      if (projectIds.has(p.id)) dup(['projects', pi, 'id'], `duplicate project id "${p.id}"`);
      projectIds.add(p.id);
      const keys = new Set<string>();
      p.fields.forEach((f, fi) => {
        if (keys.has(f.key)) dup(['projects', pi, 'fields', fi, 'key'], `duplicate field key "${f.key}"`);
        keys.add(f.key);
      });
      for (const [domain, map] of Object.entries(p.siteMappings)) {
        for (const key of Object.keys(map)) {
          if (!keys.has(key)) {
            dup(['projects', pi, 'siteMappings', domain, key], `unknown field key "${key}"`);
          }
        }
      }
      p.targets.forEach((t, ti) => {
        // Target IDs are global because header values are linked by target ID.
        if (targetIds.has(t.id)) dup(['projects', pi, 'targets', ti, 'id'], `duplicate target id "${t.id}"`);
        targetIds.add(t.id);
        const names = new Set<string>();
        t.headers.forEach((h, hi) => {
          if (names.has(h.toLowerCase())) dup(['projects', pi, 'targets', ti, 'headers', hi], `duplicate header name "${h}"`);
          names.add(h.toLowerCase());
        });
      });
    });
  });

export type Scope = z.infer<typeof scopeSchema>;
export type Field = z.infer<typeof fieldSchema>;
export type Target = z.infer<typeof targetSchema>;
export type Project = z.infer<typeof projectSchema>;

/** Effective content format of a project; projects without the setting send Markdown. */
export const contentFormatOf = (project: Pick<Project, 'content'>): ContentFormat => project.content ?? 'markdown';
/** Effective format of a field; fields without the setting read clicked elements as Markdown and other values as text. */
export const fieldFormatOf = (field: Pick<Field, 'format'>, clicked: boolean): FieldFormat => field.format ?? (clicked ? 'markdown' : 'text');
export type Config = z.infer<typeof configSchema>;
/** targetId -> header name -> value. Never exported. */
export type HeaderValues = Record<string, Record<string, string>>;

export const headerValuesSchema = z.record(z.string(), z.record(z.string(), z.string()));

export function formatPath(path: PropertyKey[]): string {
  return path.reduce<string>((acc, seg) => (typeof seg === 'number' ? `${acc}[${seg}]` : acc ? `${acc}.${String(seg)}` : String(seg)), '') || '(root)';
}

/** Validate and return typed config, or throw ConfigError listing every problem with its path. */
export function parseConfig(input: unknown, what = 'Invalid configuration'): Config {
  const result = configSchema.safeParse(input);
  if (result.success) return result.data;
  // Messages come from the schema, not from echoing input values, so secrets cannot leak.
  throw new ConfigError(
    what,
    result.error.issues.map((i) => {
      const msg =
        i.code === 'unrecognized_keys'
          ? i.keys.includes('triggers')
            ? 'triggers are no longer supported; use "scope" with allSites, domains and an optional pageType'
            : `unknown key(s): ${i.keys.join(', ')}`
          : i.code === 'invalid_type' && i.path[i.path.length - 1] === 'scope'
            ? 'is required: set allSites or list domains'
            : i.message;
      return `${formatPath(i.path)}: ${msg}`;
    }),
  );
}
