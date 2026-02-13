#!/usr/bin/env node

/**
 * Database Structure Verification Script
 * 
 * Ensures all required Firestore collections exist and validates structure
 * according to Phase specifications.
 * 
 * Usage: node scripts/verify_database_structure.js
 */

import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, setDoc } from 'firebase/firestore';
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

// Required collections with their field structure
const REQUIRED_COLLECTIONS = {
  tenants: {
    description: 'Tenant Records',
    requiredFields: [
      'name (string)',
      'phone (string)',
      'roomNumber (number)',
      'currentRent (number)',
      'customElectricityRate (number | null)',
      'isActive (boolean)',
      'preferredLanguage (en | hi)',
      'nextIncreaseDate (timestamp)',
      'createdAt (timestamp)',
      'updatedAt (timestamp)'
    ]
  },
  rooms: {
    description: 'Room Records',
    requiredFields: [
      'roomNumber (number)',
      'floor (number)',
      'isOccupied (boolean)',
      'currentTenantId (reference | null)'
    ]
  },
  payments: {
    description: 'Monthly Payment Records (PRIMARY)',
    requiredFields: [
      'tenantId (reference)',
      'tenantName (string)',
      'roomNumber (number)',
      'year (number - YYYY)',
      'month (number - 1-12)',
      'rent (number)',
      'electricity (number)',
      'totalAmount (number)',
      'paidAmount (number)',
      'status (paid | partial | unpaid)',
      'paymentDate (timestamp | null)',
      'createdAt (timestamp)'
    ],
    indexRequired: 'tenantId + year + month (composite)'
  },
  electricityReadings: {
    description: 'Meter Readings',
    requiredFields: [
      'tenantId',
      'roomNumber',
      'year (number)',
      'month (number)',
      'previousReading',
      'currentReading',
      'units',
      'pricePerUnit',
      'totalBill'
    ]
  },
  bankAccounts: {
    description: 'Bank/UPI Details',
    requiredFields: [
      'accountName',
      'upiId',
      'qrImageUrl',
      'isActive (boolean)',
      'createdAt'
    ],
    note: 'Only one account should be active at a time'
  },
  importLogs: {
    description: 'CSV Import History',
    requiredFields: [
      'fileName',
      'totalRows',
      'successCount',
      'errorCount',
      'errors (array)',
      'importedAt (timestamp)'
    ]
  },
  settings: {
    description: 'Global Settings (Single Document)',
    requiredFields: [
      'defaultElectricityRate (number)',
      'annualRentIncreasePercent (number)',
      'paymentMode (manual | automatic)'
    ],
    note: 'Should contain only ONE document with ID: global'
  }
};

// Check if collection exists and has documents
async function checkCollection(collectionName) {
  try {
    const collectionRef = collection(db, collectionName);
    const snapshot = await getDocs(collectionRef);
    
    return {
      exists: true,
      count: snapshot.size,
      empty: snapshot.empty,
      sampleDoc: snapshot.empty ? null : snapshot.docs[0].data()
    };
  } catch (error) {
    return {
      exists: false,
      count: 0,
      empty: true,
      error: error.message
    };
  }
}

// Initialize settings document if needed
async function initializeSettings() {
  try {
    const settingsDoc = doc(db, 'settings', 'global');
    await setDoc(settingsDoc, {
      defaultElectricityRate: 8.5,
      annualRentIncreasePercent: 10,
      paymentMode: 'manual',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }, { merge: true });
    return true;
  } catch (error) {
    console.error('Failed to initialize settings:', error.message);
    return false;
  }
}

// Validate field types in a sample document
function validateFieldTypes(collectionName, sampleDoc, requiredFields) {
  const issues = [];
  
  if (!sampleDoc) {
    return ['No documents found to validate'];
  }

  // Check for critical field type issues
  if (collectionName === 'payments') {
    // Validate year/month are numbers
    if (typeof sampleDoc.year !== 'number') {
      issues.push(`⚠️  'year' should be number, found: ${typeof sampleDoc.year}`);
    }
    if (typeof sampleDoc.month !== 'number') {
      issues.push(`⚠️  'month' should be number, found: ${typeof sampleDoc.month}`);
    }
    if (typeof sampleDoc.roomNumber !== 'number') {
      issues.push(`⚠️  'roomNumber' should be number, found: ${typeof sampleDoc.roomNumber}`);
    }
    
    // Check for old field names
    if ('rentAmount' in sampleDoc || 'electricityAmount' in sampleDoc) {
      issues.push('⚠️  Found old field names (rentAmount/electricityAmount) - should be rent/electricity');
    }
    
    // Check for required new fields
    if (!('paidAmount' in sampleDoc)) {
      issues.push('⚠️  Missing "paidAmount" field (required in new schema)');
    }
  }
  
  if (collectionName === 'rooms') {
    if (typeof sampleDoc.roomNumber !== 'number') {
      issues.push(`⚠️  'roomNumber' should be number, found: ${typeof sampleDoc.roomNumber}`);
    }
  }
  
  return issues;
}

// Main verification function
async function verifyDatabaseStructure() {
  console.log('\n🔍 PHASE: DATABASE STRUCTURE VERIFICATION\n');
  console.log('=' .repeat(80));
  console.log('\nChecking all required Firestore collections...\n');

  const results = {};
  let totalCollections = 0;
  let existingCollections = 0;
  let emptyCollections = 0;
  let issuesFound = [];

  // Check each required collection
  for (const [collectionName, config] of Object.entries(REQUIRED_COLLECTIONS)) {
    totalCollections++;
    
    console.log(`\n📋 Collection: ${collectionName}`);
    console.log(`   Description: ${config.description}`);
    
    const result = await checkCollection(collectionName);
    results[collectionName] = result;
    
    if (result.exists) {
      if (result.empty) {
        console.log(`   Status: ⚠️  EXISTS but EMPTY (${result.count} documents)`);
        emptyCollections++;
      } else {
        console.log(`   Status: ✅ EXISTS with ${result.count} document(s)`);
        existingCollections++;
        
        // Validate field types
        const validationIssues = validateFieldTypes(collectionName, result.sampleDoc, config.requiredFields);
        if (validationIssues.length > 0) {
          console.log('   ⚠️  Validation Issues:');
          validationIssues.forEach(issue => {
            console.log(`      ${issue}`);
            issuesFound.push(`${collectionName}: ${issue}`);
          });
        }
      }
    } else {
      console.log(`   Status: ❌ NOT FOUND`);
      if (result.error) {
        console.log(`   Error: ${result.error}`);
      }
    }
    
    // Display required fields
    console.log('   Required Fields:');
    config.requiredFields.forEach(field => {
      console.log(`      - ${field}`);
    });
    
    if (config.note) {
      console.log(`   📝 Note: ${config.note}`);
    }
    
    if (config.indexRequired) {
      console.log(`   🔗 Index Required: ${config.indexRequired}`);
    }
  }

  // Initialize settings if needed
  console.log('\n' + '-'.repeat(80));
  console.log('\n⚙️  Initializing Settings (if needed)...');
  const settingsInitialized = await initializeSettings();
  if (settingsInitialized) {
    console.log('   ✅ Settings document created/updated');
  }

  // Summary
  console.log('\n' + '='.repeat(80));
  console.log('\n📊 VERIFICATION SUMMARY:\n');
  console.log(`   Total collections required: ${totalCollections}`);
  console.log(`   Collections with data: ${existingCollections} ✅`);
  console.log(`   Empty collections: ${emptyCollections} ⚠️`);
  console.log(`   Missing collections: ${totalCollections - existingCollections - emptyCollections} ❌`);
  
  if (issuesFound.length > 0) {
    console.log(`\n   ⚠️  ${issuesFound.length} validation issue(s) found:`);
    issuesFound.forEach((issue, i) => {
      console.log(`      ${i + 1}. ${issue}`);
    });
  }

  // Next steps
  console.log('\n' + '='.repeat(80));
  console.log('\n📝 NEXT STEPS:\n');
  
  if (emptyCollections > 0 || existingCollections < totalCollections) {
    console.log('   1. Add data to empty collections:');
    console.log('      - Rooms: Run "npm run seed:rooms"');
    console.log('      - Tenants: Add via Admin Panel → Tenants');
    console.log('      - Payments: Import CSV via ImportCSV module');
    console.log('      - Bank Accounts: Add via Admin Panel → Bank Accounts');
  }
  
  if (issuesFound.length > 0) {
    console.log('\n   2. Fix validation issues:');
    console.log('      - Update existing documents to use new schema');
    console.log('      - Run migration script if needed');
    console.log('      - Re-import CSV files with correct format');
  }
  
  console.log('\n   3. Verify Dashboard calculations:');
  console.log('      - Check dashboard shows dynamic data (not placeholders)');
  console.log('      - Verify year-wise and month-wise aggregations');
  
  console.log('\n   4. Test CSV import:');
  console.log('      - Ensure CSV importer writes to payments collection');
  console.log('      - Verify year/month as numbers');
  console.log('      - Check duplicate detection works');

  console.log('\n' + '='.repeat(80));
  console.log('\n✅ Database structure verification complete!\n');
}

// Run verification
verifyDatabaseStructure()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Verification failed:', error);
    process.exit(1);
  });
