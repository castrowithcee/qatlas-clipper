import { useId, useRef, useState } from 'react';
import { exportConfig, checkImportUrl, fetchImportText, MAX_IMPORT_CHARS, parseImportText, saveConfig, type Config, type StorageArea } from '../config';
import { useI18n } from '../settings';
import { Button, Dialog, IconButton, TextField, useNotifications } from '../ui/components';
import type { PermissionsApi } from './permissions';
import { AddressList, ShareFileButton, ShareImportButton } from './ShareImportDialog';
import { ShareManager } from './ShareManager';
import { saveText } from './saveText';

export const EXPORT_FILENAME = 'qatlas-clipper-config.json';

interface Props {
  storage?: StorageArea;
  permissions: PermissionsApi;
  /** True if the editor has unsaved changes. */
  dirty: boolean;
  onImported: () => void;
  /** Brackets the replacing write, so the page does not treat its own import as a foreign change. */
  onImporting?: (active: boolean) => void;
  /** Opens the import dialog for a chosen share file; rejects with a message for an invalid file. */
  onShareFile: (file: File) => Promise<void>;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Distinct target origins of a configuration, in file order; an unparsable address is shown as written. */
const targetOrigins = (config: Config) =>
  [...new Set(config.projects.flatMap((p) => p.targets.map((x) => { try { return new URL(x.url).origin; } catch { return x.url; } })))];

export function ImportExport({ storage, permissions, dirty, onImported, onImporting, onShareFile }: Props) {
  const { t, tn } = useI18n();
  const id = useId();
  const [url, setUrl] = useState('');
  const [pending, setPending] = useState<Config>();
  const { notify, dismiss } = useNotifications();
  const statusId = useRef<number | undefined>(undefined);
  const setStatus = (status: { kind: 'success' | 'error'; text: string } | undefined) => {
    if (statusId.current !== undefined) dismiss(statusId.current);
    statusId.current = status && notify(status.kind, status.text);
  };
  const [fileError, setFileError] = useState<string>();
  const [urlError, setUrlError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setPending(undefined);
    setStatus(undefined);
    setFileError(undefined);
    setUrlError(undefined);
  };

  const doExport = async () => {
    reset();
    try {
      // Only the saved state is exported, never header values.
      // Success is only reported once the file is written; a plain download or a cancelled dialog says nothing.
      if (await saveText(EXPORT_FILENAME, await exportConfig(storage), t('options.io.export.fileType'))) {
        setStatus({ kind: 'success', text: t('options.io.export.done') });
      }
    } catch (e) {
      setStatus({ kind: 'error', text: t('options.io.export.failed', { message: message(e) }) });
    }
  };

  const fromFile = async (file: File | undefined) => {
    reset();
    if (!file) return;
    try {
      if (file.size > MAX_IMPORT_CHARS * 4) throw new Error(t('options.io.tooLarge'));
      setPending(parseImportText(await file.text()));
    } catch (e) {
      setFileError(t('options.io.failed', { message: message(e) }));
    }
  };

  const fromUrl = () => {
    reset();
    let pattern: string;
    try {
      pattern = checkImportUrl(url).pattern;
    } catch (e) {
      setUrlError(t('options.io.failed', { message: message(e) }));
      return;
    }
    // Requested directly from the click, with nothing awaited before, to keep the user gesture.
    const request = permissions.request([pattern]).catch(() => false);
    setBusy(true);
    void (async () => {
      try {
        if (!(await request)) {
          setUrlError(t('options.io.denied'));
          return;
        }
        setPending(parseImportText(await fetchImportText(url, { hasPermission: async () => true })));
      } catch (e) {
        setUrlError(t('options.io.failed', { message: message(e) }));
      } finally {
        setBusy(false);
      }
    })();
  };

  const confirm = async () => {
    if (!pending) return;
    setBusy(true);
    onImporting?.(true);
    try {
      await saveConfig(pending, storage);
      setPending(undefined);
      setStatus({ kind: 'success', text: tn('options.io.imported', pending.projects.length) });
      onImported();
    } catch (e) {
      onImporting?.(false);
      setPending(undefined);
      setStatus({ kind: 'error', text: t('options.io.failed', { message: message(e) }) });
    } finally {
      setBusy(false);
    }
  };

  const origins = pending ? targetOrigins(pending) : [];

  return (
    <section aria-labelledby={`${id}-title`} className="options-io">
      <h2 id={`${id}-title`}>
        {t('options.nav.importExport')}{' '}
        <IconButton icon="info" label={t('ui.moreInfo')} tooltip={t('options.io.help')} className="q-help" />
      </h2>
      <section aria-labelledby={`${id}-backup`} className="options-section">
        <h3 id={`${id}-backup`}>
          {t('options.io.backup.title')}{' '}
          <IconButton icon="info" label={t('ui.moreInfo')} tooltip={`${t('options.io.export.note')} ${t('options.io.import.note')}`} className="q-help" />
        </h3>
        <div className="options-restore">
          <div>
            <Button icon="file-export" className="options-wide" onClick={doExport} disabled={busy}>
              {t('options.io.export.button')}
            </Button>
            {dirty && <p className="q-hint">{t('options.io.export.dirty')}</p>}
          </div>
          <ShareFileButton
            label={t('options.io.file')}
            className="options-wide"
            error={fileError}
            disabled={busy}
            testId="backup-file-input"
            onFile={(f) => void fromFile(f)}
          />
          <div className="options-add">
            <TextField
              label={t('options.io.url')}
              type="url"
              value={url}
              placeholder="https://example.com/config.json"
              error={urlError}
              onChange={(e) => setUrl(e.target.value)}
            />
            <Button icon="file-import" onClick={fromUrl} disabled={busy || url.trim() === ''}>
              {t('options.io.load')}
            </Button>
          </div>
        </div>
      </section>
      <section aria-labelledby={`${id}-share`} className="options-section">
        <h3 id={`${id}-share`}>
          {t('options.io.share.title')}{' '}
          <IconButton icon="info" label={t('ui.moreInfo')} tooltip={`${t('options.share.manager.note')} ${t('options.shareImport.note')}`} className="q-help" />
        </h3>
        <ShareManager storage={storage} dirty={dirty} />
        <div className="options-share-import">
          <ShareImportButton onFile={onShareFile} />
        </div>
      </section>
      <Dialog
        open={pending !== undefined}
        onClose={() => !busy && setPending(undefined)}
        title={t('options.io.confirm.title')}
        actions={
          <>
            <Button onClick={() => setPending(undefined)} disabled={busy}>
              {t('options.io.confirm.cancel')}
            </Button>
            <Button variant="danger" onClick={confirm} disabled={busy}>
              {t('options.io.confirm.ok')}
            </Button>
          </>
        }
      >
        {pending && (
          <>
            <p>{tn('options.io.confirm.count', pending.projects.length)}</p>
            {pending.projects.length === 0 && (
              <p role="alert" className="options-import-targets">
                {t('options.io.confirm.empty')}
              </p>
            )}
            <p>{t('options.io.confirm.replace')}</p>
            {dirty && <p>{t('options.io.confirm.dirty')}</p>}
            {origins.length > 0 && (
              <div role="alert" className="options-import-targets">
                <p>{tn('options.shareImport.targets', origins.length)}</p>
                <AddressList origins={origins} />
                <p>{t('options.shareImport.keys')}</p>
              </div>
            )}
            {pending.projects.length > 0 && origins.length === 0 && <p className="q-hint">{t('options.shareImport.noTargets')}</p>}
          </>
        )}
      </Dialog>
    </section>
  );
}
