# METER-BASED PAYMENT SYSTEM - IMPLEMENTATION GUIDE

## 🎯 Overview

This guide explains the upgraded meter-based payment system with complete electricity calculation from meter readings.

---

## 📋 STEP-BY-STEP IMPLEMENTATION

### STEP 1: Safe Backup + Clean Reset

**CRITICAL:** Always backup before making changes!

#### Run the Backup Script:

```bash
cd /workspaces/Rent-Collection
node scripts/backup_and_reset_payments.js
```

**What it does:**
1. Creates a timestamped backup collection: `payments_backup_<timestamp>`
2. Copies all documents from `payments` collection
3. Verifies backup count matches original
4. Deletes all documents from original `payments` collection
5. Logs detailed results

**Expected Output:**
```
✅ Found X documents in 'payments' collection
✅ Backed up X documents to 'payments_backup_TIMESTAMP'
✅ Backup verification successful!
✅ Deleted X documents from 'payments' collection
✅ BACKUP AND RESET COMPLETED SUCCESSFULLY
```

**IMPORTANT:** The backup collection is permanent. You can restore from it anytime.

---

### STEP 2: Upgraded Payments Data Model

The new payment document structure includes:

```javascript
{
  // Room & Tenant Info
  roomNumber: number,              // e.g., 101, 201
  floor: number,                   // Auto: <200=1, >=200=2
  tenantNameSnapshot: string,      // Plain text, not validated
  
  // Time Period
  year: number,                    // e.g., 2024
  month: number,                   // 1-12
  
  // Rent
  rent: number,                    // e.g., 5000
  
  // Meter-Based Electricity
  oldReading: number,              // Previous meter reading
  currentReading: number,          // Current meter reading
  units: number,                   // Auto: currentReading - oldReading
  ratePerUnit: number,             // e.g., 8.5
  electricity: number,             // Auto: units * ratePerUnit
  
  // Totals & Payment
  total: number,                   // Auto: rent + electricity
  paidAmount: number,              // Amount paid by tenant
  status: string,                  // Auto: "paid", "partial", "pending"
  
  // Timestamps
  createdAt: timestamp,
  updatedAt: timestamp
}
```

---

### STEP 3: CSV Import Format

#### Required Columns:

```csv
roomNumber,tenantName,year,month,rent,oldReading,currentReading,ratePerUnit,paidAmount
```

#### Example CSV:

```csv
roomNumber,tenantName,year,month,rent,oldReading,currentReading,ratePerUnit,paidAmount,paymentDate,paymentMode
101,John Doe,2024,1,5000,1200,1250,8.5,5425,2024-01-05,upi
102,Jane Smith,2024,1,6000,2100,2180,8.5,6680,2024-01-10,cash
103,Bob Wilson,2024,1,5500,1800,1860,8.5,6010,2024-01-08,bank
```

#### Calculation Example:
- Room 101, January 2024
- Rent: ₹5,000
- Old Reading: 1200
- Current Reading: 1250
- Units: 1250 - 1200 = 50
- Rate: ₹8.5 per unit
- Electricity: 50 × 8.5 = ₹425
- **Total: ₹5,000 + ₹425 = ₹5,425**
- Paid: ₹5,425
- **Status: paid** (because paidAmount >= total)

---

### STEP 4: Using the Financial History Page

Access: **History Manager** from the sidebar

#### Features:

1. **Year Selector** - Select year to view
2. **Floor Filter** - Filter by Floor 1, Floor 2, or All
3. **Month Tabs** - Quick filter by month
4. **Full Table View** with columns:
   - Room Number
   - Floor (auto-detected)
   - Month
   - Tenant Name
   - Rent
   - Old Reading
   - Current Reading
   - Units (auto-calculated)
   - Rate per Unit
   - Electricity (auto-calculated)
   - Total (auto-calculated)
   - Paid Amount
   - Status (auto-determined)
   - Actions (Edit/Mark Paid)

#### Editing Records:

1. Click **Edit** button on any row
2. Modify any field:
   - **Rent**: Updates total
   - **Old/Current Reading**: Auto-recalculates units, electricity, total
   - **Rate per Unit**: Auto-recalculates electricity, total
   - **Paid Amount**: Auto-updates status
3. Click **Save** to apply changes
4. All calculations update automatically!

#### Bulk Operations:

1. **Select multiple records** using checkboxes
2. Click **Mark Paid (X)** to mark all as paid
3. **Export CSV** to download filtered data

---

### STEP 5: Calculation Safety

The system includes defensive checks:

#### Negative Units Protection:
```javascript
if (currentReading - oldReading < 0) {
  units = 0;
  // Logs warning but continues
}
```

#### Missing Data Handling:
```javascript
oldReading = oldReading || 0;
currentReading = currentReading || 0;
ratePerUnit = ratePerUnit || 0;
```

#### Status Auto-Determination:
```javascript
if (paidAmount >= total) status = "paid";
else if (paidAmount > 0) status = "partial";
else status = "pending";
```

---

### STEP 6: Testing

#### Test with Sample Data:

1. Go to **Import CSV** page
2. Upload: `/workspaces/Rent-Collection/data/test_meter_import.csv`
3. Verify preview shows 3 records
4. Click **Import Data**
5. Verify results:
   - 3 Successfully Created
   - 0 Errors

#### Verification Checklist:

Go to **History Manager**, select 2024, January:

| Room | Rent | Old | Current | Units | Rate | Electricity | Total | Status |
|------|------|-----|---------|-------|------|-------------|-------|--------|
| 101  | 5000 | 1200| 1250    | 50    | 8.5  | 425         | 5425  | paid   |
| 102  | 6000 | 2100| 2180    | 80    | 8.5  | 680         | 6680  | paid   |
| 103  | 5500 | 1800| 1860    | 60    | 8.5  | 510         | 6010  | paid   |

✅ All calculations correct!
✅ Floor auto-detection correct (all Floor 1)
✅ Status logic correct

---

## 🚨 CRITICAL RULES

### 1. Tenant Names are Snapshots
- Tenant names from CSV are stored as-is
- **NOT validated** against tenants collection
- Historical names preserved even if tenant changes

### 2. Floor Auto-Detection
```javascript
floor = roomNumber < 200 ? 1 : 2
```
- Rooms 101-199 → Floor 1
- Rooms 200+ → Floor 2

### 3. No Manual Electricity Input
- Electricity **MUST** come from meter readings
- Cannot manually enter electricity amount
- All calculations automated

### 4. Duplicate Handling
- Unique key: `roomNumber + year + month`
- If duplicate exists: **UPDATE** instead of reject
- Prevents accidental data loss

### 5. Defensive Calculations
- Negative units → Set to 0 with warning
- Missing readings → Default to 0
- Never fail on calculation errors

---

## 📊 Import Rules Summary

| Column | Type | Required | Auto-Calculated | Default |
|--------|------|----------|-----------------|---------|
| roomNumber | Number | ✅ Yes | No | - |
| tenantName | String | ✅ Yes | No | - |
| year | Number | ✅ Yes | No | - |
| month | Number | ✅ Yes | No | - |
| rent | Number | ✅ Yes | No | 0 |
| oldReading | Number | ✅ Yes | No | 0 |
| currentReading | Number | ✅ Yes | No | 0 |
| ratePerUnit | Number | ✅ Yes | No | 0 |
| paidAmount | Number | ✅ Yes | No | 0 |
| floor | Number | No | ✅ Yes | Auto |
| units | Number | No | ✅ Yes | Auto |
| electricity | Number | No | ✅ Yes | Auto |
| total | Number | No | ✅ Yes | Auto |
| status | String | No | ✅ Yes | Auto |
| paymentDate | ISO String | No | No | null |
| paymentMode | String | No | No | 'cash' |

---

## 🔄 Data Migration Workflow

For migrating old payment data to the new meter-based system:

### Option A: Full Reset and Re-import (Recommended)

1. **Backup existing data:**
   ```bash
   node scripts/backup_and_reset_payments.js
   ```

2. **Prepare CSV with meter readings:**
   - Add `oldReading`, `currentReading`, `ratePerUnit` columns
   - Calculate historical readings if available
   - If readings not available, use `oldReading=0, currentReading=0` (electricity will be 0)

3. **Import new data:**
   - Use Import CSV page
   - Verify calculations
   - Check all records

### Option B: Update Existing Records

1. **Export current data from History Manager**
2. **Add meter columns in Excel/Sheets:**
   - `oldReading`
   - `currentReading`
   - `ratePerUnit`
3. **Remove old `electricity` column** (will be recalculated)
4. **Re-import via History Manager's Import CSV**
   - Existing records will be updated (not duplicated)

---

## ⚠️ Important Notes

### Before Full Production Import:

1. ✅ Run backup script
2. ✅ Test with 3-5 sample records
3. ✅ Verify calculations are correct
4. ✅ Check floor detection works
5. ✅ Confirm status logic correct
6. ✅ Test editing functionality
7. ✅ Only then import full historical data

### Rollback Procedure:

If something goes wrong:
1. Go to Firebase Console
2. Find your backup collection: `payments_backup_<timestamp>`
3. Export that collection
4. Delete current `payments` collection
5. Import from backup

---

## 📞 Support

If you encounter issues:

1. Check Firebase Console → Firestore → `payments` collection
2. Check browser console for errors
3. Verify CSV format matches requirements exactly
4. Test with the provided `test_meter_import.csv` first

---

## ✅ Ready for Production?

Checklist before importing 2022-2026 data:

- [ ] Backup script executed successfully
- [ ] Test import completed (3 records)
- [ ] All calculations verified correct
- [ ] Floor detection working
- [ ] Status logic working
- [ ] Edit functionality tested
- [ ] CSV prepared with all required columns
- [ ] Historical meter readings added (or set to 0)
- [ ] Ready to proceed with full import!

---

**System is now ready for meter-based financial record keeping! 🎉**
