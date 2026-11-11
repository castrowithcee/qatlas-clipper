import { useEffect, useState } from 'react';
import { buildShare, loadConfig, stringifyShare, type Config, type StorageArea } from '../config';
import { useI18n } from '../settings';
import { Button, Dialog, Switch, useNotifications } from '../ui/components';
import { saveText } from './saveText';
import { shareFilename } from './shareFilename';

/** What a share export is about. Ids refer to the saved state; the dialog reads that state itself. */
export interface ShareRequest {
  projectIds: string[];
  folderIds: string[];
}

interface Props {
  /** Undefined: closed. A new request starts from the defaults (targets off). */
  request: ShareRequest | undefined;
  storage?: StorageArea;
  /** True if the editor has unsaved changes. */
  dirty: boolean;
  onClose: () => void;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Suggested file name: the name of a single chosen project or folder, else a generic one. */
function suggestedName(config: Config, request: ShareRequest): string | undefined {
  if (request.projectIds.length === 1 && request.folderIds.length === 0) return config.projects.find((p) => p.id === request.projectIds[0])?.name;
  if (request.projectIds.length === 0 && request.folderIds.length === 1) return config.folders?.find((f) => f.id === request.folderIds[0])?.name;
  return undefined;
}

/** Shared by the project, the folder and the export manager. Exports the saved state only, never header values or keys. */
export function ShareExportDialog({ request, ...rest }: Props) {
  return request ? <ShareExport request={request} {...rest} /> : null;
}

function ShareExport({ request, storage, dirty, onClose }: Props & { request: ShareRequest }) {
  const { t, tn } = useI18n();
  const { notify } = useNotifications();
  const [config, setConfig] = useState<Config>();
  const [targets, setTargets] = useState(false);
  const [warning, setWarning] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadConfig(storage).then(
      (c) => !cancelled && setConfig(c),
      (e: unknown) => {
        if (cancelled) return;
        notify('error', t('options.io.export.failed', { message: message(e) }));
        onClose();
      },
    );
    return () => {
      cancelled = true;
    };
    // Only a new request reloads; notify, t and onClose are not stable identities.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request, storage]);

  // The preview with targets tells what is in the selection; an entry that is not saved yet is unknown to the saved state.
  const preview = (() => {
    if (!config) return undefined;
    try {
      return buildShare(config, { ...request, includeTargets: true });
    } catch {
      return 'unsaved' as const;
    }
  })();
  const ready = preview !== undefined && preview !== 'unsaved';
  const targetCount = ready ? preview.projects.reduce((n, p) => n + p.targets.length, 0) : 0;

  const doExport = async () => {
    if (!config || !ready) return;
    setBusy(true);
    try {
      const text = stringifyShare(buildShare(config, { ...request, includeTargets: targets && targetCount > 0 }));
      // Success is only reported once the file is written; a cancelled dialog or a plain download says nothing.
      if (await saveText(shareFilename(suggestedName(config, request)), text, t('options.share.fileType'))) {
        notify('success', t('options.share.done'));
        onClose();
      }
    } catch (e) {
      notify('error', t('options.io.export.failed', { message: message(e) }));
    } finally {
      setBusy(false);
    }
  };

  const projects = ready ? tn('options.share.projects', preview.projects.length) : '';
  const what = ready && preview.folders.length > 0 ? t('options.share.whatBoth', { projects, folders: tn('options.share.folders', preview.folders.length) }) : t('options.share.what', { projects });

  return (
    <>
      <Dialog
        open
        onClose={() => !busy && onClose()}
        title={t('options.share.title')}
        actions={
          <>
            <Button onClick={onClose} disabled={busy}>{t('options.cancel')}</Button>
            <Button variant="primary" icon="file-export" onClick={doExport} disabled={busy || !ready}>{t('options.share.button')}</Button>
          </>
        }
      >
        {preview === 'unsaved' && <p role="alert">{t('options.share.unsaved')}</p>}
        {ready && (
          <div className="options-share">
            <p>{what}</p>
            <p className="q-hint">{t('options.share.note')}</p>
            {dirty && <p className="q-hint">{t('options.io.export.dirty')}</p>}
            {targetCount > 0 && (
              <Switch
                label={t('options.share.targets')}
                hint={t('options.share.targetsHint')}
                checked={targets}
                disabled={busy}
                onChange={(e) => (e.target.checked ? setWarning(true) : setTargets(false))}
              />
            )}
          </div>
        )}
      </Dialog>
      <Dialog
        open={warning}
        onClose={() => setWarning(false)}
        title={t('options.share.warn.title')}
        actions={
          <>
            <Button onClick={() => setWarning(false)}>{t('options.cancel')}</Button>
            <Button variant="danger" onClick={() => { setTargets(true); setWarning(false); }}>{t('options.share.warn.ok')}</Button>
          </>
        }
      >
        <p>{tn('options.share.warn.text', targetCount)}</p>
        <p>{t('options.share.warn.keys')}</p>
      </Dialog>
    </>
  );
}
