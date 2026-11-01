import { buildReadResult } from '../src/extract/result';
import type { Project } from '../src/config/schema';
import { READER_GLOBAL, type ReaderOutcome } from '../src/extract/inject';

/** Called by readTab (src/extract/inject.ts) after injection; only runs on that explicit call. */
export default defineUnlistedScript(() => {
  (globalThis as Record<string, unknown>)[READER_GLOBAL] = (projects: Project[], projectId?: string): ReaderOutcome => {
    try {
      if (document.contentType === 'application/pdf') return { ok: false, kind: 'unsupported' };
      return { ok: true, result: buildReadResult(location.href, document, projects, projectId) };
    } catch {
      return { ok: false, kind: 'failed' };
    }
  };
});
