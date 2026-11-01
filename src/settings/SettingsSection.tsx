import { useId, useState } from 'react';
import type { LanguageChoice } from '../i18n';
import type { Appearance } from '../ui';
import { useSettings } from './SettingsProvider';

const LANGUAGES: LanguageChoice[] = ['auto', 'de', 'en'];
const APPEARANCES: Appearance[] = ['system', 'light', 'dark'];

export function SettingsSection() {
  const { settings, i18n, update } = useSettings();
  const [error, setError] = useState<string>();
  const id = useId();

  const change = (patch: Parameters<typeof update>[0]) => {
    setError(undefined);
    update(patch).catch((e: unknown) => setError(i18n.t('settings.saveFailed', { message: e instanceof Error ? e.message : String(e) })));
  };

  return (
    <section aria-labelledby={`${id}-title`} className="settings">
      <h2 id={`${id}-title`}>{i18n.t('settings.title')}</h2>
      <p className="hint">{i18n.t('settings.hint')}</p>
      <div className="row inline">
        <label htmlFor={`${id}-language`}>{i18n.t('settings.language.label')}</label>
        <select id={`${id}-language`} value={settings.language} onChange={(e) => change({ language: e.target.value as LanguageChoice })}>
          {LANGUAGES.map((l) => (
            <option key={l} value={l}>{i18n.t(`settings.language.${l}`)}</option>
          ))}
        </select>
      </div>
      <div className="row inline">
        <label htmlFor={`${id}-appearance`}>{i18n.t('settings.appearance.label')}</label>
        <select id={`${id}-appearance`} value={settings.appearance} onChange={(e) => change({ appearance: e.target.value as Appearance })}>
          {APPEARANCES.map((a) => (
            <option key={a} value={a}>{i18n.t(`settings.appearance.${a}`)}</option>
          ))}
        </select>
      </div>
      {error && <p role="alert" className="error">{error}</p>}
    </section>
  );
}
