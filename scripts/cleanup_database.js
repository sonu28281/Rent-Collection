/**
 * DATABASE CLEANUP SCRIPT
 * 
 * Clears transactional data to free up Firebase quota:
 * - Deletes all payment records
 * - Deletes all import logs
 * - KEEPS essential data: admin, rooms, tenants, settings, bankAccounts
 * 
 * Run with: node scripts/cleanup_database.js
 */

import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, writeBatch, doc } from 'firebase/firestore';
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

/**
 * Delete all documents from a collection in batches
 */
async function clearCollection(collectionName) {
  console.log(`\n🗑️  Clearing collection: ${collectionName}`);
  
  const collectionRef = collection(db, collectionName);
  const snapshot = await getDocs(collectionRef);
  const totalDocs = snapshot.size;
  
  if (totalDocs === 0) {
    console.log(`   ℹ️  Collection is already empty`);
    return 0;
  }
  
  console.log(`   📊 Found ${totalDocs} documents to delete`);
  
  let deletedCount = 0;
  let batch = writeBatch(db);
  let batchCount = 0;
  
  for (const docSnap of snapshot.docs) {
    batch.delete(doc(db, collectionName, docSnap.id));
    batchCount++;
    
    // Firestore batch limit is 500 operations
    if (batchCount === 500) {
      await batch.commit();
      deletedCount += batchCount;
      console.log(`   ⏳ Deleted ${deletedCount}/${totalDocs} documents...`);
      batch = writeBatch(db);
      batchCount = 0;
    }
  }
  
  // Commit remaining documents
  if (batchCount > 0) {
    await batch.commit();
    deletedCount += batchCount;
  }
  
  console.log(`   ✅ Successfully deleted ${deletedCount} documents from ${collectionName}`);
  return deletedCount;
}

/**
 * Get count of documents in a collection
 */
async function getCollectionCount(collectionName) {
  try {
    const snapshot = await getDocs(collection(db, collectionName));
    return snapshot.size;
  } catch (error) {
    return 0;
  }
}

/**
 * Main cleanup function
 */
async function cleanupDatabase() {
  console.log('🚀 DATABASE CLEANUP STARTED');
  console.log('=' .repeat(60));
  console.log('⚠️  This will delete ALL payment and import log data');
  console.log('✓  Essential data (admin, rooms, tenants) will be preserved');
  console.log('=' .repeat(60));
  
  try {
    // Show current state
    console.log('\n📊 CURRENT DATABASE STATE:');
    const paymentsCount = await getCollectionCount('payments');
    const importLogsCount = await getCollectionCount('importLogs');
    const roomsCount = await getCollectionCount('rooms');
    const tenantsCount = await getCollectionCount('tenants');
    const adminCount = await getCollectionCount('admin');
    const settingsCount = await getCollectionCount('settings');
    const bankAccountsCount = await getCollectionCount('bankAccounts');
    
    console.log(`   • Payments: ${paymentsCount} records`);
    console.log(`   • Import Logs: ${importLogsCount} records`);
    console.log(`   • Rooms: ${roomsCount} records (will keep)`);
    console.log(`   • Tenants: ${tenantsCount} records (will keep)`);
    console.log(`   • Admin: ${adminCount} records (will keep)`);
    console.log(`   • Settings: ${settingsCount} records (will keep)`);
    console.log(`   • Bank Accounts: ${bankAccountsCount} records (will keep)`);
    
    const totalToDelete = paymentsCount + importLogsCount;
    console.log(`\n📉 Total documents to delete: ${totalToDelete}`);
    
    if (totalToDelete === 0) {
      console.log('\n✨ Database is already clean! No data to delete.');
      return;
    }
    
    // Clear transactional data
    console.log('\n🗑️  CLEARING TRANSACTIONAL DATA:');
    const deletedPayments = await clearCollection('payments');
    const deletedLogs = await clearCollection('importLogs');
    
    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('✅ CLEANUP COMPLETED SUCCESSFULLY');
    console.log('='.repeat(60));
    console.log(`📊 Summary:`);
    console.log(`   • Deleted ${deletedPayments} payment records`);
    console.log(`   • Deleted ${deletedLogs} import logs`);
    console.log(`   • Total freed: ${deletedPayments + deletedLogs} documents`);
    console.log(`\n✓ Essential data preserved: rooms, tenants, admin, settings, bankAccounts`);
    console.log(`\n🎯 Database is ready for fresh import!`);
    
  } catch (error) {
    console.error('\n❌ ERROR during cleanup:', error);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run the cleanup
cleanupDatabase()
  .then(() => {
    console.log('\n✨ Script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Script failed:', error);
    process.exit(1);
  });
