import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CONFIG_KEY,
  ConfigError,
  HEADER_VALUES_KEY,
  exportConfig,
  importFromText,
  importFromUrl,
  loadConfig,
  loadHeaderValues,
  migrateConfig,
  saveConfig,
  setHeaderValue,
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
      triggers: [
        { type: 'urlPrefix', value: 'https://example.com/blog/' },
        { type: 'regex', pattern: '^https://example\\.com/p/\\d+$' },
        { type: 'schemaOrgType', value: 'Article' },
      ],
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
    expect(err.message).toContain('projects[0].targets[0].url: must be an absolute http: or https: URL');
    expect(err.message).toContain('projects[0].fields[0].label');
    expect(storage.data[CONFIG_KEY]).toBeUndefined();
  });

  it('rejects invalid stored config on load instead of half-loading', async () => {
    const bad = validConfig();
    bad.projects[0]!.triggers.push({ type: 'regex', pattern: '(' });
    storage = fakeStorage({ [CONFIG_KEY]: bad });
    await expect(loadConfig(storage)).rejects.toThrow(/projects\[0\]\.triggers\[3\]\.pattern: is not a valid regular expression/);
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
      triggers: [{ type: 'urlPrefix', value: 'https://example.com/blog/' }],
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
    for (const u of ['file:///etc/passwd', 'javascript:alert(1)', 'not a url']) {
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
