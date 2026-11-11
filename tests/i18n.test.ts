import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { HELP_SECTIONS, PAYLOAD_KEYS } from '../src/options/helpContent';
import { examplePayload } from '../src/options/HelpSection';
import { de, en } from '../src/i18n/catalog';
import { createTranslator, resolveLanguage } from '../src/i18n';

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('catalog parity', () => {
  it('has the same keys in de and en', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(de).sort());
  });
  it('has the same placeholders per key', () => {
    for (const key of Object.keys(de) as (keyof typeof de)[]) {
      expect(placeholders(en[key]), key).toEqual(placeholders(de[key]));
    }
  });
  it('has no empty texts', () => {
    for (const text of [...Object.values(de), ...Object.values(en)]) expect(text.trim()).not.toBe('');
  });
});

describe('language resolution', () => {
  it.each([['de'], ['de-AT'], ['DE-ch']])('auto gives de for %s', (l) => expect(resolveLanguage('auto', l)).toBe('de'));
  it.each([['en-US'], ['fr'], ['deu'], ['']])('auto gives en for "%s"', (l) => expect(resolveLanguage('auto', l)).toBe('en'));
  it('a fixed choice wins over the browser language', () => {
    expect(resolveLanguage('en', 'de-DE')).toBe('en');
    expect(resolveLanguage('de', 'en-US')).toBe('de');
  });
});

describe('translator', () => {
  const catalogs = {
    de: { 'x.one': '{count} Eintrag in {where}', 'x.other': '{count} Einträge in {where}' },
    en: { 'x.one': '{count} entry in {where}', 'x.other': '{count} entries in {where}', only: 'fallback' },
  };
  it('fills placeholders and picks plural forms', () => {
    const t = createTranslator('en', catalogs);
    expect(t.tn('x', 1, { where: 'A' })).toBe('1 entry in A');
    expect(t.tn('x', 3, { where: 'A' })).toBe('3 entries in A');
    expect(createTranslator('de', catalogs).tn('x', 1200, { where: 'B' })).toBe('1.200 Einträge in B');
  });
  it('translates with the active catalog and formats per language', () => {
    expect(createTranslator('de').t('settings.title')).toBe('Einstellungen');
    expect(createTranslator('en').t('settings.title')).toBe('Settings');
    expect(createTranslator('de').number(1234.5)).toBe('1.234,5');
    expect(createTranslator('en').number(1234.5)).toBe('1,234.5');
    const d = new Date(Date.UTC(2026, 0, 31, 12));
    expect(createTranslator('de').date(d, { dateStyle: 'medium', timeZone: 'UTC' })).toBe('31.01.2026');
    expect(createTranslator('en').date(d, { dateStyle: 'medium', timeZone: 'UTC' })).toBe('Jan 31, 2026');
  });
  it('falls back to English, then to the key', () => {
    expect(createTranslator('de', catalogs).t('only' as never)).toBe('fallback');
    expect(createTranslator('de', catalogs).t('nope' as never)).toBe('nope');
  });
});

describe('help texts', () => {
  const keys = HELP_SECTIONS.flatMap((s) => [s.title, ...s.blocks.flatMap((b) => ('key' in b ? [b.key] : 'keys' in b ? b.keys : []))]);
  it('has every heading and block text in both languages', () => {
    for (const key of [...keys, ...PAYLOAD_KEYS.map((k) => `help.payload.k.${k}` as const)]) {
      expect(de[key]?.trim(), key).toBeTruthy();
      expect(en[key]?.trim(), key).toBeTruthy();
    }
  });
  it('uses every help key in the view', () => {
    const used = new Set<string>([...keys, ...PAYLOAD_KEYS.map((k) => `help.payload.k.${k}`), 'help.title', 'help.intro', 'help.jump', 'options.nav.help']);
    expect(Object.keys(de).filter((k) => /^(help\.|options\.nav\.help)/.test(k) && !used.has(k))).toEqual([]);
  });
  it('describes every key of the sent object', () => {
    const sent = Object.keys(JSON.parse(examplePayload()) as object);
    expect([...PAYLOAD_KEYS].sort()).toEqual(sent.sort());
  });
  it('shows the same example as docs/webhook.md apart from the field list', () => {
    const doc = readFileSync(new URL('../docs/webhook.md', import.meta.url), 'utf8');
    const json = /```json\n([\s\S]*?)\n```/.exec(doc)?.[1] ?? '';
    const strip = (o: Record<string, unknown>) => ({ ...o, fields: undefined });
    expect(strip(JSON.parse(examplePayload()))).toEqual(strip(JSON.parse(json)));
  });
});
