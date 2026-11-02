import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { PopupApp } from '../../src/popup/PopupApp';
import { useSidePanelReload } from '../../src/popup/sidePanelReload';
import { SettingsProvider } from '../../src/settings';

// Only the e2e build binds the panel to a tab (`?tabId=`); see resolveTab in PopupApp.
const raw = import.meta.env.MODE === 'e2e' ? new URLSearchParams(window.location.search).get('tabId') : null;
const pinnedTabId = raw !== null && /^\d+$/.test(raw) ? Number(raw) : undefined;

function SidePanel() {
  const reloadToken = useSidePanelReload(pinnedTabId);
  return <PopupApp variant="sidepanel" reloadToken={reloadToken} />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SettingsProvider>
      <SidePanel />
    </SettingsProvider>
  </StrictMode>,
);
