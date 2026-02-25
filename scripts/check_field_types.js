import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, query, where } from 'firebase/firestore';

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

// Check tenant and payment roomNumber field types
async function checkFieldTypes() {
  console.log('🔍 Checking roomNumber field types...\n');
  
  try {
    // Check tenants
    const tenantsRef = collection(db, 'tenants');
    const tenantsSnapshot = await getDocs(tenantsRef);
    
    console.log('👥 TENANTS:');
    tenantsSnapshot.forEach(doc => {
      const data = doc.data();
      const roomNum = data.roomNumber;
      const type = typeof roomNum;
      console.log(`   Room ${roomNum} - Type: ${type} (${type === 'number' ? '✅' : '❌ Should be number!'})`);
    });
    
    console.log('\n💰 PAYMENTS (sample):');
    const paymentsRef = collection(db, 'payments');
    const paymentsSnapshot = await getDocs(query(paymentsRef, where('roomNumber', '==', 101)));
    
    if (paymentsSnapshot.empty) {
      console.log('   ❌ No payments found for room 101 (number)');
      
      // Try with string
      const paymentsSnapshot2 = await getDocs(query(paymentsRef, where('roomNumber', '==', '101')));
      if (!paymentsSnapshot2.empty) {
        console.log('   ⚠️ Found payments with roomNumber as STRING!');
      }
    } else {
      console.log(`   ✅ Found ${paymentsSnapshot.size} payments for room 101 (number)`);
      const sample = paymentsSnapshot.docs[0].data();
      console.log(`   Sample: roomNumber type = ${typeof sample.roomNumber}`);
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
  }
  
  process.exit(0);
}

checkFieldTypes();
