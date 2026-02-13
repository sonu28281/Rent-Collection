# 🚀 QUICK START GUIDE - Meter-Based Payment System

## Before You Start

### Prerequisites
- Firebase Admin SDK configured
- `serviceAccountKey.json` in `/scripts` folder
- CSV file with meter readings prepared

---

## Step 1: Backup Current Data

```bash
cd /workspaces/Rent-Collection
node scripts/backup_and_reset_payments.js
```

**Expected Output:**
```
✅ BACKUP AND RESET COMPLETED SUCCESSFULLY
📦 Backup Collection: payments_backup_TIMESTAMP
```

---

## Step 2: Prepare Your CSV

### Required Format:

```csv
roomNumber,tenantName,year,month,rent,oldReading,currentReading,ratePerUnit,paidAmount
101,John Doe,2022,1,5000,1200,1250,8.5,5425
102,Jane Smith,2022,1,6000,2100,2180,8.5,6680
```

### Column Descriptions:

| Column | Example | Notes |
|--------|---------|-------|
| roomNumber | 101 | Room number (auto-detects floor) |
| tenantName | "John Doe" | Stored as snapshot (not validated) |
| year | 2022 | 4-digit year |
| month | 1 | 1-12 (1=Jan, 12=Dec) |
| rent | 5000 | Monthly rent amount |
| oldReading | 1200 | Previous meter reading |
| currentReading | 1250 | Current meter reading |
| ratePerUnit | 8.5 | Electricity rate per unit |
| paidAmount | 5425 | Amount actually paid |

### Auto-Calculations:
- **units** = currentReading - oldReading
- **electricity** = units × ratePerUnit
- **total** = rent + electricity
- **floor** = roomNumber < 200 ? 1 : 2
- **status** = auto-determined from paidAmount vs total

---

## Step 3: Test Import

1. Open application in browser
2. Navigate to **Import CSV**
3. Upload test file: `data/test_meter_import.csv`
4. Review preview (should show 3 rows)
5. Click **Import Data**
6. Verify:
   - ✅ 3 Successfully Created
   - ✅ 0 Errors

---

## Step 4: Verify in History Manager

1. Navigate to **History Manager**
2. Select Year: **2024**
3. Select Month: **January** (Jan)
4. Check calculations:

**Room 101:**
- Rent: ₹5,000
- Units: 50 (1250 - 1200)
- Electricity: ₹425 (50 × 8.5)
- Total: ₹5,425
- Status: paid

---

## Step 5: Full Data Import

Once test passes:

1. Prepare full CSV with all historical data
2. Import via **Import CSV** page
3. Monitor import results
4. Verify data in **History Manager**

---

## Editing Records

### In History Manager:

1. Find record in table
2. Click **Edit**
3. Modify fields:
   - **Meter readings** → Auto-recalculates units, electricity, total
   - **Paid amount** → Auto-updates status
4. Click **Save**

### Live Calculation Preview:
When editing, you'll see real-time calculation updates!

---

## Floor Filter

In History Manager:
- **All Floors** - Shows all rooms
- **Floor 1** - Rooms < 200
- **Floor 2** - Rooms ≥ 200

Auto-detected from room number!

---

## Bulk Operations

1. **Select** multiple records (checkboxes)
2. **Mark Paid (X)** - Marks all selected as paid
3. **Export CSV** - Downloads filtered data

---

## Status Logic

| Condition | Status | Badge Color |
|-----------|--------|-------------|
| paidAmount >= total | paid | Green |
| paidAmount > 0 | partial | Yellow |
| paidAmount = 0 | pending | Red |

---

## Troubleshooting

### "Missing required columns" error
- Check CSV has all required columns
- Column names must match exactly (case-sensitive)

### "Negative units" warning
- Current reading < Old reading
- System sets units to 0 (non-blocking warning)

### Duplicate records
- System updates existing record
- Does NOT reject or create duplicate

### Floor showing wrong
- Room numbers < 200 → Floor 1
- Room numbers ≥ 200 → Floor 2
- Edit record to fix if needed

---

## CSV Template

Download: `data/test_meter_import.csv`

Or create from this template:

```csv
roomNumber,tenantName,year,month,rent,oldReading,currentReading,ratePerUnit,paidAmount,paymentDate,paymentMode
101,Tenant Name,2024,1,5000,1200,1250,8.5,5425,2024-01-05,upi
```

---

## Restore from Backup

If needed:

1. Go to Firebase Console
2. Open Firestore
3. Find: `payments_backup_TIMESTAMP`
4. Export that collection
5. Import back to `payments`

---

## ✅ Pre-Flight Checklist

Before importing production data:

- [ ] Backup completed successfully
- [ ] Test CSV imported (3 records)
- [ ] Calculations verified correct
- [ ] Floor detection tested
- [ ] Edit functionality works
- [ ] Status logic correct
- [ ] Full CSV prepared with meter readings
- [ ] Ready for full import!

---

## 📊 Summary of Changes

### What's New:
✅ Meter-based electricity calculation (not manual!)
✅ Auto-calculation of units, electricity, total
✅ Floor auto-detection from room number
✅ Floor filtering in History Manager
✅ Enhanced table with all meter columns
✅ Real-time calculation preview during editing
✅ Update-on-duplicate (not reject)
✅ Defensive negative units handling

### What's Removed:
❌ Manual electricity input
❌ Validation of tenant names
❌ Duplicate rejection (now updates)

---

**You're ready to go! 🎉**

For detailed information, see: `METER_SYSTEM_GUIDE.md`
