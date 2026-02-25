import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, collection, query, where, getDocs } from 'firebase/firestore';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '..', '.env') });

const firebaseConfig = {
  apiKey: process.env.VITE_FIREBASE_API_KEY,
  authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.VITE_FIREBASE_APP_ID
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const ADMIN_EMAIL = 'sonu28281@gmail.com';
const ADMIN_PASSWORD = 'kavyA@18deC';

async function verifyFixes() {
  console.log('✅ Verifying all fixes...\n');
  
  try {
    await signInWithEmailAndPassword(auth, ADMIN_EMAIL, ADMIN_PASSWORD);
    
    const paymentsRef = collection(db, 'payments');
    const feb2026Query = query(
      paymentsRef,
      where('year', '==', 2026),
      where('month', '==', 2)
    );
    const snapshot = await getDocs(feb2026Query);
    
    console.log(`📊 Total Feb 2026 Payments: ${snapshot.size}\n`);
    console.log('=' .repeat(70));
    
    let allGood = true;
    snapshot.forEach((doc) => {
      const data = doc.data();
      const issues = [];
      
      if (!data.tenantId) issues.push('❌ Missing tenantId');
      if (!data.paidAmount && !data.rent) issues.push('❌ No paidAmount or rent');
      if (data.status !== 'paid') issues.push(`⚠️  Status: ${data.status}`);
      
      const statusIcon = issues.length === 0 ? '✅' : '⚠️ ';
      console.log(`${statusIcon} Room ${data.roomNumber} - ${data.tenantName || data.tenantNameSnapshot}`);
      console.log(`   tenantId: ${data.tenantId ? '✅' : '❌ MISSING'}`);
      console.log(`   paidAmount: ${data.paidAmount !== undefined ? '₹' + data.paidAmount : 'undefined'}`);
      console.log(`   rent: ₹${data.rent || 0}`);
      console.log(`   status: ${data.status}`);
      
      if (issues.length > 0) {
        console.log(`   Issues: ${issues.join(', ')}`);
        allGood = false;
      }
      console.log('');
    });
    
    console.log('=' .repeat(70));
    if (allGood) {
      console.log('\n🎉 ALL GOOD! All Feb 2026 payments are properly configured.');
      console.log('💡 Tenant Portal should now show:');
      console.log('   - "Current Month Paid ✅" for all tenants who paid Feb 2026');
      console.log('   - Payment status will be correctly detected');
    } else {
      console.log('\n⚠️  Some issues found, review above');
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
  }
  
  process.exit(0);
}

verifyFixes();
