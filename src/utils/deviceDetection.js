/**
 * Device Detection Utility
 * Detects device type, OS, and browser
 */

export const detectDevice = () => {
  const ua = navigator.userAgent;
  
  // Detect iOS
  const isIOS = /iPad|iPhone|iPod/.test(ua) && !window.MSStream;
  
  // Detect Android
  const isAndroid = /Android/i.test(ua);
  
  // Detect if running as PWA
  const isPWA = window.matchMedia('(display-mode: standalone)').matches || 
                window.navigator.standalone === true ||
                document.referrer.includes('android-app://');
  
  // Detect browser
  const isChrome = /Chrome/i.test(ua) && /Google Inc/i.test(navigator.vendor);
  const isSafari = /Safari/i.test(ua) && /Apple Computer/i.test(navigator.vendor);
  const isFirefox = /Firefox/i.test(ua);
  
  // Get OS version for iOS
  let iOSVersion = null;
  if (isIOS) {
    const match = ua.match(/OS (\d+)_(\d+)_?(\d+)?/);
    if (match) {
      iOSVersion = parseInt(match[1], 10);
    }
  }
  
  // Get Android version
  let androidVersion = null;
  if (isAndroid) {
    const match = ua.match(/Android (\d+)\.?(\d+)?/);
    if (match) {
      androidVersion = parseInt(match[1], 10);
    }
  }
  
  return {
    isIOS,
    isAndroid,
    isPWA,
    isChrome,
    isSafari,
    isFirefox,
    iOSVersion,
    androidVersion,
    isMobile: isIOS || isAndroid,
    deviceName: isIOS ? 'iPhone/iPad' : isAndroid ? 'Android' : 'Desktop',
    browserName: isChrome ? 'Chrome' : isSafari ? 'Safari' : isFirefox ? 'Firefox' : 'Unknown'
  };
};

export const getCameraPermissionInstructions = () => {
  const device = detectDevice();
  
  if (device.isIOS) {
    if (device.isPWA) {
      return {
        title: '📱 iPhone - Installed App Permission',
        steps: [
          'Open iPhone Settings app',
          'Scroll down and find this app in the list',
          'Tap on the app name',
          'Enable "Camera" toggle',
          'Come back and try again'
        ],
        note: 'You need to allow camera access from iPhone Settings for installed apps.'
      };
    } else if (device.isSafari) {
      return {
        title: '🌐 iPhone - Safari Browser Permission',
        steps: [
          'Open iPhone Settings app',
          'Scroll down and tap "Safari"',
          'Tap "Camera" under Settings for Websites',
          'Select "Ask" or "Allow"',
          'Reload this page and allow camera when prompted'
        ],
        note: 'Safari needs camera permission from Settings.'
      };
    }
  }
  
  if (device.isAndroid) {
    if (device.isPWA) {
      return {
        title: '📱 Android - Installed App Permission',
        steps: [
          'Open Android Settings',
          'Go to Apps → See all apps',
          'Find and tap this app',
          'Tap "Permissions"',
          'Enable "Camera" permission',
          'Come back and try again'
        ],
        note: 'Installed apps need camera permission from Android Settings.'
      };
    } else if (device.isChrome) {
      return {
        title: '🌐 Android Chrome - Browser Permission',
        steps: [
          'Tap the 🔒 lock icon in address bar',
          'Tap "Permissions"',
          'Find "Camera" and set to "Allow"',
          'Refresh the page',
          'Allow camera when prompted'
        ],
        note: 'You can also grant permission when browser prompts you.'
      };
    }
  }
  
  // Desktop or other devices
  return {
    title: '💻 Desktop - Browser Permission',
    steps: [
      'Click the camera icon in address bar',
      'Select "Always allow" for camera',
      'Click "Done" or "Allow"',
      'Refresh if needed'
    ],
    note: 'Browser will prompt for camera permission when you click the button.'
  };
};

export const checkCameraPermission = async () => {
  try {
    // Check if Permissions API is available
    if (navigator.permissions && navigator.permissions.query) {
      const result = await navigator.permissions.query({ name: 'camera' });
      return {
        state: result.state, // 'granted', 'denied', or 'prompt'
        supported: true
      };
    }
    
    // Fallback: Try to get user media
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      stream.getTracks().forEach(track => track.stop());
      return { state: 'granted', supported: true };
    } catch (err) {
      if (err.name === 'NotAllowedError') {
        return { state: 'denied', supported: true };
      }
      return { state: 'prompt', supported: true };
    }
  } catch (error) {
    return { state: 'unknown', supported: false };
  }
};
