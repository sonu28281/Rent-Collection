# Firestore Security Rules Setup

## Quick Setup (Firebase Console - Recommended)

Since we can't deploy rules from this environment, please set up Firestore rules manually:

### Step 1: Go to Firebase Console
1. Visit: https://console.firebase.google.com/project/rent-collection-5e1d2/firestore
2. Click on **"Rules"** tab

### Step 2: Replace Rules
Copy and paste the following rules:

```javascript
rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {
    
    // Allow all authenticated users to read/write for development
    // TODO: Restrict in production
    match /{document=**} {
      allow read, write: if request.auth != null;
    }
  }
}
```

### Step 3: Publish
Click **"Publish"** button to deploy the rules.

### Step 4: Test
After publishing, run the seed script:
```bash
npm run seed:rooms
```

---

## For Production (Stricter Rules)

Once testing is complete, update to stricter rules from `firestore.rules` file in the repository.

---

## Current Status
- ⏳ Firestore rules need to be set in Firebase Console
- ⏳ After setting rules, run seed script to create rooms
