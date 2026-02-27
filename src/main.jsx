import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';
import './i18n'; // Initialize i18next

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then((registration) => {
        console.log('[App] Service worker registered');
        
        // Check for updates every 10 seconds
        setInterval(() => {
          registration.update();
        }, 10000);
        
        // Listen for updates from service worker
        navigator.serviceWorker.addEventListener('message', (event) => {
          if (event.data && event.data.type === 'SW_UPDATED') {
            console.log('[App] Service worker updated to:', event.data.version);
            console.log('[App] Reloading page to apply updates...');
            // Small delay to let the service worker finish claiming
            setTimeout(() => {
              window.location.reload();
            }, 500);
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
