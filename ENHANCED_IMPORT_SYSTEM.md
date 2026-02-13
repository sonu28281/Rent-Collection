# Enhanced Import System - Balance Tracking & Logs

## Overview

The enhanced import system extends the existing meter-based CSV import with:
- **Balance tracking**: Automatic calculation of dues/advances
- **Debit/Credit notation**: Manual D/C field for accounting
- **Remarks**: Custom notes per payment record
- **Import logs**: Complete audit trail of all imports

---

## New Fields

### 1. Balance (Auto-calculated)
- **Type**: Number
- **Formula**: `balance = total - paidAmount`
- **Purpose**: Track outstanding dues or advance payments
- **Display**: Color-coded (red for due, green for advance)

### 2. Balance Type (Auto-calculated)
- **Type**: Enum - `"due"` | `"advance"` | `"settled"`
- **Logic**:
  - `balance > 0` → `"due"` (tenant owes money)
  - `balance < 0` → `"advance"` (tenant paid extra)
  - `balance === 0` → `"settled"` (fully paid)
- **Display**: Badge with color coding

### 3. Debit/Credit (Manual)
- **Type**: String | null
- **CSV Columns**: `Debit/Credit`, `D/C`, `Debit Credit`, `DebitCredit`
- **Purpose**: Manual accounting notation (e.g., "DR", "CR")
- **Editable**: Yes, via inline editing

### 4. Remark (Manual)
- **Type**: String | null
- **CSV Columns**: `Remark`, `Remarks`, `Note`, `Notes`, `Comment`, `Comments`
- **Purpose**: Custom notes about the payment
- **Editable**: Yes, via inline editing

---

## CSV Format

### Enhanced CSV Template

```csv
Room No.,Tenant Name,Year,Month,Date,Rent,Reading (Prev.),Reading (Curr.),Price/Unit,Paid,Payment Mode,Debit/Credit,Remark
101,John Doe,2024,1,2024-01-05,5000,100,150,8.5,5425,cash,,Full payment
102,Jane Smith,2024,1,2024-01-10,4500,80,120,8.5,4900,bank,CR,Advance for next month
103,Bob Jones,2024,1,2024-01-15,6000,200,250,8.5,6000,cash,DR,Pending electricity
```

### Column Mapping (Flexible)

The system accepts multiple column name variations:

| Field | Accepted CSV Headers |
|-------|---------------------|
| Room Number | `Room No.`, `Room Number`, `Room`, `RoomNo` |
| Tenant Name | `Tenant Name`, `Tenant`, `Name` |
| Year | `Year` |
| Month | `Month` |
| Date | `Date`, `Payment Date`, `PaymentDate` |
| Rent | `Rent`, `Monthly Rent`, `Rent Amount` |
| Old Reading | `Reading (Prev.)`, `Previous Reading`, `Old Reading` |
| Current Reading | `Reading (Curr.)`, `Current Reading`, `New Reading` |
| Price/Unit | `Price/Unit`, `Rate`, `Unit Price`, `Electricity Rate` |
| Paid Amount | `Paid`, `Amount Paid`, `Paid Amount`, `Payment` |
| Payment Mode | `Payment Mode`, `Mode`, `Method` |
| **Debit/Credit** | `Debit/Credit`, `D/C`, `Debit Credit`, `DebitCredit` |
| **Remark** | `Remark`, `Remarks`, `Note`, `Notes`, `Comment`, `Comments` |

---

## Components

### 1. ImportCSV Component
**Path**: `/src/components/ImportCSV.jsx`

**Features**:
- CSV file upload with preview
- Enhanced column mapping for new fields
- Balance calculation during preview
- 19-column preview table: Room, Tenant, Year, Month, Date, Rent, Old, Cur, Units, $/U, Elec, Total, Paid, Balance, Bal Type, D/C, Remark, Mode, Status

**Usage**:
1. Click "📥 Import CSV" in sidebar
2. Upload CSV file
3. Preview shows calculated balance and type
4. Review warnings/errors
5. Click "Import to Firestore"

### 2. FinancialHistoryManager Component
**Path**: `/src/components/FinancialHistoryManager.jsx`

**Features**:
- Yearly view of all payment records
- Color-coded balance display (red=due, green=advance)
- Inline editing for Debit/Credit and Remark fields
- Auto-recalculation on edit

**Usage**:
1. Click "📊 Financial History" in sidebar
2. Select year from dropdown
3. View all records with balance columns
4. Click any D/C or Remark cell to edit
5. Balance recalculates automatically on save

### 3. ImportLogsPage Component (NEW)
**Path**: `/src/components/ImportLogsPage.jsx`

**Features**:
- Complete audit trail of imports and backups
- Shows timestamp, type, user, summary stats
- Modal view for detailed warnings/errors
- Download error rows as CSV
- Supports both "CSV Import" and "Backup & Reset" operations

**Usage**:
1. Click "📋 Import Logs" in sidebar
2. View chronological list of all operations
3. Click "Details" to see full import summary
4. Click "Download Errors" for problematic rows (if any)

---

## Data Flow

### Import Process

```
CSV File Upload
    ↓
Papa Parse (column mapping)
    ↓
Calculate: units = currentReading - oldReading
Calculate: electricity = units × pricePerUnit
Calculate: total = rent + electricity
Calculate: balance = total - paidAmount
Calculate: balanceType = (balance > 0 ? "due" : balance < 0 ? "advance" : "settled")
Extract: debitCredit, remark (if present)
    ↓
Preview Table (19 columns)
    ↓
Firestore Batch Write (payments collection)
    ↓
Log Entry (importLogs collection)
```

### Edit Process

```
User clicks D/C or Remark cell
    ↓
Input field appears
    ↓
User enters value → Save
    ↓
Firestore Update
    ↓
Recalculate: balance = total - paidAmount
Recalculate: balanceType (based on balance)
    ↓
Update Firestore with new balance/balanceType
    ↓
UI refreshes with color-coded display
```

---

## Database Schema

### Collection: `payments`

```javascript
{
  roomNumber: string,          // e.g., "101"
  tenantName: string,           // e.g., "John Doe"
  year: number,                 // e.g., 2024
  month: number,                // 1-12
  date: string,                 // ISO format "2024-01-05"
  rent: number,                 // Monthly rent
  oldReading: number,           // Previous meter reading
  currentReading: number,       // Current meter reading
  units: number,                // currentReading - oldReading
  pricePerUnit: number,         // Rate per electricity unit
  electricity: number,          // units × pricePerUnit
  total: number,                // rent + electricity
  paidAmount: number,           // Amount tenant paid
  paymentMode: string,          // "cash", "upi", "bank", etc.
  status: string,               // "paid" or "unpaid"
  
  // NEW FIELDS
  balance: number,              // total - paidAmount (auto-calculated)
  balanceType: string,          // "due", "advance", or "settled" (auto-calculated)
  debitCredit: string | null,   // Manual D/C notation
  remark: string | null,        // Custom notes
  
  createdAt: timestamp,
  updatedAt: timestamp
}
```

### Collection: `importLogs`

```javascript
{
  timestamp: timestamp,
  type: "csv_import" | "backup_and_reset",
  userId: string,
  userName: string,
  
  // For CSV imports
  fileName?: string,
  summary?: {
    totalRecords: number,
    successfulRecords: number,
    failedRecords: number,
    recordsByRoom: { [roomNumber]: count }
  },
  warnings?: [
    { row: number, message: string },
    ...
  ],
  errors?: [
    { row: number, message: string },
    ...
  ],
  errorRows?: [
    { ...rowData },
    ...
  ],
  
  // For backups
  backupInfo?: {
    totalRecordsBackedUp: number,
    collectionName: string,
    backupFilePath: string
  }
}
```

### Required Indexes

```javascript
// Composite indexes for Firestore
payments: [
  { fields: ["roomNumber", "year", "month"], order: "asc" },
  { fields: ["year", "month"], order: "asc" }
]

importLogs: [
  { fields: ["timestamp"], order: "desc" }
]
```

---

## Balance Calculation Examples

### Example 1: Fully Paid
```
Rent: 5000
Electricity: 425 (50 units × 8.5)
Total: 5425
Paid: 5425
Balance: 0
Balance Type: "settled"
```

### Example 2: Partial Payment (Due)
```
Rent: 5000
Electricity: 340 (40 units × 8.5)
Total: 5340
Paid: 5000
Balance: 340
Balance Type: "due"
Display: Red text "₹340"
```

### Example 3: Overpayment (Advance)
```
Rent: 4500
Electricity: 340 (40 units × 8.5)
Total: 4840
Paid: 4900
Balance: -60
Balance Type: "advance"
Display: Green text "₹60"
```

---

## UI Features

### Preview Table (ImportCSV)
- **19 Columns**: Room, Tenant, Year, Month, Date, Rent, Old, Cur, Units, $/U, Elec, Total, Paid, Balance, Bal Type, D/C, Remark, Mode, Status
- **Color Coding**: Balance column (red text for due, green for advance)
- **Responsive**: Horizontal scroll for narrow screens
- **Validation**: Missing required fields highlighted

### Financial History Table
- **Inline Editing**: Click D/C or Remark cells to edit
- **Auto-save**: Changes saved immediately to Firestore
- **Real-time Balance**: Recalculates on every edit
- **Badge Display**: Balance Type shown as colored badge
- **Filters**: Year selection dropdown

### Import Logs Page
- **Table View**: Chronological list (newest first, limit 50)
- **Type Icons**: Different emoji for CSV imports vs backups
- **Summary Stats**: Total/Success/Failed counts in table
- **Details Modal**: Full warnings/errors list
- **Error Export**: Download problematic rows as CSV
- **Timestamp**: Human-readable date/time display

---

## Testing

### Test CSV File
**Path**: `/data/test_import_excel_format.csv`

Contains 9 test records with:
- Mixed balance scenarios (due, advance, settled)
- Sample Debit/Credit notations (DR, CR)
- Various remark examples
- Multiple tenants and rooms

### Test Workflow

1. **Backup existing data**:
   - Navigate to "🚨 Payments Reset"
   - Click "Backup & Reset" if needed

2. **Import test CSV**:
   - Go to "📥 Import CSV"
   - Upload `/data/test_import_excel_format.csv`
   - Verify preview shows balance calculations
   - Check D/C and Remark columns populated

3. **View Financial History**:
   - Go to "📊 Financial History"
   - Select year 2024
   - Verify balance column color coding
   - Test inline editing of D/C and Remark fields

4. **Check Import Logs**:
   - Go to "📋 Import Logs"
   - Verify latest import appears
   - Click "Details" to see summary
   - Confirm no errors (or download error CSV if any)

---

## Best Practices

### For CSV Preparation
1. Include all required columns (Room, Tenant, Year, Month, etc.)
2. Use consistent date format (YYYY-MM-DD)
3. Ensure numeric fields are valid numbers
4. Add D/C and Remark columns for audit trail
5. Test with small batch first

### For Data Entry
1. **Partial Payments**: Enter actual paid amount, system calculates balance
2. **Advance Payments**: Enter paid > total, balance shows as advance
3. **Debit/Credit**: Use standard notation (DR, CR, or descriptive text)
4. **Remarks**: Add context for unusual payments (e.g., "Late payment adjusted")

### For Auditing
1. Check Import Logs after each operation
2. Review error CSV files for failed imports
3. Monitor balance types for outstanding dues
4. Use Financial History for monthly reconciliation

---

## Troubleshooting

### Issue: Balance not calculating
- **Cause**: Missing total or paidAmount values
- **Solution**: Verify CSV has valid numeric values for Rent, Electricity readings, and Paid columns

### Issue: Debit/Credit not importing
- **Cause**: CSV column name mismatch
- **Solution**: Use one of the supported headers: `Debit/Credit`, `D/C`, `Debit Credit`, `DebitCredit`

### Issue: Import Logs not showing
- **Cause**: Firestore rules or missing importLogs collection
- **Solution**: Check Firebase console, ensure importLogs collection exists with proper indexes

### Issue: Inline edit not saving
- **Cause**: Firestore update failing or balance recalculation error
- **Solution**: Check browser console for errors, verify Firestore connection

---

## API Reference

### calculateRecordData(row, columnMapping, fileName)
**Location**: `ImportCSV.jsx`

Processes CSV row into Firestore document:
- Maps CSV columns to database fields
- Calculates units, electricity, total
- Computes balance and balanceType
- Extracts debitCredit and remark if present

**Returns**: `{ data, error, rowData }`

### handleSaveEdit(id, field, value)
**Location**: `FinancialHistoryManager.jsx`

Updates payment record with new field value:
- Validates input
- Saves to Firestore
- Recalculates balance and balanceType
- Updates local state

**Parameters**:
- `id`: Document ID
- `field`: "debitCredit" | "remark"
- `value`: New field value (string)

### downloadErrorsCSV(errorRows)
**Location**: `ImportLogsPage.jsx`

Generates CSV file from error rows:
- Extracts all field keys
- Formats data as CSV
- Triggers browser download

**Parameters**:
- `errorRows`: Array of error row objects

---

## Migration Guide

### From Basic Import to Enhanced Import

1. **Update CSV template** to include new columns:
   ```csv
   ...,Paid,Payment Mode,Debit/Credit,Remark
   ```

2. **No schema migration needed** - existing records work fine:
   - Old records: `balance`, `balanceType`, `debitCredit`, `remark` will be `null` or auto-calculated on first edit
   - New imports: All fields populated automatically

3. **Recalculate existing balances** (optional):
   ```javascript
   // Run in browser console or script
   const payments = await getDocs(collection(db, 'payments'));
   payments.forEach(async doc => {
     const data = doc.data();
     const balance = data.total - data.paidAmount;
     const balanceType = balance > 0 ? 'due' : balance < 0 ? 'advance' : 'settled';
     await updateDoc(doc.ref, { balance, balanceType });
   });
   ```

---

## Future Enhancements

Potential additions for v3:
- [ ] Balance aging report (30/60/90 days overdue)
- [ ] Automated reminder emails for dues
- [ ] Payment plan tracking for large balances
- [ ] Bulk remark updates via CSV
- [ ] Export Financial History with custom filters
- [ ] Chart visualization of advance vs due trends

---

## Version History

### v2.1 (Current) - Enhanced Import System
- ✅ Balance tracking (auto-calculated)
- ✅ Balance Type badges (due/advance/settled)
- ✅ Debit/Credit field (manual entry)
- ✅ Remark field (manual notes)
- ✅ Import Logs page with audit trail
- ✅ Inline editing in Financial History
- ✅ Error CSV download
- ✅ Enhanced test CSV

### v2.0 - Meter-Based System
- Meter reading import
- Electricity calculation
- Financial history view
- Backup & reset functionality

### v1.0 - Basic System
- Manual payment tracking
- Room management
- Tenant management

---

**Documentation Complete** ✓

For additional help, see:
- `QUICK_START_METER.md` - Quick start guide
- `METER_SYSTEM_GUIDE.md` - Full system documentation
- `DATABASE_SCHEMA_V2.0.md` - Database structure reference
