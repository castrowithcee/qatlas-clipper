import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CONFIG_KEY,
  ConfigError,
  contentFormatOf,
  HEADER_VALUES_KEY,
  exportConfig,
  importFromText,
  importFromUrl,
  loadConfig,
  loadHeaderValues,
  migrateConfig,
  parseConfig,
  saveConfig,
  setHeaderValue,
  storedStateEquals,
  StoredStateChangedError,
  updateStored,
  type StorageArea,
} from '../src/config';

function fakeStorage(initial: Record<string, unknown> = {}): StorageArea & { data: Record<string, unknown> } {
  const data = { ...initial };
  return {
    data,
    get: async (keys) => Object.fromEntries(keys.filter((k) => k in data).map((k) => [k, structuredClone(data[k])])),
    set: async (items) => void Object.assign(data, structuredClone(items)),
  };
}

const HEADER_VALUE = 'example-header-value';

const validConfig = () => ({
  schemaVersion: 1,
  projects: [
    {
      id: 'articles',
      name: 'Articles',
      scope: { allSites: false, domains: ['example.com'], pageType: 'Article' },
      fields: [
        {
          key: 'author',
          label: 'Author',
          required: true,
          sources: {
            schemaOrgPath: 'Article.author.name',
            metaTag: { attribute: 'property', name: 'og:title' },
            manual: { type: 'choice', values: ['a', 'b'] },
          },
        },
      ],
      siteMappings: { 'example.com': { author: '.byline' } },
      targets: [{ id: 't1', name: 'Hook', url: 'https://example.com/hook', headers: ['Authorization'], purpose: 'Test' }],
    },
  ],
});

const v0State = () => ({
  projects: [
    {
      id: 'articles',
      name: 'Articles',
      urlPrefixes: ['https://example.com/blog/'],
      fields: [{ key: 'author', label: 'Author', required: false, schemaPath: 'Article.author.name' }],
      selectors: { 'example.com': { author: '.byline' } },
      targets: [],
    },
  ],
});

let storage: ReturnType<typeof fakeStorage>;
beforeEach(() => {
  storage = fakeStorage();
});

describe('validation', () => {
  it('reports path and problem on import', async () => {
    const bad = validConfig();
    bad.projects[0]!.targets[0]!.url = 'ftp://example.com';
    delete (bad.projects[0]!.fields[0] as Partial<{ label: string }>).label;
    const err = await importFromText(JSON.stringify(bad), storage).catch((e) => e);
    expect(err).toBeInstanceOf(ConfigError);
    expect(err.message).toContain('projects[0].targets[0].url: must be an absolute https: URL (http: is only allowed for localhost)');
    expect(err.message).toContain('projects[0].fields[0].label');
    expect(storage.data[CONFIG_KEY]).toBeUndefined();
  });

  it('rejects invalid stored config on load instead of half-loading', async () => {
    const bad = validConfig();
    bad.projects[0]!.scope.domains.push('example.com/path');
    storage = fakeStorage({ [CONFIG_KEY]: bad });
    await expect(loadConfig(storage)).rejects.toThrow(/projects\[0\]\.scope\.domains\[1\]: must be a lowercase host name/);
  });

  it('rejects duplicates and unknown mapping keys', async () => {
    const bad = validConfig();
    (bad.projects[0]!.siteMappings as Record<string, Record<string, string>>)['example.com'] = { nope: '.x' };
    bad.projects.push({ ...structuredClone(bad.projects[0]!), id: 'articles' });
    const err = await importFromText(JSON.stringify(bad), storage).catch((e) => e);
    expect(err.message).toContain('unknown field key "nope"');
    expect(err.message).toContain('duplicate project id');
    expect(err.message).toContain('duplicate target id');
  });

  it('rejects imported header values', async () => {
    const bad = validConfig() as Record<string, unknown>;
    bad.headerValues = { t1: { Authorization: HEADER_VALUE } };
    const err = await importFromText(JSON.stringify(bad), storage).catch((e) => e);
    expect(err.message).toContain('unknown key(s): headerValues');
    expect(err.message).not.toContain(HEADER_VALUE);
    const bad2 = validConfig();
    (bad2.projects[0]!.targets[0] as { headers: unknown }).headers = [{ name: 'Authorization', value: HEADER_VALUE }];
    const err2 = await importFromText(JSON.stringify(bad2), storage).catch((e) => e);
    expect(err2).toBeInstanceOf(ConfigError);
    expect(err2.message).not.toContain(HEADER_VALUE);
  });

  it('rejects invalid domains with a clear message', async () => {
    for (const d of ['https://example.com', 'example.com/blog', 'example.com:8080', 'exa mple.com', 'Example.com', 'www.example.com', 'localhost', '*.example.com', '']) {
      const bad = validConfig();
      bad.projects[0]!.scope.domains = [d];
      const err = await importFromText(JSON.stringify(bad), storage).catch((e) => e);
      expect(err).toBeInstanceOf(ConfigError);
      expect(err.message).toContain('projects[0].scope.domains[0]');
      if (d) expect(err.message).not.toContain(d);
    }
  });

  it('enforces domains against allSites', async () => {
    const both = validConfig();
    both.projects[0]!.scope.allSites = true;
    await expect(importFromText(JSON.stringify(both), storage)).rejects.toThrow(/scope\.domains: must be empty/);
    const none = validConfig();
    none.projects[0]!.scope.domains = [];
    await expect(importFromText(JSON.stringify(none), storage)).rejects.toThrow(/scope\.domains: needs at least one domain/);
    const ok = validConfig();
    ok.projects[0]!.scope = { allSites: true, domains: [] } as never;
    await expect(importFromText(JSON.stringify(ok), storage)).resolves.toBeTruthy();
  });

  it('rejects a project without scope', async () => {
    const bad = validConfig();
    delete (bad.projects[0] as Partial<{ scope: unknown }>).scope;
    await expect(importFromText(JSON.stringify(bad), storage)).rejects.toThrow(/projects\[0\]\.scope: is required/);
  });

  it('rejects the old triggers field without echoing values', async () => {
    const bad = { ...validConfig() } as { projects: Record<string, unknown>[] };
    bad.projects[0]!.triggers = [{ type: 'urlPrefix', value: 'https://secret.example/' }];
    const err = await importFromText(JSON.stringify(bad), storage).catch((e) => e);
    expect(err).toBeInstanceOf(ConfigError);
    expect(err.message).toContain('triggers are no longer supported');
    expect(err.message).not.toContain('secret.example');
  });

  it('returns an empty config when nothing is stored', async () => {
    expect(await loadConfig(storage)).toEqual({ schemaVersion: 1, projects: [] });
  });
});

describe('migration', () => {
  it('migrates v0 to v1', async () => {
    const migrated = migrateConfig(v0State());
    expect(migrated).toMatchObject({ schemaVersion: 1 });
    storage = fakeStorage({ [CONFIG_KEY]: v0State() });
    const cfg = await loadConfig(storage);
    expect(cfg.projects[0]).toMatchObject({
      scope: { allSites: false, domains: ['example.com'] },
      siteMappings: { 'example.com': { author: '.byline' } },
      fields: [{ sources: { schemaOrgPath: 'Article.author.name' } }],
    });
  });

  it('rejects a newer version', async () => {
    const err = await importFromText(JSON.stringify({ schemaVersion: 2, projects: [] }), storage).catch((e) => e);
    expect(err).toBeInstanceOf(ConfigError);
    expect(err.message).toMatch(/Unsupported configuration version 2/);
    storage = fakeStorage({ [CONFIG_KEY]: { schemaVersion: 99, projects: [] } });
    await expect(loadConfig(storage)).rejects.toThrow(/Unsupported configuration version 99/);
  });
});

describe('content format', () => {
  it('treats a missing setting as markdown and keeps explicit values through import and export', async () => {
    const cfg = validConfig();
    const parsed = parseConfig(cfg);
    expect(parsed.projects[0]!.content).toBeUndefined();
    expect(contentFormatOf(parsed.projects[0]!)).toBe('markdown');
    const withHtml = { ...cfg, projects: [{ ...cfg.projects[0]!, content: 'html' }] };
    await importFromText(JSON.stringify(withHtml), storage);
    const exported = JSON.parse(await exportConfig(storage));
    expect(exported.projects[0].content).toBe('html');
    expect(contentFormatOf(parseConfig(exported).projects[0]!)).toBe('html');
  });

  it('rejects an unknown value', () => {
    const cfg = validConfig();
    expect(() => parseConfig({ ...cfg, projects: [{ ...cfg.projects[0]!, content: 'pdf' }] })).toThrow(ConfigError);
  });
});

describe('export and import', () => {
  it('export contains no header values', async () => {
    await saveConfig(validConfig(), storage);
    await setHeaderValue('t1', 'Authorization', HEADER_VALUE, storage);
    const json = await exportConfig(storage);
    expect(json).not.toContain(HEADER_VALUE);
    expect(json).not.toContain(HEADER_VALUES_KEY);
    expect(JSON.parse(json).projects[0].targets[0].headers).toEqual(['Authorization']);
  });

  it('import keeps tokens for same target id and removes others', async () => {
    const cfg = validConfig();
    cfg.projects[0]!.targets.push({ id: 't2', name: 'Other', url: 'https://example.com/o', headers: ['X-Key'], purpose: '' });
    await saveConfig(cfg, storage);
    await setHeaderValue('t1', 'Authorization', HEADER_VALUE, storage);
    await setHeaderValue('t2', 'X-Key', 'other', storage);

    const next = validConfig(); // only t1
    next.projects[0]!.name = 'Renamed';
    await importFromText(JSON.stringify(next), storage);
    expect(await loadHeaderValues(storage)).toEqual({ t1: { Authorization: HEADER_VALUE } });
    expect((await loadConfig(storage)).projects[0]!.name).toBe('Renamed');
  });

  it('rejects invalid JSON', async () => {
    await expect(importFromText('{nope', storage)).rejects.toThrow('Import is not valid JSON');
  });

  it('setHeaderValue rejects undeclared targets and headers without echoing the value', async () => {
    await saveConfig(validConfig(), storage);
    const err = await setHeaderValue('t9', 'Authorization', HEADER_VALUE, storage).catch((e) => e);
    expect(err.message).not.toContain(HEADER_VALUE);
    await expect(setHeaderValue('t1', 'X-Other', HEADER_VALUE, storage)).rejects.toThrow(ConfigError);
  });
});

describe('URL import', () => {
  it('fails without permission and does not fetch', async () => {
    const fetchMock = vi.fn();
    const hasPermission = vi.fn(async () => false);
    await expect(
      importFromUrl('https://example.com/config.json', { storage, fetch: fetchMock as unknown as typeof fetch, hasPermission }),
    ).rejects.toThrow(/No host permission for https:\/\/example\.com/);
    expect(hasPermission).toHaveBeenCalledWith('https://example.com/*');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects non-http schemes before any permission check or fetch', async () => {
    const fetchMock = vi.fn();
    const hasPermission = vi.fn(async () => true);
    for (const u of ['file:///etc/passwd', 'javascript:alert(1)', 'not a url', 'http://example.com/c.json']) {
      await expect(importFromUrl(u, { storage, fetch: fetchMock as unknown as typeof fetch, hasPermission })).rejects.toThrow(ConfigError);
    }
    expect(hasPermission).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('imports with permission', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(validConfig())));
    await importFromUrl('https://example.com/config.json', {
      storage,
      fetch: fetchMock as unknown as typeof fetch,
      hasPermission: async () => true,
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect((await loadConfig(storage)).projects).toHaveLength(1);
  });
});

describe('target URL rule', () => {
  const withUrl = (url: string) => {
    const c = validConfig();
    c.projects[0]!.targets[0]!.url = url;
    return c;
  };
  it('accepts https and http only for localhost', () => {
    for (const u of ['https://example.com/hook', 'http://localhost:8080/hook', 'http://localhost/x']) {
      expect(() => parseConfig(withUrl(u))).not.toThrow();
    }
  });
  it('rejects other http hosts and schemes without echoing the value', () => {
    for (const u of ['http://example.com/hook', 'http://127.0.0.1/x', 'ftp://example.com', 'javascript:alert(1)', 'not a url']) {
      let message = '';
      try {
        parseConfig(withUrl(u));
      } catch (e) {
        message = (e as Error).message;
      }
      expect(message).toContain('projects[0].targets[0].url: must be an absolute https: URL');
      expect(message).not.toContain(u);
    }
  });
});

describe('updateStored', () => {
  const stored = () =>
    fakeStorage({
      config: validConfig(),
      headerValues: { 't1': { Authorization: HEADER_VALUE } },
    });
  const rename = (c: Awaited<ReturnType<typeof loadConfig>>, name: string) => ({
    config: { ...c, projects: c.projects.map((p, i) => (i === 0 ? { ...p, name } : p)) },
  });

  it('applies the change to the freshly stored state and writes both keys in one call', async () => {
    const s = stored();
    const setCalls: string[][] = [];
    const set = s.set;
    s.set = async (items) => {
      setCalls.push(Object.keys(items));
      await set(items);
    };
    let seen = '';
    await updateStored((c, v) => {
      seen = `${c.projects[0]!.name}|${v['t1']?.Authorization}`;
      return rename(c, 'Changed');
    }, s);
    expect(seen).toBe(`Articles|${HEADER_VALUE}`);
    expect(setCalls).toEqual([[CONFIG_KEY, HEADER_VALUES_KEY]]);
    expect((await loadConfig(s)).projects[0]!.name).toBe('Changed');
    expect(await loadHeaderValues(s)).toEqual({ 't1': { Authorization: HEADER_VALUE } });
  });
  it('reads fresh state on every call', async () => {
    const s = stored();
    await updateStored((c) => rename(c, 'One'), s);
    const names: string[] = [];
    await updateStored((c) => (names.push(c.projects[0]!.name), { config: c }), s);
    expect(names).toEqual(['One']);
  });
  it('writes nothing when the change throws', async () => {
    const s = stored();
    const before = structuredClone(s.data);
    await expect(
      updateStored(() => {
        throw new StoredStateChangedError();
      }, s),
    ).rejects.toThrow(StoredStateChangedError);
    expect(s.data).toEqual(before);
  });
  it('writes nothing when validation fails and does not leak header values', async () => {
    const s = stored();
    const before = structuredClone(s.data);
    const err = await updateStored((c) => rename(c, ''), s).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConfigError);
    expect(String((err as Error).message)).not.toContain(HEADER_VALUE);
    expect(s.data).toEqual(before);
  });
  it('prunes header values and accepts new ones', async () => {
    const s = stored();
    await updateStored((c) => ({ config: { ...c, projects: [] }, headerValues: { gone: { X: 'v' } } }), s);
    expect(await loadHeaderValues(s)).toEqual({});
  });
  it('serializes concurrent updates so none is lost', async () => {
    const s = stored();
    await Promise.all([
      updateStored((c) => rename(c, 'First'), s),
      updateStored((c) => ({ config: { ...c, projects: c.projects.map((p) => ({ ...p, scope: { allSites: true, domains: [] } })) } }), s),
    ]);
    const p = (await loadConfig(s)).projects[0]!;
    expect(p.name).toBe('First');
    expect(p.scope).toEqual({ allSites: true, domains: [] });
  });
});

describe('storedStateEquals', () => {
  const state = () => ({ config: parseConfig(validConfig()), headerValues: { 't1': { Authorization: HEADER_VALUE } } });
  it('compares structurally and ignores empty target maps', () => {
    const a = state();
    const b = structuredClone(a);
    b.headerValues = { ...b.headerValues, other: {} } as typeof b.headerValues;
    expect(storedStateEquals(a, b)).toBe(true);
    b.config.projects[0]!.name = 'Changed';
    expect(storedStateEquals(a, b)).toBe(false);
    const c = state();
    c.headerValues['t1']!.Authorization = 'different';
    expect(storedStateEquals(a, c)).toBe(false);
  });
});
