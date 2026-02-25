#!/usr/bin/env node

/**
 * Fix Payment Totals Script
 * 
 * This script recalculates the 'total' field for all payment records
 * to ensure they correctly reflect rent + electricity.
 * 
 * Run: node scripts/fix_payment_totals.js
 */

import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, updateDoc, writeBatch, serverTimestamp } from 'firebase/firestore';
import * as dotenv from 'dotenv';

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

async function fixPaymentTotals() {
  try {
    console.log('\n=== Starting Payment Totals Fix ===\n');
    
    const paymentsRef = collection(db, 'payments');
    const snapshot = await getDocs(paymentsRef);
    
    if (snapshot.empty) {
      console.log('No payment records found.');
      return;
    }
    
    console.log(`Found ${snapshot.size} payment records to check...\n`);
    
    let fixedCount = 0;
    let alreadyCorrectCount = 0;
    let batch = writeBatch(db);
    let batchCount = 0;
    const batchLimit = 500;
    
    for (const docSnapshot of snapshot.docs) {
      const data = docSnapshot.data();
      const rent = Number(data.rent) || 0;
      const electricity = Number(data.electricity) || 0;
      const currentTotal = Number(data.total || data.totalAmount) || 0;
      const correctTotal = rent + electricity;
      
      // Check if total needs fixing
      if (currentTotal !== correctTotal) {
        // Recalculate balance too
        const paidAmount = Number(data.paidAmount) || 0;
        const balance = Number((correctTotal - paidAmount).toFixed(2));
        
        // Determine status
        let status = data.status || 'pending';
        if (paidAmount === 0) {
          status = 'unpaid';
        } else if (paidAmount >= correctTotal) {
          status = balance < 0 ? 'advance' : 'paid';
        } else if (paidAmount > 0) {
          status = 'partial';
        }
        
        batch.update(docSnapshot.ref, {
          total: correctTotal,
          totalAmount: correctTotal, // Update legacy field too
          balance: balance,
          status: status,
          updatedAt: serverTimestamp()
        });
        
        console.log(`Room ${data.roomNumber}, ${data.month}/${data.year}: ${currentTotal} → ${correctTotal} (Rent: ${rent}, Elec: ${electricity})`);
        fixedCount++;
        batchCount++;
        
        // Commit batch if limit reached
        if (batchCount >= batchLimit) {
          await batch.commit();
          console.log(`\nCommitted batch of ${batchCount} updates...\n`);
          batch = writeBatch(db);
          batchCount = 0;
        }
      } else {
        alreadyCorrectCount++;
      }
    }
    
    // Commit remaining updates
    if (batchCount > 0) {
      await batch.commit();
      console.log(`\nCommitted final batch of ${batchCount} updates...\n`);
    }
    
    console.log('\n=== Fix Complete ===');
    console.log(`Total records checked: ${snapshot.size}`);
    console.log(`Records fixed: ${fixedCount}`);
    console.log(`Records already correct: ${alreadyCorrectCount}`);
    console.log('\nAll payment totals are now accurate!\n');
    
  } catch (error) {
    console.error('Error fixing payment totals:', error);
    process.exit(1);
  }
  
  process.exit(0);
}

// Run the script
fixPaymentTotals();
