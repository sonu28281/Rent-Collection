import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, query, where, limit } from 'firebase/firestore';

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

// Check payment records for specific rooms
async function checkPaymentRecords() {
  console.log('🔍 Checking payment records in database...\n');
  
  try {
    // Get all payments
    const paymentsRef = collection(db, 'payments');
    const snapshot = await getDocs(paymentsRef);
    
    console.log(`📊 Total payment records: ${snapshot.size}\n`);
    
    if (snapshot.size === 0) {
      console.log('❌ No payment records found in database!');
      console.log('💡 You need to import payment data first.\n');
      return;
    }
    
    // Group by room number
    const roomPayments = {};
    snapshot.forEach(doc => {
      const data = doc.data();
      const roomNum = data.roomNumber;
      
      if (!roomPayments[roomNum]) {
        roomPayments[roomNum] = [];
      }
      roomPayments[roomNum].push({
        room: roomNum,
        month: data.month,
        year: data.year,
        rent: data.rent,
        electricity: data.electricity,
        total: data.total,
        status: data.status
      });
    });
    
    // Display first 3 rooms as sample
    console.log('📋 Sample Payment Records:\n');
    const rooms = Object.keys(roomPayments).sort((a, b) => a - b).slice(0, 3);
    
    rooms.forEach(roomNum => {
      const payments = roomPayments[roomNum];
      console.log(`🏠 Room ${roomNum}:`);
      console.log(`   Total records: ${payments.length}`);
      
      // Show latest 2 records
      payments
        .sort((a, b) => {
          if (b.year !== a.year) return b.year - a.year;
          return b.month - a.month;
        })
        .slice(0, 2)
        .forEach(p => {
          console.log(`   - ${p.month}/${p.year}: ₹${p.total} (${p.status})`);
        });
      console.log('');
    });
    
    console.log(`\n✅ Found payment records for ${Object.keys(roomPayments).length} rooms`);
    
  } catch (error) {
    console.error('❌ Error checking payments:', error);
  }
  
  process.exit(0);
}

checkPaymentRecords();
