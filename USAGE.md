# Callvia Rent Management - User Guide

## 📚 Table of Contents
- [Getting Started](#getting-started)
- [Daily Operations](#daily-operations)
- [Monthly Procedures](#monthly-procedures)
- [Troubleshooting](#troubleshooting)

---

## 🚀 Getting Started

### First Time Setup
1. **Login**: Visit your Netlify URL and login with admin credentials
2. **Settings**: Go to Settings and set your default electricity rate
3. **Bank Account**: Add your primary UPI/bank account with QR code
4. **Rooms**: Verify all 12 rooms are seeded (101-106, 201-206)

### Adding Your First Tenant
1. Navigate to **Tenants** → **Add Tenant**
2. Fill in required details:
   - Name, Phone, Check-in Date
   - Select vacant room
   - Set base rent and security deposit
   - Set annual increase percentage (default 10%)
3. Share tenant portal link: `https://yoursite.netlify.app/t/{uniqueToken}`

---

## 📅 Daily Operations

### Recording Electricity Readings
1. Go to **Electricity** module
2. Click **Add Reading**
3. Select tenant and month
4. Enter previous and current meter readings
5. System auto-calculates units and amount
6. (Optional) Upload meter photo URL
7. Mark as verified
8. This auto-creates/updates monthly record

### Recording Payments
1. Go to **Payments** module
2. View pending payments list
3. Click **Record Payment** for a pending item
4. Enter:
   - Payment date
   - UTR number
   - Select bank account received in
5. Save → Status auto-updates to 'paid'

### Adding Maintenance Records
1. Go to **Maintenance** module
2. Click **Add Record**
3. Select room, enter description, cost, and date
4. (Optional) Add bill photo URL
5. Track total maintenance expenses over time

---

## 📊 Monthly Procedures

### Month-End Checklist
1. **Electricity Readings**: Record for all active tenants
2. **Generate Bills**: monthlyRecords auto-created from readings
3. **Share Portal Links**: Remind tenants to check their portal
4. **Track Payments**: Monitor pending payments
5. **Follow Up**: Contact tenants with overdue payments

### Generating Reports
1. **Export Monthly Data**: Backup → Export Monthly Records CSV
2. **Yearly PDF**: Backup → Select year → Generate PDF report
3. **Tenant List**: Backup → Export Tenants CSV

---

## 🔄 Annual Operations

### Applying Rent Increases
1. Go to **Rent Increase** module
2. Review pending increases list
3. Options:
   - **Apply All**: Bulk increase for all eligible tenants
   - **Apply Individual**: Increase one tenant at a time
4. System auto-updates:
   - currentRent = oldRent × (1 + percentage)
   - nextIncreaseDate = +1 year
5. View history logs for audit trail

---

## 📥 Importing Historical Data

### CSV Import Process
1. Prepare CSV with columns:
   - `tenantName` (must match existing tenant)
   - `roomNumber`, `year`, `month`, `rent`
   - Optional: `electricity`, `extraCharges`, `lateFee`, `status`
2. Go to **Import CSV** module
3. Upload file
4. Review preview (first 5 rows)
5. Click **Import Data**
6. Check summary: success/errors
7. System logs import in `importLogs` collection

**Sample CSV:**
```csv
tenantName,roomNumber,year,month,rent,electricity,status
John Doe,101,2024,1,5000,500,paid
Jane Smith,102,2024,1,6000,600,paid
```

---

## 🏦 Managing Bank Accounts

### Adding Multiple UPI/Bank Accounts
1. Go to **Bank Accounts** module
2. Click **Add Account**
3. Enter:
   - UPI ID (e.g., yourname@upi)
   - Nickname (e.g., "Main GPay")
   - QR code image URL
4. Toggle **Active** status
5. **Note**: Only ONE account can be active at a time
6. Active account shows in:
   - Payment recording dropdown
   - Tenant portal for payments

### Switching Active Account
1. Open account you want to activate
2. Click **Edit**
3. Toggle **Active** to ON
4. Previous active account auto-deactivates

---

## 👥 Tenant Management

### Checking Out a Tenant
1. Go to **Tenants**
2. Find tenant → Click **Edit**
3. Set **Check-out Date**
4. Toggle **Is Active** to OFF
5. Room becomes vacant automatically

### Viewing Tenant Portal (Admin Preview)
- Each tenant has unique token in their record
- Portal URL: `https://yoursite.netlify.app/t/{token}`
- Shows: dues, payment history, active UPI details

---

## 🌐 Multi-Language Support

### Switching Language
- Click language toggle in sidebar footer
- Options: English / हिंदी (Hindi)
- Preference saved in browser
- Affects all UI text across pages

---

## 💾 Backup Strategy

### Recommended Backup Schedule
- **Weekly**: Export tenants + monthly records CSV
- **Monthly**: Generate PDF report for current month
- **Quarterly**: Download all logs from Firebase Console
- **Yearly**: Full database export

### Export Operations
1. **Tenants CSV**: All tenant details
2. **Monthly Records CSV**: Payment history
3. **Yearly PDF**: Summary report with totals

---

## 🔧 Settings Configuration

### Global Settings
- **Default Electricity Rate**: Base rate per unit (₹)
- **Payment Mode**: Manual (current implementation)
- **Reminder Days**: Days before due date to remind
- **Default Language**: EN or HI
- **Annual Increase %**: Default rent increase percentage

### Tenant-Specific Overrides
- Custom electricity rate (overrides global)
- Custom annual increase percentage
- Room-specific agreements

---

## 🚨 Troubleshooting

### "Duplicate Room Assignment" Error
- **Cause**: Room already occupied
- **Solution**: Check out previous tenant first OR assign different room

### "Tenant Not Found" on CSV Import
- **Cause**: Tenant name doesn't match existing record
- **Solution**: Ensure exact name match (case-sensitive)

### "Only One Active Account Allowed"
- **Cause**: Trying to activate second bank account
- **Solution**: System auto-handles, previous account deactivates

### Electricity Reading "Units Negative"
- **Cause**: Current reading < previous reading
- **Solution**: Check meter number, re-enter correct values

### Payment Not Updating Status
- **Cause**: monthlyRecord ID mismatch
- **Solution**: Ensure payment linked to correct monthlyRecord

### Mobile Menu Not Opening
- **Cause**: JavaScript error
- **Solution**: Hard refresh (Ctrl+Shift+R), check console

---

## 📞 Support & Maintenance

### Admin Contact
- **Email**: sonu28281@gmail.com
- **GitHub**: https://github.com/sonu28281/Rent-Collection

### Useful Resources
- **Firebase Console**: https://console.firebase.google.com
- **Netlify Dashboard**: https://app.netlify.com
- **Testing Checklist**: See TESTING.md

---

## 🎯 Best Practices

1. **Regular Backups**: Export data weekly
2. **Verify Entries**: Double-check meter readings before saving
3. **Timely Updates**: Record payments same day
4. **Monitor Logs**: Check rent increase logs for accuracy
5. **Token Security**: Keep tenant portal tokens private
6. **Mobile Testing**: Test all operations on mobile device
7. **Browser Compatibility**: Use Chrome/Firefox for best experience

---

## 🔐 Security Guidelines

- Never share admin login credentials
- Use strong password for Firebase Auth
- Keep Firebase API keys in Netlify env vars only
- Monitor Firebase Auth logs for suspicious activity
- Regular password updates (quarterly)
- Firestore rules restrict write access to admin only

---

**Last Updated**: February 2026  
**Version**: 1.0.0  
**Status**: Production Ready ✅
