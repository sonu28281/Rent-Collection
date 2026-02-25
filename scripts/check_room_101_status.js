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

// Check Room 101 payment status for Feb 2026
async function checkRoom101Status() {
  console.log('🔍 Checking Room 101 payment status...\n');
  
  try {
    // Get Room 101 tenant
    const tenantsRef = collection(db, 'tenants');
    const tenantQuery = query(
      tenantsRef,
      where('roomNumber', 'in', [101, '101']),
      where('isActive', '==', true)
    );
    const tenantSnapshot = await getDocs(tenantQuery);
    
    if (tenantSnapshot.empty) {
      console.log('❌ No active tenant found for Room 101');
      process.exit(0);
    }
    
    const tenantDoc = tenantSnapshot.docs[0];
    const tenant = tenantDoc.data();
    
    console.log('👤 Tenant Info:');
    console.log(`  Room: ${tenant.roomNumber}`);
    console.log(`  Name: ${tenant.name}`);
    console.log(`  Active: ${tenant.isActive}`);
    console.log(`  Rent: ₹${tenant.rentAmount || tenant.rent || 'N/A'}\n`);
    
    // Get Feb 2026 payment
    const paymentsRef = collection(db, 'payments');
    const feb2026Query = query(
      paymentsRef,
      where('roomNumber', 'in', [101, '101']),
      where('year', '==', 2026),
      where('month', '==', 2)
    );
    const paymentSnapshot = await getDocs(feb2026Query);
    
    console.log('💰 Feb 2026 Payment:');
    if (paymentSnapshot.empty) {
      console.log('  ❌ No payment record found for Feb 2026\n');
    } else {
      const payment = paymentSnapshot.docs[0].data();
      console.log(`  Status: ${payment.status}`);
      console.log(`  Rent: ₹${payment.rent || 0}`);
      console.log(`  Electricity: ₹${payment.electricity || 0}`);
      console.log(`  Total Billed: ₹${(payment.rent || 0) + (payment.electricity || 0)}`);
      console.log(`  Paid Amount: ₹${payment.paidAmount || 0}`);
      console.log(`  Payment Date: ${payment.paymentDate || 'N/A'}`);
      console.log(`  Payment Method: ${payment.paymentMethod || 'N/A'}\n`);
      
      if (payment.status === 'paid' && (payment.paidAmount || 0) > 0) {
        console.log('✅ Room 101 has PAID for Feb 2026');
        console.log('   Tenant portal should show NEXT month due date (March 20)');
      } else if (payment.status === 'paid' && (payment.paidAmount || 0) === 0) {
        console.log('⚠️ Status is "paid" but paidAmount is 0');
        console.log('   This needs to be fixed in database');
      } else {
        console.log('❌ Payment is PENDING');
        console.log('   Tenant portal should show overdue (Feb 20 passed)');
      }
    }
    
    // Check all payments for this tenant
    console.log('\n📋 All Payment History:');
    const allPaymentsQuery = query(
      paymentsRef,
      where('tenantNameSnapshot', '==', tenant.name)
    );
    const allPayments = await getDocs(allPaymentsQuery);
    
    const payments = [];
    allPayments.forEach(doc => {
      const p = doc.data();
      payments.push({
        year: p.year,
        month: p.month,
        status: p.status,
        paidAmount: p.paidAmount || 0,
        total: (p.rent || 0) + (p.electricity || 0)
      });
    });
    
    payments.sort((a, b) => {
      if (a.year !== b.year) return b.year - a.year;
      return b.month - a.month;
    });
    
    payments.forEach(p => {
      const monthName = new Date(2000, p.month - 1).toLocaleString('default', { month: 'short' });
      console.log(`  ${p.year} ${monthName}: ${p.status} - ₹${p.paidAmount} / ₹${p.total}`);
    });
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

checkRoom101Status();
