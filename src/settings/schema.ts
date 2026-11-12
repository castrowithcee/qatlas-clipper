import { z } from 'zod';

/** Invalid or missing fields fall back to their defaults; settings must never block the UI. */
export const settingsSchema = z.object({
  language: z.enum(['auto', 'de', 'en']).catch('auto'),
  appearance: z.enum(['system', 'light', 'dark']).catch('system'),
  openAs: z.enum(['popup', 'sidepanel']).catch('popup'),
  /** Frames around mapped elements on the page; stored settings without the key count as on. */
  highlight: z.boolean().catch(true).default(true),
  /** Display order of projects and folders on this device; the stored manual order never changes. */
  projectSort: z.enum(['manual', 'nameAsc', 'nameDesc']).catch('manual'),
  /** Options page, wide view only: the sidebar is hidden and the content takes the full width. */
  sidebarCollapsed: z.boolean().catch(false).default(false),
});

export type Settings = z.infer<typeof settingsSchema>;

export const DEFAULT_SETTINGS: Settings = { language: 'auto', appearance: 'system', openAs: 'popup', highlight: true, projectSort: 'manual', sidebarCollapsed: false };

export const parseSettings = (raw: unknown): Settings =>
  settingsSchema.safeParse(raw ?? {}).data ?? DEFAULT_SETTINGS;
