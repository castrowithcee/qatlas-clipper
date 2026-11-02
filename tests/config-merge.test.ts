import { describe, expect, it } from 'vitest';
import { mergeConfig, parseConfig, type Config, type HeaderValues, type Project, type StoredState } from '../src/config';

const field = (key: string, label = key) => ({ key, label, required: false, sources: {} });
const target = (id: string, headers: string[] = []) => ({ id, name: `Target ${id}`, url: 'https://example.com/hook', headers, purpose: '' });
const project = (id: string, extra: Partial<Project> = {}): Project => ({
  id,
  name: `Project ${id}`,
  scope: { allSites: true, domains: [] },
  fields: [field('title'), field('price')],
  siteMappings: { 'example.com': { title: '.t' } },
  targets: [],
  ...extra,
});
const state = (projects: Project[], headerValues: HeaderValues = {}): StoredState => ({
  config: { schemaVersion: 1, projects },
  headerValues,
});
const HEADER_VALUE = 'header-value-1';

const base = () => state([project('a'), project('b')]);
const edit = (s: StoredState, fn: (projects: Project[]) => Project[], hv?: HeaderValues): StoredState => {
  const c = structuredClone(s);
  return { config: { ...c.config, projects: fn(c.config.projects) }, headerValues: hv ?? c.headerValues };
};
const onA = (s: StoredState, fn: (p: Project) => Project) => edit(s, (ps) => ps.map((p) => (p.id === 'a' ? fn(p) : p)));
const valid = (s: StoredState): Config => parseConfig(s.config);

function merged(mine: StoredState, theirs: StoredState, renames?: Record<string, Record<string, string>>, b = base()) {
  const r = mergeConfig({ base: b, mine, theirs, renames });
  valid(r.preferMine);
  valid(r.preferTheirs);
  return r;
}

describe('mergeConfig units', () => {
  it('without changes returns the base', () => {
    const r = merged(base(), base());
    expect(r.conflicts).toEqual([]);
    expect(r.preferMine).toEqual(base());
    expect(r.preferTheirs).toEqual(base());
  });

  const cases: [string, (p: Project, v: string) => Project, (p: Project) => unknown, string][] = [
    ['name', (p, v) => ({ ...p, name: v }), (p) => p.name, 'projectName'],
    ['scope', (p, v) => ({ ...p, scope: { allSites: false, domains: [`${v}.example.com`] } }), (p) => p.scope.domains[0], 'scope'],
    ['field', (p, v) => ({ ...p, fields: p.fields.map((f) => (f.key === 'title' ? { ...f, label: v } : f)) }), (p) => p.fields[0]!.label, 'field'],
    ['mapping', (p, v) => ({ ...p, siteMappings: { 'example.com': { title: v } } }), (p) => p.siteMappings['example.com']!.title, 'mapping'],
    [
      'target',
      (p, v) => ({ ...p, targets: p.targets.map((t) => ({ ...t, name: v })) }),
      (p) => p.targets[0]!.name,
      'target',
    ],
  ];
  for (const [unit, change, read, kind] of cases) {
    describe(unit, () => {
      const b = onA(base(), (p) => ({ ...p, targets: [target('t1')] }));
      const get = (s: StoredState) => read(s.config.projects[0]!);
      const chg = (v: string) => onA(b, (p) => change(p, v));
      it('only theirs wins', () => {
        const r = merged(b, chg('x'), undefined, b);
        expect(r.conflicts).toEqual([]);
        expect(get(r.preferMine)).toBe(get(chg('x')));
      });
      it('only mine wins', () => {
        const r = merged(chg('x'), b, undefined, b);
        expect(r.conflicts).toEqual([]);
        expect(get(r.preferTheirs)).toBe(get(chg('x')));
      });
      it('both equal is no conflict', () => {
        const r = merged(chg('x'), chg('x'), undefined, b);
        expect(r.conflicts).toEqual([]);
        expect(get(r.preferMine)).toBe(get(chg('x')));
      });
      it('both different is a conflict resolved by preference', () => {
        const r = merged(chg('x'), chg('y'), undefined, b);
        expect(r.conflicts).toHaveLength(1);
        expect(r.conflicts[0]).toMatchObject({ kind, projectId: 'a' });
        expect(get(r.preferMine)).toBe(get(chg('x')));
        expect(get(r.preferTheirs)).toBe(get(chg('y')));
      });
    });
  }

  it('adds from both sides and deletes of unchanged units', () => {
    const r = merged(
      onA(base(), (p) => ({ ...p, fields: [...p.fields, field('mine')], targets: [target('tm')] })),
      onA(base(), (p) => ({ ...p, fields: [p.fields[0]!, field('theirs')], siteMappings: { ...p.siteMappings, 'example.org': { theirs: '.x' } } })),
    );
    expect(r.conflicts).toEqual([]);
    const p = r.preferMine.config.projects[0]!;
    expect(p.fields.map((f) => f.key)).toEqual(['title', 'mine', 'theirs']);
    expect(p.siteMappings).toEqual({ 'example.com': { title: '.t' }, 'example.org': { theirs: '.x' } });
    expect(p.targets.map((t) => t.id)).toEqual(['tm']);
  });

  it('adding the same new unit differently is a conflict', () => {
    const mk = (label: string) => onA(base(), (p) => ({ ...p, fields: [...p.fields, field('extra', label)] }));
    const r = merged(mk('One'), mk('Two'));
    expect(r.conflicts).toMatchObject([{ kind: 'field', fieldKey: 'extra' }]);
  });

  it('delete against change of the same unit is a conflict', () => {
    const mine = onA(base(), (p) => ({ ...p, fields: p.fields.filter((f) => f.key !== 'price') }));
    const theirs = onA(base(), (p) => ({ ...p, fields: p.fields.map((f) => (f.key === 'price' ? { ...f, label: 'Cost' } : f)) }));
    const r = merged(mine, theirs);
    expect(r.conflicts).toMatchObject([{ kind: 'field', fieldKey: 'price', fieldLabel: 'Cost' }]);
    expect(r.preferMine.config.projects[0]!.fields.map((f) => f.key)).toEqual(['title']);
    expect(r.preferTheirs.config.projects[0]!.fields.map((f) => f.label)).toEqual(['title', 'Cost']);
  });

  it('delete of an unchanged unit wins from either side', () => {
    const gone = onA(base(), (p) => ({ ...p, siteMappings: {} }));
    expect(merged(gone, base()).preferMine.config.projects[0]!.siteMappings).toEqual({});
    expect(merged(base(), gone).preferMine.config.projects[0]!.siteMappings).toEqual({});
  });
});

describe('mergeConfig projects', () => {
  it('project deleted by theirs while mine changed inside is a conflict on the project', () => {
    const mine = onA(base(), (p) => ({ ...p, siteMappings: { 'example.com': { title: '.new' } } }));
    const theirs = edit(base(), (ps) => ps.filter((p) => p.id !== 'a'));
    const r = merged(mine, theirs);
    expect(r.conflicts).toEqual([{ kind: 'project', projectId: 'a', projectName: 'Project a' }]);
    expect(r.preferMine.config.projects.map((p) => p.id)).toEqual(['a', 'b']);
    expect(r.preferMine.config.projects[0]!.siteMappings['example.com']).toEqual({ title: '.new' });
    expect(r.preferTheirs.config.projects.map((p) => p.id)).toEqual(['b']);
  });
  it('project deleted by mine while theirs changed inside is a conflict', () => {
    const mine = edit(base(), (ps) => ps.filter((p) => p.id !== 'a'));
    const theirs = onA(base(), (p) => ({ ...p, name: 'Renamed' }));
    const r = merged(mine, theirs);
    expect(r.conflicts).toEqual([{ kind: 'project', projectId: 'a', projectName: 'Renamed' }]);
    expect(r.preferMine.config.projects.map((p) => p.id)).toEqual(['b']);
    expect(r.preferTheirs.config.projects.map((p) => p.name)).toEqual(['Renamed', 'Project b']);
  });
  it('project deleted on one side only, unchanged on the other, is gone; added projects are kept', () => {
    const r = merged(
      edit(base(), (ps) => [...ps.filter((p) => p.id !== 'a'), project('m')]),
      edit(base(), (ps) => [...ps, project('t')]),
    );
    expect(r.conflicts).toEqual([]);
    expect(r.preferMine.config.projects.map((p) => p.id)).toEqual(['b', 'm', 't']);
  });
  it('same project id added differently is a conflict', () => {
    const r = merged(edit(base(), (ps) => [...ps, project('n', { name: 'One' })]), edit(base(), (ps) => [...ps, project('n', { name: 'Two' })]));
    expect(r.conflicts).toMatchObject([{ kind: 'project', projectId: 'n' }]);
    expect(r.preferTheirs.config.projects[2]!.name).toBe('Two');
  });
});

describe('mergeConfig order', () => {
  const three = () => state([project('a'), project('b'), project('c')]);
  const order = (s: StoredState) => s.config.projects.map((p) => p.id);
  const sorted = (s: StoredState, ids: string[]) => edit(s, (ps) => ids.map((id) => ps.find((p) => p.id === id)!));

  it('only one side reordered: its order, new elements of the other side follow their predecessor', () => {
    const mine = sorted(three(), ['c', 'a', 'b']);
    const theirs = edit(three(), (ps) => [ps[0]!, project('n'), ps[1]!, ps[2]!]);
    const r = merged(mine, theirs, undefined, three());
    expect(r.conflicts).toEqual([]);
    expect(order(r.preferMine)).toEqual(['c', 'a', 'n', 'b']);
    const r2 = merged(theirs, mine, undefined, three());
    expect(order(r2.preferMine)).toEqual(['c', 'a', 'n', 'b']);
  });
  it('removed elements leave the chosen order', () => {
    const mine = sorted(three(), ['c', 'b', 'a']);
    const theirs = edit(three(), (ps) => ps.filter((p) => p.id !== 'b'));
    expect(order(merged(mine, theirs, undefined, three()).preferMine)).toEqual(['c', 'a']);
  });
  it('equal reorder on both sides is no conflict; different is', () => {
    const r = merged(sorted(three(), ['c', 'a', 'b']), sorted(three(), ['c', 'a', 'b']), undefined, three());
    expect(r.conflicts).toEqual([]);
    const c = merged(sorted(three(), ['c', 'a', 'b']), sorted(three(), ['b', 'c', 'a']), undefined, three());
    expect(c.conflicts).toEqual([{ kind: 'projectOrder' }]);
    expect(order(c.preferMine)).toEqual(['c', 'a', 'b']);
    expect(order(c.preferTheirs)).toEqual(['b', 'c', 'a']);
  });
  it('field order per project', () => {
    const b = onA(base(), (p) => ({ ...p, fields: [field('x'), field('y'), field('z')], siteMappings: {} }));
    const re = (ks: string[]) => onA(b, (p) => ({ ...p, fields: ks.map((k) => field(k)) }));
    const keys = (s: StoredState) => s.config.projects[0]!.fields.map((f) => f.key);
    const r = merged(re(['z', 'x', 'y']), onA(b, (p) => ({ ...p, fields: [...p.fields, field('w')] })), undefined, b);
    expect(keys(r.preferMine)).toEqual(['z', 'w', 'x', 'y']);
    const c = merged(re(['z', 'x', 'y']), re(['y', 'z', 'x']), undefined, b);
    expect(c.conflicts).toEqual([{ kind: 'fieldOrder', projectId: 'a', projectName: 'Project a' }]);
    expect(keys(c.preferTheirs)).toEqual(['y', 'z', 'x']);
  });
  it('target order per project conflicts when reordered differently', () => {
    const b = onA(base(), (p) => ({ ...p, targets: [target('t1'), target('t2'), target('t3')] }));
    const re = (ids: string[]) => onA(b, (p) => ({ ...p, targets: ids.map((i) => target(i)) }));
    const c = merged(re(['t3', 't1', 't2']), re(['t2', 't3', 't1']), undefined, b);
    expect(c.conflicts).toMatchObject([{ kind: 'targetOrder', projectId: 'a' }]);
  });
});

describe('mergeConfig field renames', () => {
  const renames = { a: { price: 'cost' } };
  const renameInMine = (s: StoredState) =>
    onA(s, (p) => ({
      ...p,
      fields: p.fields.map((f) => (f.key === 'price' ? { ...f, key: 'cost' } : f)),
      siteMappings: Object.fromEntries(
        Object.entries(p.siteMappings).map(([d, m]) => [d, Object.fromEntries(Object.entries(m).map(([k, v]) => [k === 'price' ? 'cost' : k, v]))]),
      ),
    }));

  it('foreign mapping added for the old key follows the new key', () => {
    const theirs = onA(base(), (p) => ({ ...p, siteMappings: { ...p.siteMappings, 'example.org': { price: '.p' } } }));
    const r = merged(renameInMine(base()), theirs, renames);
    expect(r.conflicts).toEqual([]);
    expect(r.preferMine.config.projects[0]!.siteMappings['example.org']).toEqual({ cost: '.p' });
    expect(r.preferMine.config.projects[0]!.fields.map((f) => f.key)).toEqual(['title', 'cost']);
  });
  it('foreign change of the field and of an existing mapping follows the new key', () => {
    const b = onA(base(), (p) => ({ ...p, siteMappings: { 'example.com': { title: '.t', price: '.p' } } }));
    const theirs = onA(b, (p) => ({
      ...p,
      fields: p.fields.map((f) => (f.key === 'price' ? { ...f, label: 'Cost' } : f)),
      siteMappings: { 'example.com': { title: '.t', price: '.p2' } },
    }));
    const r = merged(renameInMine(b), theirs, renames, b);
    expect(r.conflicts).toEqual([]);
    const p = r.preferMine.config.projects[0]!;
    expect(p.fields[1]).toMatchObject({ key: 'cost', label: 'Cost' });
    expect(p.siteMappings['example.com']).toEqual({ title: '.t', cost: '.p2' });
  });
  it('without a rename entry the foreign mapping for the old key is dropped by validation-safe merge', () => {
    const theirs = onA(base(), (p) => ({ ...p, siteMappings: { ...p.siteMappings, 'example.org': { price: '.p' } } }));
    const r = merged(renameInMine(base()), theirs);
    expect(r.preferMine.config.projects[0]!.siteMappings['example.org']).toBeUndefined();
  });
  it('rename in mine, foreign change of an existing mapping on a field that mine changed too, conflicts', () => {
    const b = onA(base(), (p) => ({ ...p, siteMappings: { 'example.com': { title: '.t', price: '.p' } } }));
    const mine = onA(renameInMine(b), (p) => ({ ...p, siteMappings: { 'example.com': { title: '.t', cost: '.mine' } } }));
    const theirs = onA(b, (p) => ({ ...p, siteMappings: { 'example.com': { title: '.t', price: '.theirs' } } }));
    const r = merged(mine, theirs, renames, b);
    expect(r.conflicts).toMatchObject([{ kind: 'mapping', fieldKey: 'cost', domain: 'example.com' }]);
    expect(r.preferTheirs.config.projects[0]!.siteMappings['example.com']).toEqual({ title: '.t', cost: '.theirs' });
  });
});

describe('mergeConfig field delete', () => {
  const deleteInMine = (s: StoredState) =>
    onA(s, (p) => ({ ...p, fields: p.fields.filter((f) => f.key !== 'price'), siteMappings: { 'example.com': { title: '.t' } } }));

  it('foreign added mappings of the deleted field are dropped without conflict', () => {
    const theirs = onA(base(), (p) => ({ ...p, siteMappings: { ...p.siteMappings, 'example.org': { price: '.p' } } }));
    const r = merged(deleteInMine(base()), theirs);
    expect(r.conflicts).toEqual([]);
    for (const s of [r.preferMine, r.preferTheirs]) {
      expect(s.config.projects[0]!.siteMappings).toEqual({ 'example.com': { title: '.t' } });
    }
  });
  it('foreign change of the field itself is a conflict', () => {
    const theirs = onA(base(), (p) => ({ ...p, fields: p.fields.map((f) => (f.key === 'price' ? { ...f, required: true } : f)) }));
    const r = merged(deleteInMine(base()), theirs);
    expect(r.conflicts).toMatchObject([{ kind: 'field', fieldKey: 'price' }]);
  });
  it('foreign delete of a field with mine-added mapping drops the mapping', () => {
    const mine = onA(base(), (p) => ({ ...p, siteMappings: { ...p.siteMappings, 'example.org': { price: '.p' } } }));
    const r = merged(mine, deleteInMine(base()));
    expect(r.conflicts).toEqual([]);
    expect(r.preferMine.config.projects[0]!.siteMappings).toEqual({ 'example.com': { title: '.t' } });
  });
});

describe('mergeConfig header values', () => {
  const b = () => onA(state([project('a'), project('b')], { t1: { Authorization: 'base-value' } }), (p) => ({ ...p, targets: [target('t1', ['Authorization', 'X-Key'])] }));
  const withValues = (s: StoredState, hv: HeaderValues): StoredState => ({ ...s, headerValues: hv });

  it('one side changes, the other adds, equal changes', () => {
    const mine = withValues(b(), { t1: { Authorization: 'mine-value' } });
    const theirs = withValues(b(), { t1: { Authorization: 'base-value', 'X-Key': 'k' } });
    const r = merged(mine, theirs, undefined, b());
    expect(r.conflicts).toEqual([]);
    expect(r.preferMine.headerValues).toEqual({ t1: { Authorization: 'mine-value', 'X-Key': 'k' } });
    const same = merged(mine, withValues(b(), { t1: { Authorization: 'mine-value' } }), undefined, b());
    expect(same.conflicts).toEqual([]);
  });
  it('a deleted value on one side wins over an unchanged one', () => {
    const r = merged(withValues(b(), {}), b(), undefined, b());
    expect(r.conflicts).toEqual([]);
    expect(r.preferMine.headerValues).toEqual({});
  });
  it('different values conflict without carrying values', () => {
    const r = merged(withValues(b(), { t1: { Authorization: HEADER_VALUE } }), withValues(b(), { t1: { Authorization: 'other-value' } }), undefined, b());
    expect(r.conflicts).toEqual([
      { kind: 'headerValue', projectId: 'a', projectName: 'Project a', targetId: 't1', targetName: 'Target t1', headerName: 'Authorization' },
    ]);
    expect(JSON.stringify(r.conflicts)).not.toContain(HEADER_VALUE);
    expect(r.preferMine.headerValues.t1!.Authorization).toBe(HEADER_VALUE);
    expect(r.preferTheirs.headerValues.t1!.Authorization).toBe('other-value');
  });
  it('delete against change conflicts', () => {
    const r = merged(withValues(b(), {}), withValues(b(), { t1: { Authorization: 'new-value' } }), undefined, b());
    expect(r.conflicts).toMatchObject([{ kind: 'headerValue', headerName: 'Authorization' }]);
    expect(r.preferMine.headerValues).toEqual({});
    expect(r.preferTheirs.headerValues).toEqual({ t1: { Authorization: 'new-value' } });
  });
  it('values of a target removed by the merge are pruned', () => {
    const mine = onA(b(), (p) => ({ ...p, targets: [] }));
    const r = merged(mine, withValues(b(), { t1: { Authorization: 'new-value' } }), undefined, b());
    expect(r.conflicts).toEqual([]);
    expect(r.preferMine.headerValues).toEqual({});
  });
  it('keeps conflict lists equal for both preferences', () => {
    const r = merged(withValues(onA(b(), (p) => ({ ...p, name: 'X' })), { t1: { Authorization: 'm' } }), withValues(onA(b(), (p) => ({ ...p, name: 'Y' })), { t1: { Authorization: 't' } }), undefined, b());
    expect(r.conflicts.map((c) => c.kind)).toEqual(['projectName', 'headerValue']);
  });
});

describe('mergeConfig project content', () => {
  const withContent = (s: StoredState, content: Project['content']) =>
    onA(s, (p) => {
      const copy = { ...p };
      delete copy.content;
      return content === undefined ? copy : { ...copy, content };
    });
  const contentOf = (s: StoredState) => s.config.projects[0]!.content;

  it('takes a one-sided change', () => {
    const changed = withContent(base(), 'html');
    for (const [mine, theirs] of [[changed, base()], [base(), changed]] as const) {
      const r = merged(mine, theirs);
      expect(r.conflicts).toEqual([]);
      expect(contentOf(r.preferMine)).toBe('html');
      expect(contentOf(r.preferTheirs)).toBe('html');
    }
  });

  it('does not conflict on equal changes', () => {
    const r = merged(withContent(base(), 'none'), withContent(base(), 'none'));
    expect(r.conflicts).toEqual([]);
    expect(contentOf(r.preferTheirs)).toBe('none');
  });

  it('conflicts on different changes and honours both preferences', () => {
    const r = merged(withContent(base(), 'html'), withContent(base(), 'none'));
    expect(r.conflicts).toEqual([{ kind: 'content', projectId: 'a', projectName: 'Project a' }]);
    expect(contentOf(r.preferMine)).toBe('html');
    expect(contentOf(r.preferTheirs)).toBe('none');
  });

  it('treats set against absent as different and keeps the key absent', () => {
    const b = withContent(base(), 'markdown');
    const r = merged(withContent(b, undefined), withContent(b, 'html'), undefined, b);
    expect(r.conflicts).toHaveLength(1);
    expect(contentOf(r.preferMine)).toBeUndefined();
    expect('content' in r.preferMine.config.projects[0]!).toBe(false);
    expect(contentOf(r.preferTheirs)).toBe('html');
  });

  it('keeps content and unknown project keys on an unchanged merge', () => {
    const b = withContent(base(), 'html');
    const extra = onA(b, (p) => ({ ...p, futureKey: { x: 1 } }) as Project);
    const r = mergeConfig({ base: extra, mine: extra, theirs: extra });
    expect(r.conflicts).toEqual([]);
    expect(r.preferMine).toEqual(extra);
    const r2 = mergeConfig({ base: extra, mine: onA(extra, (p) => ({ ...p, name: 'N' })), theirs: extra });
    expect((r2.preferTheirs.config.projects[0] as unknown as Record<string, unknown>).futureKey).toEqual({ x: 1 });
    expect(contentOf(r2.preferTheirs)).toBe('html');
  });
});

describe('mergeConfig field format', () => {
  const setFormat = (s: StoredState, key: string, format?: 'text' | 'markdown') =>
    onA(s, (p) => ({
      ...p,
      fields: p.fields.map((f) => {
        if (f.key !== key) return f;
        const rest: Record<string, unknown> = { ...f };
        delete rest.format;
        return (format ? { ...rest, format } : rest) as typeof f;
      }),
    }));
  const formatOf = (s: StoredState, key = 'title') => s.config.projects[0]!.fields.find((f) => f.key === key)!.format;
  const b = setFormat(base(), 'title', 'markdown');

  it('keeps a format change of mine next to a project change of theirs', () => {
    const r = merged(setFormat(b, 'title', 'text'), onA(b, (p) => ({ ...p, name: 'N' })), undefined, b);
    expect(r.conflicts).toEqual([]);
    for (const s of [r.preferMine, r.preferTheirs]) {
      expect(formatOf(s)).toBe('text');
      expect(s.config.projects[0]!.name).toBe('N');
    }
  });

  it('takes a format change of theirs without conflict', () => {
    const r = merged(b, setFormat(b, 'title', 'text'), undefined, b);
    expect(r.conflicts).toEqual([]);
    expect(formatOf(r.preferMine)).toBe('text');
    expect(formatOf(r.preferTheirs)).toBe('text');
  });

  it('conflicts when both set different formats on the same field', () => {
    const r = merged(setFormat(b, 'title', 'text'), setFormat(b, 'title', undefined), undefined, b);
    expect(r.conflicts).toHaveLength(1);
    expect(r.conflicts[0]).toMatchObject({ kind: 'field', projectId: 'a', fieldKey: 'title' });
    expect(formatOf(r.preferMine)).toBe('text');
    expect(formatOf(r.preferTheirs)).toBeUndefined();
  });

  it('conflicts with explicit text vs markdown, each preference carries its value', () => {
    const b3 = setFormat(base(), 'title', 'text');
    const mine = setFormat(b3, 'title', 'markdown');
    const theirs = onA(b3, (p) => ({ ...p, fields: p.fields.map((f) => (f.key === 'title' ? { ...f, format: 'text' as const, label: 'L' } : f)) }));
    const r = merged(mine, theirs, undefined, b3);
    expect(r.conflicts).toHaveLength(1);
    expect(formatOf(r.preferMine)).toBe('markdown');
    expect(formatOf(r.preferTheirs)).toBe('text');
    expect(r.preferTheirs.config.projects[0]!.fields[0]!.label).toBe('L');
  });

  it('leaves a field without format untouched by an unrelated change', () => {
    const r = merged(onA(base(), (p) => ({ ...p, name: 'N' })), base(), undefined, base());
    expect(r.conflicts).toEqual([]);
    for (const s of [r.preferMine, r.preferTheirs]) {
      expect('format' in s.config.projects[0]!.fields[0]!).toBe(false);
    }
  });
});
