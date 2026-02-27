#!/usr/bin/env node

/**
 * Reset KYC Status Script
 * 
 * This script resets the KYC verification status for a tenant,
 * allowing them to verify again with DigiLocker.
 * 
 * Usage:
 *   node scripts/reset_kyc_status.js <TENANT_ID>
 *   node scripts/reset_kyc_status.js --room=101
 *   node scripts/reset_kyc_status.js --all  (⚠️ Resets all tenants)
 */

import admin from 'firebase-admin';
import { readFile } from 'fs/promises';

// Initialize Firebase Admin
const serviceAccountPath = './serviceAccountKey.json';

try {
  const serviceAccount = JSON.parse(
    await readFile(serviceAccountPath, 'utf8')
  );
  
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
  
  console.log('✅ Firebase Admin initialized\n');
} catch (error) {
  console.error('❌ Error initializing Firebase:', error.message);
  process.exit(1);
}

const db = admin.firestore();

/**
 * Reset KYC status for a single tenant
 */
async function resetTenantKyc(tenantId, tenantInfo) {
  const tenantRef = db.collection('tenants').doc(tenantId);
  const tenantSnap = await tenantRef.get();
  
  if (!tenantSnap.exists) {
    console.log(`   ❌ Tenant not found: ${tenantId}`);
    return false;
  }
  
  const data = tenantSnap.data();
  const hasKyc = data.kyc && data.kyc.verified;
  
  if (!hasKyc) {
    console.log(`   ⚠️  Tenant already unverified: ${data.name || tenantId} (Room ${data.roomNumber})`);
    return false;
  }
  
  // Reset KYC status
  await tenantRef.update({
    kyc: {
      verified: false,
      verifiedBy: null,
      verifiedAt: null,
      resetAt: admin.firestore.FieldValue.serverTimestamp(),
      resetReason: 'Manual reset via script'
    }
  });
  
  console.log(`   ✅ Reset KYC for: ${data.name || tenantId} (Room ${data.roomNumber})`);
  return true;
}

/**
 * Find tenant by room number
 */
async function findTenantByRoom(roomNumber) {
  const tenantsRef = db.collection('tenants');
  
  // Try as number first
  let query = tenantsRef.where('roomNumber', '==', Number(roomNumber)).limit(1);
  let snapshot = await query.get();
  
  if (snapshot.empty) {
    // Try as string
    query = tenantsRef.where('roomNumber', '==', String(roomNumber)).limit(1);
    snapshot = await query.get();
  }
  
  if (snapshot.empty) {
    return null;
  }
  
  return snapshot.docs[0];
}

/**
 * Reset all tenants
 */
async function resetAllTenants() {
  const tenantsRef = db.collection('tenants');
  const snapshot = await tenantsRef.where('kyc.verified', '==', true).get();
  
  if (snapshot.empty) {
    console.log('   ℹ️  No verified tenants found');
    return 0;
  }
  
  console.log(`   Found ${snapshot.size} verified tenants\n`);
  
  let resetCount = 0;
  for (const doc of snapshot.docs) {
    const success = await resetTenantKyc(doc.id, doc.data());
    if (success) resetCount++;
  }
  
  return resetCount;
}

async function main() {
  const arg = process.argv[2];
  
  if (!arg) {
    console.error('❌ Usage: node scripts/reset_kyc_status.js <TENANT_ID>');
    console.error('          node scripts/reset_kyc_status.js --room=101');
    console.error('          node scripts/reset_kyc_status.js --all');
    process.exit(1);
  }
  
  console.log('🔄 KYC Status Reset Tool');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');
  
  try {
    if (arg === '--all') {
      console.log('⚠️  WARNING: Resetting KYC for ALL verified tenants');
      console.log('   This action cannot be undone!');
      console.log('');
      
      // Wait 3 seconds for user to cancel
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const resetCount = await resetAllTenants();
      console.log('');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log(`✅ Reset ${resetCount} tenant(s)`);
      
    } else if (arg.startsWith('--room=')) {
      const roomNumber = arg.split('=')[1];
      console.log(`🔍 Finding tenant in room ${roomNumber}...`);
      console.log('');
      
      const tenantDoc = await findTenantByRoom(roomNumber);
      
      if (!tenantDoc) {
        console.log(`❌ No tenant found in room ${roomNumber}`);
        process.exit(1);
      }
      
      const success = await resetTenantKyc(tenantDoc.id, tenantDoc.data());
      console.log('');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log(success ? '✅ KYC Status Reset Successfully' : '⚠️  No changes made');
      
    } else {
      // Assume it's a tenant ID
      const tenantId = arg;
      console.log(`🔍 Resetting KYC for tenant: ${tenantId}...`);
      console.log('');
      
      const success = await resetTenantKyc(tenantId);
      console.log('');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log(success ? '✅ KYC Status Reset Successfully' : '❌ Failed to reset');
    }
    
    console.log('');
    console.log('Next steps:');
    console.log('  1. Tenant can now verify again with DigiLocker');
    console.log('  2. Portal will show "Verify with DigiLocker" button');
    console.log('  3. Admin panel will show "Not Verified" status');
    
  } catch (error) {
    console.error('');
    console.error('❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

main();
