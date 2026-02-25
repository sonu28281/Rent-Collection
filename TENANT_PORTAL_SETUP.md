# 🏠 Tenant Portal Setup Guide

## Step-by-Step Setup Process

### Step 1: Setup Tenants (MUST DO FIRST)
1. Go to **Settings → Setup 2026 Tenants**
2. Verify tenant details are correct:
   - Floor 1: Rooms 101-106 (6 tenants)  
   - Floor 2: Rooms 201-206 (6 tenants)
3. Click **"Floor 1"** button → This creates/updates tenants and generates portal links
4. Click **"Floor 2"** button → Same for Floor 2
5. **Copy the portal links** that appear (one for each tenant)

### Step 2: Share Portal Links
Each tenant gets a unique link like:
```
https://your-domain.com/t/tenant_101_1234567890
```

**How to share:**
- **Option 1:** Use WhatsApp button in Tenants page (automated)
- **Option 2:** Copy link and send via SMS/WhatsApp manually

### Step 3: Tenant Login Process
1. Tenant opens their unique link on mobile/computer
2. Portal shows:
   - Room details
   - Current rent and dues
   - Meter readings
   - Payment history
   - UPI/QR code for payment
3. Tenant makes payment via UPI
4. Tenant informs you after payment

### Step 4: Admin Records Payment
1. Go to **Payments** page
2. Find the tenant's room
3. Click "Record Payment"
4. Enter payment details
5. Save

---

## Common Issues & Solutions

### ❌ Issue: "Invalid access link" error

**Reason:** Tenant not set up yet

**Solution:**
1. Go to Settings → Setup 2026 Tenants
2. Click Floor 1 or Floor 2 button
3. Generate fresh portal links
4. Share new link with tenant

---

### ❌ Issue: Portal shows "Account Inactive"

**Reason:** Tenant marked as inactive in database

**Solution:**
1. Go to **Tenants** page
2. Find the tenant
3. Click Edit
4. Make sure "Active" is checked
5. Save changes
6. Ask tenant to refresh their portal link

---

### ❌ Issue: Tenant can access admin panel

**Reason:** Should NOT happen anymore (security fix applied)

**Security:**
- Tenant portal is completely separate
- No admin access from tenant portal
- Each tenant only sees their own data
- Links are unique and secure

---

## How Tenant Portal Works

### 🔐 Security
```
Tenant Link: /t/{uniqueToken}
              ↓
    Check if token exists in database
              ↓
         Yes: Show tenant portal
         No: Show "Invalid link" error
              ↓
    Check if tenant is active
              ↓
         Yes: Load tenant's data
         No: Show "Inactive account" error
```

### 📊 What Tenant Can See
✅ Their room number and rent
✅ Current and previous meter readings
✅ Total pending dues
✅ Payment history (last 12 months from 2024+)
✅ UPI/QR code for payment

### 🚫 What Tenant CANNOT See
❌ Other tenants' data
❌ Admin panel
❌ Other rooms' information
❌ Financial reports
❌ Settings or configuration

---

## Payment Workflow

### Current System (Manual)
1. Tenant sees dues on portal
2. Tenant pays via UPI/QR code
3. Tenant informs admin "paid"
4. **Admin manually records payment** in Payments page
5. Portal updates to show new status

### Future Enhancement (Auto)
- Add payment verification via UPI API
- Auto-update payment status
- Send confirmation to tenant
- (Requires additional coding)

---

## Testing the Portal

### Test Checklist
- [ ] Run Setup 2026 Tenants for both floors
- [ ] Copy one portal link
- [ ] Open link in incognito/private browser window
- [ ] Verify you see ONLY tenant portal (no admin access)
- [ ] Check if room details are correct
- [ ] Verify meter readings show up
- [ ] Test payment history display
- [ ] Confirm UPI/QR code is visible
- [ ] Try accessing admin URL directly (should redirect to login)

### Sample Test Link
After running setup, you'll get links like:
```
http://localhost:5173/t/tenant_101_1708876543210
```

Open this in private/incognito browser to test as a tenant.

---

## Quick Commands

```bash
# Setup tenants via browser
Settings → Setup 2026 Tenants → Click Floor buttons

# Share links via WhatsApp
Tenants page → Click WhatsApp button on tenant card

# Check if tenant has token
Firebase Console → tenants collection → Find tenant → Check uniqueToken field

# Sync meter readings
Settings → Sync Room Meters → Click Sync button
```

---

## Important Notes

⚠️ **Port
al links are permanent** - Don't share with others
⚠️ **Each tenant has unique token** - Cannot use someone else's link
⚠️ **Setup must be run first** - Otherwise "Invalid link" error
⚠️ **Payments are manual** - Admin must record after tenant pays
⚠️ **Mobile friendly** - Portal works on all devices

---

## Support Contact

If tenant portal issues persist:
1. Check Firebase Console → tenants collection
2. Verify uniqueToken exists for tenant
3. Verify isActive = true
4. Check roomNumber matches rooms collection
5. Re-run Setup 2026 Tenants to regenerate tokens
