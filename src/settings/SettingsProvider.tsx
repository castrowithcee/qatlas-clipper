import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { StorageArea } from '../config';
import { createTranslator, resolveLanguage, type Language, type Translator } from '../i18n';
import { DARK_QUERY, applyTheme, installTokens, pageTokensCss, resolveTheme, type Theme } from '../ui';
import { DEFAULT_SETTINGS, type Settings } from './schema';
import { loadSettings, saveSettings, subscribeSettings } from './storage';

interface SettingsContextValue {
  settings: Settings;
  language: Language;
  theme: Theme;
  i18n: Translator;
  update(patch: Partial<Settings>): Promise<void>;
}

const SettingsContext = createContext<SettingsContextValue>({
  settings: DEFAULT_SETTINGS,
  language: 'en',
  theme: 'light',
  i18n: createTranslator('en'),
  update: async () => {},
});

export const useSettings = () => useContext(SettingsContext);
export const useI18n = () => useContext(SettingsContext).i18n;

interface Props {
  children: ReactNode;
  /** Defaults to chrome.storage.local. */
  storage?: StorageArea;
  /** Defaults to storage.onChanged of the browser. */
  subscribe?: (onChange: (settings: Settings) => void) => () => void;
  /** Defaults to the prefers-color-scheme media query of the window. */
  media?: Pick<MediaQueryList, 'matches' | 'addEventListener' | 'removeEventListener'>;
  /** Defaults to navigator.language. */
  browserLanguage?: string;
}

/** Loads the settings, applies theme and language to the document and keeps them in sync without a reload. */
export function SettingsProvider({ children, storage, subscribe = subscribeSettings, media, browserLanguage }: Props) {
  const [settings, setSettings] = useState<Settings>();
  const query = useMemo(() => media ?? window.matchMedia(DARK_QUERY), [media]);
  const systemDark = useSyncExternalStore(
    (notify) => {
      query.addEventListener('change', notify);
      return () => query.removeEventListener('change', notify);
    },
    () => query.matches,
  );

  useEffect(() => installTokens(pageTokensCss()), []);

  useEffect(() => {
    let cancelled = false;
    loadSettings(storage)
      .catch(() => DEFAULT_SETTINGS)
      .then((s) => !cancelled && setSettings((current) => current ?? s));
    const stop = subscribe((s) => setSettings(s));
    return () => {
      cancelled = true;
      stop();
    };
  }, [storage, subscribe]);

  const effective = settings ?? DEFAULT_SETTINGS;
  const language = resolveLanguage(effective.language, browserLanguage ?? navigator.language);
  const theme = resolveTheme(effective.appearance, systemDark);

  useEffect(() => {
    applyTheme(theme);
    document.documentElement.lang = language;
  }, [theme, language]);

  const update = useCallback(
    async (patch: Partial<Settings>) => {
      const next = { ...(settings ?? DEFAULT_SETTINGS), ...patch };
      setSettings(next);
      await saveSettings(next, storage);
    },
    [settings, storage],
  );

  const value = useMemo<SettingsContextValue>(
    () => ({ settings: effective, language, theme, i18n: createTranslator(language), update }),
    [effective, language, theme, update],
  );

  // Rendering waits for the stored settings so the first paint already has the right language.
  if (!settings) return null;
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}
