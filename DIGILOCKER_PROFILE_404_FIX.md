# DigiLocker Profile Endpoint 404 Fix

## Problem
After completing DigiLocker OAuth, getting error:
```
Profile fetch failed: 404 {}
```

## Root Cause
The environment variable `DIGILOCKER_PROFILE_ENDPOINT` is set to an incorrect endpoint:
- ❌ Current: `https://digilocker.meripehchaan.gov.in/public/oauth2/1/profile`
- The `/profile` endpoint **does not exist** in DigiLocker's OAuth API

## Solution

### Step 1: Update Netlify Environment Variable

Go to Netlify Dashboard → Site Settings → Environment Variables

Update:
```bash
DIGILOCKER_PROFILE_ENDPOINT=https://digilocker.meripehchaan.gov.in/public/oauth2/3/user
```

**Try in order:**
1. **Recommended (API v3)**: `/public/oauth2/3/user`
2. **Fallback (API v1)**: `/public/oauth2/1/user`

### Step 2: Trigger Deploy

After updating the environment variable:
```bash
git commit --allow-empty -m "Trigger deploy for env var update"
git push
```

Or trigger manually from Netlify Dashboard.

### Step 3: Test

1. Clear browser cache / use incognito
2. Login to tenant portal
3. Click "Verify with DigiLocker"
4. Complete authentication
5. Check Netlify Function logs for detailed output

## Enhanced Logging

The code now includes detailed logging in `_kycCore.js`:
- 🔵 Profile endpoint being called
- 📡 Response status and headers
- 📥 Full payload received
- ❌ Detailed error messages with suggested fixes

## Testing Tool

Use the endpoint tester to find the working endpoint:
```bash
# After getting an access token from logs
node scripts/test_digilocker_endpoints.js YOUR_ACCESS_TOKEN
```

This will test all possible endpoints and show which one works.

## DigiLocker API Reference

Based on official DigiLocker OAuth 2.0 specification:

| Endpoint | URL |
|----------|-----|
| Authorization | `/public/oauth2/{version}/authorize` |
| Token | `/public/oauth2/{version}/token` |
| User Profile | `/public/oauth2/{version}/user` ✅ |
| UserInfo (alternative) | `/public/oauth2/{version}/userinfo` |

Where `{version}` is typically `3` (latest) or `1` (legacy).

## Common Mistakes

1. ❌ Using `/profile` instead of `/user`
2. ❌ Mixing API versions (v1 auth with v3 profile)
3. ❌ Not triggering deploy after env var update

## Verification

After fix, you should see in logs:
```
🔵 Fetching DigiLocker profile from: https://digilocker.meripehchaan.gov.in/public/oauth2/3/user
📡 Profile response status: 200
📥 Profile payload received: { ... user data ... }
✅ KYC callback processed successfully
```

## Quick Fix Command

If you have Netlify CLI:
```bash
# Update env var
netlify env:set DIGILOCKER_PROFILE_ENDPOINT "https://digilocker.meripehchaan.gov.in/public/oauth2/3/user"

# Trigger deploy
git commit --allow-empty -m "Fix DigiLocker profile endpoint"
git push
```

## References

- DigiLocker Developer Portal: https://digilocker.meripehchaan.gov.in
- OAuth 2.0 Specification: https://oauth.net/2/
- This fix: See commit history for enhanced logging and documentation
