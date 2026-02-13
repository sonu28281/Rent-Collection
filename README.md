# Rent-Collection
For home use

TITLE: Build & Deploy Autoxweb Rent (Netlify + Firebase + Zero-Cost Storage) – Full Production Build

OBJECTIVE
---------
Build a production-ready rental management web app for a 12-room lodge.
Must be mobile-first, secure, modular, Netlify-deployed, Firestore-backed.
All phases must be tested before moving to the next.
Do not skip validation.
Commit after each phase.

OWNER CONTEXT
-------------
- Property has rooms: 101–106 and 201–206.
- Historical data exists from 2017–2025 (CSV provided).
- File storage must NOT use Firebase Storage (avoid Blaze billing).
- Use storageAdapter abstraction (local mock first, Drive API future).
- Manual payment mode default.
- UPI switching must be dynamic.
- Annual rent increase 10%.
- Tenant portal token-based.
- Admin only via Email/Password.

FIREBASE CONFIG (USE THESE VALUES)
-----------------------------------
const firebaseConfig = {
  apiKey: "AIzaSyD5Nv3uIlCQuOQkj7crx1kcg-ENIH9cXT4",
  authDomain: "rent-collection-5e1d2.firebaseapp.com",
  projectId: "rent-collection-5e1d2",
  storageBucket: "rent-collection-5e1d2.firebasestorage.app",
  messagingSenderId: "605839501523",
  appId: "1:605839501523:web:153e006f8ada52f9804c26",
  measurementId: "G-ZK8D32M76Y"
};

REGION: us-central1

DEPLOYMENT TARGET
-----------------
Netlify

SETUP REQUIREMENTS
------------------
1. Create GitHub repository.
2. Connect repo to Netlify.
3. Add environment variables in Netlify:
   VITE_FIREBASE_API_KEY
   VITE_FIREBASE_AUTH_DOMAIN
   VITE_FIREBASE_PROJECT_ID
   VITE_FIREBASE_APP_ID
   FIREBASE_ADMIN_SERVICE_ACCOUNT (secure)
   DEFAULT_UPI_ID
4. Never commit secrets to repo.

REPO STRUCTURE
--------------
Root:
- netlify.toml
- package.json
- README.md
- /src
- /functions
- /scripts
- /data (contains historical CSV)

NETLIFY CONFIG
--------------
netlify.toml:

[build]
  command = "npm run build"
  publish = "dist"

[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200

DATABASE STRUCTURE (CREATE EXACTLY)
------------------------------------

COLLECTION: rooms
- roomNumber
- floor
- status
- defaultRent
- electricityMeterNo
- createdAt

Seed rooms 101–106, 201–206.

COLLECTION: tenants
- name
- phone
- roomNumber
- checkInDate
- checkOutDate
- isActive
- uniqueToken (48 char hex)
- baseRent
- currentRent
- securityDeposit
- annualIncreasePercentage
- nextIncreaseDate
- customElectricityRate
- preferredLanguage
- agreementUrl
- kycAadharUrl
- kycPanUrl
- createdAt

COLLECTION: monthlyRecords
- tenantId
- roomNumber
- year
- month
- rent
- electricity
- extraCharges
- total
- dueDate
- status
- lateFee
- createdAt

COLLECTION: electricityReadings
- tenantId
- roomNumber
- year
- month
- previousReading
- currentReading
- units
- pricePerUnit
- totalAmount
- photoUrl
- verified
- createdAt

COLLECTION: payments
- tenantId
- roomNumber
- ledgerId
- amount
- paymentDate
- utr
- screenshotUrl
- receivedAccountId
- status
- createdAt

COLLECTION: bankAccounts
- upiId
- nickname
- qrImageUrl
- isActive
- createdAt
- changedBy
- changedAt

Ensure only one bank account isActive=true at any time.

COLLECTION: maintenance
- roomNumber
- description
- cost
- date
- billPhotoUrl
- createdAt

COLLECTION: settings (doc id: global)
- defaultElectricityRate
- paymentMode
- reminderDaysBefore
- defaultLanguage
- annualIncreasePercentageDefault

COLLECTION: importLogs
- fileName
- rowsImported
- errors
- importedAt

COLLECTION: logs
- actor
- action
- payload
- status
- timestamp

PHASE EXECUTION (STRICT ORDER)
------------------------------

PHASE 1: Bootstrap
- Setup React + Vite + Tailwind
- Initialize Firebase
- Admin login
- Protected routes
TEST: Login works
COMMIT: "Phase 1 complete – Auth scaffold"

PHASE 2: Seed Rooms
- Create scripts/seed_rooms.js
- Insert 12 rooms
TEST: Rooms visible
COMMIT: "Phase 2 complete – Rooms seeded"

PHASE 3: Tenants CRUD
- Create tenant form
- Assign room
- Prevent duplicate room usage
TEST: CRUD validated
COMMIT: "Phase 3 complete – Tenants module"

PHASE 4: Tenant Portal
Route: /t/:token
- Fetch by uniqueToken
- Show dues + history
- Show active UPI
TEST: Token validation works
COMMIT: "Phase 4 complete – Tenant portal"

PHASE 5: Electricity Module
- Global rate in settings
- Tenant override
- Unit calculation
- Auto monthlyRecord update
TEST: Units and billing correct
COMMIT: "Phase 5 complete – Electricity logic"

PHASE 6: Manual Payment Flow
- Upload screenshot (storageAdapter)
- Enter UTR
- Admin verify
- Update ledger
TEST: Payment status updates
COMMIT: "Phase 6 complete – Payments"

PHASE 7: Annual Rent Increase
- Check nextIncreaseDate
- Update currentRent
- Log change
TEST: Trigger increases rent
COMMIT: "Phase 7 complete – Rent automation"

PHASE 8: Multi-language
- i18next
- English/Hindi toggle
TEST: UI switches language
COMMIT: "Phase 8 complete – i18n"

PHASE 9: Dynamic UPI
- Add multiple accounts
- Toggle active
TEST: Only one active
COMMIT: "Phase 9 complete – UPI switching"

PHASE 10: Historical CSV Import
Use provided CSV:
autoxweb_rent_upload_ready_2017_2025.csv

- Upload via Admin UI
- Validate columns
- Detect duplicates
- Batch write
- Create importLogs record
TEST: Import summary shows correct count
COMMIT: "Phase 10 complete – Historical import"

PHASE 11: Backup & Export
- Export tenants CSV
- Export monthlyRecords CSV
- Generate yearly PDF
TEST: Files download successfully
COMMIT: "Phase 11 complete – Backup tools"

PHASE 12: CI/CD
- Add GitHub Actions
- Auto build & deploy
TEST: Push triggers deploy
COMMIT: "Release v1.0"

STORAGE ADAPTER REQUIREMENTS
----------------------------
Implement storageAdapter.js:
- uploadFile()
- deleteFile()
Phase 1: store in Netlify Function local temp
Phase 2: add Google Drive API integration hook

SECURITY RULES
--------------
- Admin-only write for sensitive collections
- Tenant access restricted by token
- Prevent unauthorized updates

FINAL DELIVERABLE
-----------------
1. GitHub repo URL
2. Netlify deployed site URL
3. README with setup steps
4. Seed scripts
5. Working import tool
6. Backup/export tools
7. Fully tested production build

END OF INSTRUCTIONS
