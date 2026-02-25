import { initializeApp } from 'firebase/app';
import { getFirestore, collection, query, where, getDocs, doc, writeBatch } from 'firebase/firestore';

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

// Update Jan 2026 payments - ALL tenants paid
async function updateJan2026Payments() {
  console.log('🔄 Updating Jan 2026 payment records...\n');
  
  try {
    // Get all Jan 2026 payments
    const paymentsRef = collection(db, 'payments');
    const jan2026Query = query(
      paymentsRef,
      where('year', '==', 2026),
      where('month', '==', 1)
    );
    const snapshot = await getDocs(jan2026Query);
    
    console.log(`📋 Found ${snapshot.size} Jan 2026 payment records\n`);
    
    if (snapshot.empty) {
      console.log('❌ No Jan 2026 payments found');
      process.exit(0);
    }
    
    // Prepare batch updates
    const batch = writeBatch(db);
    let updateCount = 0;
    let totalAmount = 0;
    
    snapshot.forEach(docSnap => {
      const data = docSnap.data();
      const roomNum = data.roomNumber;
      const rent = Number(data.rent) || 0;
      const electricity = Number(data.electricity) || 0;
      const total = rent + electricity;
      
      // All rooms paid in Jan 2026
      console.log(`  ✅ Room ${roomNum} (${data.tenantNameSnapshot || 'N/A'}): Setting paidAmount = ₹${total}`);
      batch.update(doc(db, 'payments', docSnap.id), {
        status: 'paid',
        paidAmount: total,
        paymentDate: '2026-01-20',
        paidAt: new Date('2026-01-20').toISOString(),
        paymentMethod: 'cash'
      });
      updateCount++;
      totalAmount += total;
    });
    
    console.log(`\n📝 Updating ${updateCount} records...`);
    
    // Commit batch
    await batch.commit();
    
    console.log('\n✅ SUCCESS! Jan 2026 payments updated:');
    console.log(`  ✅ All 12 rooms marked as PAID`);
    console.log(`  💰 Total collected: ₹${totalAmount.toLocaleString('en-IN')}`);
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.code === 'permission-denied') {
      console.log('\n💡 Permission denied. Need to update via:');
      console.log('  - Firebase Console');
      console.log('  - Admin Panel (if you have edit access)');
      console.log('  - Update Firestore rules temporarily');
    }
    process.exit(1);
  }
}

updateJan2026Payments();
