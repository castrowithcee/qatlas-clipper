import { useId, useState } from 'react';
import type { LanguageChoice } from '../i18n';
import type { Appearance } from '../ui';
import { IconButton, Select, TileGroup, Tooltip, type IconName } from '../ui/components';
import { useSettings } from './SettingsProvider';

const LANGUAGES: LanguageChoice[] = ['auto', 'de', 'en'];
const APPEARANCES: { value: Appearance; icon: IconName }[] = [
  { value: 'system', icon: 'monitor' },
  { value: 'light', icon: 'sun' },
  { value: 'dark', icon: 'moon' },
];

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
      <TileGroup
        legend={i18n.t('settings.appearance.label')}
        value={settings.appearance}
        onChange={(appearance) => change({ appearance })}
        options={APPEARANCES.map((a) => ({ ...a, label: i18n.t(`settings.appearance.${a.value}`) }))}
      />
      {error && <p role="alert" className="error">{error}</p>}
    </section>
  );
}
