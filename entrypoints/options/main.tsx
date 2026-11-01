import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { SettingsProvider } from '../../src/settings';
import { App } from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SettingsProvider>
      <App />
    </SettingsProvider>
  </StrictMode>,
);
