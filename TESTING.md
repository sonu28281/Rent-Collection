# Autoxweb Rent Management - Testing Checklist

## 🚀 Pre-Deployment Testing

### Phase 1: Authentication & Authorization ✅
- [ ] Admin login with correct credentials (sonu28281@gmail.com)
- [ ] Login fails with incorrect password
- [ ] Password reset email sends successfully
- [ ] Protected routes redirect to login when not authenticated
- [ ] Logout clears session and redirects to login

### Phase 2: Rooms Management ✅
- [ ] All 12 rooms display correctly (101-106, 201-206)
- [ ] Room status updates (occupied/vacant)
- [ ] Floor grouping works correctly
- [ ] Mobile responsiveness verified

### Phase 3: Tenants CRUD ✅
- [ ] Create new tenant with all required fields
- [ ] Assign tenant to vacant room
- [ ] Prevent duplicate room assignment
- [ ] Edit tenant details successfully
- [ ] Mark tenant as inactive (checkout)
- [ ] Generate unique token for tenant portal
- [ ] Search and filter tenants work correctly
- [ ] Mobile form layout is usable

### Phase 4: Tenant Portal ✅
- [ ] Access portal via /t/:token route
- [ ] Tenant sees their room and personal details
- [ ] View payment history correctly
- [ ] See pending dues if any
- [ ] Active UPI/bank details display with QR code
- [ ] Token validation prevents unauthorized access
- [ ] Works on mobile devices

### Phase 5: Electricity Module ✅
- [ ] Set global electricity rate in settings
- [ ] Override electricity rate per tenant
- [ ] Record meter readings (previous + current)
- [ ] Units calculate correctly (current - previous)
- [ ] Total amount = units × rate
- [ ] monthlyRecord auto-created/updated
- [ ] Photo URL field present (future storage)
- [ ] Verification status toggle works

### Phase 6: Payments Module ✅
- [ ] View pending payments list
- [ ] Record payment with UTR number
- [ ] Select bank account for payment
- [ ] Payment updates monthlyRecord status to 'paid'
- [ ] Recent payments history displays
- [ ] Payment date recorded correctly
- [ ] Amount matches monthlyRecord total

### Phase 7: Annual Rent Increase ✅
- [ ] Check pending increases shows correct tenants
- [ ] Days past due calculated accurately
- [ ] Apply single rent increase updates currentRent
- [ ] nextIncreaseDate set to +1 year
- [ ] Percentage applied correctly (default 10%)
- [ ] Bulk apply processes all eligible tenants
- [ ] Logs created in logs collection
- [ ] Success/failure tracking works
- [ ] Recent history displays correctly

### Phase 8: Internationalization ✅
- [ ] Language switcher appears in sidebar
- [ ] Toggle between English and Hindi
- [ ] Language preference persists (localStorage)
- [ ] All translated UI elements update
- [ ] Works across all pages

### Phase 9: Bank Accounts ✅
- [ ] Add new UPI/bank account
- [ ] Edit account details
- [ ] Delete account (if not in use)
- [ ] Toggle active status
- [ ] Only one account can be active at a time
- [ ] QR code image URL saved correctly
- [ ] Active account shows in payment form
- [ ] Active account visible in tenant portal

### Phase 10: CSV Import ✅
- [ ] Upload CSV file successfully
- [ ] Preview shows first 5 rows
- [ ] Required columns validated (tenantName, roomNumber, year, month, rent)
- [ ] Tenant name mapping works
- [ ] Duplicate records detected and skipped
- [ ] Import summary shows success/error counts
- [ ] Error details list specific row issues
- [ ] Import log created in importLogs collection

### Phase 11: Backup & Export ✅
- [ ] Export tenants to CSV downloads file
- [ ] Export monthlyRecords to CSV works
- [ ] Generate yearly PDF for specific year
- [ ] PDF includes all monthly records
- [ ] PDF summary shows total collected
- [ ] File downloads trigger correctly
- [ ] Data format is correct in exports

### Additional: Maintenance Module ✅
- [ ] Add maintenance record with room, description, cost, date
- [ ] View all maintenance records
- [ ] Total maintenance cost calculates correctly
- [ ] Records display in chronological order

---

## 🔒 Security Testing

- [ ] Firebase API keys in environment variables (not hardcoded)
- [ ] Firestore rules prevent unauthorized access
- [ ] Admin-only operations require authentication
- [ ] Tenant portal isolated by unique token
- [ ] No sensitive data exposed in client code
- [ ] HTTPS enforced on Netlify

---

## 📱 Mobile Responsiveness

- [ ] Login page mobile-friendly
- [ ] Sidebar collapses to hamburger menu
- [ ] Dashboard stats stack vertically
- [ ] Tables scroll horizontally on small screens
- [ ] Forms fit within viewport
- [ ] Buttons easily tappable (min 44px)
- [ ] Modals display properly
- [ ] Tenant portal optimized for mobile

---

## 🚨 Error Handling

- [ ] Network errors show user-friendly messages
- [ ] Form validation prevents invalid submissions
- [ ] Loading states shown during async operations
- [ ] Failed operations allow retry
- [ ] Firebase errors caught and logged
- [ ] 404 routes redirect to dashboard

---

## ⚡ Performance

- [ ] Initial page load < 3 seconds
- [ ] Firestore queries optimized (indexes if needed)
- [ ] No unnecessary re-renders
- [ ] Images lazy-loaded where applicable
- [ ] Build size reasonable (check dist/)

---

## 🎨 UI/UX

- [ ] Consistent color scheme (Tailwind)
- [ ] Icons used appropriately (emoji fallback)
- [ ] Loading spinners on async operations
- [ ] Success/error messages clear
- [ ] Confirmation dialogs for destructive actions
- [ ] Accessible (keyboard navigation, aria labels)

---

## 🌐 Deployment

- [ ] Netlify build succeeds without errors
- [ ] Environment variables set in Netlify
- [ ] Custom domain configured (if applicable)
- [ ] HTTPS certificate active
- [ ] Redirects work correctly (SPA routing)
- [ ] Build time < 2 minutes

---

## 📝 Documentation

- [ ] README.md complete with setup instructions
- [ ] .env.example has all required variables
- [ ] FIRESTORE_SETUP.md accurate
- [ ] NETLIFY_SETUP.md up to date
- [ ] Inline code comments where needed

---

## ✅ Final Checks

- [ ] All 12 phases completed
- [ ] No console errors in browser
- [ ] No TypeScript/ESLint warnings
- [ ] Git history clean and organized
- [ ] Version tagged (v1.0.0)
- [ ] Production URL accessible
- [ ] Admin credentials secure

---

## 🐛 Known Issues / Future Enhancements

- [ ] File storage: Currently stores URLs only (future: Google Drive integration)
- [ ] Real-time updates: Consider Firebase realtime listeners
- [ ] Notifications: Email/SMS reminders for due dates
- [ ] Analytics: Track payment trends, occupancy rates
- [ ] Automated backups: Schedule weekly exports
- [ ] Multi-tenancy: Support multiple properties

---

**Date Tested:** _____________  
**Tested By:** _____________  
**Environment:** _____________  
**Status:** ⬜ Pass | ⬜ Fail | ⬜ Partial

---

**Notes:**
