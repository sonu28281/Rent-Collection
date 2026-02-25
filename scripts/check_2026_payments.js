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

// Check if any 2026 payment records exist
async function check2026Payments() {
  console.log('🔍 Checking for 2026 payment records...\n');
  
  try {
    const paymentsRef = collection(db, 'payments');
    const query2026 = query(
      paymentsRef,
      where('year', '==', 2026)
    );
    
    const snapshot = await getDocs(query2026);
    console.log(`📊 Total 2026 payment records: ${snapshot.size}\n`);
    
    if (snapshot.size === 0) {
      console.log('❌ NO 2026 payment records found in database!');
      console.log('💡 You need to add 2026 payment data first.\n');
      console.log('Options:');
      console.log('1. Use "Add 2026 Payments" button in admin panel');
      console.log('2. Import CSV with 2026 data');
      console.log('3. Run scripts/add_2026_payments.js script');
    } else {
      console.log('✅ Found 2026 payments!\n');
      
      // Group by room
      const roomPayments = {};
      snapshot.forEach(doc => {
        const data = doc.data();
        const room = data.roomNumber;
        if (!roomPayments[room]) {
          roomPayments[room] = [];
        }
        roomPayments[room].push({
          month: data.month,
          year: data.year,
          status: data.status
        });
      });
      
      console.log('📋 2026 Payments by Room:\n');
      Object.keys(roomPayments).sort((a, b) => a - b).forEach(room => {
        const months = roomPayments[room].map(p => p.month).sort((a, b) => a - b);
        console.log(`  Room ${room}: ${months.length} payments (Months: ${months.join(', ')})`);
      });
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
  }
  
  process.exit(0);
}

check2026Payments();
