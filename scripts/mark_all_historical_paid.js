import { initializeApp } from 'firebase/app';
import { 
  getFirestore, 
  collection, 
  getDocs, 
  writeBatch,
  doc,
  Timestamp
} from 'firebase/firestore';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Firebase configuration
const firebaseConfig = {
  apiKey: process.env.VITE_FIREBASE_API_KEY,
  authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.VITE_FIREBASE_APP_ID
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

console.log('🔥 Firebase initialized\n');

async function markAllPaymentsPaid() {
  try {
    console.log('📊 MARKING ALL HISTORICAL PAYMENTS AS PAID');
    console.log('================================================================================\n');

    // Fetch all payments
    const paymentsRef = collection(db, 'payments');
    const snapshot = await getDocs(paymentsRef);

    console.log(`   Found ${snapshot.size} total payment records\n`);

    if (snapshot.empty) {
      console.log('   ⚠️  No payments found in database');
      return;
    }

    // Filter payments that are not already paid
    const unpaidPayments = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      if (data.status !== 'paid') {
        unpaidPayments.push({ id: doc.id, ...data });
      }
    });

    console.log(`   📝 Found ${unpaidPayments.length} payments to mark as paid\n`);

    if (unpaidPayments.length === 0) {
      console.log('   ✅ All payments are already marked as paid!');
      return;
    }

    // Display summary before updating
    console.log('   Payment Summary:');
    console.log('   ─────────────────────────────────────────────────────────────────\n');
    
    const yearSummary = {};
    unpaidPayments.forEach(payment => {
      const year = payment.year || 'Unknown';
      if (!yearSummary[year]) {
        yearSummary[year] = { count: 0, total: 0 };
      }
      yearSummary[year].count++;
      yearSummary[year].total += payment.totalAmount || 0;
    });

    Object.keys(yearSummary).sort().forEach(year => {
      console.log(`   Year ${year}: ${yearSummary[year].count} payments, Total: ₹${yearSummary[year].total.toLocaleString('en-IN')}`);
    });

    console.log('\n   ─────────────────────────────────────────────────────────────────\n');

    // Ask for confirmation
    console.log('   ⚠️  This will update ALL unpaid/partial payments to PAID status');
    console.log('   ⚠️  This action cannot be easily undone\n');

    // Wait 3 seconds before proceeding
    console.log('   Starting update in 3 seconds...');
    await new Promise(resolve => setTimeout(resolve, 1000));
    console.log('   2...');
    await new Promise(resolve => setTimeout(resolve, 1000));
    console.log('   1...');
    await new Promise(resolve => setTimeout(resolve, 1000));
    console.log('\n   🚀 Starting bulk update...\n');

    // Update in batches of 500 (Firestore limit)
    const batchSize = 500;
    let updatedCount = 0;
    let errorCount = 0;
    const errors = [];

    for (let i = 0; i < unpaidPayments.length; i += batchSize) {
      const batch = writeBatch(db);
      const chunk = unpaidPayments.slice(i, i + batchSize);

      console.log(`   Processing batch ${Math.floor(i / batchSize) + 1} (${chunk.length} payments)...`);

      chunk.forEach(payment => {
        const docRef = doc(db, 'payments', payment.id);
        const totalAmount = payment.totalAmount || (payment.rent + payment.electricity) || 0;
        
        // Set payment date to current date if not present
        const paymentDate = payment.paymentDate || Timestamp.now();

        batch.update(docRef, {
          status: 'paid',
          paidAmount: totalAmount,
          paymentDate: paymentDate,
          updatedAt: Timestamp.now(),
          markedPaidBy: 'bulk_script',
          markedPaidAt: Timestamp.now()
        });
      });

      try {
        await batch.commit();
        updatedCount += chunk.length;
        console.log(`   ✅ Batch ${Math.floor(i / batchSize) + 1} completed: ${chunk.length} payments updated`);
      } catch (error) {
        errorCount += chunk.length;
        errors.push(`Batch ${Math.floor(i / batchSize) + 1}: ${error.message}`);
        console.error(`   ❌ Batch ${Math.floor(i / batchSize) + 1} failed:`, error.message);
      }
    }

    console.log('\n================================================================================');
    console.log('\n📊 BULK UPDATE SUMMARY:\n');
    console.log(`   ✅ Successfully updated: ${updatedCount} payments`);
    console.log(`   ❌ Failed: ${errorCount} payments`);
    console.log(`   📋 Total processed: ${unpaidPayments.length} payments\n`);

    if (errors.length > 0) {
      console.log('   Error Details:');
      errors.forEach(err => console.log(`   - ${err}`));
      console.log('');
    }

    console.log('================================================================================\n');
    console.log('✅ Bulk update completed!\n');

    // Show verification instructions
    console.log('📋 NEXT STEPS:\n');
    console.log('   1. Open Firebase Console → Firestore Database');
    console.log('   2. Check payments collection - all should show status: "paid"');
    console.log('   3. Refresh Admin Dashboard - income totals should update');
    console.log('   4. Open History Manager (/history) - verify all rows show PAID status\n');

  } catch (error) {
    console.error('\n❌ FATAL ERROR:', error);
    console.error('\nStack trace:', error.stack);
    process.exit(1);
  }
}

// Run the script
console.log('🚀 BULK PAYMENT UPDATE SCRIPT');
console.log('================================================================================\n');

markAllPaymentsPaid()
  .then(() => {
    console.log('✅ Script completed successfully\n');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Script failed:', error);
    process.exit(1);
  });
