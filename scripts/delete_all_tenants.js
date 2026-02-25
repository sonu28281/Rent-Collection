#!/usr/bin/env node

/**
 * Delete All Tenants Script
 * 
 * This script removes ALL tenant records from the database
 * Use this to clean up duplicates and start fresh
 * 
 * Usage: node scripts/delete_all_tenants.js
 */

import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, collection, getDocs, deleteDoc, doc } from 'firebase/firestore';
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

async function deleteAllTenants() {
  try {
    console.log('🔐 Authenticating as admin...');
    await signInWithEmailAndPassword(auth, ADMIN_EMAIL, ADMIN_PASSWORD);
    console.log('✅ Authenticated successfully\n');
    
    console.log('🔍 Scanning for tenants...');
    
    const tenantsRef = collection(db, 'tenants');
    const snapshot = await getDocs(tenantsRef);
    
    console.log(`📊 Found ${snapshot.size} tenant records`);
    
    if (snapshot.size === 0) {
      console.log('✅ No tenants to delete');
      process.exit(0);
    }
    
    console.log('🗑️  Deleting all tenants...\n');
    
    let deleted = 0;
    for (const docSnap of snapshot.docs) {
      const data = docSnap.data();
      console.log(`   Deleting: Room ${data.roomNumber} - ${data.name} (ID: ${docSnap.id})`);
      await deleteDoc(doc(db, 'tenants', docSnap.id));
      deleted++;
    }
    
    console.log(`\n✅ Successfully deleted ${deleted} tenant records!`);
    console.log('💡 Now you can run Setup 2026 Tenants to create fresh records');
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error deleting tenants:', error);
    process.exit(1);
  }
}

// Run the cleanup
deleteAllTenants();
