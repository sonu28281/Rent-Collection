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

// Check all Feb 2026 payments for Room 101
async function checkFeb2026Room101() {
  console.log('🔍 Checking ALL Feb 2026 payments for Room 101...\n');
  
  try {
    // Get Room 101 tenant
    const tenantsRef = collection(db, 'tenants');
    const tenantQuery = query(tenantsRef, where('roomNumber', '==', '101'));
    const tenantSnapshot = await getDocs(tenantQuery);
    
    const tenant = tenantSnapshot.docs[0].data();
    console.log('👤 Current Tenant:', {
      name: tenant.name,
      roomNumber: tenant.roomNumber
    });
    
    // Get ALL Feb 2026 payments for Room 101
    const paymentsRef = collection(db, 'payments');
    const paymentsQuery = query(
      paymentsRef,
      where('roomNumber', '==', 101),
      where('year', '==', 2026),
      where('month', '==', 2)
    );
    const paymentsSnapshot = await getDocs(paymentsQuery);
    
    console.log(`\n📊 Total Feb 2026 payments for Room 101: ${paymentsSnapshot.size}\n`);
    
    if (paymentsSnapshot.size === 0) {
      console.log('❌ NO Feb 2026 payment record exists for Room 101!');
      console.log('\n💡 Solution: You need to add Feb 2026 payment record first.');
      console.log('   Options:');
      console.log('   1. Use "Add 2026 Payments" in admin panel');
      console.log('   2. Go to Payments page and record payment manually');
    } else {
      paymentsSnapshot.forEach((doc, i) => {
        const data = doc.data();
        console.log(`Payment ${i + 1}:`);
        console.log(`  ID: ${doc.id}`);
        console.log(`  Room: ${data.roomNumber}`);
        console.log(`  Tenant Name: "${data.tenantNameSnapshot || data.tenantName || 'N/A'}"`);
        console.log(`  Status: ${data.status}`);
        console.log(`  Rent: ₹${data.rent || 0}`);
        console.log(`  Electricity: ₹${data.electricity || 0}`);
        console.log(`  Total: ₹${(data.rent || 0) + (data.electricity || 0)}`);
        
        // Check if tenant name matches
        const nameMatches = 
          data.tenantNameSnapshot === tenant.name || 
          data.tenantName === tenant.name;
        
        console.log(`  Name Matches Current Tenant? ${nameMatches ? '✅ YES' : '❌ NO'}`);
        
        if (!nameMatches) {
          console.log(`  ⚠️ Mismatch: Payment has "${data.tenantNameSnapshot || data.tenantName}" but current tenant is "${tenant.name}"`);
        }
        console.log('');
      });
    }
    
    // Also check Jan 2026
    console.log('\n🔍 Checking Jan 2026 for comparison...');
    const jan2026Query = query(
      paymentsRef,
      where('roomNumber', '==', 101),
      where('year', '==', 2026),
      where('month', '==', 1)
    );
    const jan2026Snapshot = await getDocs(jan2026Query);
    
    if (jan2026Snapshot.size > 0) {
      const janData = jan2026Snapshot.docs[0].data();
      console.log('✅ Jan 2026 exists:');
      console.log(`  Tenant Name: "${janData.tenantNameSnapshot || janData.tenantName}"`);
      console.log(`  Status: ${janData.status}`);
    } else {
      console.log('❌ Jan 2026 also not found');
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
  }
  
  process.exit(0);
}

checkFeb2026Room101();
