import { useEffect, useId, useRef, useState } from 'react';
import type { Settings } from './schema';
import type { LanguageChoice } from '../i18n';
import type { Appearance } from '../ui';
import { IconButton, Select, TileGroup, type IconName } from '../ui/components';
import { ALL_SITES_ORIGINS, defaultPermissions, type PermissionsApi } from '../options/permissions';
import { sidePanelSupported } from './openAs';
import { useSettings } from './SettingsProvider';

const LANGUAGES: LanguageChoice[] = ['auto', 'de', 'en'];
const APPEARANCES: { value: Appearance; icon: IconName }[] = [
  { value: 'system', icon: 'monitor' },
  { value: 'light', icon: 'sun' },
  { value: 'dark', icon: 'moon' },
];

const OPEN_AS: { value: Settings['openAs']; icon: IconName }[] = [
  { value: 'popup', icon: 'popup' },
  { value: 'sidepanel', icon: 'sidepanel' },
];

export function SettingsSection({ permissions = defaultPermissions }: { permissions?: Pick<PermissionsApi, 'contains' | 'request'> } = {}) {
  const { settings, i18n, update } = useSettings();
  const [error, setError] = useState<string>();
  const id = useId();
  // Known ahead of the click: the request has to run synchronously in the click to keep the user gesture.
  const granted = useRef(false);
  useEffect(() => {
    let live = true;
    try {
      permissions.contains(ALL_SITES_ORIGINS).then(
        (g) => live && (granted.current = g),
        () => undefined,
      );
    } catch {
      // Unknown state: the click then asks for the access.
    }
    return () => {
      live = false;
    };
  }, [permissions]);

  const chooseOpenAs = (openAs: Settings['openAs']) => {
    if (openAs === 'popup' || granted.current) return change({ openAs });
    setError(undefined);
    let asked: Promise<boolean>;
    try {
      asked = permissions.request(ALL_SITES_ORIGINS);
    } catch {
      asked = Promise.resolve(false);
    }
    void asked.catch(() => false).then((ok) => {
      if (ok) {
        granted.current = true;
        change({ openAs });
      } else {
        setError(i18n.t('settings.openAs.needsAccess'));
      }
    });
  };

  const change = (patch: Parameters<typeof update>[0]) => {
    setError(undefined);
    update(patch).catch((e: unknown) => setError(i18n.t('settings.saveFailed', { message: e instanceof Error ? e.message : String(e) })));
  };

  return (
    <section aria-labelledby={`${id}-title`} className="settings">
      <h2 id={`${id}-title`}>
        {i18n.t('settings.title')}{' '}
        <IconButton icon="info" label={i18n.t('ui.moreInfo')} tooltip={i18n.t('settings.help')} className="q-help" />
      </h2>
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
      {sidePanelSupported() && (
        <TileGroup
          legend={i18n.t('settings.openAs.label')}
          value={settings.openAs}
          onChange={chooseOpenAs}
          options={OPEN_AS.map((o) => ({ ...o, label: i18n.t(`settings.openAs.${o.value}`) }))}
        />
      )}
      {error && <p role="alert" className="error">{error}</p>}
    </section>
  );
}
