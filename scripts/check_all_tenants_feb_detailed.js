import { initializeApp } from 'firebase/app';
import { getFirestore, collection, query, where, getDocs } from 'firebase/firestore';

// Firebase config
const firebaseConfig = {
  apiKey: "AIzaSyBYIe89b-VpT8i1wTtaUfpEVoTBkDj-66E",
  authDomain: "rent-collection-5e1d2.firebaseapp.com",
  projectId: "rent-collection-5e1d2",
  storageBucket: "rent-collection-5e1d2.firebasestorage.app",
  messagingSenderId: "1089196354844",
  appId: "1:1089196354844:web:28e653965a0fa9e638b2d5"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function checkAllTenantsFeb() {
  console.log('🔍 Checking ALL tenants Feb 2026 payments...\n');
  
  try {
    // Get all active tenants
    const tenantsRef = collection(db, 'tenants');
    const tenantsQuery = query(tenantsRef, where('isActive', '==', true));
    const tenantsSnapshot = await getDocs(tenantsQuery);
    
    console.log(`👥 Total Active Tenants: ${tenantsSnapshot.size}\n`);
    
    // Get all Feb 2026 payments
    const paymentsRef = collection(db, 'payments');
    const feb2026Query = query(
      paymentsRef,
      where('year', '==', 2026),
      where('month', '==', 2)
    );
    const paymentsSnapshot = await getDocs(feb2026Query);
    
    // Map payments by room number (both types)
    const paymentsByRoom = {};
    paymentsSnapshot.forEach((doc) => {
      const data = doc.data();
      const roomKey = String(data.roomNumber); // Normalize to string
      paymentsByRoom[roomKey] = {
        id: doc.id,
        ...data
      };
    });
    
    console.log(`💰 Total Feb 2026 Payments: ${paymentsSnapshot.size}\n`);
    console.log('=' .repeat(80));
    
    // Check each tenant
    let matchCount = 0;
    let mismatchCount = 0;
    
    tenantsSnapshot.forEach((doc) => {
      const tenant = doc.data();
      const tenantId = doc.id;
      const roomKey = String(tenant.roomNumber);
      const payment = paymentsByRoom[roomKey];
      
      console.log(`\n🏠 Room ${tenant.roomNumber} - ${tenant.name}`);
      console.log(`  Tenant ID: ${tenantId}`);
      console.log(`  Room Number Type: ${typeof tenant.roomNumber}`);
      
      if (payment) {
        console.log(`  ✅ Feb 2026 Payment Found:`);
        console.log(`    Payment ID: ${payment.id}`);
        console.log(`    month: ${payment.month} (type: ${typeof payment.month})`);
        console.log(`    year: ${payment.year} (type: ${typeof payment.year})`);
        console.log(`    status: "${payment.status}"`);
        console.log(`    paidAmount: ${payment.paidAmount}`);
        console.log(`    rent: ${payment.rent}`);
        console.log(`    roomNumber: ${payment.roomNumber} (type: ${typeof payment.roomNumber})`);
        console.log(`    tenantId: ${payment.tenantId || 'UNDEFINED'}`);
        console.log(`    tenantName: ${payment.tenantName || payment.tenantNameSnapshot || 'N/A'}`);
        
        // Check matching criteria
        const tenantIdMatches = payment.tenantId === tenantId;
        const nameMatches = 
          payment.tenantName === tenant.name || 
          payment.tenantNameSnapshot === tenant.name;
        
        console.log(`    Tenant ID Matches: ${tenantIdMatches ? '✅' : '❌'} (payment: ${payment.tenantId}, tenant: ${tenantId})`);
        console.log(`    Name Matches: ${nameMatches ? '✅' : '❌'} (payment: ${payment.tenantName || payment.tenantNameSnapshot}, tenant: ${tenant.name})`);
        
        if (tenantIdMatches || nameMatches) {
          console.log(`    🎉 WILL BE DETECTED BY PORTAL`);
          matchCount++;
        } else {
          console.log(`    ⚠️  MAY NOT BE DETECTED - Neither ID nor name matches!`);
          mismatchCount++;
        }
      } else {
        console.log(`  ❌ No Feb 2026 Payment found for this room`);
        mismatchCount++;
      }
    });
    
    console.log('\n' + '='.repeat(80));
    console.log('\n📊 SUMMARY:');
    console.log(`  ✅ Payments that will be detected: ${matchCount}`);
    console.log(`  ❌ Payments that may NOT be detected: ${mismatchCount}`);
    console.log(`  📋 Total tenants checked: ${tenantsSnapshot.size}`);
    
    // Additional check: Show current date handling
    console.log('\n🕐 Current Date Logic:');
    const today = new Date();
    console.log(`  Today: ${today.toISOString()}`);
    console.log(`  Current Year: ${today.getFullYear()} (type: ${typeof today.getFullYear()})`);
    console.log(`  Current Month: ${today.getMonth() + 1} (type: ${typeof (today.getMonth() + 1)})`);
    console.log(`  Current Day: ${today.getDate()}`);
    
    console.log('\n💡 For payment to show as PAID in portal:');
    console.log('  1. Payment record must exist for current month (Feb 2026)');
    console.log('  2. year must === 2026 (number)');
    console.log('  3. month must === 2 (number)');
    console.log('  4. status must === "paid" (string)');
    console.log('  5. paidAmount must be > 0');
    console.log('  6. tenantId must match OR tenantName must match');
    
  } catch (error) {
    console.error('❌ Error:', error);
  }
  
  process.exit(0);
}

checkAllTenantsFeb();
