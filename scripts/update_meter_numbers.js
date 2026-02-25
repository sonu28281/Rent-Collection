#!/usr/bin/env node

/**
 * Update Meter Numbers Script
 * 
 * Sets meter numbers for all rooms based on room number
 * Also updates current/previous readings from latest payment records
 * 
 * Usage: node scripts/update_meter_numbers.js
 */

import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, collection, getDocs, doc, updateDoc, query, where, orderBy, limit } from 'firebase/firestore';
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

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Admin credentials
const ADMIN_EMAIL = 'sonu28281@gmail.com';
const ADMIN_PASSWORD = 'kavyA@18deC';

async function updateMeterNumbers() {
  try {
    console.log('🔐 Authenticating as admin...');
    await signInWithEmailAndPassword(auth, ADMIN_EMAIL, ADMIN_PASSWORD);
    console.log('✅ Authenticated successfully\n');

    console.log('🏠 Loading rooms from database...\n');

    // Get all rooms
    const roomsRef = collection(db, 'rooms');
    const roomsSnapshot = await getDocs(roomsRef);
    
    if (roomsSnapshot.empty) {
      console.log('⚠️  No rooms found in database');
      console.log('   Run: node scripts/seed_rooms.js first\n');
      return;
    }

    console.log(`Found ${roomsSnapshot.size} room(s)\n`);
    console.log('=' .repeat(80));

    let successCount = 0;
    let errorCount = 0;

    // Get all payments for reference
    const paymentsRef = collection(db, 'payments');
    const paymentsSnapshot = await getDocs(paymentsRef);
    
    console.log(`Found ${paymentsSnapshot.size} payment records for meter readings\n`);

    // Process each room
    for (const roomDoc of roomsSnapshot.docs) {
      const roomData = roomDoc.data();
      const roomNumber = Number(roomData.roomNumber) || roomData.roomNumber;
      
      try {
        // Prepare update data
        const updateData = {
          electricityMeterNo: String(roomNumber), // Meter number = room number
          updatedAt: new Date().toISOString()
        };

        // Find latest payment record for this room to get current reading
        const roomPaymentsQuery = query(
          paymentsRef,
          where('roomNumber', '==', roomNumber),
          orderBy('year', 'desc'),
          orderBy('month', 'desc'),
          limit(1)
        );
        
        const latestPayment = await getDocs(roomPaymentsQuery);
        
        if (!latestPayment.empty) {
          const paymentData = latestPayment.docs[0].data();
          updateData.currentReading = Number(paymentData.currentReading) || 0;
          updateData.previousReading = Number(paymentData.oldReading) || 0;
          
          console.log(`📍 Room ${roomNumber}:`);
          console.log(`   ✓ Meter Number: ${roomNumber}`);
          console.log(`   ✓ Current Reading: ${updateData.currentReading}`);
          console.log(`   ✓ Previous Reading: ${updateData.previousReading}`);
          console.log(`   📅 Latest record: ${paymentData.month}/${paymentData.year}`);
        } else {
          // No payment records, set to 0
          updateData.currentReading = 0;
          updateData.previousReading = 0;
          
          console.log(`📍 Room ${roomNumber}:`);
          console.log(`   ✓ Meter Number: ${roomNumber}`);
          console.log(`   ⚠️  No payment records found - readings set to 0`);
        }

        // Update room
        await updateDoc(doc(db, 'rooms', roomDoc.id), updateData);
        console.log(`   ✅ Updated successfully\n`);
        successCount++;

      } catch (error) {
        console.error(`   ❌ Error updating room ${roomNumber}:`, error.message, '\n');
        errorCount++;
      }
    }

    // Summary
    console.log('=' .repeat(80));
    console.log('📊 UPDATE SUMMARY');
    console.log('=' .repeat(80));
    console.log(`✅ Successfully updated: ${successCount} rooms`);
    if (errorCount > 0) {
      console.log(`❌ Errors: ${errorCount}`);
    }
    console.log('=' .repeat(80));
    
    console.log('\n💡 Next Steps:');
    console.log('   1. Check Rooms page to verify meter numbers');
    console.log('   2. If you have historical CSV data, import it via Import CSV page');
    console.log('   3. Meter readings will auto-update from payment records');
    console.log('   4. Vacancy Report will show data once payments are imported\n');

  } catch (error) {
    console.error('\n💥 Script failed:', error);
    process.exit(1);
  }
}

// Run the script
updateMeterNumbers();
