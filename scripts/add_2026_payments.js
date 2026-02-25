import { initializeApp } from 'firebase/app';
import { getFirestore, collection, addDoc, query, where, getDocs, serverTimestamp } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyCR6g_ACtDP43FoJ_kHZJq6m3eX5d-JcjI",
  authDomain: "rent-collection-ebbed.firebaseapp.com",
  projectId: "rent-collection-ebbed",
  storageBucket: "rent-collection-ebbed.firebasestorage.app",
  messagingSenderId: "612074265730",
  appId: "1:612074265730:web:ebfc8fe17c72f798b33fd8"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

/**
 * Add 2026 payment records (Jan & Feb) for all 12 tenants
 * All payments marked as PAID
 */

const tenants = [
  // Floor 1
  { roomNumber: '101', rent: 3200, dueDate: 20, name: 'Janvi Singh' },
  { roomNumber: '102', rent: 2500, dueDate: 1, name: 'Aadarsh Sharma' },
  { roomNumber: '103', rent: 3500, dueDate: 22, name: 'DK Singh' },
  { roomNumber: '104', rent: 3800, dueDate: 1, name: 'Raj Singh' },
  { roomNumber: '105', rent: 2500, dueDate: 1, name: 'Akash Singh' },
  { roomNumber: '106', rent: 2500, dueDate: 1, name: 'Akash Singh' },
  // Floor 2
  { roomNumber: '201', rent: 3200, dueDate: 22, name: 'Saurabh Singh' },
  { roomNumber: '202', rent: 3000, dueDate: 20, name: 'Sumit Yadav' },
  { roomNumber: '203', rent: 4000, dueDate: 1, name: 'Manali Singh' },
  { roomNumber: '204', rent: 4000, dueDate: 20, name: 'Suneel Gupta' },
  { roomNumber: '205', rent: 3800, dueDate: 1, name: 'Veer Singh' },
  { roomNumber: '206', rent: 2500, dueDate: 1, name: 'Sanjeev Rastogi' }
];

async function getRoomElectricityData(roomNumber) {
  const roomsRef = collection(db, 'rooms');
  const roomQuery = query(roomsRef, where('roomNumber', '==', roomNumber));
  const roomSnapshot = await getDocs(roomQuery);
  
  if (!roomSnapshot.empty) {
    const roomData = roomSnapshot.docs[0].data();
    return {
      meterNo: roomData.electricityMeterNo || `MTR${roomNumber}`,
      currentReading: roomData.currentReading || 0,
      previousReading: roomData.previousReading || 0,
      ratePerUnit: roomData.ratePerUnit || 9
    };
  }
  
  return {
    meterNo: `MTR${roomNumber}`,
    currentReading: 0,
    previousReading: 0,
    ratePerUnit: 9
  };
}

async function checkIfPaymentExists(roomNumber, year, month) {
  const paymentsRef = collection(db, 'payments');
  const paymentQuery = query(
    paymentsRef,
    where('roomNumber', '==', roomNumber),
    where('year', '==', year),
    where('month', '==', month)
  );
  const snapshot = await getDocs(paymentQuery);
  return !snapshot.empty;
}

async function add2026Payments() {
  console.log('🚀 Starting 2026 Payment Records Creation...\n');

  const paymentsRef = collection(db, 'payments');
  let totalAdded = 0;
  let skipped = 0;

  for (const tenant of tenants) {
    console.log(`\n📍 Processing Room ${tenant.roomNumber} - ${tenant.name}`);
    
    // Get electricity data
    const elecData = await getRoomElectricityData(tenant.roomNumber);
    
    // January 2026
    const janExists = await checkIfPaymentExists(tenant.roomNumber, 2026, 1);
    if (!janExists) {
      const janUnits = Math.floor(Math.random() * 50) + 150; // Random units between 150-200
      const janElectricity = janUnits * elecData.ratePerUnit;
      
      await addDoc(paymentsRef, {
        roomNumber: tenant.roomNumber,
        tenantName: tenant.name,
        year: 2026,
        month: 1,
        rent: tenant.rent,
        electricity: janElectricity,
        units: janUnits,
        total: tenant.rent + janElectricity,
        status: 'paid',
        paidAt: '2026-01-' + String(tenant.dueDate).padStart(2, '0'),
        paymentMethod: 'UPI',
        electricityMeterNo: elecData.meterNo,
        notes: 'January 2026 payment received on time',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      
      console.log(`  ✅ January 2026: ₹${tenant.rent} + ₹${janElectricity} (${janUnits} units) = ₹${tenant.rent + janElectricity}`);
      totalAdded++;
    } else {
      console.log(`  ⏭️  January 2026: Already exists`);
      skipped++;
    }
    
    // February 2026
    const febExists = await checkIfPaymentExists(tenant.roomNumber, 2026, 2);
    if (!febExists) {
      const febUnits = Math.floor(Math.random() * 50) + 150; // Random units between 150-200
      const febElectricity = febUnits * elecData.ratePerUnit;
      
      await addDoc(paymentsRef, {
        roomNumber: tenant.roomNumber,
        tenantName: tenant.name,
        year: 2026,
        month: 2,
        rent: tenant.rent,
        electricity: febElectricity,
        units: febUnits,
        total: tenant.rent + febElectricity,
        status: 'paid',
        paidAt: '2026-02-' + String(tenant.dueDate).padStart(2, '0'),
        paymentMethod: 'UPI',
        electricityMeterNo: elecData.meterNo,
        notes: 'February 2026 payment received on time',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      
      console.log(`  ✅ February 2026: ₹${tenant.rent} + ₹${febElectricity} (${febUnits} units) = ₹${tenant.rent + febElectricity}`);
      totalAdded++;
    } else {
      console.log(`  ⏭️  February 2026: Already exists`);
      skipped++;
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('✅ 2026 Payment Records Creation Complete!');
  console.log('='.repeat(60));
  console.log(`📊 Total records added: ${totalAdded}`);
  console.log(`⏭️  Records skipped (already exist): ${skipped}`);
  console.log(`👥 Tenants processed: ${tenants.length}`);
  console.log('='.repeat(60));
}

// Run the script
add2026Payments()
  .then(() => {
    console.log('\n✅ Script completed successfully!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Error:', error);
    process.exit(1);
  });
