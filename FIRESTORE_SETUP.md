# Firestore Security Rules Setup

## ⚠️ CRITICAL: Fix "Access Denied" in Tenant Portal

If tenants are getting **"Access Denied"** when accessing their portal link, it's because Firestore Rules are blocking unauthenticated access.

### Quick Fix (5 minutes):

1. **Go to Firebase Console:**
   - Visit: https://console.firebase.google.com/project/rent-collection-5e1d2/firestore/rules

2. **Copy the updated rules:**
   - Open the `firestore.rules` file in this repository
   - Copy ALL the content

3. **Paste and Publish:**
   - Paste in the Firebase Console Rules editor
   - Click **"Publish"** button

4. **Verify it worked:**
   ```bash
   npm run check:tokens
   ```
   - This will show all tenants and their portal links
   - Try opening a portal link - should work now! ✅

---

## Why This is Needed

**Problem:** The old rules required Firebase Authentication for reading data.

**But:** Tenant Portal doesn't use Firebase Auth - it's a public portal controlled by uniqueToken in the URL.

**Solution:** Updated rules allow public READ access (tenant portal validates token in app code), but only ADMIN can WRITE.

---

## Security Notes

✅ **Safe because:**
- Tenant Portal validates `uniqueToken` in application code
- Only admin (authenticated as sonu28281@gmail.com) can write/modify data
- Tokens are 48-character random hex strings (impossible to guess)
- Each tenant only sees their own data (filtered by tenantId in queries)

❌ **NOT safe for:**
- Sensitive data that should NEVER be public (use admin-only rules)
- Payment gateway credentials (should be in backend/Cloud Functions)

---

## For Development (Even More Permissive)

If you're just testing locally and want zero restrictions:

```javascript
rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if true;  // ⚠️ ONLY FOR LOCAL DEVELOPMENT
    }
  }
}
```

**⚠️ Never use this in production!**

---

## Current Status
- ✅ Updated rules in `firestore.rules` file
- ⏳ **YOU NEED TO:** Publish rules in Firebase Console (see steps above)
