#!/usr/bin/env node

/**
 * Migration Script: Add uniqueToken to Tenants
 * 
 * This script adds uniqueToken to all tenants who don't have one.
 * This fixes the "Access Denied" issue when sharing portal links.
 * 
 * Usage: node scripts/add_tenant_tokens.js
 */

import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, updateDoc } from 'firebase/firestore';
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

// Generate unique token (same function as in TenantForm)
const generateUniqueToken = () => {
  const array = new Uint8Array(24);
  crypto.getRandomValues(array);
  return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
};

// Main migration function
async function migrateTenantsTokens() {
  console.log('\n🔄 Starting migration: Adding uniqueToken to tenants...\n');
  
  try {
    // Fetch all tenants
    const tenantsRef = collection(db, 'tenants');
    const tenantsSnapshot = await getDocs(tenantsRef);
    
    if (tenantsSnapshot.empty) {
      console.log('⚠️  No tenants found in database.');
      return;
    }

    console.log(`📋 Found ${tenantsSnapshot.size} tenant(s)\n`);

    let updatedCount = 0;
    let skippedCount = 0;

    // Process each tenant
    for (const tenantDoc of tenantsSnapshot.docs) {
      const tenantData = tenantDoc.data();
      const tenantId = tenantDoc.id;

      // Check if uniqueToken already exists
      if (tenantData.uniqueToken) {
        console.log(`✓ Skipped: ${tenantData.name} (Token already exists)`);
        skippedCount++;
        continue;
      }

      // Generate and add uniqueToken
      const newToken = generateUniqueToken();
      await updateDoc(doc(db, 'tenants', tenantId), {
        uniqueToken: newToken
      });

      console.log(`✅ Updated: ${tenantData.name}`);
      console.log(`   Token: ${newToken.substring(0, 12)}...`);
      updatedCount++;
    }

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 Migration Summary:');
    console.log(`   Total tenants: ${tenantsSnapshot.size}`);
    console.log(`   Updated: ${updatedCount}`);
    console.log(`   Skipped (already had token): ${skippedCount}`);
    console.log('='.repeat(60));
    
    if (updatedCount > 0) {
      console.log('\n✅ Migration completed successfully!');
      console.log('💡 Now all tenants can access their portal with unique links.\n');
    } else {
      console.log('\n✅ All tenants already have uniqueTokens. No changes made.\n');
    }

  } catch (error) {
    console.error('\n❌ Migration failed:', error.message);
    console.error(error);
    process.exit(1);
  }
}

// Run migration
migrateTenantsTokens()
  .then(() => {
    console.log('👋 Exiting...\n');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
