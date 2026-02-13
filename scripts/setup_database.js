/**
 * Database Setup and Migration Script
 * 
 * This script ensures all required Firestore collections exist with correct schema
 * Run this after initial Firebase setup or when schema changes
 * 
 * Usage: node scripts/setup_database.js
 */

import { initializeApp } from 'firebase/app';
import { getFirestore, collection, doc, getDoc, setDoc, getDocs } from 'firebase/firestore';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Firebase configuration from env
const firebaseConfig = {
  apiKey: process.env.VITE_FIREBASE_API_KEY,
  authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.VITE_FIREBASE_APP_ID,
  measurementId: process.env.VITE_FIREBASE_MEASUREMENT_ID
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

console.log('\n🔧 Autoxweb Rent - Database Setup Script\n');
console.log('=' .repeat(60));

// Required collections with their schemas
const REQUIRED_COLLECTIONS = {
  rooms: {
    description: '12 room documents (101-106, 201-206)',
    sampleFields: {
      roomNumber: 'string',
      floor: 'number',
      isOccupied: 'boolean',
      createdAt: 'timestamp'
    }
  },
  tenants: {
    description: 'Tenant records with unique tokens',
    sampleFields: {
      name: 'string',
      phone: 'string',
      roomNumber: 'string',
      currentRent: 'number',
      customElectricityRate: 'number | null',
      isActive: 'boolean',
      checkInDate: 'timestamp',
      checkOutDate: 'timestamp | null',
      nextIncreaseDate: 'timestamp',
      uniqueToken: 'string (48 char hex)',
      preferredLanguage: 'string',
      kycAadharUrl: 'string | null',
      kycPanUrl: 'string | null',
      createdAt: 'timestamp'
    }
  },
  payments: {
    description: 'Payment records (rent + electricity)',
    sampleFields: {
      tenantId: 'string',
      tenantName: 'string',
      roomNumber: 'string',
      rentAmount: 'number',
      electricityAmount: 'number',
      totalAmount: 'number',
      month: 'number (1-12)',
      year: 'number (YYYY)',
      paymentDate: 'timestamp',
      paymentMode: 'string (cash/upi/bank)',
      status: 'string (paid/pending)',
      createdAt: 'timestamp'
    }
  },
  maintenance: {
    description: 'Maintenance and repair records',
    sampleFields: {
      type: 'string',
      roomNumber: 'string | null',
      description: 'string',
      cost: 'number',
      date: 'timestamp',
      billPhotoUrl: 'string | null',
      createdAt: 'timestamp'
    }
  },
  bankAccounts: {
    description: 'UPI/bank account details',
    sampleFields: {
      upiId: 'string',
      nickname: 'string',
      qrImageUrl: 'string | null',
      isActive: 'boolean',
      createdAt: 'timestamp'
    }
  },
  settings: {
    description: 'Global application settings',
    documentId: 'global',
    sampleFields: {
      defaultElectricityRate: 'number',
      annualIncreasePercentage: 'number',
      paymentMode: 'string',
      reminderDaysBefore: 'number',
      defaultLanguage: 'string'
    }
  },
  electricityReadings: {
    description: 'Monthly meter readings',
    sampleFields: {
      tenantId: 'string',
      roomNumber: 'string',
      year: 'number',
      month: 'number',
      previousReading: 'number',
      currentReading: 'number',
      units: 'number',
      pricePerUnit: 'number',
      totalAmount: 'number',
      photoUrl: 'string | null',
      verified: 'boolean',
      createdAt: 'timestamp'
    }
  },
  importLogs: {
    description: 'CSV import history',
    sampleFields: {
      fileName: 'string',
      rowsImported: 'number',
      rowsFailed: 'number',
      errors: 'array',
      importedAt: 'timestamp'
    }
  },
  logs: {
    description: 'Audit trail (rent increases, etc.)',
    sampleFields: {
      actor: 'string',
      action: 'string',
      payload: 'object',
      status: 'string',
      timestamp: 'timestamp'
    }
  }
};

/**
 * Check if a collection exists and has documents
 */
async function checkCollection(collectionName) {
  try {
    const colRef = collection(db, collectionName);
    const snapshot = await getDocs(colRef);
    return {
      exists: true,
      count: snapshot.size,
      empty: snapshot.empty
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

/**
 * Initialize settings collection with defaults
 */
async function initializeSettings() {
  try {
    const settingsRef = doc(db, 'settings', 'global');
    const settingsDoc = await getDoc(settingsRef);
    
    if (!settingsDoc.exists()) {
      const defaultSettings = {
        defaultElectricityRate: 7.5,
        annualIncreasePercentage: 10,
        paymentMode: 'manual',
        reminderDaysBefore: 3,
        defaultLanguage: 'en',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      
      await setDoc(settingsRef, defaultSettings);
      console.log('✅ Settings document initialized with defaults');
      return true;
    } else {
      console.log('✓ Settings document already exists');
      return false;
    }
  } catch (error) {
    console.error('❌ Error initializing settings:', error.message);
    return false;
  }
}

/**
 * Main audit function
 */
async function auditDatabase() {
  console.log('\n📊 Auditing Firestore Collections...\n');
  
  let totalCollections = 0;
  let existingCollections = 0;
  let emptyCollections = 0;
  
  for (const [collectionName, config] of Object.entries(REQUIRED_COLLECTIONS)) {
    totalCollections++;
    process.stdout.write(`Checking: ${collectionName.padEnd(25)}`);
    
    const status = await checkCollection(collectionName);
    
    if (status.exists && !status.empty) {
      console.log(`✅ ${status.count} documents`);
      existingCollections++;
    } else if (status.exists && status.empty) {
      console.log(`⚠️  Collection exists but empty`);
      emptyCollections++;
    } else {
      console.log(`❌ Not found or no documents`);
    }
  }
  
  console.log('\n' + '='.repeat(60));
  console.log(`\n📈 Summary:`);
  console.log(`   Total collections required: ${totalCollections}`);
  console.log(`   Collections with data: ${existingCollections}`);
  console.log(`   Empty collections: ${emptyCollections}`);
  console.log(`   Missing: ${totalCollections - existingCollections - emptyCollections}`);
  
  return { totalCollections, existingCollections, emptyCollections };
}

/**
 * Display schema documentation
 */
function displaySchemas() {
  console.log('\n\n📚 Required Collection Schemas:\n');
  console.log('='.repeat(60));
  
  for (const [collectionName, config] of Object.entries(REQUIRED_COLLECTIONS)) {
    console.log(`\n${collectionName.toUpperCase()}`);
    console.log(`Description: ${config.description}`);
    if (config.documentId) {
      console.log(`Document ID: ${config.documentId}`);
    }
    console.log('\nFields:');
    for (const [field, type] of Object.entries(config.sampleFields)) {
      console.log(`  - ${field.padEnd(25)} : ${type}`);
    }
    console.log('-'.repeat(60));
  }
}

/**
 * Main execution
 */
async function main() {
  try {
    // Run audit
    const summary = await auditDatabase();
    
    // Initialize settings if needed
    console.log('\n🔧 Checking settings...');
    await initializeSettings();
    
    // Display schemas
    displaySchemas();
    
    // Recommendations
    console.log('\n💡 Next Steps:\n');
    
    if (summary.existingCollections === 0) {
      console.log('   1. Run: npm run seed:rooms (to create 12 room documents)');
      console.log('   2. Add your first tenant via the UI');
      console.log('   3. Import historical payment data (if available)');
    } else if (summary.emptyCollections > 0) {
      console.log('   ⚠️  Some collections are empty. Add data via:');
      console.log('      - Rooms: npm run seed:rooms');
      console.log('      - Tenants: Use the Tenants page in UI');
      console.log('      - Payments: Import CSV or record manually');
    } else {
      console.log('   ✅ Database structure looks good!');
      console.log('   ℹ️  Continue using the application normally.');
    }
    
    console.log('\n📝 Important Notes:');
    console.log('   - year and month must be stored as numbers');
    console.log('   - rentAmount, electricityAmount, totalAmount must be numbers');
    console.log('   - Use ImportCSV module to import historical data into payments collection');
    console.log('   - Dashboard will auto-calculate financial summaries from payments collection');
    
    console.log('\n✨ Setup complete!\n');
    
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Setup failed:', error);
    process.exit(1);
  }
}

// Run the script
main();
