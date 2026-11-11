import { useId, useRef, useState } from 'react';
import { exportConfig, checkImportUrl, fetchImportText, MAX_IMPORT_CHARS, parseImportText, saveConfig, type Config, type StorageArea } from '../config';
import { useI18n } from '../settings';
import { Button, Dialog, Field, IconButton, TextField, Tooltip, useNotifications } from '../ui/components';
import type { PermissionsApi } from './permissions';
import { ShareImportSection } from './ShareImportDialog';
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

  return (
    <>
    <section aria-labelledby={`${id}-title`} className="options-io">
      <h2 id={`${id}-title`}>
        {t('options.nav.importExport')}{' '}
        <Tooltip content={t('options.io.help')}>
          {(props) => <IconButton icon="info" label={t('ui.moreInfo')} className="q-help" {...props} />}
        </Tooltip>
      </h2>
      <section aria-labelledby={`${id}-export`} className="options-section">
        <h3 id={`${id}-export`}>{t('options.io.export.title')}</h3>
        <p className="q-hint">
          {t('options.io.export.note')}
          {dirty ? ` ${t('options.io.export.dirty')}` : ''}
        </p>
        <Button icon="arrow-down" onClick={doExport} disabled={busy}>
          {t('options.io.export.button')}
        </Button>
      </section>
      <section aria-labelledby={`${id}-import`} className="options-section">
        <h3 id={`${id}-import`}>{t('options.io.import.title')}</h3>
        <p className="q-hint">{t('options.io.import.note')}</p>
        <Field label={t('options.io.file')} error={fileError} disabled={busy}>
          {(control) => (
            <input
              {...control}
              type="file"
              className="q-input"
              accept="application/json,.json"
              disabled={busy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                void fromFile(f);
              }}
            />
          )}
        </Field>
        <div className="options-add">
          <TextField
            label={t('options.io.url')}
            type="url"
            value={url}
            placeholder="https://example.com/config.json"
            error={urlError}
            onChange={(e) => setUrl(e.target.value)}
          />
          <Button icon="arrow-up" onClick={fromUrl} disabled={busy || url.trim() === ''}>
            {t('options.io.load')}
          </Button>
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
            <p>{t('options.io.confirm.replace')}</p>
            {dirty && <p>{t('options.io.confirm.dirty')}</p>}
          </>
        )}
      </Dialog>
    </section>
    {/* Next to the backup, not inside it: the backup section keeps its own headings. */}
    <ShareManager storage={storage} dirty={dirty} />
    <ShareImportSection onFile={onShareFile} />
    </>
  );
}
