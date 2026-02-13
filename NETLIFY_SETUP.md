# Netlify Environment Variables Setup

## Required Variables for Production Deployment

Add these in Netlify Dashboard → Site Settings → Environment Variables:

```
VITE_FIREBASE_API_KEY
VITE_FIREBASE_AUTH_DOMAIN
VITE_FIREBASE_PROJECT_ID
VITE_FIREBASE_STORAGE_BUCKET
VITE_FIREBASE_MESSAGING_SENDER_ID
VITE_FIREBASE_APP_ID
VITE_FIREBASE_MEASUREMENT_ID
DEFAULT_UPI_ID
```

## How to Get Values:

1. Go to [Firebase Console](https://console.firebase.google.com)
2. Select your project: **rent-collection-5e1d2**
3. Click ⚙️ Settings → Project Settings
4. Scroll to "Your apps" section
5. Copy the config values

## Important:

- ✅ Add variables in Netlify (not in code)
- ✅ Never commit actual credentials to Git
- ✅ For local dev: use `.env` file (already in .gitignore)
- ✅ Re-deploy after adding variables

## Status:

🟢 Admin user already created in Firebase Auth
- Email: sonu28281@gmail.com
- Login: https://rent582.netlify.app/login
