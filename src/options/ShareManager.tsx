import { useEffect, useId, useRef, useState } from 'react';
import { loadConfig, type Config, type StorageArea } from '../config';
import { useI18n } from '../settings';
import { Button, Checkbox } from '../ui/components';
import { ShareExportDialog, type ShareRequest } from './ShareExportDialog';

interface Props {
  storage?: StorageArea;
  dirty: boolean;
}

/** A folder counts as chosen when all its projects are; an empty one is chosen on its own. */
const folderState = (inside: string[], chosen: Set<string>, emptyChosen: boolean): 'on' | 'off' | 'mixed' => {
  if (inside.length === 0) return emptyChosen ? 'on' : 'off';
  const n = inside.filter((id) => chosen.has(id)).length;
  return n === 0 ? 'off' : n === inside.length ? 'on' : 'mixed';
};

/** Export manager: a tree of folders and projects with checkboxes, exporting through the shared dialog. */
export function ShareManager({ storage, dirty }: Props) {
  const { t, tn } = useI18n();
  const id = useId();
  const [config, setConfig] = useState<Config>();
  const [projectIds, setProjectIds] = useState<Set<string>>(new Set());
  const [emptyFolders, setEmptyFolders] = useState<Set<string>>(new Set());
  const [request, setRequest] = useState<ShareRequest>();
  const root = useRef<HTMLElement>(null);

  // `indeterminate` exists only as a DOM property.
  useEffect(() => {
    for (const el of root.current?.querySelectorAll<HTMLInputElement>('input[data-folder-check]') ?? []) el.indeterminate = el.dataset.folderCheck === 'mixed';
  });

  // The saved state is the source, like for the export itself.
  useEffect(() => {
    let cancelled = false;
    loadConfig(storage).then((c) => !cancelled && setConfig(c), () => undefined);
    return () => {
      cancelled = true;
    };
  }, [storage]);

  const folders = config?.folders ?? [];
  const known = new Set(folders.map((f) => f.id));
  const loose = (config?.projects ?? []).filter((p) => !p.folderId || !known.has(p.folderId));
  const idsIn = (folderId: string) => (config?.projects ?? []).filter((p) => p.folderId === folderId).map((p) => p.id);

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
  const all = () => {
    setProjectIds(new Set((config?.projects ?? []).map((p) => p.id)));
    setEmptyFolders(new Set(folders.map((f) => f.id)));
  };
  const none = () => {
    setProjectIds(new Set());
    setEmptyFolders(new Set());
  };

  const chosenFolders = folders.filter((f) => folderState(idsIn(f.id), projectIds, emptyFolders.has(f.id)) === 'on').map((f) => f.id);
  const selected = projectIds.size + emptyFolders.size;
  const unnamed = t('options.projects.unnamed');
  const projectBox = (p: { id: string; name: string }) => (
    <li key={p.id}>
      <Checkbox label={p.name || unnamed} checked={projectIds.has(p.id)} onChange={(e) => setProject(p.id, e.target.checked)} />
    </li>
  );

  return (
    <section ref={root} aria-labelledby={`${id}-title`} className="options-section options-share-manager">
      <h3 id={`${id}-title`}>{t('options.share.manager.title')}</h3>
      <p className="q-hint">{t('options.share.manager.note')}</p>
      {config && config.projects.length === 0 && folders.length === 0 ? (
        <p className="q-hint">{t('options.share.manager.empty')}</p>
      ) : (
        config && (
          <>
            <div className="options-share-tools">
              <Button onClick={all}>{t('options.share.manager.all')}</Button>
              <Button onClick={none}>{t('options.share.manager.none')}</Button>
            </div>
            <ul className="options-share-tree" aria-label={t('options.share.manager.tree')}>
              {loose.map(projectBox)}
              {folders.map((f) => {
                const inside = (config.projects ?? []).filter((p) => p.folderId === f.id);
                const state = folderState(inside.map((p) => p.id), projectIds, emptyFolders.has(f.id));
                return (
                  <li key={f.id} data-testid="share-folder">
                    <Checkbox
                      label={f.name || t('options.folders.unnamed')}
                      checked={state === 'on'}
                      data-folder-check={state}
                      onChange={(e) => setFolder(f.id, e.target.checked)}
                    />
                    {inside.length > 0 && <ul className="options-share-tree options-share-children">{inside.map(projectBox)}</ul>}
                  </li>
                );
              })}
            </ul>
            <p role="status" className="q-hint">{projectIds.size > 0 ? tn('options.share.manager.count', projectIds.size) : ''}</p>
            <Button
              icon="arrow-down"
              disabled={selected === 0}
              onClick={() => setRequest({ projectIds: [...projectIds], folderIds: chosenFolders })}
            >
              {t('options.share.manager.button')}
            </Button>
          </>
        )
      )}
      <ShareExportDialog request={request} storage={storage} dirty={dirty} onClose={() => setRequest(undefined)} />
    </section>
  );
}
