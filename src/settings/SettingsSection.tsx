import { useId, useState } from 'react';
import type { LanguageChoice } from '../i18n';
import type { Appearance } from '../ui';
import { IconButton, Select, Tooltip } from '../ui/components';
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
      <h2 id={`${id}-title`}>
        {i18n.t('settings.title')}{' '}
        <Tooltip content={i18n.t('settings.help')}>
          {(props) => <IconButton icon="info" label={i18n.t('ui.moreInfo')} className="q-help" {...props} />}
        </Tooltip>
      </h2>
      <p className="hint">{i18n.t('settings.hint')}</p>
      <Select
        label={i18n.t('settings.language.label')}
        value={settings.language}
        onChange={(e) => change({ language: e.target.value as LanguageChoice })}
        options={LANGUAGES.map((l) => ({ value: l, label: i18n.t(`settings.language.${l}`) }))}
      />
      <Select
        label={i18n.t('settings.appearance.label')}
        value={settings.appearance}
        onChange={(e) => change({ appearance: e.target.value as Appearance })}
        options={APPEARANCES.map((a) => ({ value: a, label: i18n.t(`settings.appearance.${a}`) }))}
      />
      {error && <p role="alert" className="error">{error}</p>}
    </section>
  );
}
