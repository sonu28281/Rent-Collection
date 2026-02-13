# Database Schema Update - v1.1.0

## 🔄 Major Changes

### Key Updates:
1. **Payments Collection**: Now the primary collection for all payment records
2. **Field Type Enforcement**: All numeric fields stored as `number` type
3. **Dynamic Dashboard**: Real-time financial calculations from Firestore
4. **Import Target**: CSV imports now go directly to `payments` collection

---

## 📊 Updated Collection Structure

### **payments** (Primary Payment Records)
```javascript
{
  tenantId: string,              // Reference to tenant
  tenantName: string,            // Denormalized for quick lookup
  roomNumber: string,            // Room identifier
  rentAmount: number,            // ⚠️ MUST be number type
  electricityAmount: number,     // ⚠️ MUST be number type
  totalAmount: number,           // rentAmount + electricityAmount
  month: number,                 // 1-12 (⚠️ MUST be number)
  year: number,                  // YYYY (⚠️ MUST be number)
  paymentDate: timestamp,        // ISO string or Firestore timestamp
  paymentMode: string,           // 'cash', 'upi', 'bank'
  status: string,                // 'paid' or 'pending'
  createdAt: timestamp,          // Record creation time
  importedAt: timestamp          // Optional - if imported from CSV
}
```

**Document ID Format**: `{tenantId}_{year}_{month}`  
**Example**: `abc123_2024_1`

---

### **tenants** (Tenant Records)
```javascript
{
  name: string,
  phone: string,
  roomNumber: string,
  currentRent: number,           // Current monthly rent
  customElectricityRate: number | null,  // Override global rate
  isActive: boolean,             // true = currently renting
  checkInDate: timestamp,
  checkOutDate: timestamp | null,
  nextIncreaseDate: timestamp,   // For annual rent increase
  uniqueToken: string,           // 48-char hex for tenant portal
  preferredLanguage: string,     // 'en' or 'hi'
  kycAadharUrl: string | null,   // Future: storage adapter
  kycPanUrl: string | null,      // Future: storage adapter
  securityDeposit: number,
  baseRent: number,              // Original rent amount
  annualIncreasePercentage: number, // Default 10%
  createdAt: timestamp
}
```

---

### **electricityReadings** (Meter Readings)
```javascript
{
  tenantId: string,
  roomNumber: string,
  year: number,                  // ⚠️ MUST be number
  month: number,                 // 1-12 (⚠️ MUST be number)
  previousReading: number,
  currentReading: number,
  units: number,                 // currentReading - previousReading
  pricePerUnit: number,          // Rate at time of reading
  totalAmount: number,           // units * pricePerUnit
  photoUrl: string | null,       // Future: storage adapter
  verified: boolean,             // Admin verification flag
  createdAt: timestamp
}
```

---

### **maintenance** (Repair Records)
```javascript
{
  type: string,                  // 'plumbing', 'electrical', etc.
  roomNumber: string | null,     // null = common area
  description: string,
  cost: number,                  // ⚠️ MUST be number
  date: timestamp,
  billPhotoUrl: string | null,   // Future: storage adapter
  createdAt: timestamp
}
```

---

### **bankAccounts** (UPI/Bank Details)
```javascript
{
  upiId: string,                 // e.g., username@paytm
  nickname: string,              // e.g., "Main GPay"
  qrImageUrl: string | null,     // QR code image URL
  isActive: boolean,             // Only ONE can be true
  createdAt: timestamp,
  changedBy: string,             // Admin email
  changedAt: timestamp
}
```

---

### **settings** (Global Config)
**Document ID**: `global` (singleton)

```javascript
{
  defaultElectricityRate: number,      // Default ₹ per unit
  annualIncreasePercentage: number,    // Default 10%
  paymentMode: string,                 // 'manual' (current)
  reminderDaysBefore: number,          // Days before due date
  defaultLanguage: string,             // 'en' or 'hi'
  createdAt: timestamp,
  updatedAt: timestamp
}
```

---

### **rooms** (Room Master Data)
```javascript
{
  roomNumber: string,            // '101', '102', etc.
  floor: number,                 // 1 or 2
  isOccupied: boolean,           // Auto-updated from tenants
  defaultRent: number,           // Base rent for room
  electricityMeterNo: string,    // Meter identifier
  createdAt: timestamp
}
```

---

### **importLogs** (Import History)
```javascript
{
  fileName: string,
  rowsImported: number,
  rowsFailed: number,
  errors: array,                 // Array of error messages
  importedAt: timestamp
}
```

---

### **logs** (Audit Trail)
```javascript
{
  actor: string,                 // 'admin' or email
  action: string,                // 'rent_increase', 'payment_recorded', etc.
  payload: object,               // Action-specific data
  status: string,                // 'success' or 'error'
  timestamp: timestamp
}
```

---

## 🔧 Migration from Old Schema

### If you have existing `monthlyRecords`:

**Option 1: Manual Migration Script**
```javascript
// scripts/migrate_monthly_to_payments.js
import { collection, getDocs, doc, setDoc } from 'firebase/firestore';
import { db } from '../src/firebase.js';

const monthlyRecordsRef = collection(db, 'monthlyRecords');
const snapshot = await getDocs(monthlyRecordsRef);

for (const docSnapshot of snapshot.docs) {
  const data = docSnapshot.data();
  
  const paymentData = {
    tenantId: data.tenantId,
    tenantName: data.tenantName || 'Unknown', // Add tenant name
    roomNumber: data.roomNumber,
    rentAmount: Number(data.rent) || 0,
    electricityAmount: Number(data.electricity) || 0,
    totalAmount: Number(data.total) || 0,
    month: Number(data.month),
    year: Number(data.year),
    paymentDate: data.paidAt || data.createdAt,
    paymentMode: 'cash',
    status: data.status || 'pending',
    createdAt: data.createdAt,
    migratedAt: new Date().toISOString()
  };
  
  const paymentId = `${data.tenantId}_${data.year}_${data.month}`;
  await setDoc(doc(db, 'payments', paymentId), paymentData);
  console.log(`Migrated: ${paymentId}`);
}
```

**Option 2: Fresh Start**
- Export existing data to CSV
- Clear old collections
- Import via updated ImportCSV module (now targets `payments`)

---

## 💻 Code Changes

### 1. **Dashboard** - Now Dynamic
**Before**: Static hardcoded zeros  
**After**: Real-time calculations from Firestore

```javascript
// src/utils/financial.js
export const getDashboardStats = async () => {
  const activeTenants = await getActiveTenantCount();
  const pendingPayments = await getPendingPaymentCount();
  const currentMonthIncome = await getCurrentMonthIncome();
  const totalIncome = await getTotalLifetimeIncome();
  const occupancy = await getOccupancyRate();
  
  return { activeTenants, pendingPayments, currentMonthIncome, totalIncome, occupancy };
};
```

### 2. **ImportCSV** - Updated Target
**Before**: Imported to `monthlyRecords`  
**After**: Imports to `payments` with correct field types

```javascript
// Key changes:
- year: Number(row.year)        // Force number type
- month: Number(row.month)      // Force number type
- rentAmount: Number(row.rent)  // Renamed field
- electricityAmount: Number(row.electricity)  // Renamed field
- totalAmount: rentAmount + electricityAmount // Calculated
```

### 3. **Financial Reports** - Year/Month Summaries
New utilities in `/src/utils/financial.js`:
- `getYearlyIncomeSummary()` - Income by year
- `getMonthlyIncomeByYear(year)` - Month-wise breakdown
- `getTotalLifetimeIncome()` - All-time total

---

## 📝 CSV Import Format (Updated)

### Required Columns:
```csv
tenantName,roomNumber,year,month,rent,electricity
```

### Optional Columns:
```csv
paymentDate,paymentMode,status
```

### Sample CSV:
```csv
tenantName,roomNumber,year,month,rent,electricity,paymentDate,paymentMode,status
John Doe,101,2024,1,5000,450,2024-01-05,upi,paid
Jane Smith,102,2024,1,6000,600,2024-01-10,cash,paid
Bob Wilson,103,2024,2,5500,480,2024-02-08,bank,paid
```

**Important**:
- `year` and `month` will be converted to `number` type
- `rent` becomes `rentAmount` (number)
- `electricity` becomes `electricityAmount` (number)
- System auto-calculates `totalAmount`

---

## 🧪 Testing Checklist

### 1. Database Setup
```bash
npm run setup:database  # Audit current structure
```

### 2. Seed Rooms (if fresh install)
```bash
npm run seed:rooms  # Creates 12 rooms
```

### 3. Add Test Tenant
- Go to Tenants → Add Tenant
- Fill required fields
- Verify `isActive: true`

### 4. Import Sample Data
- Go to Import CSV
- Upload `/data/sample_payments.csv`
- Verify import success count
- Check `payments` collection in Firebase Console

### 5. Verify Dashboard
- Check "Active Tenants" shows correct count
- Check "This Month" shows imported payment totals
- Verify year-wise table populates
- Click a year to see month-wise breakdown

### 6. Financial Queries
Open browser console:
```javascript
import { getTotalLifetimeIncome } from './utils/financial.js';
const total = await getTotalLifetimeIncome();
console.log('Total:', total);
```

---

## 🚨 Breaking Changes

### ❌ Removed/Deprecated:
- `monthlyRecords` collection (replaced by `payments`)
- `ledgerId` field (not needed)
- `meterReadings` collection (renamed to `electricityReadings`)

### ✅ New Collections:
- `payments` (primary financial records)
- `electricityReadings` (meter data)

### 🔄 Renamed Fields:
- `rent` → `rentAmount` (in payments)
- `electricity` → `electricityAmount` (in payments)
- `total` → `totalAmount` (in payments)

---

## 🎯 Benefits

1. **Type Safety**: All numeric fields enforced as `number`
2. **Single Source of Truth**: `payments` collection for all financial data
3. **Real-time Analytics**: Dashboard auto-calculates from Firestore
4. **Optimized Queries**: Indexed on `year`, `month`, `status`
5. **Audit Trail**: Every import logged in `importLogs`
6. **Scalable**: Ready for multi-property expansion

---

## 📞 Support

Issues? Check:
1. Firestore rules allow read/write for authenticated users
2. All imports use `Number()` conversion
3. `payments` collection has composite index on `(status, year, month)`
4. Settings document exists at `settings/global`

---

**Version**: 1.1.0  
**Date**: February 13, 2026  
**Status**: ✅ Production Ready
