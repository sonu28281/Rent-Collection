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

async function checkBankAccounts() {
  try {
    console.log('🏦 Checking Bank Accounts...\n');

    const accountsRef = collection(db, 'bankAccounts');
    const accountsSnapshot = await getDocs(accountsRef);
    
    console.log(`Total Bank Accounts: ${accountsSnapshot.size}\n`);

    if (accountsSnapshot.empty) {
      console.log('❌ No bank accounts found!');
      console.log('\n💡 To add a bank account, go to:');
      console.log('   Settings > Bank Accounts > Add New Account');
      process.exit(0);
    }

    accountsSnapshot.forEach((doc) => {
      const account = doc.data();
      console.log(`📋 Account: ${doc.id}`);
      console.log(`   UPI ID: ${account.upiId}`);
      console.log(`   Nickname: ${account.nickname || 'N/A'}`);
      console.log(`   Active: ${account.isActive ? '✅ Yes' : '❌ No'}`);
      console.log(`   QR Code: ${account.qrCode ? '✅ Available' : '❌ Not uploaded'}`);
      console.log();
    });

    // Check for active accounts
    const activeQuery = query(accountsRef, where('isActive', '==', true));
    const activeSnapshot = await getDocs(activeQuery);
    
    if (activeSnapshot.empty) {
      console.log('⚠️ No active bank accounts found!');
      console.log('Please activate at least one account for tenant payments.');
    } else {
      console.log(`✅ ${activeSnapshot.size} active account(s) available for tenant payments`);
    }

    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

checkBankAccounts();
