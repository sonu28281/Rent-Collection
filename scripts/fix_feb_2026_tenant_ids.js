import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, collection, query, where, getDocs, doc, updateDoc } from 'firebase/firestore';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
dotenv.config({ path: join(__dirname, '..', '.env') });

const firebaseConfig = {
  apiKey: process.env.VITE_FIREBASE_API_KEY,
  authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.VITE_FIREBASE_APP_ID,
  measurementId: process.env.VITE_FIREBASE_MEASUREMENT_ID
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Admin credentials
const ADMIN_EMAIL = 'sonu28281@gmail.com';
const ADMIN_PASSWORD = 'kavyA@18deC';

async function fixFeb2026TenantIds() {
  console.log('🔧 Fixing Feb 2026 payment records - Adding missing tenantIds...\n');
  
  try {
    // Authenticate as admin
    console.log('🔐 Authenticating as admin...');
    await signInWithEmailAndPassword(auth, ADMIN_EMAIL, ADMIN_PASSWORD);
    console.log('✅ Authenticated successfully\n');
    // Get all active tenants with their IDs
    const tenantsRef = collection(db, 'tenants');
    const tenantsQuery = query(tenantsRef, where('isActive', '==', true));
    const tenantsSnapshot = await getDocs(tenantsQuery);
    
    // Map tenants by room number for quick lookup
    const tenantsByRoom = {};
    const tenantsByName = {};
    tenantsSnapshot.forEach((doc) => {
      const tenant = doc.data();
      const roomKey = String(tenant.roomNumber);
      tenantsByRoom[roomKey] = {
        id: doc.id,
        name: tenant.name,
        roomNumber: tenant.roomNumber
      };
      tenantsByName[tenant.name] = doc.id;
    });
    
    console.log(`📋 Loaded ${tenantsSnapshot.size} active tenants\n`);
    
    // Get all Feb 2026 payments
    const paymentsRef = collection(db, 'payments');
    const feb2026Query = query(
      paymentsRef,
      where('year', '==', 2026),
      where('month', '==', 2)
    );
    const paymentsSnapshot = await getDocs(feb2026Query);
    
    console.log(`💰 Found ${paymentsSnapshot.size} Feb 2026 payments\n`);
    console.log('=' .repeat(80));
    
    let updatedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;
    
    for (const paymentDoc of paymentsSnapshot.docs) {
      const payment = paymentDoc.data();
      const roomKey = String(payment.roomNumber);
      
      console.log(`\n🏠 Room ${payment.roomNumber} - ${payment.tenantName || payment.tenantNameSnapshot}`);
      console.log(`  Payment ID: ${paymentDoc.id}`);
      console.log(`  Current tenantId: ${payment.tenantId || 'UNDEFINED'}`);
      
      // Skip if tenantId already exists
      if (payment.tenantId) {
        console.log(`  ✅ Already has tenantId, skipping`);
        skippedCount++;
        continue;
      }
      
      // Find tenant by room number
      const tenant = tenantsByRoom[roomKey];
      
      if (!tenant) {
        console.log(`  ⚠️  No active tenant found for room ${roomKey}`);
        errorCount++;
        continue;
      }
      
      // Verify name matches
      const paymentName = payment.tenantName || payment.tenantNameSnapshot;
      if (paymentName !== tenant.name) {
        console.log(`  ⚠️  Name mismatch! Payment: "${paymentName}", Tenant: "${tenant.name}"`);
        console.log(`  Skipping to avoid data corruption`);
        errorCount++;
        continue;
      }
      
      // Update payment with tenantId
      try {
        await updateDoc(doc(db, 'payments', paymentDoc.id), {
          tenantId: tenant.id,
          updatedAt: new Date().toISOString()
        });
        
        console.log(`  ✅ Updated with tenantId: ${tenant.id}`);
        updatedCount++;
      } catch (error) {
        console.log(`  ❌ Error updating: ${error.message}`);
        errorCount++;
      }
    }
    
    console.log('\n' + '='.repeat(80));
    console.log('📊 SUMMARY:');
    console.log(`  ✅ Updated: ${updatedCount} payments`);
    console.log(`  ⏭️  Skipped (already had tenantId): ${skippedCount}`);
    console.log(`  ❌ Errors: ${errorCount}`);
    console.log('=' .repeat(80));
    
    if (updatedCount > 0) {
      console.log('\n🎉 Success! All Feb 2026 payments now have tenantId.');
      console.log('💡 Tenant Portal should now show correct payment status.');
    } else {
      console.log('\n⚠️  No updates needed - all payments already have tenantId.');
    }
    
  } catch (error) {
    console.error('\n❌ Error:', error);
  }
  
  process.exit(0);
}

fixFeb2026TenantIds();
