import { deepEqual } from './equal';
import type { Config, Field, HeaderValues, Project, Target } from './schema';
import { pruneHeaderValues, type StoredState } from './storage';

export type MergePreference = 'mine' | 'theirs';

export type MergeConflictKind =
  | 'project' // deleted on one side and changed on the other, or added differently on both
  | 'projectName'
  | 'scope'
  | 'content'
  | 'projectOrder'
  | 'field'
  | 'fieldOrder'
  | 'mapping'
  | 'target'
  | 'targetOrder'
  | 'headerValue';

/** Identifies a conflicting unit for a dialog. Never carries header values or selectors. */
export interface MergeConflict {
  kind: MergeConflictKind;
  projectId?: string;
  projectName?: string;
  fieldKey?: string;
  fieldLabel?: string;
  domain?: string;
  targetId?: string;
  targetName?: string;
  headerName?: string;
}

export interface MergeResult {
  /** Same list for both preferences. */
  conflicts: MergeConflict[];
  /** All conflicts resolved in favour of the draft. Equals `preferTheirs` if there are no conflicts. */
  preferMine: StoredState;
  /** All conflicts resolved in favour of the newly stored state. */
  preferTheirs: StoredState;
}

/** projectId -> old field key (in base) -> new field key (in mine). */
export type FieldRenames = Record<string, Record<string, string>>;

export interface MergeInput {
  /** Last known stored state the draft was started from. */
  base: StoredState;
  /** The draft. */
  mine: StoredState;
  /** The stored state now. */
  theirs: StoredState;
  /** Field key renames made in the draft; without stable field ids they cannot be derived. */
  renames?: FieldRenames;
}

/**
 * Three-way merge of config and header values. Units: project (name, scope, fields, targets, site mappings,
 * order of fields and targets), project order, header value per target and name. A unit changed on one side
 * only takes that change; equal changes do not conflict; different changes are conflicts, resolved for all
 * of them together by the caller's choice of `preferMine` or `preferTheirs`.
 * Not covered: a rename made on both sides is seen as delete plus add; a target id moved or added in two
 * projects can yield an invalid result that the writer's validation rejects.
 */
export function mergeConfig(input: MergeInput): MergeResult {
  const withMine = run(input, 'mine');
  const withTheirs = run(input, 'theirs');
  return { conflicts: withMine.conflicts, preferMine: withMine.state, preferTheirs: withTheirs.state };
}

type Pick<T> = { value: T | undefined; conflict: boolean };

function pick3<T>(base: T | undefined, mine: T | undefined, theirs: T | undefined, prefer: MergePreference): Pick<T> {
  if (deepEqual(mine, theirs)) return { value: mine, conflict: false };
  if (deepEqual(base, mine)) return { value: theirs, conflict: false };
  if (deepEqual(base, theirs)) return { value: mine, conflict: false };
  return { value: prefer === 'mine' ? mine : theirs, conflict: true };
}

const orderChanged = (base: string[], side: string[]): boolean =>
  !deepEqual(
    base.filter((k) => side.includes(k)),
    side.filter((k) => base.includes(k)),
  );

/** Order of the merged set `keep`: the side that reordered wins; elements new from the other side follow their predecessor. */
function mergeOrder(
  base: string[],
  mine: string[],
  theirs: string[],
  keep: Set<string>,
  prefer: MergePreference,
): { order: string[]; conflict: boolean } {
  const mineMoved = orderChanged(base, mine);
  const theirsMoved = orderChanged(base, theirs);
  let primary = base;
  let others = [mine, theirs];
  let conflict = false;
  if (mineMoved && !theirsMoved) [primary, others] = [mine, [theirs]];
  else if (!mineMoved && theirsMoved) [primary, others] = [theirs, [mine]];
  else if (mineMoved && theirsMoved) {
    const sameOrder = deepEqual(
      mine.filter((k) => theirs.includes(k)),
      theirs.filter((k) => mine.includes(k)),
    );
    conflict = !sameOrder;
    const first = prefer === 'mine' || sameOrder ? mine : theirs;
    [primary, others] = [first, [first === mine ? theirs : mine]];
  }
  const order = primary.filter((k) => keep.has(k));
  // Last list first, so that on equal predecessors the first list's additions end up first.
  for (const list of [...others].reverse()) {
    list.forEach((key, i) => {
      if (!keep.has(key) || order.includes(key)) return;
      let at = 0;
      for (let j = i - 1; j >= 0; j--) {
        const p = order.indexOf(list[j] as string);
        if (p >= 0) {
          at = p + 1;
          break;
        }
      }
      order.splice(at, 0, key);
    });
  }
  for (const key of keep) if (!order.includes(key)) order.push(key);
  return { order, conflict };
}

const union = (...lists: string[][]): string[] => [...new Set(lists.flat())];

/** Renames that are plausible for this project; others are ignored. */
function usableRenames(base: Project, mine: Project, theirs: Project, wanted: Record<string, string>): Record<string, string> {
  const has = (p: Project, key: string) => p.fields.some((f) => f.key === key);
  const out: Record<string, string> = {};
  for (const [from, to] of Object.entries(wanted)) {
    if (from !== to && has(base, from) && !has(base, to) && has(mine, to) && !has(mine, from) && !has(theirs, to)) out[from] = to;
  }
  return out;
}

function applyRenames(project: Project, renames: Record<string, string>): Project {
  if (Object.keys(renames).length === 0) return project;
  const rename = (key: string) => (Object.hasOwn(renames, key) ? (renames[key] as string) : key);
  const siteMappings: Project['siteMappings'] = {};
  for (const [domain, map] of Object.entries(project.siteMappings)) {
    siteMappings[domain] = Object.fromEntries(Object.entries(map).map(([k, sel]) => [rename(k), sel]));
  }
  return { ...project, fields: project.fields.map((f) => ({ ...f, key: rename(f.key) })), siteMappings };
}

function run(input: MergeInput, prefer: MergePreference): { state: StoredState; conflicts: MergeConflict[] } {
  const { base, mine, theirs } = input;
  const conflicts: MergeConflict[] = [];
  const byId = (c: Config) => new Map(c.projects.map((p) => [p.id, p]));
  const [pb, pm, pt] = [byId(base.config), byId(mine.config), byId(theirs.config)];
  const ids = union(
    mine.config.projects.map((p) => p.id),
    theirs.config.projects.map((p) => p.id),
    base.config.projects.map((p) => p.id),
  );

  const merged = new Map<string, Project>();
  for (const id of ids) {
    const [b, m, t] = [pb.get(id), pm.get(id), pt.get(id)];
    const unit = { kind: 'project' as const, projectId: id, projectName: (m ?? t ?? b)?.name };
    if (!m && !t) continue;
    if (!b) {
      if (m && t && !deepEqual(m, t)) {
        conflicts.push(unit);
        merged.set(id, prefer === 'mine' ? m : t);
      } else merged.set(id, (m ?? t) as Project);
    } else if (!m || !t) {
      const other = (m ?? t) as Project;
      if (deepEqual(other, b)) continue;
      conflicts.push(unit);
      // Preferring the side that deleted drops the project, the other keeps the changed one.
      if ((prefer === 'mine') === (m !== undefined)) merged.set(id, other);
    } else {
      merged.set(id, mergeProject(b, m, t, input.renames?.[id] ?? {}, prefer, conflicts));
    }
  }

  const ord = mergeOrder(
    base.config.projects.map((p) => p.id),
    mine.config.projects.map((p) => p.id),
    theirs.config.projects.map((p) => p.id),
    new Set(merged.keys()),
    prefer,
  );
  if (ord.conflict) conflicts.push({ kind: 'projectOrder' });
  const config: Config = { ...mine.config, projects: ord.order.map((id) => merged.get(id) as Project) };

  const headerValues = mergeHeaderValues(input, config, prefer, conflicts);
  return { state: { config, headerValues }, conflicts };
}

const HANDLED_PROJECT_KEYS = new Set(['id', 'name', 'scope', 'content', 'fields', 'siteMappings', 'targets']);

function mergeProject(
  baseOrig: Project,
  mine: Project,
  theirsOrig: Project,
  wantedRenames: Record<string, string>,
  prefer: MergePreference,
  conflicts: MergeConflict[],
): Project {
  const renames = usableRenames(baseOrig, mine, theirsOrig, wantedRenames);
  const base = applyRenames(baseOrig, renames);
  const theirs = applyRenames(theirsOrig, renames);
  const at = { projectId: mine.id, projectName: mine.name };
  const note = (c: Omit<MergeConflict, 'projectId' | 'projectName'>) => conflicts.push({ ...c, ...at });

  const name = pick3(base.name, mine.name, theirs.name, prefer);
  if (name.conflict) note({ kind: 'projectName' });
  const scope = pick3(base.scope, mine.scope, theirs.scope, prefer);
  if (scope.conflict) note({ kind: 'scope' });

  // Fields
  const fieldMap = (p: Project) => new Map(p.fields.map((f) => [f.key, f]));
  const [fb, fm, ft] = [fieldMap(base), fieldMap(mine), fieldMap(theirs)];
  const fieldKeys = union(
    mine.fields.map((f) => f.key),
    theirs.fields.map((f) => f.key),
    base.fields.map((f) => f.key),
  );
  const fields = new Map<string, Field>();
  const goneKeys = new Set<string>();
  for (const key of fieldKeys) {
    const r = pick3(fb.get(key), fm.get(key), ft.get(key), prefer);
    if (r.conflict) note({ kind: 'field', fieldKey: key, fieldLabel: (fm.get(key) ?? ft.get(key) ?? fb.get(key))?.label });
    if (r.value) fields.set(key, r.value);
    if (fb.has(key) && (!fm.has(key) || !ft.has(key))) goneKeys.add(key);
  }
  const labelOf = (key: string) => (fm.get(key) ?? ft.get(key) ?? fb.get(key))?.label;
  const fo = mergeOrder(
    base.fields.map((f) => f.key),
    mine.fields.map((f) => f.key),
    theirs.fields.map((f) => f.key),
    new Set(fields.keys()),
    prefer,
  );
  if (fo.conflict) note({ kind: 'fieldOrder' });

  // Site mappings: a field removed on either side takes its mappings with it, without a conflict of its own.
  const siteMappings: Project['siteMappings'] = {};
  const domains = union(Object.keys(mine.siteMappings), Object.keys(theirs.siteMappings), Object.keys(base.siteMappings));
  const own = (p: Project, domain: string): Record<string, string> =>
    Object.hasOwn(p.siteMappings, domain) ? (p.siteMappings[domain] as Record<string, string>) : {};
  for (const domain of domains) {
    const [mb, mm, mt] = [own(base, domain), own(mine, domain), own(theirs, domain)];
    for (const key of union(Object.keys(mm), Object.keys(mt), Object.keys(mb))) {
      if (!fields.has(key)) continue;
      const get = (m: Record<string, string>) => (Object.hasOwn(m, key) ? m[key] : undefined);
      const r = pick3(get(mb), get(mm), get(mt), prefer);
      if (r.conflict && !goneKeys.has(key)) note({ kind: 'mapping', fieldKey: key, fieldLabel: labelOf(key), domain });
      if (r.value !== undefined) (siteMappings[domain] ??= {})[key] = r.value;
    }
  }

  // Targets
  const targetMap = (p: Project) => new Map(p.targets.map((t) => [t.id, t]));
  const [tb, tm, tt] = [targetMap(base), targetMap(mine), targetMap(theirs)];
  const targets = new Map<string, Target>();
  for (const id of union(mine.targets.map((t) => t.id), theirs.targets.map((t) => t.id), base.targets.map((t) => t.id))) {
    const r = pick3(tb.get(id), tm.get(id), tt.get(id), prefer);
    if (r.conflict) note({ kind: 'target', targetId: id, targetName: (tm.get(id) ?? tt.get(id) ?? tb.get(id))?.name });
    if (r.value) targets.set(id, r.value);
  }
  const to = mergeOrder(
    base.targets.map((t) => t.id),
    mine.targets.map((t) => t.id),
    theirs.targets.map((t) => t.id),
    new Set(targets.keys()),
    prefer,
  );
  if (to.conflict) note({ kind: 'targetOrder' });

  const content = pick3(base.content, mine.content, theirs.content, prefer);
  if (content.conflict) note({ kind: 'content' });

  // Any property without its own handling above is merged per key, so a field added to the schema is never dropped silently.
  const extra: Record<string, unknown> = {};
  for (const key of union(Object.keys(base), Object.keys(mine), Object.keys(theirs))) {
    if (HANDLED_PROJECT_KEYS.has(key)) continue;
    const get = (p: Project) => (p as unknown as Record<string, unknown>)[key];
    const r = pick3(get(base), get(mine), get(theirs), prefer);
    if (r.conflict) note({ kind: 'project' });
    if (r.value !== undefined) extra[key] = r.value;
  }

  return {
    ...extra,
    // An absent value stays absent (it means "markdown"); it is not normalised, so nothing is rewritten silently.
    ...(content.value !== undefined && { content: content.value }),
    id: mine.id,
    name: name.value as string,
    scope: scope.value as Project['scope'],
    fields: fo.order.map((k) => fields.get(k) as Field),
    siteMappings,
    targets: to.order.map((id) => targets.get(id) as Target),
  };
}

function mergeHeaderValues(
  { base, mine, theirs }: MergeInput,
  config: Config,
  prefer: MergePreference,
  conflicts: MergeConflict[],
): HeaderValues {
  const targetInfo = (c: Config) =>
    new Map(c.projects.flatMap((p) => p.targets.map((t) => [t.id, { project: p, target: t }] as const)));
  const [im, it] = [targetInfo(mine.config), targetInfo(theirs.config)];
  const out: HeaderValues = {};
  const get = (v: HeaderValues, id: string, name: string) =>
    Object.hasOwn(v, id) && Object.hasOwn(v[id] as object, name) ? (v[id] as Record<string, string>)[name] : undefined;
  for (const id of union(Object.keys(mine.headerValues), Object.keys(theirs.headerValues), Object.keys(base.headerValues))) {
    const names = (v: HeaderValues) => (Object.hasOwn(v, id) ? Object.keys(v[id] as object) : []);
    for (const name of union(names(mine.headerValues), names(theirs.headerValues), names(base.headerValues))) {
      const r = pick3(get(base.headerValues, id, name), get(mine.headerValues, id, name), get(theirs.headerValues, id, name), prefer);
      const a = im.get(id);
      // Only report where both sides still have the target; otherwise the value is dropped or follows its adder.
      if (r.conflict && a && it.has(id)) {
        conflicts.push({
          kind: 'headerValue',
          projectId: a.project.id,
          projectName: a.project.name,
          targetId: id,
          targetName: a.target.name,
          headerName: name,
        });
      }
      if (r.value !== undefined) (out[id] ??= {})[name] = r.value;
    }
  }
  return pruneHeaderValues(config, out);
}
