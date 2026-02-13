#!/usr/bin/env node

/**
 * Firebase Admin User Setup Script
 * This script creates the admin user in Firebase Authentication
 * Run this ONCE to setup the admin account
 */

import { initializeApp } from 'firebase/app';
import { getAuth, createUserWithEmailAndPassword } from 'firebase/auth';

const firebaseConfig = {
  apiKey: "AIzaSyD5Nv3uIlCQuOQkj7crx1kcg-ENIH9cXT4",
  authDomain: "rent-collection-5e1d2.firebaseapp.com",
  projectId: "rent-collection-5e1d2",
  storageBucket: "rent-collection-5e1d2.firebasestorage.app",
  messagingSenderId: "605839501523",
  appId: "1:605839501523:web:153e006f8ada52f9804c26",
  measurementId: "G-ZK8D32M76Y"
};

const ADMIN_EMAIL = 'sonu28281@gmail.com';
const ADMIN_PASSWORD = 'kavyA@18deC';

async function setupAdmin() {
  try {
    console.log('🔥 Initializing Firebase...');
    const app = initializeApp(firebaseConfig);
    const auth = getAuth(app);

    console.log('👤 Creating admin user...');
    console.log(`Email: ${ADMIN_EMAIL}`);

    const userCredential = await createUserWithEmailAndPassword(
      auth,
      ADMIN_EMAIL,
      ADMIN_PASSWORD
    );

    console.log('✅ Admin user created successfully!');
    console.log(`UID: ${userCredential.user.uid}`);
    console.log(`Email: ${userCredential.user.email}`);
    console.log('\n🎉 You can now login to the application!');
    
    process.exit(0);
  } catch (error) {
    if (error.code === 'auth/email-already-in-use') {
      console.log('ℹ️  Admin user already exists!');
      console.log('✅ You can proceed to login.');
    } else {
      console.error('❌ Error creating admin user:', error.message);
      console.error('Error code:', error.code);
    }
    process.exit(1);
  }
}

setupAdmin();
