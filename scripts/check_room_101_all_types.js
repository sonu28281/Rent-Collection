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

async function checkAllTypes() {
  console.log('🔍 Checking Room 101 payments with ALL type variations...\n');
  
  try {
    // Get Room 101 tenant
    const tenantsRef = collection(db, 'tenants');
    const tenantQuery = query(tenantsRef, where('roomNumber', '==', '101'));
    const tenantSnapshot = await getDocs(tenantQuery);
    
    if (tenantSnapshot.empty) {
      console.log('❌ No tenant found for Room 101');
      process.exit(1);
    }
    
    const tenant = tenantSnapshot.docs[0];
    const tenantData = tenant.data();
    console.log('👤 Current Tenant:');
    console.log(`  ID: ${tenant.id}`);
    console.log(`  Name: ${tenantData.name}`);
    console.log(`  Room: ${tenantData.roomNumber} (type: ${typeof tenantData.roomNumber})\n`);
    
    // Check payments  by roomNumber as NUMBER
    console.log('📊 Checking roomNumber as NUMBER (101)...');
    const paymentsRef = collection(db, 'payments');
    const numQuery = query(
      paymentsRef,
      where('roomNumber', '==', 101)
    );
    const numSnapshot = await getDocs(numQuery);
    console.log(`  Found: ${numSnapshot.size} payments\n`);
    
    // Check payments by roomNumber as STRING
    console.log('📊 Checking roomNumber as STRING ("101")...');
    const strQuery = query(
      paymentsRef,
      where('roomNumber', '==', '101')
    );
    const strSnapshot = await getDocs(strQuery);
    console.log(`  Found: ${strSnapshot.size} payments\n`);
    
    if (strSnapshot.size > 0) {
      console.log('✅ Found payments with roomNumber as STRING:\n');
      strSnapshot.forEach((doc) => {
        const data = doc.data();
        console.log(`  Payment ID: ${doc.id}`);
        console.log(`  Month/Year: ${data.month}/${data.year}`);
        console.log(`  roomNumber: ${data.roomNumber} (type: ${typeof data.roomNumber})`);
        console.log(`  tenantId: ${data.tenantId}`);
        console.log(`  tenantName: ${data.tenantNameSnapshot || data.tenantName}`);
        console.log(`  status: ${data.status}`);
        console.log(`  paidAmount: ${data.paidAmount}`);
        console.log(`  rent: ${data.rent}`);
        console.log('');
      });
    }
    
    // Check payments by tenantId
    console.log('📊 Checking by tenantId...');
    const tenantIdQuery = query(
      paymentsRef,
      where('tenantId', '==', tenant.id)
    );
    const tenantIdSnapshot = await getDocs(tenantIdQuery);
    console.log(`  Found: ${tenantIdSnapshot.size} payments\n`);
    
    if (tenantIdSnapshot.size > 0) {
      console.log('✅ Found payments by tenantId:\n');
      tenantIdSnapshot.forEach((doc) => {
        const data = doc.data();
        console.log(`  Payment ID: ${doc.id}`);
        console.log(`  Month/Year: ${data.month}/${data.year}`);
        console.log(`  roomNumber: ${data.roomNumber} (type: ${typeof data.roomNumber})`);
        console.log(`  status: ${data.status}`);
        console.log(`  paidAmount: ${data.paidAmount}`);
        console.log('');
      });
    }
    
    // Check ALL Feb 2026 payments (no room filter)
    console.log('📊 Checking ALL Feb 2026 payments...');
    const allFebQuery = query(
      paymentsRef,
      where('year', '==', 2026),
      where('month', '==', 2)
    );
    const allFebSnapshot = await getDocs(allFebQuery);
    console.log(`  Total Feb 2026 payments in database: ${allFebSnapshot.size}\n`);
    
    if (allFebSnapshot.size > 0) {
      console.log('💡 All Feb 2026 payments:');
      allFebSnapshot.forEach((doc) => {
        const data = doc.data();
        console.log(`  - Room ${data.roomNumber} (${typeof data.roomNumber}): ${data.tenantNameSnapshot ||data.tenantName} - ${data.status}`);
      });
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
  }
  
  process.exit(0);
}

checkAllTypes();
