# Room Occupancy Status Management System

## Overview

The system now includes a comprehensive Room Occupancy Status management feature that allows administrators to track and manage room occupancy independently from payment records. This ensures accurate room availability tracking for better property management.

---

## 🎯 Key Features

### 1. **Persistent Room-Level Status**
- Status stored in `rooms` collection, NOT in payments
- Two states: `filled` | `vacant`
- Default: `vacant` when room is created

### 2. **Automatic Status Updates**
- ✅ **Tenant Assigned**: Room status → `filled`
- ❌ **Tenant Checkout**: Room status → `vacant`
- 🔄 **Room Changed**: Old room → `vacant`, New room → `filled`

### 3. **Manual Status Control**
- Individual room status update via modal
- Optional remark field for tracking reasons
- Audit logging in `roomStatusLogs` collection

### 4. **Bulk Status Updates**
- Select multiple rooms with checkboxes
- Bulk mark as `Vacant` or `Filled`
- Batch updates with Firestore batch writes
- Individual audit logs for each room

### 5. **CSV Import Integration**
- Optional `Room Status` column in CSV imports
- Automatic enforcement: vacant rooms → all amounts = 0
- Room status updates from CSV data

---

## 📊 Database Schema Changes

### **rooms Collection** (Updated)

```javascript
{
  roomNumber: number,            // Existing
  floor: number,                 // Existing
  defaultRent: number,           // Existing
  electricityMeterNo: string,    // Existing
  
  // NEW FIELDS
  status: "filled" | "vacant",   // Room occupancy status
  lastStatusUpdatedAt: timestamp, // When status was last changed
  lastStatusUpdatedBy: string,   // User ID who made the change
  currentTenantId: string | null // Current tenant ID (if filled)
}
```

### **roomStatusLogs Collection** (New)

```javascript
{
  roomId: string,           // Room document ID
  roomNumber: number,       // Room number for easy reference
  oldStatus: string,        // Previous status
  newStatus: string,        // New status
  changedBy: string,        // User ID who made the change
  changedByEmail: string,   // User email for audit
  changedAt: timestamp,     // When the change occurred
  remark: string | null     // Optional note about the change
}
```

### **payments Collection** (Updated)

```javascript
{
  // Existing fields...
  
  // NEW FIELD
  roomStatus: "filled" | "vacant" | null  // Room status snapshot at import time
}
```

---

## 🚀 Usage Guide

### **For Existing Systems: Run Migration**

If you have existing rooms in your database, run the migration script to add status fields:

```bash
npm run migrate:room-status
```

This script will:
- ✅ Add `status`, `lastStatusUpdatedAt`, `lastStatusUpdatedBy` to all rooms
- ✅ Auto-detect occupied rooms based on active tenants
- ✅ Set `filled` for occupied rooms, `vacant` for empty rooms
- ✅ Skip already migrated rooms

---

## 💡 Admin Interface Features

### **Rooms Page**

#### **1. Statistics Dashboard**
- **Total Rooms**: Count of all rooms
- **Vacant Rooms**: Count of available rooms (grey badge)
- **Filled Rooms**: Count of occupied rooms (green badge)

#### **2. Filter Options**
- All Rooms
- Vacant Only
- Filled Only

#### **3. Room Table Columns**
| Column | Description |
|--------|-------------|
| Checkbox | Select for bulk actions |
| Room | Room number |
| Floor | Floor number |
| **Status** | 🆕 Badge showing Vacant/Filled |
| Default Rent | Base rent amount |
| Meter No | Electricity meter number |
| Last Updated | When status was last changed |
| Actions | Update Status button |

#### **4. Individual Status Update**
1. Click **"Update Status"** button on any room
2. Modal opens with:
   - Dropdown: Select `Vacant` or `Filled`
   - Remark field (optional notes)
   - Current vs New status comparison
3. Click **"Save Status"**
4. Room status updated + audit log created

#### **5. Bulk Status Update**
1. Select multiple rooms using checkboxes
2. **Select All** checkbox to select all visible rooms
3. Bulk action buttons appear:
   - **Mark as Vacant**: Set all selected to vacant
   - **Mark as Filled**: Set all selected to filled
   - **Clear Selection**: Deselect all
4. Confirmation prompt shows count
5. All rooms updated in batch
6. Individual audit logs created

---

## 📥 CSV Import with Room Status

### **Supported Column Names**

Any of these column headers will map to room status:
- `Room Status`
- `Status`
- `status`
- `Occupancy`
- `occupancy`

### **Valid Values**

| CSV Value | Mapped To |
|-----------|-----------|
| `filled` | filled |
| `occupied` | filled |
| `fill` | filled |
| `vacant` | vacant |
| `empty` | vacant |

### **Automatic Enforcement Rules**

When `Room Status = vacant` in CSV:

```javascript
{
  rent: 0,              // Forced to 0
  oldReading: 0,        // Forced to 0
  currentReading: 0,    // Forced to 0
  paidAmount: 0,        // Forced to 0
  units: 0,             // Calculated as 0
  electricity: 0,       // Calculated as 0
  total: 0              // Calculated as 0
}
```

### **Example CSV Row**

```csv
Room No.,Tenant Name,Year,Month,Date,Rent,Reading (Prev.),Reading (Curr.),Price/Unit,Paid,Room Status
101,John Doe,2024,1,2024-01-05,5000,100,150,8,5400,filled
102,Jane Smith,2024,1,2024-01-05,5000,200,250,8,5400,filled
103,Empty Room,2024,1,,0,0,0,0,0,vacant
```

---

## 📜 History Manager Integration

### **New Column: Room Status**

The History Manager now displays room status for each payment record:

- **⬜ Vacant**: Grey badge
- **✅ Filled**: Green badge
- **-**: No status data (old records)

This helps identify which records were for vacant vs occupied rooms at the time of the payment.

---

## 🔄 Automatic Status Change Workflows

### **Scenario 1: New Tenant Assignment**

**Action:** Admin adds new tenant in Tenants page

**Automatic Updates:**
1. ✅ Tenant created in `tenants` collection
2. ✅ Room status → `filled`
3. ✅ `currentTenantId` set
4. ✅ Audit log created with remark: "Tenant assigned"

---

### **Scenario 2: Tenant Checkout**

**Action:** Admin sets tenant as inactive

**Automatic Updates:**
1. ✅ Tenant `isActive` → false
2. ✅ Room status → `vacant`
3. ✅ `currentTenantId` → null
4. ✅ Audit log created with remark: "Tenant removed/checkout"

---

### **Scenario 3: Tenant Room Change**

**Action:** Admin changes tenant's room number

**Automatic Updates:**
1. ✅ Old room status → `vacant`
2. ✅ Old room `currentTenantId` → null
3. ✅ New room status → `filled`
4. ✅ New room `currentTenantId` set
5. ✅ Two audit logs created (one for each room)

---

## 🛡️ Backward Compatibility

### **Old CSV Files**
- Files without `Room Status` column work perfectly
- Existing room status unchanged
- Old behavior preserved

### **Existing Rooms**
- Run migration script to add new fields
- All existing functionality preserved
- No breaking changes

### **Old Payment Records**
- Records without `roomStatus` field display "-" in History Manager
- All calculations and displays work normally

---

## 🔍 Audit Trail

Every status change is logged in `roomStatusLogs`:

```javascript
{
  roomId: "room_doc_id",
  roomNumber: 101,
  oldStatus: "vacant",
  newStatus: "filled",
  changedBy: "user_uid",
  changedByEmail: "admin@example.com",
  changedAt: Timestamp,
  remark: "Tenant assigned" // or custom remark
}
```

**Use Cases:**
- Track who changed room status and when
- Understand occupancy history
- Debug status inconsistencies
- Generate occupancy reports

---

## 🎨 UI/UX Highlights

### **Status Badges**

**Vacant (Grey):**
```
⬜ Vacant
```
- Background: `bg-gray-100`
- Text: `text-gray-800`

**Filled (Green):**
```
✅ Filled
```
- Background: `bg-green-100`
- Text: `text-green-800`

### **Bulk Actions Bar**

When rooms are selected:
```
┌──────────────────────────────────────────────────┐
│ 3 room(s) selected                                │
│ [Mark as Vacant] [Mark as Filled] [Clear]        │
└──────────────────────────────────────────────────┘
```

### **Status Modal**

```
┌─────────────────────────────────┐
│ Update Room 101 Status          │
├─────────────────────────────────┤
│ Status: [Dropdown: Vacant/Filled]│
│                                  │
│ Remark (Optional):               │
│ [Text area for notes...]         │
│                                  │
│ Current Status: vacant           │
│ New Status: filled               │
├─────────────────────────────────┤
│      [Cancel]  [Save Status]     │
└─────────────────────────────────┘
```

---

## 🚨 Important Notes

### **Status is NOT Payment-Derived**
- Room status is independent of payment records
- A room can be marked `vacant` even if payments exist
- Payment history is preserved regardless of status

### **CSV Import Enforcement**
- When CSV sets status = `vacant`, all amounts forced to 0
- This is defensive to prevent data inconsistencies
- Override by manually editing room status after import

### **Bulk Updates**
- Uses Firestore batch writes for efficiency
- All updates succeed or all fail (transactional)
- Individual audit logs created for each room

### **Migration Safety**
- Migration script is idempotent (can run multiple times)
- Skips already-migrated rooms
- Auto-detects occupied rooms from active tenants

---

## 📊 Statistics & Reporting

Room occupancy statistics are automatically calculated:

```javascript
{
  total: 12,
  vacant: 5,
  filled: 7
}
```

**Occupancy Rate:**
```
(filled / total) × 100 = (7/12) × 100 = 58.33%
```

---

## 🔧 Technical Implementation

### **Room Status Update Function**

```javascript
async function updateRoomStatus(roomId, newStatus, remark = '') {
  // Update room document
  await updateDoc(doc(db, 'rooms', roomId), {
    status: newStatus,
    lastStatusUpdatedAt: serverTimestamp(),
    lastStatusUpdatedBy: auth.currentUser?.uid
  });

  // Create audit log
  await addDoc(collection(db, 'roomStatusLogs'), {
    roomId,
    roomNumber: room.roomNumber,
    oldStatus: room.status,
    newStatus,
    changedBy: auth.currentUser?.uid,
    changedByEmail: auth.currentUser?.email,
    changedAt: serverTimestamp(),
    remark
  });
}
```

### **Bulk Update Implementation**

```javascript
async function bulkUpdateStatus(roomIds, newStatus) {
  const batch = writeBatch(db);
  
  roomIds.forEach(roomId => {
    batch.update(doc(db, 'rooms', roomId), {
      status: newStatus,
      lastStatusUpdatedAt: serverTimestamp(),
      lastStatusUpdatedBy: auth.currentUser?.uid
    });
  });
  
  await batch.commit();
  
  // Create individual audit logs
  await Promise.all(roomIds.map(roomId => 
    addDoc(collection(db, 'roomStatusLogs'), {...})
  ));
}
```

---

## ✅ System Ready Checklist

- [ ] Run migration script: `npm run migrate:room-status`
- [ ] Verify all rooms have `status` field
- [ ] Test individual room status update
- [ ] Test bulk status update
- [ ] Test CSV import with Room Status column
- [ ] Verify History Manager shows status column
- [ ] Check audit logs in `roomStatusLogs` collection
- [ ] Test tenant assignment auto-updates
- [ ] Test tenant checkout auto-updates
- [ ] Verify backward compatibility with old CSVs

---

## 🎓 Best Practices

1. **Always add remarks** when manually changing status
2. **Review audit logs** regularly for consistency
3. **Use bulk updates** for efficiency when possible
4. **Include Room Status** in CSV imports for accurate tracking
5. **Run migration** before using new features
6. **Verify status** after tenant assignments/checkouts

---

## 📞 Support

For issues or questions:
1. Check `roomStatusLogs` collection for audit trail
2. Verify room document has all required fields
3. Run migration script if fields are missing
4. Review console logs for error messages

---

**Last Updated:** February 25, 2026
**Version:** 2.0
