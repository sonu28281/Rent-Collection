// Setup Floor 1 Tenants for 2026
import admin from 'firebase-admin';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: resolve(__dirname, '../.env') });

// Initialize Firebase Admin
const serviceAccount = {
  type: "service_account",
  project_id: process.env.VITE_FIREBASE_PROJECT_ID,
  private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
  private_key: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  client_email: process.env.FIREBASE_CLIENT_EMAIL,
  client_id: process.env.FIREBASE_CLIENT_ID,
  auth_uri: "https://accounts.google.com/o/oauth2/auth",
  token_uri: "https://oauth2.googleapis.com/token",
  auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
  client_x509_cert_url: process.env.FIREBASE_CLIENT_CERT_URL
};

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const db = admin.firestore();

// Floor 1 tenant data
const floor1Tenants = [
  {
    roomNumber: 101,
    tenantName: 'Janvi Singh',
    dueDate: 20,
    rent: 3200,
    ratePerUnit: 9
  },
  {
    roomNumber: 102,
    tenantName: 'Aadarsh Sharma',
    dueDate: 1,
    rent: 2500,
    ratePerUnit: 9
  },
  {
    roomNumber: 103,
    tenantName: 'DK Singh',
    dueDate: 22,
    rent: 3500,
    ratePerUnit: 9
  },
  {
    roomNumber: 104,
    tenantName: 'Raj Singh',
    dueDate: 1,
    rent: 3800,
    ratePerUnit: 9
  },
  {
    roomNumber: 105,
    tenantName: 'Akash Singh',
    dueDate: 1,
    rent: 2500,
    ratePerUnit: 9
  },
  {
    roomNumber: 106,
    tenantName: 'Akash Singh',
    dueDate: 1,
    rent: 2500,
    ratePerUnit: 9
  }
];

async function setupFloor1() {
  console.log('🚀 Setting up Floor 1 tenants for 2026...\n');

  try {
    const batch = db.batch();
    const tenantsProcessed = [];

    for (const tenantData of floor1Tenants) {
      console.log(`📝 Processing Room ${tenantData.roomNumber} - ${tenantData.tenantName}`);

      // 1. Check if room exists, create/update it
      const roomsRef = db.collection('rooms');
      const roomQuery = await roomsRef.where('roomNumber', '==', tenantData.roomNumber).get();
      
      let roomRef;
      if (roomQuery.empty) {
        // Create new room
        roomRef = roomsRef.doc();
        batch.set(roomRef, {
          roomNumber: tenantData.roomNumber,
          floor: tenantData.roomNumber < 200 ? 1 : 2,
          rent: tenantData.rent,
          ratePerUnit: tenantData.ratePerUnit,
          status: 'filled',
          tenantName: tenantData.tenantName,
          dueDate: tenantData.dueDate,
          currentReading: 0,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        console.log(`  ✅ Created room ${tenantData.roomNumber}`);
      } else {
        // Update existing room
        roomRef = roomQuery.docs[0].ref;
        batch.update(roomRef, {
          rent: tenantData.rent,
          ratePerUnit: tenantData.ratePerUnit,
          status: 'filled',
          tenantName: tenantData.tenantName,
          dueDate: tenantData.dueDate,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        console.log(`  ✅ Updated room ${tenantData.roomNumber}`);
      }

      // 2. Check if tenant exists, create/update it
      const tenantsRef = db.collection('tenants');
      const tenantQuery = await tenantsRef
        .where('roomNumber', '==', tenantData.roomNumber)
        .where('isActive', '==', true)
        .get();
      
      let tenantRef;
      let uniqueToken;

      if (tenantQuery.empty) {
        // Create new tenant
        tenantRef = tenantsRef.doc();
        uniqueToken = `tenant_${tenantData.roomNumber}_${Date.now()}`;
        
        batch.set(tenantRef, {
          name: tenantData.tenantName,
          roomNumber: tenantData.roomNumber,
          phone: '', // To be filled later
          email: '', // To be filled later
          isActive: true,
          uniqueToken: uniqueToken,
          rent: tenantData.rent,
          dueDate: tenantData.dueDate,
          joinDate: new Date().toISOString().split('T')[0],
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        
        console.log(`  ✅ Created tenant: ${tenantData.tenantName}`);
        console.log(`  🔗 Portal Link: /t/${uniqueToken}`);
      } else {
        // Update existing tenant
        tenantRef = tenantQuery.docs[0].ref;
        const existingData = tenantQuery.docs[0].data();
        uniqueToken = existingData.uniqueToken;

        batch.update(tenantRef, {
          name: tenantData.tenantName,
          rent: tenantData.rent,
          dueDate: tenantData.dueDate,
          isActive: true,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        
        console.log(`  ✅ Updated tenant: ${tenantData.tenantName}`);
        console.log(`  🔗 Portal Link: /t/${uniqueToken}`);
      }

      tenantsProcessed.push({
        roomNumber: tenantData.roomNumber,
        tenantName: tenantData.tenantName,
        rent: tenantData.rent,
        ratePerUnit: tenantData.ratePerUnit,
        dueDate: tenantData.dueDate,
        portalLink: `/t/${uniqueToken}`
      });

      console.log('');
    }

    // Commit all changes
    await batch.commit();
    
    console.log('\n✅ Floor 1 setup completed successfully!\n');
    console.log('📊 Summary:');
    console.log('═══════════════════════════════════════════════════════════');
    
    tenantsProcessed.forEach(tenant => {
      console.log(`Room ${tenant.roomNumber}: ${tenant.tenantName}`);
      console.log(`  Rent: ₹${tenant.rent}/month | Due Date: ${tenant.dueDate}th`);
      console.log(`  Electricity Rate: ₹${tenant.ratePerUnit}/unit`);
      console.log(`  Portal: ${tenant.portalLink}`);
      console.log('');
    });

    console.log('═══════════════════════════════════════════════════════════');
    console.log('\n🎉 All Floor 1 tenants are ready for 2026!');
    console.log('📱 Share the portal links with tenants for self-service access.\n');

  } catch (error) {
    console.error('❌ Error setting up Floor 1:', error);
    throw error;
  }
}

// Run the setup
setupFloor1()
  .then(() => {
    console.log('✅ Script completed successfully!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Script failed:', error);
    process.exit(1);
  });
