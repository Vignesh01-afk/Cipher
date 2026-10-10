import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Self-hosted IBM Plex (no Google Fonts, no Inter). Imported before the app
// stylesheet so @font-face is registered before the first paint.
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-sans/700.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import '@fontsource/ibm-plex-mono/600.css';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { AuthProvider } from './context/AuthContext';
import { PrivacyProvider } from './context/PrivacyContext';
import { ThemeProvider } from './context/ThemeContext';
import { ToastProvider } from './context/ToastContext';
import { PrivacyShield } from './components/PrivacyShield';
import './index.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error('The #root element is missing from index.html');
}

createRoot(container).render(
  <StrictMode>
    <ThemeProvider>
      <ToastProvider>
        <BrowserRouter>
          <AuthProvider>
            <PrivacyProvider>
              <PrivacyShield>
                <App />
              </PrivacyShield>
            </PrivacyProvider>
          </AuthProvider>
        </BrowserRouter>
      </ToastProvider>
    </ThemeProvider>
  </StrictMode>,
);
