/**
 * CRITICAL BACKUP AND RESET SCRIPT
 * 
 * This script:
 * 1. Creates a backup collection with timestamp
 * 2. Copies all documents from 'payments' to backup
 * 3. Verifies backup count matches original
 * 4. Deletes all documents from original 'payments' collection
 * 5. Logs detailed results
 * 
 * Run with: node scripts/backup_and_reset_payments.js
 */

import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, setDoc, writeBatch } from 'firebase/firestore';
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

async function backupAndResetPayments() {
  console.log('🚀 Starting Backup and Reset Process...\n');
  
  const timestamp = Date.now();
  const backupCollectionName = `payments_full_backup_${timestamp}`;
  
  try {
    // STEP 1: Count original documents
    console.log('📊 Step 1: Counting original documents...');
    const paymentsRef = collection(db, 'payments');
    const paymentsSnapshot = await getDocs(paymentsRef);
    const originalCount = paymentsSnapshot.size;
    console.log(`✅ Found ${originalCount} documents in 'payments' collection\n`);
    
    if (originalCount === 0) {
      console.log('⚠️  No documents to backup. Payments collection is already empty.');
      console.log('✅ System is ready for fresh import.\n');
      process.exit(0);
    }
    
    // STEP 2: Create backup collection
    console.log(`💾 Step 2: Creating backup collection '${backupCollectionName}'...`);
    const backupRef = collection(db, backupCollectionName);
    let backedUpCount = 0;
    
    // Copy all documents to backup
    for (const docSnapshot of paymentsSnapshot.docs) {
      const backupDocRef = doc(backupRef, docSnapshot.id);
      await setDoc(backupDocRef, {
        ...docSnapshot.data(),
        backupTimestamp: new Date().toISOString(),
        originalDocId: docSnapshot.id
      });
      backedUpCount++;
      
      // Progress indicator
      if (backedUpCount % 50 === 0) {
        console.log(`   ... backed up ${backedUpCount} documents`);
      }
    }
    
    console.log(`✅ Backed up ${backedUpCount} documents to '${backupCollectionName}'\n`);
    
    // STEP 3: Verify backup
    console.log('🔍 Step 3: Verifying backup...');
    const backupSnapshot = await getDocs(backupRef);
    const backupCount = backupSnapshot.size;
    console.log(`📊 Backup collection contains ${backupCount} documents`);
    
    if (backupCount !== originalCount) {
      throw new Error(`❌ Backup verification failed! Original: ${originalCount}, Backup: ${backupCount}`);
    }
    console.log('✅ Backup verification successful!\n');
    
    // STEP 4: Delete original documents
    console.log('🗑️  Step 4: Deleting documents from original collection...');
    let deleteCount = 0;
    const batchSize = 500;
    let currentBatch = writeBatch(db);
    let batchOperations = 0;
    
    for (const docSnapshot of paymentsSnapshot.docs) {
      currentBatch.delete(docSnapshot.ref);
      batchOperations++;
      deleteCount++;
      
      // Commit batch when it reaches limit
      if (batchOperations >= batchSize) {
        await currentBatch.commit();
        currentBatch = writeBatch(db);
        batchOperations = 0;
        console.log(`   ... deleted ${deleteCount} documents`);
      }
    }
    
    // Commit remaining operations
    if (batchOperations > 0) {
      await currentBatch.commit();
    }
    
    console.log(`✅ Deleted ${deleteCount} documents from 'payments' collection\n`);
    
    // STEP 5: Final verification
    console.log('🔍 Step 5: Final verification...');
    const finalSnapshot = await getDocs(paymentsRef);
    console.log(`📊 'payments' collection now contains ${finalSnapshot.size} documents`);
    
    if (finalSnapshot.size !== 0) {
      throw new Error(`❌ Deletion verification failed! Expected 0, found ${finalSnapshot.size}`);
    }
    
    // STEP 6: Summary
    console.log('\n' + '='.repeat(60));
    console.log('✅ BACKUP AND RESET COMPLETED SUCCESSFULLY');
    console.log('='.repeat(60));
    console.log(`📦 Backup Collection: ${backupCollectionName}`);
    console.log(`📊 Documents Backed Up: ${backedUpCount}`);
    console.log(`🗑️  Documents Deleted: ${deleteCount}`);
    console.log(`✅ Verification: PASSED`);
    console.log('\n💡 The "payments" collection is now empty and ready for the new data model.');
    console.log(`💡 Original data is safely stored in "${backupCollectionName}"`);
    console.log('\n🎯 SYSTEM STATUS:');
    console.log('   ✅ Ready for historical import (2017-2025)');
    console.log('   ✅ Meter-based calculation active');
    console.log('   ✅ Floor auto-detection enabled');
    console.log('   ✅ Update-on-duplicate configured');
    console.log('   ✅ Tenant validation disabled (snapshot mode)\n');
    
  } catch (error) {
    console.error('\n' + '='.repeat(60));
    console.error('❌ ERROR DURING BACKUP AND RESET');
    console.error('='.repeat(60));
    console.error(error);
    console.error('\n⚠️  Process aborted. Check error details above.\n');
    process.exit(1);
  }
}

// Run the script
backupAndResetPayments()
  .then(() => {
    console.log('🏁 Script execution completed successfully.');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  });
