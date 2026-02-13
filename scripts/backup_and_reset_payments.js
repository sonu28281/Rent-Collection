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

const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');

// Initialize Firebase Admin
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const db = admin.firestore();

async function backupAndResetPayments() {
  console.log('🚀 Starting Backup and Reset Process...\n');
  
  const timestamp = Date.now();
  const backupCollectionName = `payments_backup_${timestamp}`;
  
  try {
    // STEP 1: Count original documents
    console.log('📊 Step 1: Counting original documents...');
    const paymentsRef = db.collection('payments');
    const paymentsSnapshot = await paymentsRef.get();
    const originalCount = paymentsSnapshot.size;
    console.log(`✅ Found ${originalCount} documents in 'payments' collection\n`);
    
    if (originalCount === 0) {
      console.log('⚠️  No documents to backup. Exiting.');
      return;
    }
    
    // STEP 2: Create backup collection
    console.log(`💾 Step 2: Creating backup collection '${backupCollectionName}'...`);
    const backupRef = db.collection(backupCollectionName);
    let backedUpCount = 0;
    
    const batchSize = 500;
    const batches = [];
    let currentBatch = db.batch();
    let operationCount = 0;
    
    for (const doc of paymentsSnapshot.docs) {
      const backupDocRef = backupRef.doc(doc.id);
      currentBatch.set(backupDocRef, {
        ...doc.data(),
        backupTimestamp: admin.firestore.FieldValue.serverTimestamp(),
        originalDocId: doc.id
      });
      
      operationCount++;
      backedUpCount++;
      
      // Commit batch when it reaches batchSize
      if (operationCount >= batchSize) {
        batches.push(currentBatch.commit());
        currentBatch = db.batch();
        operationCount = 0;
      }
    }
    
    // Commit remaining operations
    if (operationCount > 0) {
      batches.push(currentBatch.commit());
    }
    
    await Promise.all(batches);
    console.log(`✅ Backed up ${backedUpCount} documents to '${backupCollectionName}'\n`);
    
    // STEP 3: Verify backup
    console.log('🔍 Step 3: Verifying backup...');
    const backupSnapshot = await backupRef.get();
    const backupCount = backupSnapshot.size;
    console.log(`📊 Backup collection contains ${backupCount} documents`);
    
    if (backupCount !== originalCount) {
      throw new Error(`❌ Backup verification failed! Original: ${originalCount}, Backup: ${backupCount}`);
    }
    console.log('✅ Backup verification successful!\n');
    
    // STEP 4: Delete original documents
    console.log('🗑️  Step 4: Deleting documents from original collection...');
    const deleteBatches = [];
    let deleteBatch = db.batch();
    let deleteCount = 0;
    let deleteOperationCount = 0;
    
    for (const doc of paymentsSnapshot.docs) {
      deleteBatch.delete(doc.ref);
      deleteOperationCount++;
      deleteCount++;
      
      if (deleteOperationCount >= batchSize) {
        deleteBatches.push(deleteBatch.commit());
        deleteBatch = db.batch();
        deleteOperationCount = 0;
      }
    }
    
    if (deleteOperationCount > 0) {
      deleteBatches.push(deleteBatch.commit());
    }
    
    await Promise.all(deleteBatches);
    console.log(`✅ Deleted ${deleteCount} documents from 'payments' collection\n`);
    
    // STEP 5: Final verification
    console.log('🔍 Step 5: Final verification...');
    const finalSnapshot = await paymentsRef.get();
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
    console.log(`💡 Original data is safely stored in "${backupCollectionName}"\n`);
    
  } catch (error) {
    console.error('\n' + '='.repeat(60));
    console.error('❌ ERROR DURING BACKUP AND RESET');
    console.error('='.repeat(60));
    console.error(error);
    console.error('\n⚠️  Process aborted. Original data remains untouched.\n');
    process.exit(1);
  }
}

// Run the script
backupAndResetPayments()
  .then(() => {
    console.log('🏁 Script execution completed.');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  });
