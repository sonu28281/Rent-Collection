We are implementing DigiLocker + MeriPehchaan KYC verification in our production Firebase + React (Vite) + Netlify project.

Domain structure:

Tenant Portal: https://tenants.callvia.in

Admin Portal: https://admin.callvia.in

Tech stack:

Frontend: React (Vite)

Backend: Firebase Cloud Functions

Database: Firestore

Hosting: Netlify (frontend) + Firebase (functions)

🔐 OAuth Configuration

Use OAuth 2.0 Authorization Code Flow.

Credentials:

CLIENT_ID = "AT561D9B37"
CLIENT_SECRET = "f3e6282d705004fe6b05"
REDIRECT_URI = "https://tenants.callvia.in/kyc/callback
"

AUTHORIZATION_ENDPOINT = "PASTE_AUTH_URL_HERE"
TOKEN_ENDPOINT = "PASTE_TOKEN_URL_HERE"
PROFILE_ENDPOINT = "PASTE_PROFILE_API_URL_HERE"

SCOPES = "openid profile issued_documents"

PHASE 1 — OAuth Connectivity Test

Create Firebase Cloud Functions:

initiateKyc()

handleKycCallback()

exchangeAuthorizationCode()

fetchUserProfile()

Flow:

Tenant clicks "Verify with DigiLocker"

Redirect to AUTHORIZATION_ENDPOINT

On callback:

Validate state

Exchange code for access token (server-side only)

Fetch profile

Log response

Do NOT store data yet

Ensure:

Client secret is stored in Firebase config

Never exposed to frontend

Proper error handling

PHASE 2 — Firestore Integration

After successful profile fetch:

Store under tenant document:

{
kyc: {
verified: true,
verifiedBy: "DigiLocker",
verifiedAt: timestamp,
name: string,
dob: string,
address: string,
digilockerTxnId: string
}
}

Do NOT store full raw documents unless required.

PHASE 3 — UI Implementation

In Tenant Dashboard:

If not verified:

Show button: "Verify with DigiLocker"

If verified:

Show green check icon

Show badge text: "Verified by DigiLocker"

Show verification date

In Admin Panel:

Add KYC status column

Filter: Verified / Not Verified

PHASE 4 — Security Rules

Update Firestore rules:

Tenant can read own KYC

Tenant cannot write KYC

Only backend (admin SDK) writes verification

Admin can read all

PHASE 5 — README Update

Create section:

DigiLocker KYC Integration

Include:

Architecture overview

OAuth flow explanation

Firestore schema

Security model

Deployment steps

Environment variable setup

Production checklist

Important Requirements

Use HTTPS only

Validate OAuth state parameter

Proper error handling

Log verification attempts

Production-ready code

Clean folder structure

Implement this step by step.