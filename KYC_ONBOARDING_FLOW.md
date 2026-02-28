# Tenant KYC Onboarding System - Implementation Plan

## Overview

A standalone KYC page that serves two purposes:
1. **Existing tenants** - Complete KYC from their dashboard (redirected via button)  
2. **New tenants** - Self-onboard via a shareable link (no login required)

After onboarding, the new tenant's data appears in the admin panel. Admin then assigns a room and activates the tenant.

**Anti-Fraud**: Aadhaar QR code scanning is **mandatory** — the QR code on Aadhaar cards contains UIDAI digitally signed data. We decode this QR to extract verified name, DOB, gender, address, photo, and Aadhaar number. This data is cross-matched against the uploaded document image (OCR) and the details filled by the tenant. Fake documents will fail QR verification.

---

## User Flows

### Flow 1: Existing Tenant (Already in System, KYC Pending)

```
Tenant logs in → Dashboard shows 🔴 "KYC Incomplete" banner
  → Clicks "Complete KYC" button
  → Opens /kyc page (pre-filled with tenant's name, room, phone)
  → Step 1: Fill Details
  → Step 2: Scan Aadhaar QR Code (MANDATORY)
      → Phone camera opens → scans QR from physical Aadhaar card
      → QR decoded → extracts UIDAI signed data (name, DOB, gender, address, photo, aadhaar no.)
      → Auto-fills fields from QR data
      → Cross-matches with OCR from uploaded Aadhaar image
      → If mismatch → ❌ Rejected (fake document detected)
  → Step 3: Upload Documents (Aadhaar front+back photo, PAN/DL, Selfie)
      → OCR runs on uploaded images
      → OCR name/number cross-verified against QR extracted data
  → Step 4: Agreement + Signature
  → KYC data saved to Firestore under tenant's profile
  → Dashboard now shows ✅ "KYC Complete"
```

### Flow 2: New Tenant (Not in System - Onboarding)

```
Admin sends link: https://yoursite.com/onboarding
  → New tenant opens link
  → Sees onboarding/signup form (no login needed)
  → Step 1: Fills details: Name, Phone, Emergency Contact, Occupation
  → Step 2: Scans Aadhaar QR Code (MANDATORY)
      → Phone camera scans QR on physical Aadhaar card
      → Extracts UIDAI signed data → auto-fills verified info
  → Step 3: Uploads documents: Aadhaar (front+back), PAN/DL, Selfie
      → OCR extracts text → cross-verified against QR data
      → Name mismatch / number mismatch → flagged
  → Step 4: Signs agreement
  → Data saved to Firestore `tenantApplications` collection
  → Status = "pending_approval"

Admin sees new application in Admin Panel:
  → Admin Dashboard / Tenants KYC page shows new pending application
  → Admin reviews KYC data + QR verification status
  → Admin approves → creates tenant account → assigns room
  → Tenant can now login with room number + password
```

### Flow 3: Direct KYC Link (Admin shares link for specific tenant)

```
Admin generates link: https://yoursite.com/onboarding?ref=ADMIN_SHARED
  → Same as Flow 2, but admin knows who this link was sent to
```

---

## Aadhaar QR Code Verification (Anti-Fraud Core)

### What is Aadhaar QR Code?

Every physical Aadhaar card (and mAadhaar app) has a QR code that contains **UIDAI digitally signed data**:

| Field | Description |
|-------|-------------|
| `uid` | Last 4 digits of Aadhaar number (Secure QR) or full 12 digits (older cards) |
| `name` | Full name as per UIDAI records |
| `dob` | Date of birth (DD-MM-YYYY) |
| `gender` | M / F / T |
| `address` | Full address (CO, House, Street, Landmark, Locality, VTC, District, State, Pincode) |
| `photo` | JPEG photo bytes (in Secure QR v2) |
| `signature` | UIDAI digital signature (proves authenticity) |

### Why This Prevents Fake Documents

1. **QR data is digitally signed by UIDAI** — cannot be forged
2. **Name from QR** is cross-matched against:
   - Name typed by tenant in Step 1
   - Name extracted via OCR from uploaded Aadhaar photo
3. **Aadhaar number from QR** is cross-matched against OCR-extracted number
4. **Photo from QR** (if Secure QR v2) can be compared with selfie
5. If anyone uploads a fake Aadhaar image, the QR scan will either:
   - Fail to decode (no valid QR)
   - Show mismatched data (QR name ≠ image name)

### QR Scanning Flow

```
Step 2: "Scan Aadhaar QR Code"
  ├── User taps "📷 Scan QR Code" button
  ├── Camera opens with QR scanner overlay
  ├── User points camera at Aadhaar card QR code
  ├── QR decoded in real-time using jsQR / html5-qrcode library
  ├── Raw QR data extracted (XML for old cards, compressed bytes for Secure QR)
  ├── Data parsed:
  │   ├── Old QR (XML): Direct XML parse → name, uid, dob, gender, address
  │   └── Secure QR (v2): Decompress (zlib) → parse binary → name, uid, dob, gender, photo
  ├── Extracted data displayed to user for confirmation
  ├── Auto-fill: Name, DOB, Gender, Address fields
  ├── Store: qrRawData, qrParsedData, qrVerified=true
  └── Cross-match triggers when documents uploaded in Step 3
```

### QR Data Types

**Type 1: Old Aadhaar QR (XML-based, pre-2018)**
```xml
<PrintLetterBarcodeData uid="123412341234" name="RAHUL KUMAR" 
  gender="M" yob="1995" co="S/O RAM KUMAR" house="123" 
  street="MG Road" lm="Near Temple" loc="Sector 5" 
  vtc="Noida" dist="Gautam Buddha Nagar" state="Uttar Pradesh" 
  pc="201301" />
```
→ Simple XML parse, full Aadhaar number available.

**Type 2: Secure QR (post-2018, current standard)**
- Contains compressed binary data (big integer → byte array → decompressed)
- Fields: Reference ID (last 4 digits), Name, DOB, Gender, Address, Photo (JPEG)
- Digitally signed — signature verification confirms UIDAI authenticity
- Photo embedded (approx 15-20KB JPEG)

### Technical Implementation

**Library: `html5-qrcode`** (npm package)
- Handles camera access + QR scanning in browser
- Works on mobile (Android/iOS) and desktop
- Supports continuous scanning mode

**Parsing:**
```javascript
// Old QR (XML)
const parser = new DOMParser();
const xml = parser.parseFromString(qrData, 'text/xml');
const root = xml.documentElement;
const name = root.getAttribute('name');
const uid = root.getAttribute('uid');

// Secure QR (binary)
// 1. Convert scanned number string to BigInteger
// 2. Convert to byte array
// 3. Decompress with pako (zlib)
// 4. Parse fixed-field binary format
// 5. Extract: refId, name, dob, gender, address components, photo bytes
```

### Cross-Verification Matrix

| Source A | Source B | Check | Status if Mismatch |
|----------|----------|-------|--------------------|
| QR Name | Typed Name (Step 1) | Fuzzy match (80%+) | ⚠️ Warning |
| QR Name | OCR Name (Aadhaar image) | Fuzzy match (70%+) | ⚠️ Warning |
| QR Aadhaar No. | OCR Aadhaar No. | Exact match | ❌ Rejected |
| QR Photo | Selfie Upload | Visual comparison (optional) | ⚠️ Flag for admin |
| QR parsed? | — | Must decode successfully | ❌ Blocked (can't proceed) |

---

## Pages & Routes

| Route | Page | Access | Purpose |
|-------|------|--------|---------|
| `/onboarding` | TenantOnboarding.jsx | Public (no login) | New tenant signup + KYC |
| `/kyc` | TenantOnboarding.jsx | Logged-in tenant | Existing tenant KYC completion |
| `/tenant-portal` | TenantPortal.jsx | Tenant login | Shows KYC status banner + "Complete KYC" button |
| `/tenants-kyc` | TenantsKYCDetails.jsx (Admin) | Admin only | View all KYC data + pending applications |

---

## Data Model

### New Collection: `tenantApplications`

```javascript
{
  // Basic Info
  fullName: string,           // "Rahul Kumar"
  phone: string,              // "9876543210"
  emergencyContact: string,   // "8765432109"
  occupation: string,         // "Software Engineer"
  dob: string,                // From QR: "15-08-1995"
  gender: string,             // From QR: "M" / "F" / "T"
  address: string,            // From QR: full address string
  
  // Aadhaar QR Verified Data (UIDAI signed — source of truth)
  aadhaarQr: {
    scanned: boolean,           // true if QR was successfully scanned
    rawData: string,            // Raw QR string (for audit)
    qrType: "xml" | "secure",   // Old XML or Secure QR
    name: string,               // Name from QR
    uid: string,                // Aadhaar number (full or last 4)
    dob: string,                // DOB from QR
    gender: string,             // Gender from QR
    address: {                  // Structured address from QR
      co: string,               // Care of (S/O, D/O, W/O)
      house: string,
      street: string,
      landmark: string,
      locality: string,
      vtc: string,
      district: string,
      state: string,
      pincode: string
    },
    photo: string,              // Base64 photo (from Secure QR v2, if available)
    scannedAt: string,          // ISO date when QR was scanned
  },
  
  // KYC Documents (base64 data URLs)
  aadharFrontImage: string,
  aadharBackImage: string,
  aadharNumber: string,       // Extracted via OCR
  secondaryIdType: "PAN" | "DL",
  secondaryIdNumber: string,
  panImage: string,
  dlImage: string,
  selfieImage: string,
  
  // OCR Verification Results
  aadharDocStatus: string,    // "verified" | "number_not_found" | etc.
  panDocStatus: string,
  dlDocStatus: string,
  aadharNameMatched: boolean,
  panNameMatched: boolean,
  
  // Cross-Verification Results
  crossVerification: {
    qrVsTypedName: "match" | "mismatch" | "pending",
    qrVsOcrName: "match" | "mismatch" | "pending",
    qrVsOcrAadhaarNo: "match" | "mismatch" | "pending",
    qrVsSelfie: "match" | "mismatch" | "skipped",  // Optional
    overallStatus: "verified" | "flagged" | "rejected" | "pending",
    flags: string[],           // ["Name mismatch between QR and OCR", ...]
  },
  
  // Agreement
  agreementAccepted: boolean,
  agreementSignature: string, // base64 signature image
  agreementSignedAt: string,  // ISO date
  
  // Meta
  status: "pending_approval" | "approved" | "rejected",
  submittedAt: string,        // ISO date
  reviewedAt: string | null,
  reviewedBy: string | null,  // admin email
  assignedTenantId: string | null,  // linked tenant ID after approval
  notes: string,              // admin notes
  source: "onboarding_link" | "tenant_portal",  // how they came
  linkedTenantId: string | null  // if existing tenant completing KYC
}
```

### Updated: `tenants` Collection (existing)

Add field:
```javascript
{
  ...existingFields,
  kycStatus: "not_started" | "in_progress" | "completed",  // New field
  kycApplicationId: string | null,  // Link to tenantApplications doc
}
```

### Updated: `tenantProfiles` Collection (existing)

No changes — KYC document data continues to be stored here for existing tenants.

---

## Implementation Phases

### Phase 1: Create Standalone KYC/Onboarding Page

**New file: `src/components/TenantOnboarding.jsx`**

- Full KYC form with 4 steps (extracted from TenantPortal.jsx KYC section):
  - Step 1: Basic Details (Name, Phone, Emergency Contact, Occupation)
  - Step 2: **Aadhaar QR Scan** (MANDATORY — camera-based QR scanner)
    - Opens camera with QR overlay
    - Decodes Aadhaar QR (XML or Secure QR format)
    - Extracts and auto-fills: Name, DOB, Gender, Address, Aadhaar No.
    - Shows extracted data for confirmation
    - Cross-matches with Step 1 typed name
  - Step 3: Document Upload (Aadhaar front+back photo, PAN/DL, Selfie) with OCR scanning
    - OCR runs on uploaded images
    - Cross-verifies OCR data against QR data
    - Mismatches flagged in real-time
  - Step 4: Agreement (Terms acceptance + Signature)
- Works in two modes:
  - **Standalone mode** (`/onboarding`): No login required, saves to `tenantApplications`
  - **Tenant mode** (`/kyc`): Logged-in tenant, saves to `tenantProfiles`
- Includes document scanner integration (already built)
- Shows scanning tips
- Mobile-first responsive design

**New file: `src/utils/aadhaarQrParser.js`**

- Parses old XML-based Aadhaar QR codes
- Parses new Secure QR (binary/compressed) format
- Returns standardized data object
- Handles edge cases (damaged QR, partial data)

**New dependency: `html5-qrcode`**

- npm package for camera-based QR scanning
- Cross-browser, mobile-friendly
- Real-time scanning with viewfinder overlay

### Phase 2: Update Tenant Portal Dashboard

**Modified: `src/components/TenantPortal.jsx`**

- Remove inline KYC section from tenant dashboard
- Add KYC status banner at top of dashboard:
  - 🔴 **Not Complete**: Red banner + "Complete KYC Now" button → navigates to `/kyc`
  - ✅ **Complete**: Green badge showing "KYC Verified"
- KYC status checked from `tenantProfiles` or `tenant.kycStatus` field

### Phase 3: Add Login Page Onboarding Button

**Modified: `src/components/TenantPortal.jsx` (Login screen)**

- Add "New Tenant? Sign Up / Onboard" button below the login form
- Button navigates to `/onboarding`
- Clean UI with explanation text

### Phase 4: Admin Panel - View Applications

**Modified: `src/components/TenantsKYCDetails.jsx`**

- Add new tab/section: "Pending Applications"
- Shows list of `tenantApplications` with status = `pending_approval`
- Admin can:
  - View submitted documents
  - Approve → Creates tenant account + assigns room
  - Reject → Updates status with reason

### Phase 5: Add Routes

**Modified: `src/App.jsx`**

- Add route: `/onboarding` → `<TenantOnboarding />`
- Add route: `/kyc` → `<TenantOnboarding mode="tenant" />`

---

## Component Architecture

```
TenantOnboarding.jsx (New - Main KYC Page)
├── Step 1: BasicDetailsForm
├── Step 2: AadhaarQrScanner (MANDATORY)
│   ├── Uses: html5-qrcode (camera QR scanning)
│   ├── Uses: aadhaarQrParser.js (parse XML / Secure QR)
│   └── Auto-fills + cross-matches name/number
├── Step 3: DocumentUpload (with scanner + OCR)
│   ├── Uses: documentScanner.js (existing)
│   ├── Uses: Tesseract.js (existing - OCR)
│   └── Cross-verifies against QR data
├── Step 4: AgreementSignature
└── Saves to: tenantApplications (new) or tenantProfiles (existing)

aadhaarQrParser.js (New - QR Data Parser)
├── parseXmlQr(xmlString) → { name, uid, dob, gender, address }
├── parseSecureQr(rawBytes) → { name, uid, dob, gender, address, photo }
└── crossVerify(qrData, ocrData, typedData) → { status, flags[] }

TenantPortal.jsx (Modified)
├── Login Screen → + "Onboard" button
└── Dashboard → KYC status banner + redirect button

TenantsKYCDetails.jsx (Modified - Admin)
└── + Pending Applications section with QR verification status
```

---

## Shareable Link Format

```
Production:  https://yoursite.com/onboarding
Local Dev:   http://localhost:3000/onboarding
```

Admin simply copies this link and sends via WhatsApp/SMS to new tenants.
No special tokens needed — the form is public and self-service.

---

## Security Considerations

1. **Aadhaar QR verification is MANDATORY** — cannot skip Step 2
2. **UIDAI digital signature** in QR data proves authenticity — forged documents will fail
3. **Triple cross-verification**: QR data ↔ OCR data ↔ Typed data
4. **No authentication required** for `/onboarding` — it's a public form
5. **Rate limiting** — Firestore rules can limit writes to `tenantApplications`
6. **Admin approval required** — No auto-activation; admin must review and approve
7. **Document data** — Stored as base64 in Firestore (same as current approach)
8. **Spam prevention** — Phone number validation + QR scan requirement + admin review gate
9. **Mismatch flagging** — Any cross-verification mismatch is flagged for admin review
10. **Audit trail** — Raw QR data stored for future reference

---

## Verification Trust Levels (shown to Admin)

| Level | Icon | Meaning |
|-------|------|---------|
| 🟢 **Fully Verified** | ✅ | QR scanned + OCR matched + Name matched + All docs uploaded |
| 🟡 **Partially Verified** | ⚠️ | QR scanned but minor mismatches (spelling variations, etc.) |
| 🔴 **Flagged** | ❌ | QR ↔ OCR mismatch, possible fake document |
| ⚪ **Pending QR** | ⏳ | Documents uploaded but QR not scanned yet (blocked from submission) |

---

## Summary

| What | Where | Access |
|------|-------|--------|
| New tenant fills KYC + QR scan | `/onboarding` | Public (no login) |
| Existing tenant completes KYC + QR scan | `/kyc` (from dashboard) | Logged-in tenant |
| Admin reviews applications + QR status | `/tenants-kyc` | Admin only |
| KYC status visible | Tenant Dashboard | Logged-in tenant |
| Signup button | Tenant Login Page | Public |

---

## NPM Dependencies to Add

```bash
npm install html5-qrcode pako
```

| Package | Purpose | Size |
|---------|---------|------|
| `html5-qrcode` | Camera-based QR code scanning in browser | ~90KB |
| `pako` | zlib decompression for Secure QR data | ~45KB |

---

## KYC Steps Summary (4 Steps)

```
Step 1: \ud83d\udcdd Fill Details       \u2192 Name, Phone, Emergency Contact, Occupation
Step 2: \ud83d\udcf7 Scan Aadhaar QR   \u2192 Camera opens, scans QR, extracts UIDAI data (MANDATORY)
Step 3: \ud83d\udcc4 Upload Documents  \u2192 Aadhaar photos + PAN/DL + Selfie + OCR + Cross-verify vs QR
Step 4: \u2705 Agreement          \u2192 Terms accept + Digital signature
```
