import { describe, expect, it } from 'vitest';
import { parseConfig, type Config, type Project } from '../src/config';
import {
  addFolder,
  addTag,
  deleteFolder,
  deleteTag,
  moveFolder,
  moveProjectTo,
  normalize,
  renameFolder,
  renameTag,
  setProjectFolder,
  setProjectTags,
  validate,
} from '../src/options/draft';

const proj = (id: string, extra: Partial<Project> = {}): Project => ({
  id,
  name: id,
  scope: { allSites: true, domains: [] },
  fields: [],
  siteMappings: {},
  targets: [],
  ...extra,
});
const config = (extra: Partial<Config> = {}): Config => ({ schemaVersion: 1, projects: [], ...extra });

describe('folder editing', () => {
  it('adds, renames and moves folders', () => {
    let c = addFolder(addFolder(addFolder(config(), 'A'), 'B'), 'C');
    expect(c.folders!.map((f) => f.name)).toEqual(['A', 'B', 'C']);
    expect(new Set(c.folders!.map((f) => f.id)).size).toBe(3);
    const id = c.folders![0]!.id;
    c = renameFolder(c, id, 'A2');
    expect(c.folders![0]).toEqual({ id, name: 'A2' });
    c = moveFolder(c, 0, 2);
    expect(c.folders!.map((f) => f.name)).toEqual(['B', 'C', 'A2']);
    expect(moveFolder(c, 0, 9)).toEqual(c);
    expect(validate(c)).toEqual([]);
  });

  it('deleting a folder keeps its projects without folderId', () => {
    const c0 = addFolder(addFolder(config(), 'A'), 'B');
    const [a, b] = c0.folders!;
    const c = { ...c0, projects: [proj('p1', { folderId: a!.id }), proj('p2', { folderId: b!.id }), proj('p3')] };
    const next = deleteFolder(c, a!.id);
    expect(next.folders).toEqual([b]);
    expect(next.projects.map((p) => p.id)).toEqual(['p1', 'p2', 'p3']);
    expect(next.projects[0]).not.toHaveProperty('folderId');
    expect(next.projects[1]!.folderId).toBe(b!.id);
    expect(validate(next)).toEqual([]);
  });

  it('assigns a project to a folder and takes it out again', () => {
    const p = setProjectFolder(proj('p'), 'f1');
    expect(p.folderId).toBe('f1');
    expect(setProjectFolder(p, undefined)).toEqual(proj('p'));
    expect(setProjectFolder(p, undefined)).not.toHaveProperty('folderId');
  });
});

describe('tag editing', () => {
  it('adds and renames tags', () => {
    let c = addTag(addTag(config(), 'x'), 'y');
    const id = c.tags![1]!.id;
    c = renameTag(c, id, 'z');
    expect(c.tags!.map((t) => t.name)).toEqual(['x', 'z']);
  });

  it('deleting a tag removes it from all projects', () => {
    const c0 = addTag(addTag(config(), 'x'), 'y');
    const [x, y] = c0.tags!;
    const c = { ...c0, projects: [proj('p1', { tagIds: [x!.id, y!.id] }), proj('p2', { tagIds: [x!.id] }), proj('p3')] };
    const next = deleteTag(c, x!.id);
    expect(next.tags).toEqual([y]);
    expect(next.projects[0]!.tagIds).toEqual([y!.id]);
    expect(next.projects[1]).not.toHaveProperty('tagIds');
    expect(next.projects[2]).toEqual(proj('p3'));
    expect(validate(next)).toEqual([]);
  });

  it('sets the tags of a project without duplicates; empty removes the key', () => {
    expect(setProjectTags(proj('p'), ['a', 'b', 'a']).tagIds).toEqual(['a', 'b']);
    expect(setProjectTags(proj('p', { tagIds: ['a'] }), [])).not.toHaveProperty('tagIds');
  });
});

describe('normalize', () => {
  it('trims folder and tag names and leaves a config without them untouched', () => {
    const c = normalize(config({ folders: [{ id: 'f', name: ' A ' }], tags: [{ id: 't', name: ' b' }] }));
    expect(c.folders![0]!.name).toBe('A');
    expect(c.tags![0]!.name).toBe('b');
    expect(normalize(config())).toEqual(parseConfig(config()));
    expect(normalize(config())).not.toHaveProperty('folders');
  });

  it('validate reports a duplicate name only after trimming', () => {
    expect(validate(config({ folders: [{ id: 'f1', name: 'A' }, { id: 'f2', name: ' a ' }] })).length).toBe(1);
  });
});

describe('moveProjectTo', () => {
  const folders = [{ id: 'fa', name: 'A' }, { id: 'fb', name: 'B' }];
  const list = [proj('p1'), proj('p2', { folderId: 'fa' }), proj('p3'), proj('p4', { folderId: 'fa' }), proj('p5', { folderId: 'fb' }), proj('p6', { folderId: 'fa' })];
  const ids = (ps: Project[]) => ps.map((p) => p.id);
  const group = (ps: Project[], folderId?: string) => ids(ps.filter((p) => p.folderId === folderId));

  it('moves within a group to the given position and leaves the other groups alone', () => {
    const out = moveProjectTo(list, folders, 'p6', 'fa', 0);
    expect(group(out, 'fa')).toEqual(['p6', 'p2', 'p4']);
    expect(group(out)).toEqual(['p1', 'p3']);
    expect(group(out, 'fb')).toEqual(['p5']);
    expect(group(moveProjectTo(list, folders, 'p2', 'fa', 2), 'fa')).toEqual(['p4', 'p6', 'p2']);
    expect(group(moveProjectTo(list, folders, 'p1', undefined, 1))).toEqual(['p3', 'p1']);
  });

  it('moves into another folder at a position or the end, and takes the folder id along', () => {
    const mid = moveProjectTo(list, folders, 'p5', 'fa', 1);
    expect(group(mid, 'fa')).toEqual(['p2', 'p5', 'p4', 'p6']);
    expect(mid.find((p) => p.id === 'p5')?.folderId).toBe('fa');
    expect(group(moveProjectTo(list, folders, 'p1', 'fb', 99), 'fb')).toEqual(['p5', 'p1']);
    expect(group(moveProjectTo(list, folders, 'p1', 'fa', 99), 'fa')).toEqual(['p2', 'p4', 'p6', 'p1']);
  });

  it('moves out of a folder without a folderId, also into an empty group', () => {
    const out = moveProjectTo(list, folders, 'p4', undefined, 1);
    expect(group(out)).toEqual(['p1', 'p4', 'p3']);
    expect('folderId' in out.find((p) => p.id === 'p4')!).toBe(false);
    const alone = moveProjectTo([proj('x', { folderId: 'fa' })], folders, 'x', undefined, 0);
    expect(ids(alone)).toEqual(['x']);
    expect(moveProjectTo([proj('x'), proj('y')], folders, 'x', 'fb', 0)[1]).toMatchObject({ id: 'x', folderId: 'fb' });
  });

  it('keeps the relative order of all other projects and ignores unknown ids and folders', () => {
    const out = moveProjectTo(list, folders, 'p3', 'fb', 0);
    expect(ids(out).filter((id) => id !== 'p3')).toEqual(['p1', 'p2', 'p4', 'p5', 'p6']);
    expect(moveProjectTo(list, folders, 'nope', 'fa', 0)).toBe(list);
    expect(moveProjectTo(list, folders, 'p1', 'gone', 0)).toBe(list);
  });

  it('treats a project with a missing folder as having none', () => {
    const odd = [proj('p1'), proj('p2', { folderId: 'gone' })];
    expect(ids(moveProjectTo(odd, folders, 'p1', undefined, 1))).toEqual(['p2', 'p1']);
  });
});
