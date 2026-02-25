import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, updateDoc, doc, query, where, orderBy } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyD5pVMjP8mGau6X8cgNPmlaLhev0HbZWes",
  authDomain: "rent-collection-71ecf.firebaseapp.com",
  projectId: "rent-collection-71ecf",
  storageBucket: "rent-collection-71ecf.firebasestorage.app",
  messagingSenderId: "533194923313",
  appId: "1:533194923313:web:7f8e044fa87da6e5db02df"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function updateCheckInDates() {
  try {
    console.log('🔍 Fetching active tenants...\n');
    
    // Get all active tenants
    const tenantsRef = collection(db, 'tenants');
    const tenantsQuery = query(tenantsRef, where('isActive', '==', true));
    const tenantsSnapshot = await getDocs(tenantsQuery);
    
    const updates = [];
    
    for (const tenantDoc of tenantsSnapshot.docs) {
      const tenant = tenantDoc.data();
      const tenantName = tenant.name;
      const roomNumber = tenant.roomNumber;
      
      console.log(`\n👤 Checking: ${tenantName} (Room ${roomNumber})`);
      
      // Check if already has checkInDate
      if (tenant.checkInDate) {
        console.log(`   ✅ Already has checkInDate: ${new Date(tenant.checkInDate).toLocaleDateString('en-IN')}`);
        continue;
      }
      
      // Find first payment record for this tenant
      const paymentsRef = collection(db, 'payments');
      const paymentsQuery = query(
        paymentsRef,
        where('tenantNameSnapshot', '==', tenantName),
        orderBy('year', 'asc'),
        orderBy('month', 'asc')
      );
      
      const paymentsSnapshot = await getDocs(paymentsQuery);
      
      if (paymentsSnapshot.empty) {
        console.log(`   ⚠️  No payment history found`);
        continue;
      }
      
      // Get first payment
      const firstPayment = paymentsSnapshot.docs[0].data();
      const firstYear = firstPayment.year;
      const firstMonth = firstPayment.month;
      
      // Create checkInDate as 1st of that month
      const checkInDate = new Date(firstYear, firstMonth - 1, 1).toISOString();
      
      console.log(`   📅 First payment: ${getMonthName(firstMonth)} ${firstYear}`);
      console.log(`   ✨ Setting checkInDate: ${new Date(checkInDate).toLocaleDateString('en-IN')}`);
      
      updates.push({
        id: tenantDoc.id,
        name: tenantName,
        roomNumber,
        checkInDate,
        firstPayment: `${getMonthName(firstMonth)} ${firstYear}`
      });
    }
    
    console.log('\n' + '='.repeat(60));
    console.log(`\n📊 Summary: Found ${updates.length} tenants to update\n`);
    
    if (updates.length === 0) {
      console.log('✅ All active tenants already have checkInDate!\n');
      process.exit(0);
    }
    
    // Show what will be updated
    console.log('📋 Updates to be applied:\n');
    updates.forEach(u => {
      console.log(`   ${u.name} (Room ${u.roomNumber})`);
      console.log(`   └─ Check-in: ${new Date(u.checkInDate).toLocaleDateString('en-IN')} (First payment: ${u.firstPayment})\n`);
    });
    
    // Ask for confirmation
    console.log('⚠️  This will update the database. Continue? (yes/no)');
    
    // For script execution, auto-confirm
    const autoConfirm = process.argv.includes('--confirm');
    
    if (!autoConfirm) {
      console.log('\n💡 Run with --confirm flag to auto-confirm');
      console.log('   Example: node scripts/update_checkin_dates.js --confirm\n');
      process.exit(0);
    }
    
    console.log('\n🚀 Updating database...\n');
    
    // Apply updates
    for (const update of updates) {
      const tenantRef = doc(db, 'tenants', update.id);
      await updateDoc(tenantRef, {
        checkInDate: update.checkInDate
      });
      console.log(`   ✅ Updated: ${update.name}`);
    }
    
    console.log(`\n✅ Successfully updated ${updates.length} tenants!\n`);
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error(error);
  }
  
  process.exit(0);
}

function getMonthName(monthNum) {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return months[monthNum - 1] || monthNum;
}

updateCheckInDates();
