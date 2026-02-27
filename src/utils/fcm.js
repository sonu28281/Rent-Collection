import { doc, setDoc } from 'firebase/firestore';
import { getMessaging, getToken, isSupported, onMessage } from 'firebase/messaging';
import app, { db } from '../firebase';

const VAPID_KEY = import.meta.env.VITE_FIREBASE_VAPID_KEY;

const getTokenDocId = (token) => {
  const encoded = encodeURIComponent(String(token || ''));
  return encoded.length > 1400 ? encoded.slice(0, 1400) : encoded;
};

export const registerPushToken = async ({
  role,
  userId,
  tenantId = null,
  adminEmail = null
}) => {
  try {
    if (!(await isSupported())) {
      return { ok: false, reason: 'unsupported' };
    }

    if (!VAPID_KEY) {
      console.warn('Missing VITE_FIREBASE_VAPID_KEY. Push token registration skipped.');
      return { ok: false, reason: 'missing-vapid-key' };
    }

    if (typeof window === 'undefined' || !('Notification' in window)) {
      return { ok: false, reason: 'no-notification-api' };
    }

    let permission = Notification.permission;
    if (permission === 'default') {
      permission = await Notification.requestPermission();
    }

    if (permission !== 'granted') {
      return { ok: false, reason: 'permission-denied' };
    }

    const serviceWorkerRegistration = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
    const messaging = getMessaging(app);

    const token = await getToken(messaging, {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration
    });

    if (!token) {
      return { ok: false, reason: 'no-token' };
    }

    const tokenDocId = getTokenDocId(token);
    await setDoc(doc(db, 'deviceTokens', tokenDocId), {
      token,
      role,
      userId: userId || null,
      tenantId: tenantId || null,
      adminEmail: adminEmail || null,
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      updatedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      isActive: true
    }, { merge: true });

    return { ok: true, token };
  } catch (error) {
    console.error('Push token registration failed:', error);
    return { ok: false, reason: 'exception', error };
  }
};

export const listenForegroundMessages = async (onPayload) => {
  try {
    if (!(await isSupported())) return () => {};
    const messaging = getMessaging(app);
    return onMessage(messaging, (payload) => {
      if (typeof onPayload === 'function') {
        onPayload(payload);
      }
    });
  } catch (error) {
    console.error('Foreground push listener setup failed:', error);
    return () => {};
  }
};
