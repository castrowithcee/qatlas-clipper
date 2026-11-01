import { createSendListener } from '../src/send/messages';

export default defineBackground(() => {
  browser.runtime.onMessage.addListener(createSendListener({ extensionId: browser.runtime.id, extensionOrigin: browser.runtime.getURL('/') }));
});
