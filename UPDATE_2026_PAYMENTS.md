# 2026 Payments को Manually Update करने के Steps

## समस्या
- Jan & Feb 2026 में सभी payments का `paidAmount = 0` है
- Status "paid" है लेकिन actual collection ₹0 है
- Dashboard में गलत data show हो रहा है

## समाधान
Firebase Console से manually update करना होगा क्योंकि Firestore rules script को write permission नहीं देते।

---

## 🔥 Firebase Console से Update करें

### Step 1: Firebase Console खोलें
1. https://console.firebase.google.com/ पर जाएं
2. Project: **rent-collection-5e1d2** select करें
3. Left sidebar से **Firestore Database** click करें

### Step 2: Jan 2026 Payments Update करें
1. **payments** collection में जाएं
2. Filter लगाएं: `year == 2026` और `month == 1`
3. सभी 12 documents में से **हर एक को click करके edit करें:**

**सभी 12 rooms के लिए (Jan 2026):**
- `status`: "paid" (already set)
- `paidAmount`: जो उस room का `rent` + `electricity` है वो set करें
  - Room 101: 3200
  - Room 102: 2500
  - Room 103: 3500
  - Room 104: 3800
  - Room 105: 2500
  - Room 106: 2500
  - Room 201: 3200
  - Room 202: 3000
  - Room 203: 4000
  - Room 204: 4000
  - Room 205: 3800
  - Room 206: 2500
- `paymentDate`: "2026-01-20"
- `paymentMethod`: "cash"

**Jan 2026 Total Expected: ₹38,500** (सभी 12 tenants paid)

### Step 3: Feb 2026 Payments Update करें
1. Filter: `year == 2026` और `month == 2`
2. **11 rooms को PAID mark करें** (सिवाय Room 103 के):

**Rooms 101, 102, 104, 105, 106, 201, 202, 203, 204, 205, 206:**
- `status`: "paid"
- `paidAmount`: उस room का rent amount (ऊपर देखें)
- `paymentDate`: "2026-02-25"
- `paymentMethod`: "cash"

**Room 103 (DK Singh) - ONLY THIS ONE PENDING:**
- `status`: "pending"
- `paidAmount`: 0
- `paymentDate`: null
- `paymentMethod`: null

**Feb 2026 Total Expected: ₹35,000** (11 tenants paid, 1 pending)

---

## ✅ Result After Update

Dashboard में दिखेगा:
```
📊 Year-wise Income:
2026: ₹73,500 (Jan ₹38,500 + Feb ₹35,000)

📅 Monthly Breakdown 2026:
Jan: ₹38,500 (12 payments)
Feb: ₹35,000 (11 payments)

📅 Current Month Summary - Feb 2026:
✅ Paid (11 tenants): ₹35,000
  - Room 101, 102, 104, 105, 106, 201, 202, 203, 204, 205, 206

❌ Pending (1 tenant): ₹3,500
  - Room 103: DK Singh
```

---

## 🚀 Quick Alternative: Bulk Update via Firebase Admin

अगर बहुत सारे records हैं तो ये बेहतर होगा:

### Option 1: Cloud Functions से Update करें
1. Firebase Functions में एक temporary function बनाएं
2. Admin SDK से batch update करें
3. Function delete कर दें

### Option 2: Local Admin Script बनाएं
1. Firebase Admin SDK install करें: `npm install firebase-admin`
2. Service Account JSON download करें Firebase Console से
3. Admin script चलाएं (authentication के साथ)

**मैं Admin SDK वाली script बना सकता हूं अगर आप Service Account JSON provide कर सकें।**

---

## 📝 Important Notes

1. **Backup लें पहले**: Firebase Console में Export Data option use करें
2. **Room numbers verify करें**: कुछ string हैं, कुछ number
3. **Tenant names check करें**: `tenantNameSnapshot` field में सही नाम होना चाहिए
4. **Testing**: एक record update करके पहले test करें, फिर बाकी करें

---

## 🎯 After Update Checklist

- [ ] Dashboard refresh करें - year-wise income correct दिख रहा है?
- [ ] Monthly breakdown check करें - Jan & Feb में सही amounts हैं?
- [ ] Current month summary check करें - 11 paid, 1 pending?
- [ ] Tenant Portal check करें (DK Singh) - due date red में दिख रहा है?
- [ ] History Manager check करें - payments में paidAmount show हो रहा है?

---

## 💡 Prevention for Future

इस issue को future में avoid करने के लिए:
1. Payment record बनाते समय हमेशा `paidAmount` set करें
2. Status "paid" mark करें तो `paidAmount = total` automatically set हो
3. Validation add करें: status=paid but paidAmount=0 नहीं होना चाहिए
