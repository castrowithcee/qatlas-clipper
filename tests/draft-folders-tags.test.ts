import { describe, expect, it } from 'vitest';
import { parseConfig, type Config, type Project } from '../src/config';
import {
  addFolder,
  addTag,
  deleteFolder,
  deleteTag,
  moveFolder,
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
