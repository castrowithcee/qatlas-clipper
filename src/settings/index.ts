export { DEFAULT_SETTINGS, parseSettings, settingsSchema, type Settings } from './schema';
export { SETTINGS_KEY, loadSettings, saveSettings, subscribeSettings } from './storage';
export type { SwitchApis } from './openAs';
export { applyOpenAs, chromeSwitchApis, effectiveOpenAs, registerOpenAs, sidePanelSupported, switchSupported, switchView } from './openAs';
export { SettingsProvider, useI18n, useSettings } from './SettingsProvider';
export { SettingsSection } from './SettingsSection';
