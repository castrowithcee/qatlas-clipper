import { useState } from 'react';
import { exportConfig, checkImportUrl, fetchImportText, MAX_IMPORT_CHARS, parseImportText, saveConfig, type Config, type StorageArea } from '../config';
import type { PermissionsApi } from './permissions';

export const EXPORT_FILENAME = 'qatlas-clipper-config.json';

function downloadText(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

interface Props {
  storage?: StorageArea;
  permissions: PermissionsApi;
  /** True if the editor has unsaved changes. */
  dirty: boolean;
  onImported: () => void;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function ImportExport({ storage, permissions, dirty, onImported }: Props) {
  const [url, setUrl] = useState('');
  const [pending, setPending] = useState<Config>();
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; text: string }>();
  const [busy, setBusy] = useState(false);

  const preview = (text: string) => {
    setPending(parseImportText(text));
    setStatus(undefined);
  };

  const doExport = async () => {
    try {
      // Only the saved state is exported, never header values.
      downloadText(EXPORT_FILENAME, await exportConfig(storage));
      setStatus({ kind: 'ok', text: 'Exported the saved configuration.' });
    } catch (e) {
      setStatus({ kind: 'error', text: `Export failed: ${message(e)}` });
    }
  };

  const fromFile = async (file: File | undefined) => {
    setPending(undefined);
    if (!file) return;
    try {
      if (file.size > MAX_IMPORT_CHARS * 4) throw new Error('Import is too large');
      preview(await file.text());
    } catch (e) {
      setStatus({ kind: 'error', text: `Import failed: ${message(e)}` });
    }
  };

  const fromUrl = () => {
    setPending(undefined);
    let pattern: string;
    try {
      pattern = checkImportUrl(url).pattern;
    } catch (e) {
      setStatus({ kind: 'error', text: `Import failed: ${message(e)}` });
      return;
    }
    // Requested directly from the click, with nothing awaited before, to keep the user gesture.
    const request = permissions.request([pattern]).catch(() => false);
    setBusy(true);
    void (async () => {
      try {
        if (!(await request)) {
          setStatus({ kind: 'error', text: 'Import failed: permission for the URL origin was not granted, nothing was fetched.' });
          return;
        }
        preview(await fetchImportText(url, { hasPermission: async () => true }));
      } catch (e) {
        setStatus({ kind: 'error', text: `Import failed: ${message(e)}` });
      } finally {
        setBusy(false);
      }
    })();
  };

  const confirm = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      await saveConfig(pending, storage);
      setPending(undefined);
      onImported();
    } catch (e) {
      setStatus({ kind: 'error', text: `Import failed: ${message(e)}` });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label="Import and export" className="import-export">
      <h2>Import and export</h2>
      <div>
        <button type="button" onClick={doExport} disabled={busy}>Export configuration</button>
        <span className="hint">
          Exports the saved configuration as a JSON file. Header values are not included.{dirty ? ' Unsaved changes are not exported.' : ''}
        </span>
      </div>
      <div>
        <label>
          Import from file
          <input type="file" accept="application/json,.json" disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; void fromFile(f); }} />
        </label>
      </div>
      <div>
        <label>
          Import from URL
          <input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/config.json" />
        </label>
        <button type="button" onClick={fromUrl} disabled={busy || url.trim() === ''}>Fetch from URL</button>
      </div>
      {pending && (
        <div role="alertdialog" aria-label="Confirm import" className="confirm">
          <p>
            The import contains {pending.projects.length} {pending.projects.length === 1 ? 'project' : 'projects'}. Importing replaces
            the whole current configuration.{dirty ? ' Your unsaved changes will be discarded.' : ''}
          </p>
          <button type="button" onClick={confirm} disabled={busy}>Confirm import</button>
          <button type="button" onClick={() => setPending(undefined)} disabled={busy}>Cancel</button>
        </div>
      )}
      {status && <p role={status.kind === 'error' ? 'alert' : 'status'} className={status.kind === 'error' ? 'error' : undefined}>{status.text}</p>}
    </section>
  );
}
