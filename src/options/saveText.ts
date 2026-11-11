// Not in the TypeScript DOM lib yet; only what is used here.
interface SaveFileHandle {
  createWritable(): Promise<{ write(data: string): Promise<void>; close(): Promise<void> }>;
}
type SaveFilePicker = (options: { suggestedName: string; types: { description: string; accept: Record<string, string[]> }[] }) => Promise<SaveFileHandle>;

const isAbort = (e: unknown) => typeof e === 'object' && e !== null && (e as { name?: unknown }).name === 'AbortError';

/** Resolves true once the file is written, false if the user cancelled or no save dialog exists (plain download, no outcome known). */
export async function saveText(filename: string, text: string, description: string): Promise<boolean> {
  const picker = (window as { showSaveFilePicker?: SaveFilePicker }).showSaveFilePicker;
  if (!picker) {
    downloadText(filename, text);
    return false;
  }
  try {
    const handle = await picker.call(window, { suggestedName: filename, types: [{ description, accept: { 'application/json': ['.json'] } }] });
    const writable = await handle.createWritable();
    // eslint-disable-next-line no-restricted-syntax -- FileSystemWritableFileStream.write, not document.write
    await writable.write(text);
    await writable.close();
    return true;
  } catch (e) {
    if (isAbort(e)) return false;
    throw e;
  }
}

function downloadText(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
