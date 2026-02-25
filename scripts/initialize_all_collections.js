#!/usr/bin/env node

/**
 * Initialize All Database Collections
 * 
 * Creates all required collections with sample data:
 * - payments (with data for existing tenants)
 * - electricityReadings
 * - settings
 * 
 * Usage: node scripts/initialize_all_collections.js
 */

import { initializeApp } from 'firebase/app';
import { getFirestore, collection, doc, setDoc, getDocs, query, where } from 'firebase/firestore';
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

let successCount = 0;
let errorCount = 0;

console.log('\n🚀 INITIALIZING ALL DATABASE COLLECTIONS\n');
console.log('='.repeat(80));

// Create settings collection
async function createSettings() {
  try {
    console.log('\n📋 Creating settings collection...');
    
    const settingsData = {
      defaultElectricityRate: 9,
      annualRentIncreasePercent: 10,
      paymentMode: 'manual',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    await setDoc(doc(db, 'settings', 'global'), settingsData, { merge: true });
    
    console.log('   ✅ settings/global document created');
    console.log(`      - Electricity Rate: ₹${settingsData.defaultElectricityRate}/unit`);
    console.log(`      - Annual Increase: ${settingsData.annualRentIncreasePercent}%`);
    successCount++;
  } catch (error) {
    console.error('   ❌ Failed to create settings:', error.message);
    errorCount++;
  }
}

// Create payments for all active tenants
async function createPayments() {
  try {
    console.log('\n💰 Creating payments collection...');
    
    // Get all active tenants
    const tenantsRef = collection(db, 'tenants');
    const tenantsSnapshot = await getDocs(query(tenantsRef, where('isActive', '==', true)));
    
    if (tenantsSnapshot.empty) {
      console.log('   ⚠️  No active tenants found. Skipping payments creation.');
      return;
    }

    console.log(`   Found ${tenantsSnapshot.size} active tenant(s)\n`);

    const currentYear = 2026;
    const months = [1, 2]; // January and February 2026

    for (const tenantDoc of tenantsSnapshot.docs) {
      const tenant = tenantDoc.data();
      const tenantId = tenantDoc.id;
      const tenantName = tenant.name;
      const roomNumber = Number(tenant.roomNumber) || 101;
      const rentAmount = Number(tenant.currentRent) || 5000;

      console.log(`   📝 Creating payments for: ${tenantName} (Room ${roomNumber})`);

      for (const month of months) {
        const paymentId = `${tenantId}_${currentYear}_${month}`;
        
        // Check if payment already exists
        const existingDoc = await getDocs(
          query(
            collection(db, 'payments'),
            where('tenantId', '==', tenantId),
            where('year', '==', currentYear),
            where('month', '==', month)
          )
        );

        if (!existingDoc.empty) {
          console.log(`      ⏭️  Skipped ${month}/${currentYear} (already exists)`);
          continue;
        }

        const electricity = 400 + Math.floor(Math.random() * 200); // 400-600
        const totalAmount = rentAmount + electricity;
        
        // First month paid, second month unpaid
        const isPaid = month === 1;
        const status = isPaid ? 'paid' : 'unpaid';
        const paidAmount = isPaid ? totalAmount : 0;
        const paymentDate = isPaid ? new Date(currentYear, month - 1, 5).toISOString() : null;

        const paymentData = {
          tenantId,
          tenantName,
          roomNumber,
          year: currentYear,
          month,
          rent: rentAmount,
          electricity,
          totalAmount,
          paidAmount,
          status,
          paymentDate,
          paymentMode: isPaid ? 'upi' : 'cash',
          createdAt: new Date().toISOString()
        };

        await setDoc(doc(db, 'payments', paymentId), paymentData);
        
        const monthName = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][month - 1];
        console.log(`      ✅ ${monthName} ${currentYear}: ₹${totalAmount} (${status})`);
        successCount++;
      }
    }

    console.log(`\n   ✅ Payments collection created with ${successCount - 1} records`);
  } catch (error) {
    console.error('   ❌ Failed to create payments:', error.message);
    errorCount++;
  }
}

// Create electricity readings
async function createElectricityReadings() {
  try {
    console.log('\n⚡ Creating electricityReadings collection...');
    
    // Get all active tenants
    const tenantsRef = collection(db, 'tenants');
    const tenantsSnapshot = await getDocs(query(tenantsRef, where('isActive', '==', true)));
    
    if (tenantsSnapshot.empty) {
      console.log('   ⚠️  No active tenants found. Skipping electricity readings.');
      return;
    }

    const currentYear = 2026;
    const currentMonth = 2; // February

    for (const tenantDoc of tenantsSnapshot.docs) {
      const tenant = tenantDoc.data();
      const tenantId = tenantDoc.id;
      const roomNumber = Number(tenant.roomNumber) || 101;
      const rate = Number(tenant.customElectricityRate) || 9;

      const readingId = `${tenantId}_${currentYear}_${currentMonth}`;
      
      // Check if reading already exists
      const existingDoc = await getDocs(
        query(
          collection(db, 'electricityReadings'),
          where('tenantId', '==', tenantId),
          where('year', '==', currentYear),
          where('month', '==', currentMonth)
        )
      );

      if (!existingDoc.empty) {
        console.log(`   ⏭️  Skipped reading for ${tenant.name} (already exists)`);
        continue;
      }

      const previousReading = 1000 + Math.floor(Math.random() * 500);
      const currentReading = previousReading + 50 + Math.floor(Math.random() * 30); // 50-80 units
      const units = currentReading - previousReading;
      const totalBill = Math.round(units * rate);

      const readingData = {
        tenantId,
        roomNumber,
        year: currentYear,
        month: currentMonth,
        previousReading,
        currentReading,
        units,
        pricePerUnit: rate,
        totalBill,
        createdAt: new Date().toISOString()
      };

      await setDoc(doc(db, 'electricityReadings', readingId), readingData);
      
      console.log(`   ✅ ${tenant.name}: ${units} units = ₹${totalBill}`);
      successCount++;
    }

    console.log(`\n   ✅ Electricity readings created`);
  } catch (error) {
    console.error('   ❌ Failed to create electricity readings:', error.message);
    errorCount++;
  }
}

// Verify collections
async function verifyCollections() {
  console.log('\n🔍 Verifying created collections...\n');
  
  const collections = ['payments', 'electricityReadings', 'settings'];
  
  for (const collectionName of collections) {
    try {
      const collectionRef = collection(db, collectionName);
      const snapshot = await getDocs(collectionRef);
      
      if (snapshot.empty) {
        console.log(`   ⚠️  ${collectionName}: Empty (0 documents)`);
      } else {
        console.log(`   ✅ ${collectionName}: ${snapshot.size} document(s)`);
      }
    } catch (error) {
      console.log(`   ❌ ${collectionName}: Not found or error`);
    }
  }
}

// Main execution
async function initializeAll() {
  try {
    await createSettings();
    await createPayments();
    await createElectricityReadings();
    await verifyCollections();

    console.log('\n' + '='.repeat(80));
    console.log('\n📊 INITIALIZATION SUMMARY:\n');
    console.log(`   ✅ Successful operations: ${successCount}`);
    console.log(`   ❌ Failed operations: ${errorCount}`);
    
    if (errorCount > 0) {
      console.log('\n⚠️  Some operations failed. Check error messages above.');
    } else {
      console.log('\n🎉 All collections initialized successfully!');
    }

    console.log('\n📋 NEXT STEPS:\n');
    console.log('   1. Refresh Firebase Console → You should see:');
    console.log('      - payments collection');
    console.log('      - electricityReadings collection');
    console.log('      - settings collection');
    console.log('\n   2. Refresh Admin Dashboard → You should see:');
    console.log('      - Pending Payments count updated');
    console.log('      - This Month Income (if any paid payments)');
    console.log('      - Year-wise income table populated');
    console.log('\n   3. Create composite index in Firebase Console:');
    console.log('      Collection: payments');
    console.log('      Fields: tenantId + year + month');
    console.log('      URL: https://console.firebase.google.com/project/rent-collection-5e1d2/firestore/indexes\n');
    
    console.log('='.repeat(80));
    console.log('\n✅ Database initialization complete!\n');

  } catch (error) {
    console.error('\n❌ Initialization failed:', error.message);
    console.error(error);
    process.exit(1);
  }
}

// Run initialization
initializeAll()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
