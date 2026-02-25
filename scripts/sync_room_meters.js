#!/usr/bin/env node

/**
 * Sync Room Meters Script
 * 
 * Updates rooms collection with:
 * - Meter numbers matching room numbers (e.g., Room 101 → Meter 101)
 * - Latest meter readings from historical payment data (2017-2025)
 * - Current and previous readings
 * 
 * Usage: node scripts/sync_room_meters.js
 */

import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, collection, getDocs, doc, updateDoc, query, where, orderBy } from 'firebase/firestore';
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

async function syncRoomMeters() {
  try {
    console.log('🔐 Authenticating as admin...');
    await signInWithEmailAndPassword(auth, ADMIN_EMAIL, ADMIN_PASSWORD);
    console.log('✅ Authenticated successfully\n');

    console.log('🔍 Loading rooms and payment history...\n');

    // Load all rooms
    const roomsRef = collection(db, 'rooms');
    const roomsSnapshot = await getDocs(roomsRef);
    
    if (roomsSnapshot.empty) {
      console.log('❌ No rooms found in database');
      process.exit(1);
    }

    const rooms = [];
    roomsSnapshot.forEach(doc => {
      rooms.push({ id: doc.id, ...doc.data() });
    });

    console.log(`📊 Found ${rooms.length} rooms\n`);

    // Load all payments
    const paymentsRef = collection(db, 'payments');
    const paymentsSnapshot = await getDocs(paymentsRef);
    
    console.log(`📊 Found ${paymentsSnapshot.size} payment records\n`);

    if (paymentsSnapshot.empty) {
      console.log('⚠️  No payment records found. Will only update meter numbers.\n');
    }

    // Group payments by room
    const paymentsByRoom = {};
    paymentsSnapshot.forEach(doc => {
      const payment = doc.data();
      const roomNum = payment.roomNumber;
      
      if (!paymentsByRoom[roomNum]) {
        paymentsByRoom[roomNum] = [];
      }
      
      paymentsByRoom[roomNum].push({
        year: payment.year,
        month: payment.month,
        currentReading: payment.currentReading || 0,
        previousReading: payment.previousReading || 0,
        units: payment.units || 0
      });
    });

    // Sort payments by year and month to get latest readings
    Object.keys(paymentsByRoom).forEach(roomNum => {
      paymentsByRoom[roomNum].sort((a, b) => {
        if (a.year !== b.year) return b.year - a.year; // Descending year
        return b.month - a.month; // Descending month
      });
    });

    console.log('🔧 Updating rooms with meter data...\n');

    let successCount = 0;
    let errorCount = 0;

    for (const room of rooms) {
      try {
        const roomNumber = Number(room.roomNumber);
        
        if (isNaN(roomNumber)) {
          console.log(`⚠️  Room ${room.roomNumber}: Invalid room number`);
          errorCount++;
          continue;
        }

        // Prepare update data
        const updateData = {
          electricityMeterNo: `MTR${roomNumber}`, // Meter number matches room number
          updatedAt: new Date().toISOString()
        };

        // Get latest meter readings from payments
        const roomPayments = paymentsByRoom[roomNumber] || [];
        
        if (roomPayments.length > 0) {
          const latestPayment = roomPayments[0]; // Most recent
          updateData.currentReading = latestPayment.currentReading || 0;
          updateData.previousReading = latestPayment.previousReading || 0;
          
          console.log(`✅ Room ${roomNumber}: Meter MTR${roomNumber}, Current: ${updateData.currentReading}, Previous: ${updateData.previousReading}`);
        } else {
          // No historical data, set to 0
          updateData.currentReading = 0;
          updateData.previousReading = 0;
          
          console.log(`✅ Room ${roomNumber}: Meter MTR${roomNumber} (no historical data)`);
        }

        // Update room document
        await updateDoc(doc(db, 'rooms', room.id), updateData);
        successCount++;

      } catch (error) {
        console.error(`❌ Error updating room ${room.roomNumber}:`, error.message);
        errorCount++;
      }
    }

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 SYNC SUMMARY');
    console.log('='.repeat(60));
    console.log(`✅ Successfully updated: ${successCount} rooms`);
    if (errorCount > 0) {
      console.log(`❌ Errors: ${errorCount}`);
    }
    console.log(`📋 Total payment records processed: ${paymentsSnapshot.size}`);
    console.log('='.repeat(60));

    console.log('\n✨ Room meter sync completed!\n');
    process.exit(0);

  } catch (error) {
    console.error('\n❌ Fatal error:', error);
    process.exit(1);
  }
}

// Run the script
syncRoomMeters();
