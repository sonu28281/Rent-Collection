# 🔐 FIRESTORE INDEX SETUP - REQUIRED

## ⚠️ CRITICAL: This index is REQUIRED for the system to work properly

The meter-based historical import system requires a **composite index** on the `payments` collection to:
- Detect duplicate records efficiently
- Enable fast queries by room and period
- Allow updates on re-import

---

## 📊 REQUIRED INDEX

**Collection**: `payments`

**Fields** (in this exact order):
1. `roomNumber` - **Ascending**
2. `year` - **Ascending**
3. `month` - **Ascending**

**Query Scope**: Collection

---

## 🚀 HOW TO CREATE THE INDEX

### Method 1: Firebase Console (Recommended)

1. **Open Firebase Console**
   - Go to: https://console.firebase.google.com
   - Select your project

2. **Navigate to Firestore**
   - Click "Firestore Database" in left sidebar
   - Click "Indexes" tab at the top

3. **Create Composite Index**
   - Click "+ Create Index" button
   - **Collection ID**: Select `payments`
   - Click "Add field"

4. **Add Fields** (in this exact order):
   
   **Field 1**:
   - Field path: `roomNumber`
   - Order: **Ascending**
   
   **Field 2**:
   - Field path: `year`
   - Order: **Ascending**
   
   **Field 3**:
   - Field path: `month`
   - Order: **Ascending**

5. **Query Scope**
   - Select: **Collection**

6. **Create Index**
   - Click "Create" button
   - Wait 2-5 minutes for index to build
   - Status will change to "Enabled" when ready

---

### Method 2: Using firestore.indexes.json

If you prefer to define indexes in code:

1. Create/update `firestore.indexes.json`:

```json
{
  "indexes": [
    {
      "collectionGroup": "payments",
      "queryScope": "COLLECTION",
      "fields": [
        {
          "fieldPath": "roomNumber",
          "order": "ASCENDING"
        },
        {
          "fieldPath": "year",
          "order": "ASCENDING"
        },
        {
          "fieldPath": "month",
          "order": "ASCENDING"
        }
      ]
    }
  ],
  "fieldOverrides": []
}
```

2. Deploy using Firebase CLI:

```bash
firebase deploy --only firestore:indexes
```

3. Wait for deployment to complete

---

### Method 3: Automatic Creation (Will happen on first query)

When you run your first import, Firestore will show an error with a link to create the index automatically.

**Steps**:
1. Attempt to import a CSV file
2. If index doesn't exist, you'll see an error message
3. Click the link in the error (usually in browser console)
4. Firebase will open with the index pre-configured
5. Click "Create Index"
6. Wait 2-5 minutes for building
7. Retry your import

**Note**: This method works but is least preferred as it interrupts the import process.

---

## 🔍 VERIFY INDEX IS CREATED

### Check in Firebase Console

1. Go to Firestore → Indexes tab
2. Look for index on `payments` collection
3. Status should be "Enabled"
4. Should show 3 fields: roomNumber, year, month

### Check in Code

The first time you run an import query, it should complete without errors about missing indexes.

---

## ❓ WHY THIS INDEX IS NEEDED

### Duplicate Detection Query

The CSV importer uses this query to check for existing records:

```javascript
query(
  collection(db, 'payments'),
  where('roomNumber', '==', 101),
  where('year', '==', 2024),
  where('month', '==', 1)
)
```

Without the composite index, this query will fail with:

```
Error: The query requires an index.
You can create it here: [link]
```

### Performance Benefits

With the index:
- Query time: **< 100ms**
- Import speed: **~100 records/minute**

Without the index:
- Import will **FAIL**
- Cannot detect duplicates
- System unusable

---

## 🎯 INDEX BUILD TIME

Depending on existing data:

| Current Records | Build Time |
|----------------|------------|
| 0 (empty)      | < 30 seconds |
| 1-100          | 1 minute |
| 100-1000       | 2-3 minutes |
| 1000-5000      | 3-5 minutes |
| 5000+          | 5-10 minutes |

**Note**: You can use the system once status shows "Enabled"

---

## ⚠️ COMMON ISSUES

### Issue: Index stays in "Building" status for >10 minutes

**Solution**:
- Refresh the page
- Check Firestore status page
- If persists, delete and recreate index

### Issue: "Index already exists" error

**Solution**:
- Check if similar index exists with different field order
- Delete old index if incorrect
- Create new one with exact field order above

### Issue: Import still fails after index created

**Solution**:
- Verify index status is "Enabled" (not Building)
- Check index has all 3 fields in correct order
- Wait 1 more minute and retry
- Clear browser cache and retry

---

## 📋 CHECKLIST

Before starting imports, verify:

- [ ] Index created in Firebase Console
- [ ] Fields in correct order: roomNumber, year, month
- [ ] All fields set to "Ascending"
- [ ] Query scope is "Collection"
- [ ] Status shows "Enabled" (not Building)
- [ ] Test query completes without error

---

## 🧪 TEST THE INDEX

After creating, test with this simple check:

1. Go to Import CSV page (`/import`)
2. Upload test file with 2-3 rows
3. Click import
4. Should complete without "index required" error

If you see "index required" error:
- Index not created yet, or
- Index still building, or
- Wrong field order/names

---

## 📊 ADDITIONAL RECOMMENDED INDEXES

While not strictly required, these indexes can improve performance:

### Index 2: Room and Year queries
```
Collection: payments
Fields:
  - roomNumber (Ascending)
  - year (Ascending)
```

### Index 3: Year queries with status
```
Collection: payments
Fields:
  - year (Ascending)
  - status (Ascending)
```

These are optional and can be added later based on usage patterns.

---

## ✅ VERIFICATION COMPLETE

Once index is created and enabled:

✅ Index exists in Firebase Console  
✅ Status: Enabled  
✅ Fields: roomNumber, year, month (ascending)  
✅ Test import succeeds  
✅ No "index required" errors  

**You're ready to use the import system!** 🚀

---

## 📞 NEED HELP?

**Index not working?**
1. Check Firebase Console → Indexes tab
2. Verify status is "Enabled"
3. Check field names match exactly (case-sensitive)
4. Delete and recreate if needed

**Still stuck?**
- Review Firestore documentation: https://firebase.google.com/docs/firestore/query-data/indexing
- Check Firebase status page
- Verify Firebase project has sufficient quota

---

**Document**: Firestore Index Setup Guide  
**Required For**: Meter-Based Historical Import System  
**Version**: 1.0  
**Last Updated**: February 13, 2026
