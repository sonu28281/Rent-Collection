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

// Check Feb 2026 payment status for all tenants
async function checkAllTenantsFeb2026() {
  console.log('🔍 Checking Feb 2026 payment status for ALL tenants...\n');
  
  try {
    // Get all active tenants
    const tenantsRef = collection(db, 'tenants');
    const tenantsSnapshot = await getDocs(query(tenantsRef, where('isActive', '==', true)));
    
    console.log(`👥 Total active tenants: ${tenantsSnapshot.size}\n`);
    
    // Get all Feb 2026 payments
    const paymentsRef = collection(db, 'payments');
    const feb2026Query = query(
      paymentsRef,
      where('year', '==', 2026),
      where('month', '==', 2)
    );
    const paymentsSnapshot = await getDocs(feb2026Query);
    
    console.log(`💰 Total Feb 2026 payment records: ${paymentsSnapshot.size}\n`);
    
    // Create payment map by room number
    const paymentsMap = {};
    paymentsSnapshot.forEach(doc => {
      const data = doc.data();
      paymentsMap[data.roomNumber] = {
        id: doc.id,
        ...data
      };
    });
    
    // Check each tenant
    const tenantList = [];
    tenantsSnapshot.forEach(doc => {
      const tenant = doc.data();
      const roomNumber = typeof tenant.roomNumber === 'string' 
        ? parseInt(tenant.roomNumber, 10) 
        : tenant.roomNumber;
      
      const payment = paymentsMap[roomNumber];
      
      tenantList.push({
        roomNumber: tenant.roomNumber,
        name: tenant.name,
        hasFeb2026Payment: !!payment,
        paymentStatus: payment ? payment.status : 'NO_RECORD',
        paymentTenantName: payment ? (payment.tenantNameSnapshot || payment.tenantName) : 'N/A'
      });
    });
    
    // Sort by room number
    tenantList.sort((a, b) => {
      const roomA = typeof a.roomNumber === 'string' ? parseInt(a.roomNumber) : a.roomNumber;
      const roomB = typeof b.roomNumber === 'string' ? parseInt(b.roomNumber) : b.roomNumber;
      return roomA - roomB;
    });
    
    // Display results
    console.log('📋 Feb 2026 Payment Status:\n');
    console.log('Room | Tenant Name        | Payment Record | Status');
    console.log('-----|-------------------|----------------|--------');
    
    let paidCount = 0;
    let missingCount = 0;
    
    tenantList.forEach(t => {
      const roomPadded = t.roomNumber.toString().padEnd(4);
      const namePadded = t.name.padEnd(18);
      const recordStatus = t.hasFeb2026Payment ? '✅ YES' : '❌ NO';
      const recordPadded = recordStatus.padEnd(15);
      const status = t.paymentStatus === 'paid' ? '✅ PAID' : 
                     t.paymentStatus === 'NO_RECORD' ? '❌ MISSING' : 
                     `⚠️ ${t.paymentStatus.toUpperCase()}`;
      
      console.log(`${roomPadded} | ${namePadded} | ${recordPadded} | ${status}`);
      
      if (t.hasFeb2026Payment && t.paymentStatus === 'paid') {
        paidCount++;
      } else {
        missingCount++;
      }
    });
    
    console.log('\n📊 Summary:');
    console.log(`  ✅ Paid: ${paidCount} tenants`);
    console.log(`  ❌ Missing/Pending: ${missingCount} tenants`);
    
    // Show which tenants are missing
    console.log('\n⚠️ Tenants WITHOUT Feb 2026 payment record:');
    tenantList
      .filter(t => !t.hasFeb2026Payment || t.paymentStatus !== 'paid')
      .forEach(t => {
        console.log(`  - Room ${t.roomNumber}: ${t.name}`);
      });
    
  } catch (error) {
    console.error('❌ Error:', error);
  }
  
  process.exit(0);
}

checkAllTenantsFeb2026();
