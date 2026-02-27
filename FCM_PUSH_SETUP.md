# FCM Push Setup (Free)

This project now includes a free Firebase Cloud Messaging setup for background push notifications.

## What is implemented

- Admin push on new payment verification request.
- Tenant push when:
  - payment is rejected,
  - payment is verified,
  - rent is overdue (daily scheduler).
- Clicking notification opens:
  - Admin: `/verify-payments`
  - Tenant: `/tenant-portal`

## 1) Firebase Console setup

1. Open Firebase Console → Project Settings → Cloud Messaging.
2. Generate a **Web Push certificate key pair**.
3. Copy the **VAPID public key**.

## 2) Frontend env variable

Add to your `.env` (or hosting env):

```bash
VITE_FIREBASE_VAPID_KEY=YOUR_VAPID_PUBLIC_KEY
```

## 3) Install/deploy Cloud Functions

```bash
cd functions
npm install
cd ..
firebase deploy --only functions,firestore:rules
```

## 4) Browser permission

- Open admin and tenant portals once.
- Allow notifications when prompted.
- Tokens are stored in `deviceTokens` collection.

## Collections used

- `deviceTokens`: stores browser FCM tokens by role (`admin`/`tenant`).
- `notificationEvents`: dedupe keys to avoid duplicate push spam.
- `paymentSubmissions`: trigger source for verify/reject notifications.

## Notes

- Push in closed app/background works only after successful token registration.
- Mobile browser behavior may vary (best support in Chrome/Android).
- If you change domain, users should re-allow notifications and refresh once.
