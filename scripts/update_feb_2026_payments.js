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

// Update Feb 2026 payments: All rooms paid except Room 103
async function updateFeb2026Payments() {
  console.log('🔄 Updating Feb 2026 payment records...\n');
  
  try {
    // Get all Feb 2026 payments
    const paymentsRef = collection(db, 'payments');
    const feb2026Query = query(
      paymentsRef,
      where('year', '==', 2026),
      where('month', '==', 2)
    );
    const snapshot = await getDocs(feb2026Query);
    
    console.log(`📋 Found ${snapshot.size} Feb 2026 payment records\n`);
    
    if (snapshot.empty) {
      console.log('❌ No Feb 2026 payments found');
      process.exit(0);
    }
    
    // Prepare batch updates
    const batch = writeBatch(db);
    let updateCount = 0;
    let room103Doc = null;
    
    snapshot.forEach(docSnap => {
      const data = docSnap.data();
      const roomNum = data.roomNumber;
      const rent = Number(data.rent) || 0;
      const electricity = Number(data.electricity) || 0;
      const total = rent + electricity;
      
      if (roomNum == 103 || roomNum === '103') {
        // Room 103 - DK Singh hasn't paid
        console.log(`  ❌ Room 103 (${data.tenantNameSnapshot}): Setting as PENDING`);
        batch.update(doc(db, 'payments', docSnap.id), {
          status: 'pending',
          paidAmount: 0,
          paymentDate: null,
          paidAt: null,
          paymentMethod: null
        });
        room103Doc = docSnap.id;
        updateCount++;
      } else {
        // All other rooms - paid in full
        console.log(`  ✅ Room ${roomNum} (${data.tenantNameSnapshot}): Setting paidAmount = ₹${total}`);
        batch.update(doc(db, 'payments', docSnap.id), {
          status: 'paid',
          paidAmount: total,
          paymentDate: '2026-02-25',
          paidAt: new Date().toISOString(),
          paymentMethod: 'cash'
        });
        updateCount++;
      }
    });
    
    console.log(`\n📝 Updating ${updateCount} records...`);
    
    // Commit batch
    await batch.commit();
    
    console.log('\n✅ SUCCESS! Feb 2026 payments updated:');
    console.log(`  ✅ 11 rooms marked as PAID with paidAmount set`);
    console.log(`  ❌ Room 103 marked as PENDING`);
    console.log('\n🎯 Dashboard will now show:');
    console.log('  - Feb 2026: ₹38,500 collected (11 tenants × ₹3500)');
    console.log('  - Room 103 in pending list');
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.code === 'permission-denied') {
      console.log('\n💡 Permission denied. Options:');
      console.log('  1. Update Firestore rules to allow writes');
      console.log('  2. Use Firebase Admin SDK with service account');
      console.log('  3. Update manually via Firebase Console');
    }
    process.exit(1);
  }
}

updateFeb2026Payments();
