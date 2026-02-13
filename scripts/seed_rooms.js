#!/usr/bin/env node

/**
 * Seed Rooms Script
 * Creates 12 rooms in Firestore (101-106, 201-206)
 * Run: node scripts/seed_rooms.js
 */

import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, collection, doc, setDoc, getDocs } from 'firebase/firestore';
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables from .env file
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

// Room configuration
const FLOOR_1_ROOMS = [101, 102, 103, 104, 105, 106];
const FLOOR_2_ROOMS = [201, 202, 203, 204, 205, 206];
const DEFAULT_RENT = 5000; // Base rent per room

async function seedRooms() {
  try {
    console.log('🔐 Authenticating as admin...');
    await signInWithEmailAndPassword(auth, ADMIN_EMAIL, ADMIN_PASSWORD);
    console.log('✅ Authenticated successfully\n');

    console.log('🏠 Starting room seeding...\n');

    // Check if rooms already exist
    const roomsRef = collection(db, 'rooms');
    const existingRooms = await getDocs(roomsRef);
    
    if (existingRooms.size > 0) {
      console.log(`⚠️  Found ${existingRooms.size} existing rooms in database`);
      console.log('Do you want to continue? This will update existing rooms.');
      console.log('(Press Ctrl+C to cancel, or wait 3 seconds to continue...)\n');
      await new Promise(resolve => setTimeout(resolve, 3000));
    }

    let successCount = 0;
    let errorCount = 0;

    // Seed Floor 1 rooms
    console.log('📍 Seeding Floor 1 rooms (101-106)...');
    for (const roomNumber of FLOOR_1_ROOMS) {
      try {
        const roomData = {
          roomNumber: roomNumber.toString(),
          floor: 1,
          status: 'vacant',
          defaultRent: DEFAULT_RENT,
          electricityMeterNo: `MTR${roomNumber}`,
          createdAt: new Date().toISOString()
        };

        await setDoc(doc(db, 'rooms', roomNumber.toString()), roomData);
        console.log(`✅ Room ${roomNumber} created`);
        successCount++;
      } catch (error) {
        console.error(`❌ Error creating room ${roomNumber}:`, error.message);
        errorCount++;
      }
    }

    // Seed Floor 2 rooms
    console.log('\n📍 Seeding Floor 2 rooms (201-206)...');
    for (const roomNumber of FLOOR_2_ROOMS) {
      try {
        const roomData = {
          roomNumber: roomNumber.toString(),
          floor: 2,
          status: 'vacant',
          defaultRent: DEFAULT_RENT,
          electricityMeterNo: `MTR${roomNumber}`,
          createdAt: new Date().toISOString()
        };

        await setDoc(doc(db, 'rooms', roomNumber.toString()), roomData);
        console.log(`✅ Room ${roomNumber} created`);
        successCount++;
      } catch (error) {
        console.error(`❌ Error creating room ${roomNumber}:`, error.message);
        errorCount++;
      }
    }

    // Summary
    console.log('\n' + '='.repeat(50));
    console.log('📊 SEEDING SUMMARY');
    console.log('='.repeat(50));
    console.log(`✅ Successfully created: ${successCount} rooms`);
    if (errorCount > 0) {
      console.log(`❌ Errors: ${errorCount}`);
    }
    console.log('='.repeat(50));
    
    console.log('\n🎉 Room seeding complete!');
    console.log('💡 You can now view rooms in the admin dashboard\n');

    process.exit(0);
  } catch (error) {
    console.error('\n❌ Fatal error during seeding:', error.message);
    console.error('Stack trace:', error.stack);
    process.exit(1);
  }
}

// Run the seeding
console.log('🚀 Autoxweb Rent - Room Seeding Script');
console.log('=' .repeat(50));
seedRooms();
