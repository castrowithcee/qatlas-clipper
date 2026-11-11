import { describe, expect, it } from 'vitest';
import {
  applyImport,
  buildShare,
  CONFIG_KEY,
  ConfigError,
  HEADER_VALUES_KEY,
  loadHeaderValues,
  MAX_IMPORT_CHARS,
  parseConfig,
  parseShareText,
  planImport,
  stringifyShare,
  type Config,
  type ImportChoices,
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

const HEADER_VALUE = 'header-value-marker';

const project = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  name: `Project ${id}`,
  scope: { allSites: true, domains: [] },
  fields: [{ key: 'title', label: 'Title', required: false, sources: {} }],
  siteMappings: { 'example.com': { title: 'h1' } },
  targets: [{ id: `t-${id}`, name: 'Hook', url: `https://example.com/${id}`, headers: ['Authorization'], purpose: 'p' }],
  content: 'html',
  ...extra,
});

const config = (): Config =>
  parseConfig({
    schemaVersion: 1,
    folders: [
      { id: 'f1', name: 'News' },
      { id: 'f2', name: 'Empty' },
      { id: 'f3', name: 'Other' },
    ],
    tags: [
      { id: 'g1', name: 'Alpha' },
      { id: 'g2', name: 'Beta' },
    ],
    projects: [project('a', { folderId: 'f1', tagIds: ['g1'] }), project('b', { folderId: 'f1', tagIds: ['g1', 'g2'] }), project('c')],
  });

const choose = (modes: Record<string, 'add' | 'replace' | 'copy'>, extra: Partial<ImportChoices> = {}): ImportChoices => ({
  projects: Object.entries(modes).map(([id, mode]) => ({ id, mode })),
  folderIds: [],
  copySuffix: ' (copy)',
  ...extra,
});

const stored = (c: Config, values: Record<string, Record<string, string>> = {}) =>
  fakeStorage({ [CONFIG_KEY]: c, [HEADER_VALUES_KEY]: values });

describe('buildShare', () => {
  it('omits targets by default and marks it', () => {
    const s = buildShare(config(), { projectIds: ['c'], folderIds: [], includeTargets: false });
    expect(s.targetsIncluded).toBe(false);
    expect(s.projects.map((p) => p.targets)).toEqual([[]]);
  });

  it('includes target data and header names, never values', () => {
    const s = buildShare(config(), { projectIds: ['a'], folderIds: [], includeTargets: true });
    expect(s.projects[0]?.targets[0]).toMatchObject({ name: 'Hook', url: 'https://example.com/a', purpose: 'p', headers: ['Authorization'] });
    expect(stringifyShare(s)).not.toContain(HEADER_VALUE);
  });

  it('a folder includes all its projects; only used folders and tags are kept; config order', () => {
    const s = buildShare(config(), { projectIds: ['c'], folderIds: ['f1'], includeTargets: false });
    expect(s.projects.map((p) => p.id)).toEqual(['a', 'b', 'c']);
    expect(s.folders.map((f) => f.id)).toEqual(['f1']);
    expect(s.tags.map((t) => t.id)).toEqual(['g1', 'g2']);
    const only = buildShare(config(), { projectIds: ['a'], folderIds: [], includeTargets: false });
    expect(only.tags.map((t) => t.id)).toEqual(['g1']);
  });

  it('keeps explicitly chosen empty folders and rejects unknown ids', () => {
    const s = buildShare(config(), { projectIds: [], folderIds: ['f2'], includeTargets: false });
    expect(s.projects).toEqual([]);
    expect(s.folders.map((f) => f.id)).toEqual(['f2']);
    expect(() => buildShare(config(), { projectIds: ['zz'], folderIds: [], includeTargets: false })).toThrow(ConfigError);
  });
});

describe('parseShareText', () => {
  const valid = () => buildShare(config(), { projectIds: ['a'], folderIds: [], includeTargets: true });
  const parse = (v: unknown) => parseShareText(JSON.stringify(v));
  const failure = (v: unknown): string => {
    try {
      parse(v);
    } catch (e) {
      return (e as Error).message;
    }
    throw new Error('did not fail');
  };

  it('round-trips', () => {
    expect(parseShareText(stringifyShare(valid()))).toEqual(valid());
  });

  it('rejects too large, non-JSON and wrong format', () => {
    expect(() => parseShareText('x'.repeat(MAX_IMPORT_CHARS + 1))).toThrow('too large');
    expect(() => parseShareText('{nope')).toThrow('not valid JSON');
    expect(failure({ ...valid(), format: 'other' })).toContain('format');
  });

  it('rejects a higher version with the existing message', () => {
    expect(failure({ ...valid(), schemaVersion: 2 })).toContain('Unsupported configuration version 2');
  });

  it('rejects unknown keys without echoing values', () => {
    const v = valid() as unknown as Record<string, unknown>;
    expect(failure({ ...v, headerValues: { t: { A: HEADER_VALUE } } })).not.toContain(HEADER_VALUE);
    const p = project('a', { headerValues: { Authorization: HEADER_VALUE } });
    const msg = failure({ ...v, projects: [p] });
    expect(msg).not.toContain(HEADER_VALUE);
    expect(msg).toContain('projects[0]');
    const t = project('a');
    (t.targets[0] as Record<string, unknown>).headers = { Authorization: HEADER_VALUE };
    expect(failure({ ...v, projects: [t] })).not.toContain(HEADER_VALUE);
  });

  it('rejects http: outside localhost with the path only', () => {
    const p = project('a');
    p.targets[0]!.url = 'http://example.com/secret-path';
    const msg = failure({ ...valid(), projects: [p] });
    expect(msg).toContain('projects[0].targets[0].url');
    expect(msg).not.toContain('secret-path');
  });

  it('checks cross references and targetsIncluded', () => {
    expect(failure({ ...valid(), folders: [] })).toContain('projects[0].folderId');
    expect(failure({ ...valid(), targetsIncluded: false })).toContain('projects[0].targets');
  });

  it('accepts a backup of the whole configuration', () => {
    const s = parse(config());
    expect(s.targetsIncluded).toBe(true);
    expect(s.projects).toHaveLength(3);
    expect(s.folders).toHaveLength(3);
  });
});

describe('planImport', () => {
  it('reports existing projects, names, origins and folders', () => {
    const share = parseShareText(
      stringifyShare({
        ...buildShare(config(), { projectIds: ['a'], folderIds: ['f2'], includeTargets: true }),
        folders: [{ id: 'x', name: 'news' }, { id: 'f2', name: 'Empty' }, { id: 'y', name: 'Fresh' }],
        projects: [{ ...project('a', { folderId: 'x', tagIds: ['g1'] }) } as never, project('n') as never],
        tags: [{ id: 'g1', name: 'Alpha' }],
      }),
    );
    const current = config();
    current.projects[0]!.name = 'Local name';
    const plan = planImport(current, share);
    expect(plan.projects[0]).toMatchObject({ id: 'a', folderName: 'news', tagNames: ['Alpha'], existing: { name: 'Local name' }, origins: ['https://example.com'] });
    expect(plan.projects[1]?.existing).toBeUndefined();
    expect(plan.folders.map((f) => [f.exists, f.empty])).toEqual([[true, false], [true, true], [false, true]]);
  });
});

describe('applyImport', () => {
  const shareOf = (ids: string[], includeTargets = true, c: Config = config()) =>
    parseShareText(stringifyShare(buildShare(c, { projectIds: ids, folderIds: [], includeTargets })));
  const empty = (): Config => ({ schemaVersion: 1, projects: [] });

  it('adds into an empty config and the round trip yields the same projects', async () => {
    const storage = stored(empty());
    const share = shareOf(['a', 'b', 'c']);
    const r = await applyImport(share, choose({ a: 'add', b: 'add', c: 'add' }), storage);
    expect(r.config.projects).toEqual(config().projects);
    expect(r.config.folders).toEqual([{ id: 'f1', name: 'News' }]);
    expect(r.config.tags).toEqual([{ id: 'g1', name: 'Alpha' }, { id: 'g2', name: 'Beta' }]);
    expect(parseConfig(storage.data[CONFIG_KEY])).toEqual(r.config);
  });

  it('adds to the end of a filled config and reissues colliding target ids', async () => {
    const local = parseConfig({ schemaVersion: 1, projects: [project('z', { targets: [{ id: 't-a', name: 'N', url: 'https://example.com/z', headers: [], purpose: '' }] })] });
    const r = await applyImport(shareOf(['a']), choose({ a: 'add' }), stored(local));
    expect(r.config.projects.map((p) => p.id)).toEqual(['z', 'a']);
    const t = r.config.projects[1]!.targets[0]!;
    expect(t.id).not.toBe('t-a');
    expect(r.config.projects[0]!.targets[0]!.id).toBe('t-a');
  });

  it('copy gets new project and target ids and the suffix', async () => {
    const r = await applyImport(shareOf(['a']), choose({ a: 'copy' }), stored(config()));
    expect(r.config.projects).toHaveLength(4);
    const copy = r.config.projects[3]!;
    expect(copy.id).not.toBe('a');
    expect(copy.name).toBe('Project a (copy)');
    expect(copy.targets[0]!.id).not.toBe('t-a');
    expect(r.imported).toEqual([{ sourceId: 'a', id: copy.id, mode: 'copy' }]);
  });

  it('rejects add of an existing id and replace of a missing one, writing nothing', async () => {
    const storage = stored(config(), { 't-a': { Authorization: HEADER_VALUE } });
    const before = structuredClone(storage.data);
    await expect(applyImport(shareOf(['a']), choose({ a: 'add' }), storage)).rejects.toThrow(ConfigError);
    await expect(applyImport(shareOf(['a']), choose({ a: 'replace' }), stored(empty()))).rejects.toThrow(ConfigError);
    expect(storage.data).toEqual(before);
  });

  it('replace with targets keeps header values of the same target id and the position', async () => {
    const storage = stored(config(), { 't-a': { Authorization: HEADER_VALUE }, 't-b': { Authorization: 'other' } });
    const c = config();
    const edited = parseConfig({ ...c, projects: [project('a', { name: 'Remote', folderId: 'f3', tagIds: ['g2'] })], folders: c.folders, tags: c.tags });
    const share = shareOf(['a'], true, edited);
    const r = await applyImport(share, choose({ a: 'replace' }), storage);
    expect(r.config.projects.map((p) => p.id)).toEqual(['a', 'b', 'c']);
    expect(r.config.projects[0]).toMatchObject({ name: 'Remote', folderId: 'f3', tagIds: ['g2'] });
    expect((await loadHeaderValues(storage))['t-a']).toEqual({ Authorization: HEADER_VALUE });
  });

  it('replace without targets in the file keeps local targets and their values', async () => {
    const storage = stored(config(), { 't-a': { Authorization: HEADER_VALUE } });
    const r = await applyImport(shareOf(['a'], false), choose({ a: 'replace' }), storage);
    expect(r.config.projects[0]!.targets).toEqual(config().projects[0]!.targets);
    expect(r.headerValues['t-a']).toEqual({ Authorization: HEADER_VALUE });
  });

  it('replace drops values of removed targets and never hands them to another target', async () => {
    const storage = stored(config(), { 't-a': { Authorization: HEADER_VALUE } });
    const edited = parseConfig({ schemaVersion: 1, projects: [project('a', { targets: [{ id: 't-new', name: 'N', url: 'https://example.com/n', headers: ['Authorization'], purpose: '' }] }), project('n', { targets: [{ id: 't-a', name: 'N', url: 'https://example.com/x', headers: ['Authorization'], purpose: '' }] })] });
    const r = await applyImport(shareOf(['a', 'n'], true, edited), choose({ a: 'replace', n: 'add' }), storage);
    expect(r.headerValues).toEqual({});
    const ids = r.config.projects.flatMap((p) => p.targets.map((t) => t.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(r.config.projects.find((p) => p.id === 'n')!.targets[0]!.id).not.toBe('t-a');
  });

  it('replace reissues a target id that collides with another project', async () => {
    const edited = parseConfig({ schemaVersion: 1, projects: [project('a', { targets: [{ id: 't-b', name: 'N', url: 'https://example.com/n', headers: [], purpose: '' }] })] });
    const storage = stored(config(), { 't-b': { Authorization: HEADER_VALUE } });
    const r = await applyImport(shareOf(['a'], true, edited), choose({ a: 'replace' }), storage);
    expect(r.config.projects[0]!.targets[0]!.id).not.toBe('t-b');
    expect(r.headerValues['t-b']).toEqual({ Authorization: HEADER_VALUE });
    expect(r.config.projects[1]!.targets[0]!.id).toBe('t-b');
  });

  it('matches folders by id, then by name, else creates; tags by name ignoring case', async () => {
    const local = parseConfig({
      schemaVersion: 1,
      folders: [{ id: 'f1', name: 'Local news' }, { id: 'q', name: 'Archive' }],
      tags: [{ id: 'lt', name: 'ALPHA' }],
      projects: [],
    });
    const remote = parseConfig({
      schemaVersion: 1,
      folders: [{ id: 'f1', name: 'News' }, { id: 'r2', name: 'archive' }, { id: 'r3', name: 'Fresh' }],
      tags: [{ id: 'g1', name: 'alpha' }, { id: 'g9', name: 'New tag' }],
      projects: [project('p1', { folderId: 'f1', tagIds: ['g1', 'g9'] }), project('p2', { folderId: 'r2' }), project('p3', { folderId: 'r3' })],
    });
    const r = await applyImport(shareOf(['p1', 'p2', 'p3'], true, remote), choose({ p1: 'add', p2: 'add', p3: 'add' }), stored(local));
    expect(r.config.folders).toEqual([{ id: 'f1', name: 'Local news' }, { id: 'q', name: 'Archive' }, { id: 'r3', name: 'Fresh' }]);
    expect(r.config.projects.map((p) => p.folderId)).toEqual(['f1', 'q', 'r3']);
    expect(r.config.tags).toEqual([{ id: 'lt', name: 'ALPHA' }, { id: 'g9', name: 'New tag' }]);
    expect(r.config.projects[0]!.tagIds).toEqual(['lt', 'g9']);
  });

  it('reissues a folder or tag id taken by a differently named local entry', async () => {
    const local = parseConfig({ schemaVersion: 1, folders: [{ id: 'f1', name: 'Mine' }], tags: [{ id: 'g1', name: 'Mine' }], projects: [] });
    const remote = parseConfig({ schemaVersion: 1, folders: [{ id: 'f9', name: 'Theirs' }], tags: [{ id: 'g1', name: 'Theirs' }], projects: [project('p', { folderId: 'f9', tagIds: ['g1'] })] });
    const r = await applyImport(shareOf(['p'], true, remote), choose({ p: 'add' }), stored(local));
    expect(r.config.tags).toHaveLength(2);
    expect(r.config.tags![1]!.id).not.toBe('g1');
    expect(r.config.projects[0]!.tagIds).toEqual([r.config.tags![1]!.id]);
  });

  it('imports chosen empty folders only', async () => {
    const share = parseShareText(stringifyShare(buildShare(config(), { projectIds: [], folderIds: ['f2', 'f3'], includeTargets: false })));
    const r = await applyImport(share, choose({}, { folderIds: ['f2'] }), stored(empty()));
    expect(r.config.folders).toEqual([{ id: 'f2', name: 'Empty' }]);
  });

  it('writes nothing and shows no values on a failing result', async () => {
    const storage = stored(config(), { 't-a': { Authorization: HEADER_VALUE } });
    const before = structuredClone(storage.data);
    const share = shareOf(['c']);
    await expect(applyImport(share, choose({ c: 'add' }), storage)).rejects.toThrow(ConfigError);
    await expect(applyImport(share, choose({ zz: 'add' }), storage)).rejects.toThrow(ConfigError);
    expect(storage.data).toEqual(before);
  });
});
