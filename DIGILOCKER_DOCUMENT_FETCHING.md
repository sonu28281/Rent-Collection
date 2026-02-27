# DigiLocker Document Fetching Implementation Guide

## 📋 Overview

This guide explains how to fetch actual documents (Aadhaar, PAN, etc.) from DigiLocker, not just profile data.

## 🎯 Requirements

Based on your needs:
1. ✅ Tenant verifies with DigiLocker
2. ✅ System can reset KYC status (use `scripts/reset_kyc_status.js`)
3. 🔄 **Need to implement**: Fetch Aadhaar document from DigiLocker
4. 🔄 **Need to implement**: Store document for future reference

## 🔍 Current vs Desired State

### Current Implementation (Profile Only)
```javascript
Scope: "openid"
Fetches: Name, DOB, Phone (basic profile data)
Storage: Firestore tenant.kyc object
```

### Desired Implementation (With Documents)
```javascript
Scope: "openid issued_documents"
Fetches: Profile + Aadhaar PDF/XML
Storage: Firebase Storage + Firestore reference
```

## 🚧 Challenge: `issued_documents` Scope

### Problem We Faced Earlier
- Scope `"issued_documents"` was rejected by DigiLocker
- Tried `"issued-documents"` - also rejected
- Reduced to just `"openid"` which works but doesn't give documents

### Why It Failed (Likely Reasons)
1. **PKCE Missing**: DigiLocker requires PKCE for document access (✅ Now fixed!)
2. **Scope Format**: Might need exact format or additional scopes
3. **Client Permission**: Your DigiLocker app might not have document access enabled

### Solution Approach

**Option 1: Try Again with Fixed PKCE** (Recommended)
Now that PKCE is working, try requesting documents again:

```bash
DIGILOCKER_SCOPES="openid issued_documents"
```

**Option 2: Request Multiple Scopes Separately**
```bash
# Try different combinations
DIGILOCKER_SCOPES="openid"
DIGILOCKER_SCOPES="openid issued:aadhaar"
DIGILOCKER_SCOPES="openid issued_documents:aadhaar"
```

**Option 3: Check DigiLocker Developer Portal**
- Login to: https://digilocker.meripehchaan.gov.in
- Check if your app has "Document Access" permission
- May need to request access from DigiLocker team

## 📝 Implementation Steps

### Step 1: Update Environment Variables

```bash
# Netlify Environment Variables
DIGILOCKER_SCOPES=openid issued_documents
```

### Step 2: Add Document Fetching Function

Create `netlify/functions/_kycDocuments.js`:

```javascript
/**
 * DigiLocker Document Fetching Module
 * Fetches actual documents (Aadhaar, PAN, etc.) from DigiLocker
 */

const DIGILOCKER_API_BASE = 'https://digilocker.meripehchaan.gov.in/public/oauth2';

/**
 * List all issued documents for the user
 */
export async function listIssuedDocuments(accessToken, apiVersion = '3') {
  const url = `${DIGILOCKER_API_BASE}/${apiVersion}/issued_documents`;
  
  console.log('📄 Fetching issued documents list from:', url);
  
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/json'
    }
  });
  
  if (!response.ok) {
    const error = await response.text();
    console.error('❌ Failed to fetch documents:', response.status, error);
    throw new Error(`Failed to fetch documents: ${response.status}`);
  }
  
  const documents = await response.json();
  console.log('📥 Documents retrieved:', JSON.stringify(documents, null, 2));
  
  return documents;
}

/**
 * Fetch a specific document by URI
 */
export async function fetchDocument(accessToken, documentUri, apiVersion = '3') {
  const url = `${DIGILOCKER_API_BASE}/${apiVersion}/issued_documents/${documentUri}`;
  
  console.log('📄 Fetching document from:', url);
  
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/xml,application/json'  // DigiLocker returns XML
    }
  });
  
  if (!response.ok) {
    const error = await response.text();
    console.error('❌ Failed to fetch document:', response.status, error);
    throw new Error(`Failed to fetch document: ${response.status}`);
  }
  
  const contentType = response.headers.get('content-type');
  
  if (contentType.includes('xml')) {
    const xmlText = await response.text();
    return { type: 'xml', content: xmlText };
  } else if (contentType.includes('json')) {
    const jsonData = await response.json();
    return { type: 'json', content: jsonData };
  } else {
    // Might be PDF or other binary
    const buffer = await response.arrayBuffer();
    return { type: 'binary', content: Buffer.from(buffer).toString('base64') };
  }
}

/**
 * Find Aadhaar document from document list
 */
export function findAadhaarDocument(documents) {
  // DigiLocker Aadhaar document URIs typically start with "in.gov.uidai"
  const aadhaarDoc = documents.find(doc => 
    doc.uri?.includes('uidai') || 
    doc.doctype?.toLowerCase().includes('aadhaar') ||
    doc.name?.toLowerCase().includes('aadhaar')
  );
  
  return aadhaarDoc;
}

/**
 * Extract Aadhaar number and details from XML
 */
export function parseAadhaarXML(xmlContent) {
  // DigiLocker Aadhaar XML structure:
  // <KycRes uid="XXXX" ...>
  //   <Poa ... />  <!-- Proof of Address -->
  //   <Poi ... />  <!-- Proof of Identity -->
  // </KycRes>
  
  const uidMatch = xmlContent.match(/uid="([0-9X]{12,16})"/);
  const nameMatch = xmlContent.match(/name="([^"]+)"/);
  const dobMatch = xmlContent.match(/dob="([^"]+)"/);
  const addressMatch = xmlContent.match(/<Poa[^>]*\/>/) || xmlContent.match(/co="([^"]+)"/);
  
  return {
    aadhaarNumber: uidMatch ? uidMatch[1] : null,  // Will be masked: XXXXXXXX1234
    name: nameMatch ? nameMatch[1] : null,
    dob: dobMatch ? dobMatch[1] : null,
    hasProofOfAddress: !!addressMatch,
    rawXml: xmlContent
  };
}
```

### Step 3: Update KYC Handler to Fetch Documents

In `netlify/functions/_kycCore.js`, update the `runKycPipeline` function:

```javascript
import { listIssuedDocuments, findAadhaarDocument, fetchDocument, parseAadhaarXML } from './_kycDocuments.js';
import admin from 'firebase-admin';

// After successful profile fetch, fetch documents
async function runKycPipeline({ tenantId, code, ... }) {
  // ... existing code for token exchange and profile fetch ...
  
  const tokenPayload = await exchangeCodeInternal(code, cfg, { codeVerifier });
  const profile = await fetchProfileInternal(tokenPayload.access_token, cfg, options);
  
  // NEW: Fetch documents if scope includes issued_documents
  let documentData = null;
  
  if (cfg.scopes.includes('issued_documents')) {
    try {
      console.log('📄 Fetching DigiLocker documents...');
      
      // List all documents
      const documents = await listIssuedDocuments(tokenPayload.access_token);
      
      // Find Aadhaar document
      const aadhaarDoc = findAadhaarDocument(documents);
      
      if (aadhaarDoc) {
        console.log('✅ Found Aadhaar document:', aadhaarDoc.name);
        
        // Fetch the actual document
        const docContent = await fetchDocument(tokenPayload.access_token, aadhaarDoc.uri);
        
        // Parse if XML
        if (docContent.type === 'xml') {
          const aadhaarDetails = parseAadhaarXML(docContent.content);
          
          // Store in Firebase Storage
          const storageRef = admin.storage().bucket();
          const fileName = `kyc-documents/${tenantId}/aadhaar_${Date.now()}.xml`;
          const file = storageRef.file(fileName);
          
          await file.save(docContent.content, {
            contentType: 'application/xml',
            metadata: {
              tenantId,
              documentType: 'aadhaar',
              verifiedAt: new Date().toISOString()
            }
          });
          
          // Get download URL
          const [downloadUrl] = await file.getSignedUrl({
            action: 'read',
            expires: '03-01-2500'  // Far future
          });
          
          documentData = {
            aadhaarNumber: aadhaarDetails.aadhaarNumber,
            documentUri: aadhaarDoc.uri,
            documentUrl: downloadUrl,  // Firebase Storage URL
            storagePath: fileName,
            fetchedAt: admin.firestore.FieldValue.serverTimestamp()
          };
          
          console.log('✅ Aadhaar document stored successfully');
        }
      } else {
        console.warn('⚠️ No Aadhaar document found in DigiLocker');
      }
    } catch (error) {
      console.error('❌ Error fetching documents:', error);
      // Don't fail the whole KYC process, just log the error
    }
  }
  
  // Store in Firestore
  await writeKycToTenant(tenantId, profile, documentData);
}

async function writeKycToTenant(tenantId, profile, documentData) {
  const tenantRef = admin.firestore().collection('tenants').doc(tenantId);
  
  const kycData = {
    verified: true,
    verifiedBy: 'DigiLocker',
    verifiedAt: admin.firestore.FieldValue.serverTimestamp(),
    profile: profile,  // Name, DOB, etc.
  };
  
  // Add document data if available
  if (documentData) {
    kycData.aadhaar = documentData;
    kycData.hasDocument = true;
  }
  
  await tenantRef.update({ kyc: kycData });
}
```

### Step 4: Update Firestore Schema

```javascript
// Tenant document structure with documents
{
  id: "tenant_123",
  name: "John Doe",
  roomNumber: 101,
  
  kyc: {
    verified: true,
    verifiedBy: "DigiLocker",
    verifiedAt: Timestamp,
    
    // Profile data
    profile: {
      name: "John Doe",
      dob: "1990-01-01",
      phone: "+919999999999",
      email: "john@example.com"
    },
    
    // Document data (NEW)
    aadhaar: {
      aadhaarNumber: "XXXXXXXX1234",  // Masked
      documentUri: "in.gov.uidai.aadhaar.xyz",
      documentUrl: "https://storage.googleapis.com/...",  // Firebase Storage
      storagePath: "kyc-documents/tenant_123/aadhaar_1234567890.xml",
      fetchedAt: Timestamp
    },
    
    hasDocument: true  // Quick flag to check if document exists
  }
}
```

## 🔒 Security Considerations

### Document Storage
1. **Use Firebase Storage** (not Firestore) for actual documents
2. **Set proper security rules**:
   ```javascript
   // storage.rules
   rules_version = '2';
   service firebase.storage {
     match /b/{bucket}/o {
       match /kyc-documents/{tenantId}/{document} {
         // Only authenticated admin can read
         allow read: if request.auth != null && request.auth.token.admin == true;
         // Only backend (admin SDK) can write
         allow write: if false;
       }
     }
   }
   ```

3. **Signed URLs** with expiration for tenant access
4. **Encrypt sensitive data** before storage

### Privacy
- Store only **masked Aadhaar numbers** (last 4 digits)
- **Don't store** full Aadhaar in plaintext
- **Delete documents** after verification if not needed long-term
- **Audit log** all document access

## 🧪 Testing the Implementation

### Step 1: Update Env Vars
```bash
# In Netlify dashboard
DIGILOCKER_SCOPES=openid issued_documents
```

### Step 2: Test KYC Flow
```bash
1. Reset a tenant's KYC:
   node scripts/reset_kyc_status.js --room=101

2. Login to tenant portal
3. Click "Verify with DigiLocker"
4. Complete authentication
5. Check Netlify Function logs for:
   - "📄 Fetching issued documents list"
   - "✅ Found Aadhaar document"
   - "✅ Aadhaar document stored successfully"

6. Check Firestore:
   - tenant.kyc.hasDocument should be true
   - tenant.kyc.aadhaar.documentUrl should exist

7. Check Firebase Storage:
   - Look for kyc-documents/{tenantId}/aadhaar_*.xml
```

### Step 3: Verify Document Access
```bash
# Use the test script
node scripts/test_digilocker_endpoints.js <ACCESS_TOKEN>

# Manually test document endpoint
curl -H "Authorization: Bearer <TOKEN>" \
  https://digilocker.meripehchaan.gov.in/public/oauth2/3/issued_documents
```

## 🚨 Troubleshooting

### Error: "Scope not allowed: issued_documents"

**Solution 1**: Check DigiLocker app permissions
- Login to DigiLocker developer portal
- Check if "Document Access" is enabled
- May need to request access

**Solution 2**: Try different scope format
```bash
# Try these variations
SCOPES="openid issued:aadhaar"
SCOPES="openid issued_documents:aadhaar"
SCOPES="openid org.iso.18013.5.1.mDL"
```

**Solution 3**: Contact DigiLocker Support
- Email: support@digitallocker.gov.in
- Request "issued_documents" scope access
- Provide your CLIENT_ID: AT561D9B37

### Error: "No documents found"

Possible reasons:
1. User hasn't linked Aadhaar to DigiLocker
2. Scope insufficient
3. API endpoint changed

**Solution**: Add user-friendly error message in UI

### Error: "Document fetch failed: 404"

Check API version:
```javascript
// Try v1 instead of v3
listIssuedDocuments(token, '1')  // API version 1
```

## 📚 DigiLocker API Reference

### Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/oauth2/{v}/issued_documents` | GET | List all user documents |
| `/oauth2/{v}/issued_documents/{uri}` | GET | Fetch specific document |
| `/oauth2/{v}/user` | GET | User profile (working ✅) |

### Document Types

| Type | URI Pattern | Description |
|------|-------------|-------------|
| Aadhaar | `in.gov.uidai.*` | Aadhaar eKYC XML |
| PAN | `in.gov.incometax.pan.*` | PAN Card |
| Driving License | `in.gov.transport.*` | DL |
| Voter ID | `in.gov.eci.*` | Voter Card |

## 📊 Admin Panel Integration

### Display KYC Documents

In admin panel, show:
- ✅ Verified badge
- 📄 "View Aadhaar Document" button (if hasDocument)
- 🔍 Document fetch date
- 🔄 "Re-verify" button (resets KYC)

### Example Admin UI Code
```jsx
{tenant.kyc?.verified && (
  <div className="kyc-status">
    <span className="badge badge-success">✅ KYC Verified</span>
    <span className="text-muted">
      Verified: {formatDate(tenant.kyc.verifiedAt)}
    </span>
    
    {tenant.kyc?.hasDocument && (
      <button 
        onClick={() => viewDocument(tenant.kyc.aadhaar.documentUrl)}
        className="btn btn-sm btn-outline-primary"
      >
        📄 View Aadhaar
      </button>
    )}
    
    <button 
      onClick={() => resetKyc(tenant.id)}
      className="btn btn-sm btn-outline-warning"
    >
      🔄 Reset KYC
    </button>
  </div>
)}
```

## 🎯 Quick Action Items

1. **Check DigiLocker App Permissions**
   - Login to developer portal
   - Verify document access is enabled

2. **Update Scope**
   ```bash
   DIGILOCKER_SCOPES="openid issued_documents"
   ```

3. **Test with Single Tenant**
   ```bash
   node scripts/reset_kyc_status.js --room=101
   # Then test KYC flow
   ```

4. **Monitor Logs**
   - Look for "📄 Fetching issued documents"
   - Check for scope errors
   - Verify document retrieval

5. **Implement Document Storage**
   - Set up Firebase Storage bucket
   - Configure security rules
   - Test document upload

## 📖 Related Files

- `scripts/reset_kyc_status.js` - Reset tenant KYC status
- `netlify/functions/_kycCore.js` - Main KYC logic
- `netlify/functions/_kycDocuments.js` - Document fetching (to be created)
- `DIGILOCKER_PROFILE_404_FIX.md` - Profile endpoint fix
- `DIGILOCKER_KYC_IMPLEMENTATION_GUIDE.md` - Main implementation guide

## 💡 Next Steps

1. **Phase 1**: Try `issued_documents` scope again (PKCE now working)
2. **Phase 2**: Implement document fetching functions
3. **Phase 3**: Set up Firebase Storage for documents
4. **Phase 4**: Update admin panel to show documents
5. **Phase 5**: Add document viewer UI

**Estimated Time**: 4-6 hours for full implementation
