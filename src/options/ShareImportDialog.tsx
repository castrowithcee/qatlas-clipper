import { useEffect, useId, useRef, useState } from 'react';
import { MAX_IMPORT_CHARS, applyImport, loadConfig, parseShareText, planImport, type Config, type ImportMode, type ImportPlan, type ShareFile, type StorageArea, type StoredState } from '../config';
import { useI18n } from '../settings';
import { Button, Checkbox, Dialog, Field, Select, useNotifications } from '../ui/components';

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Reads a chosen file as a share file (or a backup); throws an Error whose message is ready to show. */
export async function readShareFile(file: File, t: ReturnType<typeof useI18n>['t']): Promise<ShareFile> {
  try {
    if (file.size > MAX_IMPORT_CHARS * 4) throw new Error(t('options.io.tooLarge'));
    return parseShareText(await file.text());
  } catch (e) {
    throw new Error(t('options.io.failed', { message: message(e) }), { cause: e });
  }
}

interface FileButtonProps {
  className?: string;
  label: string;
  /** Accessible name when the visible text alone is ambiguous. */
  ariaLabel?: string;
  onFile: (file: File) => void;
}

/** "From file" button: opens the file chooser; the chosen file goes to `onFile`. */
export function ShareFileButton({ className, label, ariaLabel, onFile }: FileButtonProps) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <Button icon="arrow-up" className={className} aria-label={ariaLabel} onClick={() => input.current?.click()}>
        {label}
      </Button>
      <input
        ref={input}
        hidden
        type="file"
        accept="application/json,.json"
        data-testid="share-file-input"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) onFile(f);
        }}
      />
    </>
  );
}

/** Export manager section: choose a file with a selection to import. */
export function ShareImportSection({ onFile }: { onFile: (file: File) => Promise<void> }) {
  const { t } = useI18n();
  const id = useId();
  const [error, setError] = useState<string>();
  return (
    <section aria-labelledby={`${id}-title`} className="options-section">
      <h3 id={`${id}-title`}>{t('options.shareImport.title')}</h3>
      <p className="q-hint">{t('options.shareImport.note')}</p>
      <Field label={t('options.shareImport.file')} error={error}>
        {(control) => (
          <input
            {...control}
            type="file"
            className="q-input"
            accept="application/json,.json"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              setError(undefined);
              if (f) onFile(f).catch((err: unknown) => setError(message(err)));
            }}
          />
        )}
      </Field>
    </section>
  );
}

interface Props {
  /** Undefined: closed. */
  share: ShareFile | undefined;
  storage?: StorageArea;
  /** True if the editor has unsaved changes. */
  dirty: boolean;
  onClose: () => void;
  /** Called with the stored state after the write, before the dialog closes. */
  onImported: (state: StoredState, firstId: string | undefined) => void;
}

export function ShareImportDialog({ share, ...rest }: Props) {
  return share ? <ShareImport share={share} {...rest} /> : null;
}

function ShareImport({ share, storage, dirty, onClose, onImported }: Props & { share: ShareFile }) {
  const { t, tn } = useI18n();
  const { notify } = useNotifications();
  const [config, setConfig] = useState<Config>();
  const [plan, setPlan] = useState<ImportPlan>();
  const [projectIds, setProjectIds] = useState<Set<string>>(() => new Set(share.projects.map((p) => p.id)));
  const [folderIds, setFolderIds] = useState<Set<string>>(() => new Set(share.folders.map((f) => f.id)));
  const [modes, setModes] = useState<Record<string, ImportMode>>({});
  const [busy, setBusy] = useState(false);

  // The saved state is what the import acts on.
  useEffect(() => {
    let cancelled = false;
    loadConfig(storage).then(
      (c) => {
        if (cancelled) return;
        setConfig(c);
        setPlan(planImport(c, share));
      },
      (e: unknown) => {
        if (cancelled) return;
        notify('error', t('options.io.failed', { message: message(e) }));
        onClose();
      },
    );
    return () => {
      cancelled = true;
    };
    // Only a new file reloads; notify, t and onClose are not stable identities.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [share, storage]);

  const unnamed = t('options.projects.unnamed');
  const folderUnnamed = t('options.folders.unnamed');
  const flip = <T,>(set: Set<T>, value: T, on: boolean) => {
    const next = new Set(set);
    if (on) next.add(value);
    else next.delete(value);
    return next;
  };

  const planOf = new Map((plan?.projects ?? []).map((p) => [p.id, p]));
  const projectsIn = (folderId: string) => share.projects.filter((p) => p.folderId === folderId);
  const knownFolders = new Set(share.folders.map((f) => f.id));
  const loose = share.projects.filter((p) => p.folderId === undefined || !knownFolders.has(p.folderId));
  const modeOf = (id: string): ImportMode => (planOf.get(id)?.existing ? (modes[id] ?? 'copy') : 'add');

  const chosen = share.projects.filter((p) => projectIds.has(p.id));
  const emptyChosen = (plan?.folders ?? []).filter((f) => f.empty && folderIds.has(f.id));
  const origins = [...new Set(chosen.flatMap((p) => planOf.get(p.id)?.origins ?? []))];
  const replacesWithoutTargets = !share.targetsIncluded && chosen.some((p) => modeOf(p.id) === 'replace');
  const usedFolders = new Set([...chosen.flatMap((p) => (p.folderId === undefined ? [] : [p.folderId])), ...emptyChosen.map((f) => f.id)]);
  const newFolders = (plan?.folders ?? []).filter((f) => !f.exists && usedFolders.has(f.id)).map((f) => f.name);
  const localTags = new Set((config?.tags ?? []).map((x) => x.name.trim().toLowerCase()));
  const usedTags = new Set(chosen.flatMap((p) => p.tagIds ?? []));
  const newTags = share.tags.filter((x) => usedTags.has(x.id) && !localTags.has(x.name.trim().toLowerCase())).map((x) => x.name);
  const count = chosen.length + emptyChosen.length;

  const setFolder = (fid: string, on: boolean) => {
    const inside = projectsIn(fid);
    if (inside.length === 0) return setFolderIds((s) => flip(s, fid, on));
    setProjectIds((s) => {
      const next = new Set(s);
      for (const p of inside) {
        if (on) next.add(p.id);
        else next.delete(p.id);
      }
      return next;
    });
  };

  const confirm = async () => {
    setBusy(true);
    try {
      const result = await applyImport(
        share,
        {
          projects: chosen.map((p) => ({ id: p.id, mode: modeOf(p.id) })),
          folderIds: emptyChosen.map((f) => f.id),
          copySuffix: t('options.shareImport.copySuffix'),
        },
        storage,
      );
      const parts = [
        ...(result.imported.length > 0 ? [tn('options.share.projects', result.imported.length)] : []),
        ...(emptyChosen.length > 0 ? [tn('options.share.folders', emptyChosen.length)] : []),
      ];
      onImported({ config: result.config, headerValues: result.headerValues }, result.imported[0]?.id);
      notify('success', t('options.shareImport.done', { what: parts.join(', ') }));
      onClose();
    } catch (e) {
      notify('error', t('options.io.failed', { message: message(e) }));
      setBusy(false);
    }
  };

  const projectRow = (p: ShareFile['projects'][number]) => {
    const existing = planOf.get(p.id)?.existing;
    const on = projectIds.has(p.id);
    return (
      <li key={p.id}>
        <Checkbox label={p.name || unnamed} checked={on} disabled={busy} onChange={(e) => setProjectIds((s) => flip(s, p.id, e.target.checked))} />
        {existing && (
          <div className="options-import-existing">
            <p className="q-hint">{t('options.shareImport.exists', { name: existing.name || unnamed })}</p>
            <Select
              label={t('options.shareImport.mode', { name: p.name || unnamed })}
              value={modes[p.id] ?? 'copy'}
              disabled={!on || busy}
              onChange={(e) => setModes((m) => ({ ...m, [p.id]: e.target.value as ImportMode }))}
              options={[
                { value: 'copy', label: t('options.shareImport.copy') },
                { value: 'replace', label: t('options.shareImport.replace') },
              ]}
            />
          </div>
        )}
      </li>
    );
  };

  const nothing = share.projects.length === 0 && share.folders.length === 0;

  return (
    <Dialog
      open
      onClose={() => !busy && onClose()}
      title={t('options.shareImport.dialogTitle')}
      actions={
        <>
          <Button onClick={onClose} disabled={busy}>{t('options.cancel')}</Button>
          <Button variant="primary" icon="arrow-up" onClick={confirm} disabled={busy || !plan || count === 0}>
            {t('options.shareImport.button')}
          </Button>
        </>
      }
    >
      {plan && (
        <div className="options-share">
          {nothing ? (
            <p>{t('options.shareImport.nothing')}</p>
          ) : (
            <>
              <p>{t('options.shareImport.intro')}</p>
              {dirty && <p className="q-hint">{t('options.shareImport.dirty')}</p>}
              <ul className="options-share-tree" aria-label={t('options.shareImport.tree')}>
                {loose.map(projectRow)}
                {share.folders.map((f) => {
                  const inside = projectsIn(f.id);
                  const empty = inside.length === 0;
                  const on = empty ? folderIds.has(f.id) : inside.every((p) => projectIds.has(p.id));
                  return (
                    <li key={f.id}>
                      <Checkbox
                        label={`${f.name || folderUnnamed}${empty ? ` ${t('options.shareImport.emptyFolder')}` : ''}`}
                        checked={on}
                        disabled={busy}
                        onChange={(e) => setFolder(f.id, e.target.checked)}
                      />
                      {!empty && <ul className="options-share-tree options-share-children">{inside.map(projectRow)}</ul>}
                    </li>
                  );
                })}
              </ul>
              {(newFolders.length > 0 || newTags.length > 0) && (
                <div className="q-hint">
                  {newFolders.length > 0 && <p>{t('options.shareImport.newFolders', { names: newFolders.join(', ') })}</p>}
                  {newTags.length > 0 && <p>{t('options.shareImport.newTags', { names: newTags.join(', ') })}</p>}
                </div>
              )}
              {!share.targetsIncluded && <p className="q-hint">{t('options.shareImport.noTargets')}</p>}
              {replacesWithoutTargets && <p className="q-hint">{t('options.shareImport.keepTargets')}</p>}
              {origins.length > 0 && (
                <div role="alert" className="options-import-targets">
                  <p>{tn('options.shareImport.targets', origins.length)}</p>
                  <ul>
                    {origins.map((o) => (
                      <li key={o}>{o}</li>
                    ))}
                  </ul>
                  <p>{t('options.shareImport.keys')}</p>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </Dialog>
  );
}
