import { registerOpenAs } from '../src/settings/openAs';
import { loadSettings, subscribeSettings } from '../src/settings/storage';
import { createSendListener } from '../src/send/messages';

export default defineBackground(() => {
  browser.runtime.onMessage.addListener(createSendListener({ extensionId: browser.runtime.id, extensionOrigin: browser.runtime.getURL('/') }));
  registerOpenAs({
    apis: { action: chrome.action, sidePanel: chrome.sidePanel },
    popupPath: chrome.runtime.getManifest().action?.default_popup,
    load: () => loadSettings(),
    subscribe: subscribeSettings,
    onInstalled: chrome.runtime.onInstalled,
    onStartup: chrome.runtime.onStartup,
    onActionClicked: chrome.action.onClicked,
    notifyPanel: (message) => chrome.runtime.sendMessage(message),
  });
});
