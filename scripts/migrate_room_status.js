/**
 * Migration Script: Add Room Status Fields
 * 
 * This script adds the following fields to all existing rooms:
 * - status: "filled" | "vacant" (default: "vacant")
 * - lastStatusUpdatedAt: timestamp
 * - lastStatusUpdatedBy: string
 * - currentTenantId: string | null
 * 
 * Usage:
 *   node scripts/migrate_room_status.js
 */

import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, updateDoc, serverTimestamp } from 'firebase/firestore';
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

async function migrateRoomStatus() {
  console.log('\n🔄 Starting Room Status Migration...\n');
  
  try {
    // Step 1: Fetch all rooms
    console.log('📥 Fetching all rooms...');
    const roomsRef = collection(db, 'rooms');
    const roomsSnapshot = await getDocs(roomsRef);
    
    if (roomsSnapshot.empty) {
      console.log('❌ No rooms found in database.');
      console.log('⚠️  Please run: npm run seed:rooms first');
      return;
    }
    
    console.log(`✅ Found ${roomsSnapshot.size} rooms\n`);
    
    // Step 2: Fetch all active tenants
    console.log('📥 Fetching all active tenants...');
    const tenantsRef = collection(db, 'tenants');
    const tenantsSnapshot = await getDocs(tenantsRef);
    
    // Create a map of room numbers to tenant IDs for active tenants
    const occupiedRooms = new Map();
    tenantsSnapshot.forEach((doc) => {
      const tenant = doc.data();
      if (tenant.isActive && tenant.roomNumber) {
        occupiedRooms.set(tenant.roomNumber, doc.id);
      }
    });
    
    console.log(`✅ Found ${occupiedRooms.size} occupied rooms\n`);
    
    // Step 3: Update each room
    console.log('🔧 Updating room statuses...\n');
    let updatedCount = 0;
    let skippedCount = 0;
    
    for (const roomDoc of roomsSnapshot.docs) {
      const room = roomDoc.data();
      const roomId = roomDoc.id;
      const roomNumber = room.roomNumber;
      
      // Check if room already has status field
      if (room.status !== undefined && room.lastStatusUpdatedAt !== undefined) {
        console.log(`⏩ Room ${roomNumber}: Already migrated (status: ${room.status})`);
        skippedCount++;
        continue;
      }
      
      // Determine status based on active tenants
      const isOccupied = occupiedRooms.has(roomNumber);
      const newStatus = isOccupied ? 'filled' : 'vacant';
      const tenantId = isOccupied ? occupiedRooms.get(roomNumber) : null;
      
      // Update room document
      const updateData = {
        status: newStatus,
        lastStatusUpdatedAt: serverTimestamp(),
        lastStatusUpdatedBy: 'migration_script',
        currentTenantId: tenantId
      };
      
      await updateDoc(doc(db, 'rooms', roomId), updateData);
      
      console.log(`✅ Room ${roomNumber}: Set to "${newStatus}"${tenantId ? ` (Tenant: ${tenantId})` : ''}`);
      updatedCount++;
    }
    
    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 Migration Summary:');
    console.log('='.repeat(60));
    console.log(`✅ Updated:  ${updatedCount} rooms`);
    console.log(`⏩ Skipped:  ${skippedCount} rooms (already migrated)`);
    console.log(`📊 Total:    ${roomsSnapshot.size} rooms`);
    console.log('='.repeat(60));
    console.log('\n✨ Migration completed successfully!\n');
    
  } catch (error) {
    console.error('\n❌ Migration failed:', error);
    console.error('\nError details:', error.message);
    process.exit(1);
  }
  
  process.exit(0);
}

// Run migration
migrateRoomStatus();
