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

// Check Room 103 payment with detailed type info
async function checkRoom103Details() {
  console.log('🔍 Detailed check for Room 103...\n');
  
  try {
    // Get ALL Feb 2026 payments
    const paymentsRef = collection(db, 'payments');
    const feb2026Query = query(
      paymentsRef,
      where('year', '==', 2026),
      where('month', '==', 2)
    );
    const snapshot = await getDocs(feb2026Query);
    
    console.log(`📋 Total Feb 2026 payments: ${snapshot.size}\n`);
    
    // Find Room 103
    let found = false;
    snapshot.forEach(doc => {
      const data = doc.data();
      const roomNum = data.roomNumber;
      
      // Check if this is related to Room 103
      if (roomNum == 103 || roomNum === '103') {
        found = true;
        console.log('✅ FOUND Room 103 payment!');
        console.log(`  Document ID: ${doc.id}`);
        console.log(`  Room Number: ${roomNum} (type: ${typeof roomNum})`);
        console.log(`  Tenant Name: ${data.tenantNameSnapshot || data.tenantName}`);
        console.log(`  Status: ${data.status}`);
        console.log(`  Year: ${data.year}`);
        console.log(`  Month: ${data.month}`);
        console.log(`  Rent: ₹${data.rent || 0}`);
        console.log(`  Electricity: ₹${data.electricity || 0}`);
        console.log(`  Total: ₹${(data.rent || 0) + (data.electricity || 0)}`);
        console.log(`  Paid Amount: ₹${data.paidAmount || 0}`);
        console.log(`  Payment Date: ${data.paymentDate || 'N/A'}`);
        console.log('\n');
      }
    });
    
    if (!found) {
      console.log('❌ No payment found for Room 103');
      console.log('\n📊 All room numbers in Feb 2026:');
      const roomNumbers = [];
      snapshot.forEach(doc => {
        const data = doc.data();
        roomNumbers.push(`${data.roomNumber} (${typeof data.roomNumber})`);
      });
      console.log(roomNumbers.join(', '));
    }
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

checkRoom103Details();
