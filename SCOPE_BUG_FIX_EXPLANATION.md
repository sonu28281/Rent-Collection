# 🔧 Critical Bug Fix: DigiLocker Scopes Not Working

## 🐛 Problem You Reported

> "full kyc nahi ho rahi, na hi koi aadhaar detail show ho rahi hai, bas Verified by DigiLocker likh kar aa jaata hai"

**Translation**: Full KYC not working, no Aadhaar details showing, only "Verified by DigiLocker" message appears.

## 🔍 Root Cause Found

### The Bug
File: [netlify/functions/_kycCore.js](netlify/functions/_kycCore.js#L62-L63)

**Before (BROKEN):**
```javascript
const normalizeScopes = (value) => {
  return 'openid';  // ❌ HARDCODED - ignoring input!
};
```

**What was happening:**
1. You set Netlify env var: `DIGILOCKER_SCOPES=openid profile issued_documents` ✅
2. Backend received it: `openid profile issued_documents` ✅
3. normalizeScopes called: Input = `openid profile issued_documents`
4. normalizeScopes returned: `openid` ❌ (IGNORED the input!)
5. Backend used scope: `openid` only
6. Result: 
   - ✅ Profile KYC worked (basic info comes with openid)
   - ❌ Document fetching NEVER triggered (no `issued_documents` scope!)

### Why Documents Weren't Fetched

Code check at [line 475](netlify/functions/_kycCore.js#L475):
```javascript
if (cfg.scopes.includes('issued_documents') || cfg.scopes.includes('issued:aadhaar')) {
  // Fetch Aadhaar documents
}
```

Since `cfg.scopes` was hardcoded to `openid`, the condition `cfg.scopes.includes('issued_documents')` was **always FALSE**.

So document fetching code **never ran**! 😱

## ✅ The Fix

**After (FIXED):**
```javascript
const normalizeScopes = (value) => {
  if (!value || typeof value !== 'string') {
    return 'openid';
  }
  // Split by space, trim, and join back
  const scopes = value.split(/\s+/).map(s => s.trim()).filter(Boolean).join(' ');
  return scopes || 'openid';
};
```

**What happens now:**
1. You set: `DIGILOCKER_SCOPES=openid profile issued_documents` ✅
2. Backend receives: `openid profile issued_documents` ✅
3. normalizeScopes called: Input = `openid profile issued_documents`
4. normalizeScopes returns: `openid profile issued_documents` ✅ (Uses the input!)
5. Backend uses scope: `openid profile issued_documents` ✅
6. Result:
   - ✅ Profile KYC works
   - ✅ Document fetching TRIGGERS
   - ✅ Aadhaar XML fetched from DigiLocker
   - ✅ Data parsed and stored in Firestore
   - ✅ Details displayed in UI

## 🎨 UI Enhancement Added

**New Aadhaar Details Display:**

When verified with documents, tenant portal now shows:

```
🛡️ DigiLocker KYC
✅ Verified by DigiLocker
Verification Date: 27/02/2026
📄 Aadhaar document verified

📄 Verified Aadhaar Details
Name:           Ram Kumar
DOB:            01/01/1990
Gender:         Male
Aadhaar:        XXXXXXXX1234
Pincode:        110001
Address:        123, Main Street, Delhi
✅ Document stored securely (15 KB)
```

## 🧪 Testing Steps (CRITICAL - Do This Now!)

### Step 1: Clear Old KYC Data
```bash
# Reset your test tenant (Room 101 or whichever you tested)
node scripts/reset_kyc_status.js --room=101
```

**Why:** Old KYC data doesn't have Aadhaar details (because it wasn't fetched). Need fresh verification.

### Step 2: Wait for Deployment
- Netlify is deploying the fix now
- Wait 2-3 minutes for deployment to complete
- Check: https://app.netlify.com/sites/tenant-callviain/deploys

### Step 3: Test KYC Flow
1. Login: https://tenants.callvia.in (Room 101)
2. Click: **"Verify with DigiLocker"**
3. Authenticate with DigiLocker
4. Popup closes
5. **NEW:** You should now see Aadhaar details!

### Step 4: Check Netlify Logs
https://app.netlify.com/sites/tenant-callviain/functions

**Expected logs (NEW):**
```
🔍 Configured scopes: openid profile issued_documents  ← NEW DEBUG LOG
✅ Profile fetch successful
📄 Attempting to fetch Aadhaar documents from DigiLocker...
📥 Found X documents
✅ Aadhaar document found: Aadhaar Card
✅ XML content stored in Firestore (15234 bytes)
✅ Aadhaar data prepared (Firestore only - FREE!)
✅ KYC data written to Firestore
```

**Old logs (BROKEN) looked like:**
```
✅ Profile fetch successful
ℹ️ Document fetching skipped - scope does not include issued_documents  ← This was appearing!
✅ KYC data written to Firestore
```

### Step 5: Check Firestore
Firebase Console → Firestore → tenants → [your test tenant]

**Should see:**
```javascript
{
  kyc: {
    verified: true,
    verifiedBy: "DigiLocker",
    hasDocuments: true,  // ← NEW
    
    aadhaar: {  // ← NEW - All this data
      aadhaarNumber: "XXXXXXXX1234",
      name: "Ram Kumar",
      dob: "01/01/1990",
      gender: "M",
      address: "123, Main Street, Delhi",
      pincode: "110001",
      documentUri: "in.gov.uidai...",
      documentName: "Aadhaar Card",
      source: "DigiLocker",
      xmlContentBase64: "PD94bWw...",  // Full XML
      xmlSizeBytes: 15234,
      fetchedAt: Timestamp,
      verified: true
    }
  }
}
```

### Step 6: Check UI
Tenant portal should show expanded KYC card with:
- ✅ Verified by DigiLocker
- 📄 Aadhaar document verified (NEW)
- Name, DOB, Gender, Aadhaar, Pincode, Address (ALL NEW)
- Document size info (NEW)

## 📊 Before vs After

| Aspect | Before (BROKEN) | After (FIXED) |
|--------|----------------|---------------|
| **Scope Used** | `openid` only | `openid profile issued_documents` |
| **Documents Fetched** | ❌ No | ✅ Yes |
| **Aadhaar Data Stored** | ❌ No | ✅ Yes |
| **UI Shows Details** | ❌ No | ✅ Yes (Name, DOB, etc.) |
| **Firestore has aadhaar object** | ❌ No | ✅ Yes |
| **hasDocuments flag** | ❌ false/undefined | ✅ true |
| **Log Message** | "skipped - no scope" | "Attempting to fetch" |

## 🎯 What Changed in This Fix

### Files Modified

1. **[netlify/functions/_kycCore.js](netlify/functions/_kycCore.js)**
   - Fixed `normalizeScopes()` to use actual input instead of hardcoding
   - Added debug log to show configured scopes
   
2. **[src/components/TenantPortal.jsx](src/components/TenantPortal.jsx)**
   - Added Aadhaar details display section
   - Shows all parsed Aadhaar fields
   - Responsive grid layout

### What You Need to Do

#### Nothing in Netlify! 
Your environment variables are already correct:
```
DIGILOCKER_SCOPES=openid profile issued_documents  ✅
```

The problem was the backend ignoring this value. Now it uses it!

## ⚠️ Important Notes

### Why Old KYC Data Doesn't Have Aadhaar

If you verified KYC before this fix:
- Only profile data was stored (because documents weren't fetched)
- Firestore has `kyc.verified: true` but no `kyc.aadhaar` object
- **Solution**: Reset KYC and verify again

### Reset Command
```bash
# For specific tenant
node scripts/reset_kyc_status.js <TENANT_ID>

# For specific room
node scripts/reset_kyc_status.js --room=101

# For all tenants (careful!)
node scripts/reset_kyc_status.js --all
```

### Admin Can Also Reset
Admin panel → Tenants page → Click 🔄 button next to verified tenant

## 🔍 Debugging Tips

### If Documents Still Don't Fetch

**Check 1: Netlify Logs**
Look for: `🔍 Configured scopes: openid profile issued_documents`
- If you see only `openid`, env var not set correctly
- If you see full scopes, good!

**Check 2: Document Fetching Log**
Should see: `📄 Attempting to fetch Aadhaar documents`
- If you see `ℹ️ Document fetching skipped`, scope not working
- If you see attempting, scope is working!

**Check 3: DigiLocker API Response**
Look for: `📥 Found X documents`
- If X = 0, user hasn't linked documents to DigiLocker
- If X > 0, documents are there

**Check 4: Aadhaar Found**
Look for: `✅ Aadhaar document found`
- If you see `⚠️ No Aadhaar document found`, it's in DigiLocker but not detected
- Check document name patterns in `_kycDocuments.js`

## 🎉 Expected Result After Fix

### Complete Flow (End-to-End)

1. **User clicks "Verify with DigiLocker"**
2. **DigiLocker authentication** (popup)
3. **Backend receives auth code**
4. **Token exchange** with code_verifier (PKCE)
5. **Profile fetch** → Name, DOB, Address
6. **Scope check** → Sees `issued_documents` ✅
7. **List documents** from DigiLocker API
8. **Find Aadhaar** in document list
9. **Fetch Aadhaar XML** content
10. **Parse XML** → Extract all fields
11. **Store in Firestore** (base64 XML + parsed data)
12. **Return success** to frontend
13. **UI refreshes** → Shows complete details
14. **User sees:**
    - ✅ Verified badge
    - 📄 Document verified badge
    - Name, DOB, Gender, etc.
    - Document size info

### Firestore Structure
```
tenants/
  └── tenant_xyz/
      ├── name: "Ram Kumar"
      ├── roomNumber: 101
      └── kyc: {
          verified: true,
          verifiedBy: "DigiLocker",
          verifiedAt: Timestamp(2026-02-27),
          name: "Ram Kumar",
          dob: "01/01/1990",
          address: "123, Main Street",
          hasDocuments: true,
          aadhaar: {
            aadhaarNumber: "XXXXXXXX1234",
            name: "Ram Kumar",
            dob: "01/01/1990",
            gender: "M",
            address: "123, Main Street, Delhi, 110001",
            pincode: "110001",
            documentUri: "in.gov.uidai.aadhaar.1234567890",
            documentName: "Aadhaar Card",
            source: "DigiLocker",
            xmlContentBase64: "PD94bWwgdmVyc2lvbj0iMS4w...",
            xmlSizeBytes: 15234,
            fetchedAt: Timestamp(2026-02-27),
            verified: true
          }
        }
```

## 📝 Summary

### Problem
- Scopes hardcoded to `openid`, ignoring env vars
- Documents never fetched
- Only basic verification showing

### Solution  
- Use actual scope values from environment
- Document fetching now works
- UI displays all Aadhaar details

### Action Required
1. ✅ Code deployed (automatic via Netlify)
2. ⏳ Wait 2-3 minutes for deployment
3. 🔄 Reset old KYC data: `node scripts/reset_kyc_status.js --room=101`
4. 🧪 Test verification again
5. ✨ Enjoy full Aadhaar KYC!

---

**Status**: ✅ Fix deployed  
**Next**: Reset KYC → Test → See Aadhaar details!  
**ETA**: Working in 5 minutes from deployment complete  

🎯 **Ab sab kaam karega!**
