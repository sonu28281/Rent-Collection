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

// Check ALL 2026 Room 101 payments without tenant name filter
async function checkAll2026Room101() {
  console.log('🔍 Checking ALL 2026 payments for Room 101 (no tenant filter)...\n');
  
  try {
    // Get current tenant
    const tenantsRef = collection(db, 'tenants');
    const tenantQuery = query(tenantsRef, where('roomNumber', '==', '101'));
    const tenantSnapshot = await getDocs(tenantQuery);
    const currentTenant = tenantSnapshot.docs[0].data();
    
    console.log('👤 Current Tenant:', currentTenant.name);
    console.log('');
    
    // Get ALL 2026 payments for Room 101
    const paymentsRef = collection(db, 'payments');
    const paymentsQuery = query(
      paymentsRef,
      where('roomNumber', '==', 101),
      where('year', '==', 2026)
    );
    const paymentsSnapshot = await getDocs(paymentsQuery);
    
    console.log(`📊 Total 2026 payments for Room 101: ${paymentsSnapshot.size}\n`);
    
    if (paymentsSnapshot.size === 0) {
      console.log('❌ NO 2026 payments found!');
      console.log('\n💡 Need to create 2026 payment records.');
    } else {
      paymentsSnapshot.forEach((doc) => {
        const data = doc.data();
        const tenantName = data.tenantNameSnapshot || data.tenantName || 'N/A';
        const matches = tenantName === currentTenant.name;
        
        console.log(`📅 ${data.month}/2026:`);
        console.log(`  Tenant Name in Payment: "${tenantName}"`);
        console.log(`  Current Tenant: "${currentTenant.name}"`);
        console.log(`  Match: ${matches ? '✅' : '❌'}`);
        console.log(`  Status: ${data.status}`);
        console.log(`  Amount: ₹${(data.rent || 0) + (data.electricity || 0)}`);
        console.log('');
      });
      
      const matchingPayments = [];
      paymentsSnapshot.forEach((doc) => {
        const data = doc.data();
        const tenantName = data.tenantNameSnapshot || data.tenantName;
        if (tenantName === currentTenant.name) {
          matchingPayments.push(data);
        }
      });
      
      console.log(`\n✅ Matching payments for "${currentTenant.name}": ${matchingPayments.length}`);
      console.log(`❌ Non-matching payments: ${paymentsSnapshot.size - matchingPayments.length}`);
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
  }
  
  process.exit(0);
}

checkAll2026Room101();
