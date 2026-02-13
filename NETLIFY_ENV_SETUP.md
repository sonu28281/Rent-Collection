# Netlify Environment Variables Setup Guide

## 🔧 Required Environment Variables

You need to add these environment variables in your Netlify dashboard.

### How to Add Environment Variables in Netlify:

1. Go to [Netlify Dashboard](https://app.netlify.com/)
2. Select your site: **rent582**
3. Go to **Site settings** > **Environment variables**
4. Click **Add a variable** for each of the following:

---

## 📝 Environment Variables to Add:

### Firebase Configuration

Get these values from [Firebase Console](https://console.firebase.google.com/) > **Project Settings** > **General** tab

```
Variable Name: VITE_FIREBASE_API_KEY
Value: AIzaSyD5Nv3uIlCQuOQkj7crx1kcg-ENIH9cXT4
```

```
Variable Name: VITE_FIREBASE_AUTH_DOMAIN
Value: rent-collection-5e1d2.firebaseapp.com
```

```
Variable Name: VITE_FIREBASE_PROJECT_ID
Value: rent-collection-5e1d2
```

```
Variable Name: VITE_FIREBASE_STORAGE_BUCKET
Value: rent-collection-5e1d2.firebasestorage.app
```

```
Variable Name: VITE_FIREBASE_MESSAGING_SENDER_ID
Value: 605839501523
```

```
Variable Name: VITE_FIREBASE_APP_ID
Value: 1:605839501523:web:153e006f8ada52f9804c26
```

```
Variable Name: VITE_FIREBASE_MEASUREMENT_ID
Value: G-ZK8D32M76Y
```

### Payment Configuration

```
Variable Name: DEFAULT_UPI_ID
Value: your-upi-id@bank
```

---

## ✅ After Adding Variables:

1. Go to **Deploys** tab
2. Click **Trigger deploy** > **Deploy site**
3. Wait for the build to complete
4. Your site will be live with the environment variables configured

---

## 🔒 Security Notes:

- ✅ These variables are securely stored in Netlify
- ✅ They are injected during build time
- ✅ Never committed to Git repository
- ✅ Only accessible during deployment builds

---

## 🚀 Quick Setup Commands:

If you prefer using Netlify CLI:

```bash
# Install Netlify CLI
npm install -g netlify-cli

# Login to Netlify
netlify login

# Link your site
netlify link

# Set environment variables
netlify env:set VITE_FIREBASE_API_KEY "AIzaSyD5Nv3uIlCQuOQkj7crx1kcg-ENIH9cXT4"
netlify env:set VITE_FIREBASE_AUTH_DOMAIN "rent-collection-5e1d2.firebaseapp.com"
netlify env:set VITE_FIREBASE_PROJECT_ID "rent-collection-5e1d2"
netlify env:set VITE_FIREBASE_STORAGE_BUCKET "rent-collection-5e1d2.firebasestorage.app"
netlify env:set VITE_FIREBASE_MESSAGING_SENDER_ID "605839501523"
netlify env:set VITE_FIREBASE_APP_ID "1:605839501523:web:153e006f8ada52f9804c26"
netlify env:set VITE_FIREBASE_MEASUREMENT_ID "G-ZK8D32M76Y"
netlify env:set DEFAULT_UPI_ID "your-upi-id@bank"

# Trigger a new deploy
netlify deploy --prod
```

---

## ✨ Status: 

🟢 **Admin user already created** in Firebase Authentication
- Email: sonu28281@gmail.com
- Password: (as configured)

Once environment variables are set in Netlify, your app will be fully functional!
