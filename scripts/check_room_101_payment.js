import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, query, where } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyDV29cmwZ9KReQMi8pLsaVZUPA-BMN_gPw",
  authDomain: "rent-collection-b5c84.firebaseapp.com",
  projectId: "rent-collection-b5c84",
  storageBucket: "rent-collection-b5c84.firebasestorage.app",
  messagingSenderId: "715608790441",
  appId: "1:715608790441:web:2f50a62c3a850f8bd7ff38"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function checkRoom101Payment() {
  try {
    console.log('🔍 Checking Room 101 payment status for February 2026...\n');

    // Get tenant for Room 101
    const tenantsRef = collection(db, 'tenants');
    const tenantQuery = query(tenantsRef, where('roomNumber', '==', '101'));
    const tenantSnapshot = await getDocs(tenantQuery);
    
    if (tenantSnapshot.empty) {
      console.log('❌ No tenant found for Room 101');
      process.exit(1);
    }

    const tenant = { id: tenantSnapshot.docs[0].id, ...tenantSnapshot.docs[0].data() };
    console.log('👤 Tenant Info:');
    console.log('   Name:', tenant.name);
    console.log('   Room:', tenant.roomNumber);
    console.log('   ID:', tenant.id);
    console.log('   Active:', tenant.isActive);
    console.log();

    // Check payments for Room 101
    const paymentsRef = collection(db, 'payments');
    
    // Try by room number (string)
    console.log('🔍 Searching payments by roomNumber = "101"');
    let paymentsQuery = query(paymentsRef, where('roomNumber', '==', '101'));
    let paymentsSnapshot = await getDocs(paymentsQuery);
    console.log(`   Found: ${paymentsSnapshot.size} payment(s)`);
    
    // Try by room number (number)
    console.log('🔍 Searching payments by roomNumber = 101 (number)');
    paymentsQuery = query(paymentsRef, where('roomNumber', '==', 101));
    paymentsSnapshot = await getDocs(paymentsQuery);
    console.log(`   Found: ${paymentsSnapshot.size} payment(s)`);
    
    // Try by tenant ID
    console.log('🔍 Searching payments by tenantId');
    paymentsQuery = query(paymentsRef, where('tenantId', '==', tenant.id));
    paymentsSnapshot = await getDocs(paymentsQuery);
    console.log(`   Found: ${paymentsSnapshot.size} payment(s)`);
    
    if (!paymentsSnapshot.empty) {
      console.log('\n📋 Payment Records:');
      paymentsSnapshot.forEach((doc) => {
        const payment = doc.data();
        console.log(`\n   Payment ID: ${doc.id}`);
        console.log(`   Year: ${payment.year}`);
        console.log(`   Month: ${payment.month}`);
        console.log(`   Status: ${payment.status}`);
        console.log(`   Paid Amount: ₹${payment.paidAmount || 0}`);
        console.log(`   Tenant Name: ${payment.tenantNameSnapshot || payment.tenantName || 'N/A'}`);
        console.log(`   Tenant ID: ${payment.tenantId || 'N/A'}`);
        console.log(`   Room Number: ${payment.roomNumber} (type: ${typeof payment.roomNumber})`);
        console.log(`   Paid Date: ${payment.paidDate || 'N/A'}`);
      });
      
      // Check Feb 2026 specifically
      const feb2026Payment = [];
      paymentsSnapshot.forEach((doc) => {
        const payment = doc.data();
        if (payment.year === 2026 && payment.month === 2) {
          feb2026Payment.push(payment);
        }
      });
      
      if (feb2026Payment.length > 0) {
        console.log('\n✅ February 2026 Payment Found!');
        feb2026Payment.forEach((p) => {
          console.log(`   Status: ${p.status}`);
          console.log(`   Amount: ₹${p.paidAmount}`);
          console.log(`   Match criteria check:`);
          console.log(`     - Status is 'paid': ${p.status === 'paid'}`);
          console.log(`     - paidAmount > 0: ${(p.paidAmount || 0) > 0}`);
          console.log(`     - Should show as PAID: ${p.status === 'paid' && (p.paidAmount || 0) > 0}`);
        });
      } else {
        console.log('\n❌ No February 2026 payment found');
      }
    } else {
      console.log('\n❌ No payments found for Room 101');
    }

    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

checkRoom101Payment();
