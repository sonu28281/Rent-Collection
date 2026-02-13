#!/usr/bin/env node

/**
 * Create Sample Payment Data
 * 
 * Creates a sample payment document to make the payments collection visible in Firebase Console
 * 
 * Usage: node scripts/create_sample_payment.js
 */

import { initializeApp } from 'firebase/app';
import { getFirestore, collection, doc, setDoc, getDocs, query, limit } from 'firebase/firestore';
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

async function createSamplePayment() {
  console.log('\n🔧 Creating sample payment to initialize payments collection...\n');
  
  try {
    // Check if payments collection already exists
    const paymentsRef = collection(db, 'payments');
    const existingPayments = await getDocs(query(paymentsRef, limit(1)));
    
    if (!existingPayments.empty) {
      console.log('✅ Payments collection already exists with documents.');
      console.log('   No need to create sample data.\n');
      return;
    }

    // Get first tenant for sample data
    const tenantsRef = collection(db, 'tenants');
    const tenantsSnapshot = await getDocs(query(tenantsRef, limit(1)));
    
    if (tenantsSnapshot.empty) {
      console.log('⚠️  No tenants found in database.');
      console.log('   Please add a tenant first via Admin Panel → Tenants\n');
      return;
    }

    const firstTenant = tenantsSnapshot.docs[0];
    const tenantData = firstTenant.data();
    const tenantId = firstTenant.id;

    // Create sample payment for current month
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1; // 1-12

    const paymentId = `${tenantId}_${currentYear}_${currentMonth}`;
    
    const samplePayment = {
      tenantId: tenantId,
      tenantName: tenantData.name,
      roomNumber: Number(tenantData.roomNumber) || 101,
      year: currentYear,
      month: currentMonth,
      rent: Number(tenantData.currentRent) || 5000,
      electricity: 450,
      totalAmount: (Number(tenantData.currentRent) || 5000) + 450,
      paidAmount: 0,
      status: 'unpaid',
      paymentDate: null,
      paymentMode: 'cash',
      createdAt: new Date().toISOString()
    };

    await setDoc(doc(db, 'payments', paymentId), samplePayment);

    console.log('✅ Sample payment created successfully!\n');
    console.log('   Details:');
    console.log(`   - Tenant: ${tenantData.name}`);
    console.log(`   - Room: ${samplePayment.roomNumber}`);
    console.log(`   - Period: ${currentMonth}/${currentYear}`);
    console.log(`   - Amount: ₹${samplePayment.totalAmount}`);
    console.log(`   - Status: ${samplePayment.status}`);
    console.log(`   - Document ID: ${paymentId}\n`);
    
    console.log('🔍 Refresh Firebase Console to see the payments collection!\n');
    console.log('📊 Dashboard should now show:');
    console.log('   - Pending Payments: 1');
    console.log('   - This Month Income: ₹0\n');

  } catch (error) {
    console.error('\n❌ Error creating sample payment:', error.message);
    
    if (error.code === 'permission-denied') {
      console.log('\n🔒 PERMISSION DENIED!');
      console.log('   Make sure Firestore Rules are updated.');
      console.log('   See FIRESTORE_SETUP.md for instructions.\n');
    } else {
      console.error(error);
    }
    process.exit(1);
  }
}

// Run the script
createSamplePayment()
  .then(() => {
    console.log('👋 Done!\n');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
