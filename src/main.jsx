import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';
import './i18n'; // Initialize i18next

// Patch removeChild to suppress Html5Qrcode library errors
// This is necessary because the library tries to remove DOM nodes that may not exist
(() => {
  const originalRemoveChild = Node.prototype.removeChild;
  Node.prototype.removeChild = function(child) {
    try {
      // Verify the node is actually a child before removing
      if (child && child.parentNode === this) {
        return originalRemoveChild.call(this, child);
      } else {
        console.warn('⚠️ Prevented removeChild error: Node is not a child of parent');
        return child;
      }
    } catch (err) {
      console.warn('⚠️ removeChild error caught and suppressed:', err.message);
      return child;
    }
  };
  console.log('[Patch] removeChild safety wrapper applied');
})();

// Add manifest dynamically (avoids CORS issues in Codespaces dev environment)
const addManifest = () => {
  // Check if manifest link already exists
  if (!document.querySelector('link[rel="manifest"]')) {
    const link = document.createElement('link');
    link.rel = 'manifest';
    link.href = '/manifest.webmanifest';
    
    // Only add in production or if not in Codespaces
    const isCodespaces = window.location.hostname.includes('github.dev') || 
                         window.location.hostname.includes('app.github.dev');
    
    if (import.meta.env.PROD || !isCodespaces) {
      document.head.appendChild(link);
      console.log('[PWA] Manifest loaded');
    } else {
      console.log('[Dev] Manifest disabled in Codespaces to avoid CORS errors');
    }
  }
};

addManifest();

// Disable StrictMode in development to prevent double-mounting issues with camera scanner
const AppWrapper = import.meta.env.DEV ? App : () => (
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

ReactDOM.createRoot(document.getElementById('root')).render(
  <AppWrapper />
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
