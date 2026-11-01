/** German is the reference catalog; English must carry the same keys and placeholders (checked by a test). Plural forms use `<key>.one` / `<key>.other` suffixes. */
export const de = {
  'settings.title': 'Einstellungen',
  'settings.hint': 'Gilt sofort und wird nicht exportiert.',
  'settings.help': 'Die Einstellungen gelten sofort in Optionen und Popup. Sie werden nicht mit der Konfiguration exportiert.',
  'settings.language.label': 'Sprache',
  'settings.language.auto': 'Automatisch (Browsersprache)',
  'settings.language.de': 'Deutsch',
  'settings.language.en': 'English',
  'settings.appearance.label': 'Darstellung',
  'settings.appearance.system': 'Wie das System',
  'settings.appearance.light': 'Hell',
  'settings.appearance.dark': 'Dunkel',
  'ui.close': 'Schließen',
  'ui.moreInfo': 'Mehr Informationen',
  'ui.advanced': 'Erweitert',
  'ui.loading': 'Wird geladen …',
  'ui.error': 'Etwas ist schiefgelaufen',
  'ui.retry': 'Erneut versuchen',
  'settings.saveFailed': 'Die Einstellung konnte nicht gespeichert werden: {message}',
} as const;

export type MessageKey = keyof typeof de;

export const en: Record<MessageKey, string> = {
  'settings.title': 'Settings',
  'settings.hint': 'Applies immediately and is not exported.',
  'settings.help': 'These settings apply immediately in the options page and the popup. They are not exported with the configuration.',
  'settings.language.label': 'Language',
  'settings.language.auto': 'Automatic (browser language)',
  'settings.language.de': 'Deutsch',
  'settings.language.en': 'English',
  'settings.appearance.label': 'Appearance',
  'settings.appearance.system': 'Follow system',
  'settings.appearance.light': 'Light',
  'settings.appearance.dark': 'Dark',
  'ui.close': 'Close',
  'ui.moreInfo': 'More information',
  'ui.advanced': 'Advanced',
  'ui.loading': 'Loading …',
  'ui.error': 'Something went wrong',
  'ui.retry': 'Try again',
  'settings.saveFailed': 'The setting could not be saved: {message}',
};

export type Language = 'de' | 'en';
export type LanguageChoice = 'auto' | Language;

export const CATALOGS: Record<Language, Record<string, string>> = { de, en };
