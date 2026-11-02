import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { PopupApp } from '../../src/popup/PopupApp';
import { SettingsProvider } from '../../src/settings';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SettingsProvider>
      <PopupApp variant="sidepanel" />
    </SettingsProvider>
  </StrictMode>,
);
