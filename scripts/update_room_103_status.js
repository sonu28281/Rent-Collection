import { initializeApp } from 'firebase/app';
import { getFirestore, collection, query, where, getDocs, doc, updateDoc } from 'firebase/firestore';

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

// Check and update Room 103 payment status
async function updateRoom103Status() {
  console.log('🔍 Checking Room 103 (DK Singh) payment...\n');
  
  try {
    // Get Room 103 Feb 2026 payment (roomNumber is stored as string)
    const paymentsRef = collection(db, 'payments');
    const paymentQuery = query(
      paymentsRef,
      where('roomNumber', '==', '103'),
      where('year', '==', 2026),
      where('month', '==', 2)
    );
    const snapshot = await getDocs(paymentQuery);
    
    if (snapshot.empty) {
      console.log('❌ No Feb 2026 payment found for Room 103');
      process.exit(0);
    }
    
    const paymentDoc = snapshot.docs[0];
    const payment = paymentDoc.data();
    
    console.log('📋 Current Payment Details:');
    console.log(`  Room: ${payment.roomNumber}`);
    console.log(`  Tenant: ${payment.tenantNameSnapshot || payment.tenantName}`);
    console.log(`  Year/Month: ${payment.year}/${payment.month}`);
    console.log(`  Status: ${payment.status}`);
    console.log(`  Rent: ₹${payment.rent || 0}`);
    console.log(`  Electricity: ₹${payment.electricity || 0}`);
    console.log(`  Total: ₹${(payment.rent || 0) + (payment.electricity || 0)}`);
    console.log(`  Paid Amount: ₹${payment.paidAmount || 0}`);
    
    if (payment.status === 'paid') {
      console.log('\n⚠️ Payment is marked as PAID but you said it\'s pending.');
      console.log('\n🔧 Updating status to PENDING...');
      
      try {
        await updateDoc(doc(db, 'payments', paymentDoc.id), {
          status: 'pending',
          paidAmount: 0,
          paymentDate: null,
          paidAt: null,
          paymentMethod: null,
          updatedAt: new Date()
        });
        
        console.log('✅ Successfully updated Room 103 payment status to PENDING');
        console.log('\n📝 Updated fields:');
        console.log('  status: "pending"');
        console.log('  paidAmount: 0');
        console.log('  paymentDate: null');
        console.log('  Payment will now show as DUE in dashboard');
        
      } catch (updateError) {
        console.log('❌ Update failed (Permission denied)');
        console.log('💡 Need to update via Admin Panel > Payments page');
      }
    } else {
      console.log('\n✅ Payment status is already:', payment.status);
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
  }
  
  process.exit(0);
}

updateRoom103Status();
