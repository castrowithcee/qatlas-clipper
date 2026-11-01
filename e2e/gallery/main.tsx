import { createRoot } from 'react-dom/client';
import type { StorageArea } from '../../src/config';
import { SettingsProvider, SETTINGS_KEY } from '../../src/settings';
import { Gallery } from './Gallery';

// `?theme=dark&lang=de` picks the variant; an in-memory storage keeps the gallery independent of any extension API.
const params = new URLSearchParams(location.search);
const data: Record<string, unknown> = { [SETTINGS_KEY]: { language: params.get('lang') === 'de' ? 'de' : 'en', appearance: params.get('theme') === 'dark' ? 'dark' : 'light' } };
const storage: StorageArea = {
  get: async (keys) => Object.fromEntries(keys.filter((k) => k in data).map((k) => [k, data[k]])),
  set: async (items) => void Object.assign(data, items),
};

createRoot(document.getElementById('root')!).render(
  <SettingsProvider storage={storage} subscribe={() => () => {}}>
    <Gallery />
  </SettingsProvider>,
);
