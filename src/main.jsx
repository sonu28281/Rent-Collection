import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';
import './i18n'; // Initialize i18next
import { initTheme } from './utils/theme';

initTheme(); // apply persisted/OS light-dark theme before first paint

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then(() => {
        console.log('[App] Service worker registered');

        // Reload AT MOST ONCE per SW version per tab session. Previously the app
        // polled for updates every 10s and reloaded on every SW activation with no
        // guard — on iOS Safari the service worker re-activates repeatedly, which
        // caused an endless refresh loop. This guard applies a genuine update once
        // and can never loop. (The browser still checks for SW updates on
        // navigation, so no polling is needed.)
        navigator.serviceWorker.addEventListener('message', (event) => {
          if (event.data && event.data.type === 'SW_UPDATED') {
            const key = 'sw-reloaded-version';
            let already = null;
            try { already = sessionStorage.getItem(key); } catch (e) { /* storage blocked */ }
            if (already === event.data.version) return; // already applied this version
            try { sessionStorage.setItem(key, event.data.version); } catch (e) { /* ignore */ }
            window.location.reload();
          }
        });
      })
      .catch((error) => {
        console.error('Service worker registration failed:', error);
      });
  });
}

if (import.meta.env.DEV && 'serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then((registrations) => {
    registrations.forEach((registration) => {
      registration.unregister();
    });
  });

  if ('caches' in window) {
    caches.keys().then((cacheKeys) => {
      cacheKeys.forEach((cacheKey) => caches.delete(cacheKey));
    });
  }
}
