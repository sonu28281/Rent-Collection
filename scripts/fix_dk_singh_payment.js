import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, doc, updateDoc } from 'firebase/firestore';
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

async function fixDKSinghPayment() {
  try {
    console.log('🔧 Fixing DK Singh Feb 2026 payment (paidAmount)...\n');
    
    await signInWithEmailAndPassword(auth, ADMIN_EMAIL, ADMIN_PASSWORD);
    console.log('✅ Authenticated\n');
    
    // DK Singh payment ID from diagnostic
    const paymentId = 'XC401UsJnbVzaLS3FSTp';
    const rent = 3500; // From diagnostic output
    
    await updateDoc(doc(db, 'payments', paymentId), {
      paidAmount: rent,
      updatedAt: new Date().toISOString()
    });
    
    console.log('✅ Updated DK Singh payment:');
    console.log(`  Payment ID: ${paymentId}`);
    console.log(`  Set paidAmount: ₹${rent}`);
    console.log('\n🎉 Done!\n');
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

fixDKSinghPayment();
