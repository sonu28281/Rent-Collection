#!/usr/bin/env node

/**
 * Debug Script: Check Tenant Token
 * 
 * This script helps you verify if a specific tenant has a uniqueToken
 * and shows you the portal link.
 * 
 * Usage: 
 *   node scripts/check_tenant_token.js
 *   node scripts/check_tenant_token.js "Tenant Name"
 */

import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, query, where } from 'firebase/firestore';
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

// Get tenant name from command line argument
const searchName = process.argv[2];

async function checkTenants() {
  console.log('\n🔍 Checking tenant tokens...\n');
  
  try {
    const tenantsRef = collection(db, 'tenants');
    
    let tenantsQuery;
    if (searchName) {
      // Search for specific tenant
      tenantsQuery = query(tenantsRef, where('name', '==', searchName));
    } else {
      // Get all tenants
      tenantsQuery = tenantsRef;
    }
    
    const tenantsSnapshot = await getDocs(tenantsQuery);
    
    if (tenantsSnapshot.empty) {
      if (searchName) {
        console.log(`❌ No tenant found with name: "${searchName}"`);
        console.log('💡 Try running without arguments to see all tenants.\n');
      } else {
        console.log('⚠️  No tenants found in database.');
        console.log('💡 Add tenants via the Admin Panel → Tenants page.\n');
      }
      return;
    }

    console.log(`📋 Found ${tenantsSnapshot.size} tenant(s):\n`);
    console.log('='.repeat(80));

    tenantsSnapshot.forEach((doc) => {
      const tenant = doc.data();
      const hasToken = !!tenant.uniqueToken;
      
      console.log(`\n👤 Name: ${tenant.name}`);
      console.log(`   Room: ${tenant.roomNumber}`);
      console.log(`   Phone: ${tenant.phone}`);
      console.log(`   Active: ${tenant.isActive ? '✅ Yes' : '❌ No'}`);
      console.log(`   Token: ${hasToken ? '✅ EXISTS' : '❌ MISSING'}`);
      
      if (hasToken) {
        console.log(`   Token Value: ${tenant.uniqueToken.substring(0, 12)}...${tenant.uniqueToken.substring(36)}`);
        console.log(`   🔗 Portal Link: https://rent582.netlify.app/t/${tenant.uniqueToken}`);
        console.log(`      (or local): http://localhost:5173/t/${tenant.uniqueToken}`);
      } else {
        console.log(`   ⚠️  ACTION NEEDED: Run "npm run migrate:tokens" or edit tenant in UI`);
      }
      
      console.log('   ' + '-'.repeat(76));
    });

    console.log('\n' + '='.repeat(80));
    
    // Summary
    const totalTenants = tenantsSnapshot.size;
    const tenantsWithToken = tenantsSnapshot.docs.filter(doc => doc.data().uniqueToken).length;
    const tenantsWithoutToken = totalTenants - tenantsWithToken;
    
    console.log('\n📊 Summary:');
    console.log(`   Total Tenants: ${totalTenants}`);
    console.log(`   With Token: ${tenantsWithToken} ✅`);
    console.log(`   Without Token: ${tenantsWithoutToken} ${tenantsWithoutToken > 0 ? '⚠️' : '✅'}`);
    
    if (tenantsWithoutToken > 0) {
      console.log('\n💡 To fix tenants without tokens:');
      console.log('   1. Run: npm run migrate:tokens');
      console.log('   2. Or edit each tenant in the UI and save\n');
    } else {
      console.log('\n✅ All tenants have tokens! Portal links should work.\n');
    }

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    
    if (error.code === 'permission-denied') {
      console.log('\n🔒 PERMISSION DENIED!');
      console.log('   This likely means Firestore Rules are blocking access.');
      console.log('\n   ⚠️  IMPORTANT: You need to update Firestore Rules in Firebase Console:');
      console.log('   1. Go to: https://console.firebase.google.com/project/rent-collection-5e1d2/firestore/rules');
      console.log('   2. Copy rules from: firestore.rules file in this repo');
      console.log('   3. Click "Publish" to deploy the rules');
      console.log('   4. Run this script again\n');
    } else {
      console.error(error);
    }
    process.exit(1);
  }
}

// Run the check
checkTenants()
  .then(() => {
    console.log('👋 Done!\n');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
