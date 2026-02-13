# Database Schema - Phase Compliant v2.0

## 🎯 Overview

This document defines the **exact** Firestore collection structure as per Phase specifications.  
All collections must follow these field definitions precisely.

---

## 📊 Collection Structures

### 1. **tenants** Collection

**Purpose:** Store tenant records

**Document Structure:**
```javascript
{
  name: string,                      // Tenant's full name
  phone: string,                     // Contact number
  roomNumber: number,                // ⚠️ MUST be number type
  currentRent: number,               // Monthly rent amount
  customElectricityRate: number | null,  // Override global rate (null = use default)
  isActive: boolean,                 // true = currently renting, false = moved out
  preferredLanguage: "en" | "hi",   // Language preference for portal
  nextIncreaseDate: timestamp,       // Next rent increase date
  createdAt: timestamp,              // Document creation time
  updatedAt: timestamp,              // Last modification time
  
  // Additional fields (implementation-specific):
  uniqueToken: string,               // 48-char hex for tenant portal access
  baseRent: number,                  // Original rent (for increase calculations)
  securityDeposit: number,           // Security deposit amount
  checkInDate: timestamp,            // Move-in date
  checkOutDate: timestamp | null     // Move-out date (null if active)
}
```

**Indexes:** None required (small collection)

---

### 2. **rooms** Collection

**Purpose:** Track room status and occupancy

**Document Structure:**
```javascript
{
  roomNumber: number,                // ⚠️ MUST be number type (e.g., 101, 102)
  floor: number,                     // Floor number (1, 2, etc.)
  isOccupied: boolean,               // true = tenant assigned, false = vacant
  currentTenantId: string | null     // Reference to tenants document ID (null if vacant)
}
```

**Document ID:** Use `room_<roomNumber>` format (e.g., `room_101`)

**Indexes:** None required

---

### 3. **payments** Collection ⚠️ CRITICAL - ROOM-BASED

**Purpose:** ONE document per room per month - Primary financial record (tenant-independent)

**Document Structure:**
```javascript
{
  roomNumber: number,                // ⚠️ MUST be number type - PRIMARY KEY COMPONENT
  tenantNameSnapshot: string,        // ⚠️ Plain text from CSV/input - NEVER VALIDATED
  year: number,                      // ⚠️ MUST be number (YYYY format, e.g., 2024)
  month: number,                     // ⚠️ MUST be number (1-12)
  rent: number,                      // ⚠️ Monthly rent amount
  electricity: number,               // ⚠️ Electricity charges
  totalAmount: number,               // rent + electricity
  paidAmount: number,                // Amount actually paid (can be partial)
  status: "paid" | "partial" | "unpaid",  // Payment status
  paymentDate: timestamp | null,     // Date payment received (null if unpaid)
  createdAt: timestamp,              // Record creation time
  
  // Optional fields:
  paymentMode: string,               // 'cash', 'upi', 'bank'
  importedAt: timestamp,             // Set if imported from CSV
  
  // LEGACY FIELDS (backward compatibility - optional):
  tenantId: string,                  // Only present in old records
  tenantName: string                 // Replaced by tenantNameSnapshot
}
```

**Document ID Format:** `{roomNumber}_{year}_{month}`  
**Example:** `101_2024_1` (Room 101, January 2024)

**⚠️ COMPOSITE INDEX REQUIRED:**
- Fields: `roomNumber` (Ascending) + `year` (Ascending) + `month` (Ascending)
- Purpose: Prevent duplicates, fast queries

**Create index in Firebase Console:**
```
Collection: payments
Fields: roomNumber (Ascending), year (Ascending), month (Ascending)
```

**⚠️ CRITICAL BUSINESS RULE:**
- Payment records are **room-based**, NOT tenant-based
- `tenantNameSnapshot` is stored as plain text and NEVER validated against tenants collection
- Historical data remains intact even when tenants change
- Duplicate prevention based on: `roomNumber + year + month`

**Validation Rules:**
- `tenantId + year + month` must be unique
- `year` must be 4-digit number (2020-2050)
- `month` must be 1-12
- `rent`, `electricity`, `totalAmount`, `paidAmount` must be >= 0
- `totalAmount` = `rent` + `electricity`
- `paidAmount` <= `totalAmount`

---

### 4. **electricityReadings** Collection

**Purpose:** Store meter readings

**Document Structure:**
```javascript
{
  tenantId: string,                  // Reference to tenant
  roomNumber: number,                // ⚠️ MUST be number
  year: number,                      // ⚠️ MUST be number
  month: number,                     // ⚠️ MUST be number (1-12)
  previousReading: number,           // Previous meter reading
  currentReading: number,            // Current meter reading
  units: number,                     // currentReading - previousReading
  pricePerUnit: number,              // Rate per unit at reading time
  totalBill: number                  // units * pricePerUnit
}
```

**Document ID Format:** `{tenantId}_{year}_{month}_electricity`

---

### 5. **bankAccounts** Collection

**Purpose:** Store UPI/Bank details for tenant payments

**Document Structure:**
```javascript
{
  accountName: string,               // Account holder name
  upiId: string,                     // UPI ID (e.g., 9876543210@paytm)
  qrImageUrl: string,                // QR code image URL
  isActive: boolean,                 // true = currently active (only ONE can be true)
  createdAt: timestamp               // Account creation time
}
```

**Business Rule:** Only ONE account can have `isActive: true` at any time.

---

### 6. **importLogs** Collection

**Purpose:** Track CSV import history

**Document Structure:**
```javascript
{
  fileName: string,                  // Uploaded CSV filename
  totalRows: number,                 // Total rows in CSV
  successCount: number,              // Successfully imported rows
  errorCount: number,                // Failed rows
  errors: array<string>,             // Array of error messages
  importedAt: timestamp              // Import timestamp
}
```

**Document ID:** Auto-generated by Firestore

---

### 7. **settings** Collection

**Purpose:** Global application settings

**⚠️ SINGLE DOCUMENT:** This collection should contain exactly ONE document with ID: `global`

**Document Structure:**
```javascript
{
  defaultElectricityRate: number,    // Default rate per unit (e.g., 8.5)
  annualRentIncreasePercent: number, // Annual increase % (e.g., 10)
  paymentMode: "manual" | "automatic" // Payment processing mode
}
```

**Document ID:** `global` (hardcoded)

**Access:** `doc(db, 'settings', 'global')`

---

## 🔄 Migration from Old Schema

### Field Name Changes in `payments` Collection:

| Old Field Name      | New Field Name | Type   | Notes                    |
|---------------------|----------------|--------|--------------------------|
| `rentAmount`        | `rent`         | number | Simpler name             |
| `electricityAmount` | `electricity`  | number | Simpler name             |
| -                   | `paidAmount`   | number | NEW - tracks partial pay |

### Status Value Changes:

| Old Value  | New Value  | Meaning                        |
|------------|------------|--------------------------------|
| `"pending"`| `"unpaid"` | Not paid yet                   |
| -          | `"partial"`| Partially paid                 |
| `"paid"`   | `"paid"`   | Fully paid (unchanged)         |

### roomNumber Type Change:

| Collection | Old Type | New Type | Example          |
|------------|----------|----------|------------------|
| All        | string   | number   | "101" → 101      |

---

## 📥 CSV Import Format

**File Name:** `payments_import.csv`

**⚠️ CRITICAL: Tenant names are stored as plain text and NOT validated against tenants collection**

**Headers:**
```csv
tenantName,roomNumber,year,month,rent,electricity,paidAmount,status,paymentDate
```

**Example:**
```csv
tenantName,roomNumber,year,month,rent,electricity,paidAmount,status,paymentDate
John Doe,101,2024,1,5000,450,5450,paid,2024-01-05
Jane Smith,102,2024,1,6000,600,6600,paid,2024-01-10
Bob Wilson,103,2024,2,5500,480,3000,partial,2024-02-08
Unknown Tenant XYZ,104,2024,3,7000,500,0,unpaid
```

**Import Rules:**
- ✅ `tenantName` can be ANY text - does NOT need to match existing tenants
- ✅ Duplicate prevention based on: `roomNumber + year + month`
- ✅ Import will NEVER fail due to "Tenant not found"
- ✅ Historical data preserved even when tenants change

**Validation:**
- `year` must be number
- `month` must be 1-12
- `tenantName` must exist in `tenants` collection
- Skip duplicates (tenant + year + month unique)
- `paidAmount` defaults to `totalAmount` if not specified

---

## 🎛️ Dashboard Requirements

### Dynamic Calculations from `payments` Collection:

1. **Total Rooms**
   ```javascript
   const roomsSnapshot = await getDocs(collection(db, 'rooms'));
   return roomsSnapshot.size;
   ```

2. **Active Tenants**
   ```javascript
   const tenantsSnapshot = await getDocs(
     query(collection(db, 'tenants'), where('isActive', '==', true))
   );
   return tenantsSnapshot.size;
   ```

3. **Pending Payments**
   ```javascript
   const paymentsSnapshot = await getDocs(
     query(
       collection(db, 'payments'),
       where('status', 'in', ['unpaid', 'partial'])
     )
   );
   return paymentsSnapshot.size;
   ```

4. **This Month Income**
   ```javascript
   const currentYear = new Date().getFullYear();
   const currentMonth = new Date().getMonth() + 1; // 1-12
   
   const paymentsSnapshot = await getDocs(
     query(
       collection(db, 'payments'),
       where('year', '==', currentYear),
       where('month', '==', currentMonth),
       where('status', '==', 'paid')
     )
   );
   
   let total = 0;
   paymentsSnapshot.forEach(doc => {
     total += doc.data().paidAmount || 0;
   });
   return total;
   ```

5. **Year-wise Aggregation**
   ```javascript
   // Group all paid payments by year
   const paymentsSnapshot = await getDocs(
     query(collection(db, 'payments'), where('status', '==', 'paid'))
   );
   
   const yearlyData = {};
   paymentsSnapshot.forEach(doc => {
     const data = doc.data();
     const year = data.year;
     
     if (!yearlyData[year]) {
       yearlyData[year] = {
         year,
         totalIncome: 0,
         rentIncome: 0,
         electricityIncome: 0
       };
     }
     
     yearlyData[year].totalIncome += data.paidAmount || 0;
     yearlyData[year].rentIncome += data.rent || 0;
     yearlyData[year].electricityIncome += data.electricity || 0;
   });
   
   return Object.values(yearlyData).sort((a, b) => b.year - a.year);
   ```

6. **Month-wise Breakdown (for selected year)**
   ```javascript
   const paymentsSnapshot = await getDocs(
     query(
       collection(db, 'payments'),
       where('year', '==', selectedYear),
       where('status', '==', 'paid')
     )
   );
   
   const monthlyData = Array(12).fill(0);
   paymentsSnapshot.forEach(doc => {
     const data = doc.data();
     monthlyData[data.month - 1] += data.paidAmount || 0;
   });
   
   return monthlyData;
   ```

---

## ✅ Verification Checklist

Run verification script:
```bash
npm run verify:db
```

**Manual Checks:**

- [ ] All 7 collections exist in Firestore
- [ ] `payments` collection uses `rent` / `electricity` (not `rentAmount` / `electricityAmount`)
- [ ] `roomNumber` is number type in all collections
- [ ] `year` and `month` are number types in `payments`
- [ ] Composite index created on `payments` (tenantId + year + month)
- [ ] Only one `bankAccount` has `isActive: true`
- [ ] `settings/global` document exists
- [ ] Dashboard shows dynamic data (not hardcoded zeros)
- [ ] CSV importer writes to `payments` collection
- [ ] Year-wise and month-wise aggregations work

---

## 🚀 Setup Commands

```bash
# Verify database structure
npm run verify:db

# Create 12 rooms (101-106, 201-206)
npm run seed:rooms

# Add missing uniqueTokens to tenants
npm run migrate:tokens

# Check tenant portal links
npm run check:tokens
```

---

## 📝 Notes

- **No data deletion:** This schema is additive. Old data with `rentAmount`/`electricityAmount` will still work due to backward compatibility in code.
- **Gradual migration:** New imports use new schema. Old records can be migrated gradually.
- **Type safety:** Always use `Number()` conversion when reading from CSV or user input.

---

**Document Version:** 2.0 (Phase Compliant)  
**Last Updated:** 2026-02-13
