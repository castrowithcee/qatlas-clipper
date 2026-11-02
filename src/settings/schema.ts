import { z } from 'zod';

/** Invalid or missing fields fall back to their defaults; settings must never block the UI. */
export const settingsSchema = z.object({
  language: z.enum(['auto', 'de', 'en']).catch('auto'),
  appearance: z.enum(['system', 'light', 'dark']).catch('system'),
  openAs: z.enum(['popup', 'sidepanel']).catch('popup'),
});

export type Settings = z.infer<typeof settingsSchema>;

export const DEFAULT_SETTINGS: Settings = { language: 'auto', appearance: 'system', openAs: 'popup' };

export const parseSettings = (raw: unknown): Settings =>
  settingsSchema.safeParse(raw ?? {}).data ?? DEFAULT_SETTINGS;
