import { CATALOGS, type Language, type LanguageChoice, type MessageKey } from './catalog';

export type Params = Record<string, string | number>;

/** "auto" gives German for "de" and "de-*", English otherwise. A fixed choice wins. */
export function resolveLanguage(choice: LanguageChoice, browserLanguage: string): Language {
  if (choice !== 'auto') return choice;
  return /^de(-|$)/i.test(browserLanguage) ? 'de' : 'en';
}

const interpolate = (text: string, params?: Params): string =>
  text.replace(/\{(\w+)\}/g, (whole, name: string) => (params && name in params ? String(params[name]) : whole));

export interface Translator {
  language: Language;
  /** Plain text only; the result is never HTML. */
  t(key: MessageKey, params?: Params): string;
  /** Picks `<base>.<plural category>` for the active language, falling back to `<base>.other`. */
  tn(base: string, count: number, params?: Params): string;
  number(value: number, options?: Intl.NumberFormatOptions): string;
  date(value: Date | number, options?: Intl.DateTimeFormatOptions): string;
}

export function createTranslator(language: Language, catalogs: Record<Language, Record<string, string>> = CATALOGS): Translator {
  const catalog = catalogs[language];
  const lookup = (key: string) => catalog[key] ?? catalogs.en[key] ?? key;
  const rules = new Intl.PluralRules(language);
  return {
    language,
    t: (key, params) => interpolate(lookup(key), params),
    tn: (base, count, params) => {
      const text = catalog[`${base}.${rules.select(count)}`] ?? lookup(`${base}.other`);
      return interpolate(text, { count: new Intl.NumberFormat(language).format(count), ...params });
    },
    number: (value, options) => new Intl.NumberFormat(language, options).format(value),
    date: (value, options) => new Intl.DateTimeFormat(language, options ?? { dateStyle: 'medium', timeStyle: 'short' }).format(value),
  };
}
