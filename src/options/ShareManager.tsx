import { useEffect, useRef, useState } from 'react';
import { loadConfig, type Config, type StorageArea } from '../config';
import { useI18n } from '../settings';
import { Button, Icon, type IconName } from '../ui/components';
import { ShareExportDialog, type ShareRequest } from './ShareExportDialog';

interface Props {
  storage?: StorageArea;
  dirty: boolean;
}

type State = 'on' | 'off' | 'mixed';

/** A folder counts as chosen when all its projects are; an empty one is chosen on its own. */
const folderState = (inside: string[], chosen: Set<string>, emptyChosen: boolean): State => {
  if (inside.length === 0) return emptyChosen ? 'on' : 'off';
  const n = inside.filter((id) => chosen.has(id)).length;
  return n === 0 ? 'off' : n === inside.length ? 'on' : 'mixed';
};

interface RowProps {
  icon?: IconName;
  label: string;
  state: State;
  onChange: (on: boolean) => void;
  className?: string;
}

/** One compact row: checkbox, symbol and name in a single label. `data-check` lets the effect below set `indeterminate`. */
function Row({ icon, label, state, onChange, className }: RowProps) {
  return (
    <label className={['options-share-row', className].filter(Boolean).join(' ')}>
      <input type="checkbox" className="q-check" data-check={state} checked={state === 'on'} onChange={(e) => onChange(e.target.checked)} />
      {icon && <Icon name={icon} />}
      <span>{label}</span>
    </label>
  );
}

/** Export manager: a compact tree of folders and projects with a three-state head checkbox, exporting through the shared dialog. */
export function ShareManager({ storage, dirty }: Props) {
  const { t } = useI18n();
  const [config, setConfig] = useState<Config>();
  const [projectIds, setProjectIds] = useState<Set<string>>(new Set());
  const [emptyFolders, setEmptyFolders] = useState<Set<string>>(new Set());
  const [request, setRequest] = useState<ShareRequest>();
  const root = useRef<HTMLDivElement>(null);

  // `indeterminate` exists only as a DOM property.
  useEffect(() => {
    for (const el of root.current?.querySelectorAll<HTMLInputElement>('input[data-check]') ?? []) el.indeterminate = el.dataset.check === 'mixed';
  });

  // The saved state is the source, like for the export itself.
  useEffect(() => {
    let cancelled = false;
    loadConfig(storage).then((c) => !cancelled && setConfig(c), () => undefined);
    return () => {
      cancelled = true;
    };
  }, [storage]);

  const projects = config?.projects ?? [];
  const folders = config?.folders ?? [];
  const known = new Set(folders.map((f) => f.id));
  const loose = projects.filter((p) => !p.folderId || !known.has(p.folderId));
  const idsIn = (folderId: string) => projects.filter((p) => p.folderId === folderId).map((p) => p.id);

  const flip = <T,>(set: Set<T>, value: T, on: boolean) => {
    const next = new Set(set);
    if (on) next.add(value);
    else next.delete(value);
    return next;
  };
  const setProject = (pid: string, on: boolean) => setProjectIds((s) => flip(s, pid, on));
  const setFolder = (fid: string, on: boolean) => {
    const inside = idsIn(fid);
    if (inside.length === 0) return setEmptyFolders((s) => flip(s, fid, on));
    setProjectIds((s) => {
      const next = new Set(s);
      for (const pid of inside) {
        if (on) next.add(pid);
        else next.delete(pid);
      }
      return next;
    });
  };

  // Only folders without projects count on their own; a folder with projects is chosen through them.
  const emptyIds = folders.filter((f) => idsIn(f.id).length === 0).map((f) => f.id);
  const chosenEmpty = emptyIds.filter((fid) => emptyFolders.has(fid));
  const chosenProjects = projects.filter((p) => projectIds.has(p.id)).length;
  const selected = chosenProjects + chosenEmpty.length;
  const total = projects.length + emptyIds.length;
  const head: State = selected === 0 ? 'off' : selected === total ? 'on' : 'mixed';
  const setAll = (on: boolean) => {
    setProjectIds(new Set(on ? projects.map((p) => p.id) : []));
    setEmptyFolders(new Set(on ? emptyIds : []));
  };

  const chosenFolders = folders.filter((f) => folderState(idsIn(f.id), projectIds, emptyFolders.has(f.id)) === 'on').map((f) => f.id);
  const unnamed = t('options.projects.unnamed');
  const projectRow = (p: { id: string; name: string }) => (
    <li key={p.id}>
      <Row icon="project" label={p.name || unnamed} state={projectIds.has(p.id) ? 'on' : 'off'} onChange={(on) => setProject(p.id, on)} />
    </li>
  );

  return (
    <div ref={root} className="options-share-manager">
      {config && projects.length === 0 && folders.length === 0 ? (
        <p className="q-hint">{t('options.share.manager.empty')}</p>
      ) : (
        config && (
          <>
            <Row className="options-share-head" label={t('options.share.manager.selectAll')} state={head} onChange={setAll} />
            <ul className="options-share-tree options-share-compact" aria-label={t('options.share.manager.tree')}>
              {loose.map(projectRow)}
              {folders.map((f) => {
                const inside = projects.filter((p) => p.folderId === f.id);
                return (
                  <li key={f.id} data-testid="share-folder">
                    <Row
                      icon="folder-open"
                      label={f.name || t('options.folders.unnamed')}
                      state={folderState(inside.map((p) => p.id), projectIds, emptyFolders.has(f.id))}
                      onChange={(on) => setFolder(f.id, on)}
                    />
                    {inside.length > 0 && <ul className="options-share-tree options-share-compact options-share-children">{inside.map(projectRow)}</ul>}
                  </li>
                );
              })}
            </ul>
            <Button
              icon="file-export"
              disabled={selected === 0}
              onClick={() => setRequest({ projectIds: projects.filter((p) => projectIds.has(p.id)).map((p) => p.id), folderIds: chosenFolders })}
            >
              {chosenProjects > 0 ? t('options.share.manager.buttonCount', { count: chosenProjects }) : t('options.share.manager.button')}
            </Button>
          </>
        )
      )}
      <ShareExportDialog request={request} storage={storage} dirty={dirty} onClose={() => setRequest(undefined)} />
    </div>
  );
}
