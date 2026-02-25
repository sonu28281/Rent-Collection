import { initializeApp } from 'firebase/app';
import { getFirestore, collection, addDoc } from 'firebase/firestore';

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

async function setupUPI() {
  try {
    console.log('🚀 Setting up UPI Payment Account...\n');

    // ⚠️ CHANGE THIS TO YOUR UPI ID
    const UPI_ID = 'your-upi@paytm'; // 👈 Replace with your actual UPI ID
    const NICKNAME = 'Property Rent Collection';

    if (UPI_ID === 'your-upi@paytm') {
      console.log('❌ Error: Please change the UPI_ID in the script first!');
      console.log('\nOpen this file and change line 18:');
      console.log(`   const UPI_ID = '${UPI_ID}';`);
      console.log('\nReplace with your actual UPI ID like:');
      console.log(`   const UPI_ID = '9876543210@paytm';`);
      process.exit(1);
    }

    const accountData = {
      upiId: UPI_ID,
      nickname: NICKNAME,
      isActive: true,
      qrCode: null, // Optional - can be added later from Settings
      createdAt: new Date().toISOString()
    };

    const docRef = await addDoc(collection(db, 'bankAccounts'), accountData);

    console.log('✅ UPI Account Added Successfully!\n');
    console.log('📋 Details:');
    console.log(`   UPI ID: ${UPI_ID}`);
    console.log(`   Nickname: ${NICKNAME}`);
    console.log(`   Status: Active ✅`);
    console.log(`   Document ID: ${docRef.id}`);
    console.log('\n💡 Tips:');
    console.log('   1. Tenants can now make payments via UPI');
    console.log('   2. You can upload QR code later from Settings > Bank Accounts');
    console.log('   3. Payments will show this UPI ID to tenants\n');

    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

setupUPI();
