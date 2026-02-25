import { initializeApp } from 'firebase/app';
import { getFirestore, collection, query, where, getDocs } from 'firebase/firestore';

// Firebase config
const firebaseConfig = {
  apiKey: "AIzaSyBYIe89b-VpT8i1wTtaUfpEVoTBkDj-66E",
  authDomain: "rent-collection-5e1d2.firebaseapp.com",
  projectId: "rent-collection-5e1d2",
  storageBucket: "rent-collection-5e1d2.firebasestorage.app",
  messagingSenderId: "1089196354844",
  appId: "1:1089196354844:web:28e653965a0fa9e638b2d5"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// Check current month payment status breakdown
async function checkCurrentMonthStatus() {
  console.log('🔍 Checking Feb 2026 payment status...\n');
  
  try {
    // Get all active tenants
    const tenantsRef = collection(db, 'tenants');
    const tenantsSnapshot = await getDocs(query(tenantsRef, where('isActive', '==', true)));
    
    console.log(`👥 Total active tenants: ${tenantsSnapshot.size}\n`);
    
    // Get Feb 2026 payments
    const paymentsRef = collection(db, 'payments');
    const paymentsSnapshot = await getDocs(
      query(
        paymentsRef,
        where('year', '==', 2026),
        where('month', '==', 2)
      )
    );
    
    // Create payment map
    const paymentsMap = {};
    paymentsSnapshot.forEach(doc => {
      const data = doc.data();
      paymentsMap[data.roomNumber] = data;
    });
    
    // Check each tenant
    let floor1Paid = 0, floor1Pending = 0;
    let floor2Paid = 0, floor2Pending = 0;
    
    const tenantList = [];
    
    tenantsSnapshot.forEach(doc => {
      const tenant = doc.data();
      const roomNumber = typeof tenant.roomNumber === 'string' 
        ? parseInt(tenant.roomNumber, 10) 
        : tenant.roomNumber;
      
      const payment = paymentsMap[roomNumber];
      const floor = roomNumber >= 200 ? 2 : 1;
      
      // Check if paid
      const isPaid = payment && payment.status === 'paid' && (payment.paidAmount || 0) > 0;
      
      tenantList.push({
        room: roomNumber,
        name: tenant.name,
        floor,
        status: isPaid ? 'PAID' : 'PENDING',
        paidAmount: payment ? (payment.paidAmount || 0) : 0
      });
      
      if (floor === 1) {
        isPaid ? floor1Paid++ : floor1Pending++;
      } else {
        isPaid ? floor2Paid++ : floor2Pending++;
      }
    });
    
    // Sort by floor and room
    tenantList.sort((a, b) => {
      if (a.floor !== b.floor) return a.floor - b.floor;
      return a.room - b.room;
    });
    
    console.log('📊 Payment Status Summary:\n');
    console.log(`Floor 1: ✅ Paid: ${floor1Paid} | ❌ Pending: ${floor1Pending}`);
    console.log(`Floor 2: ✅ Paid: ${floor2Paid} | ❌ Pending: ${floor2Pending}`);
    console.log(`\nTotal: ✅ Paid: ${floor1Paid + floor2Paid} | ❌ Pending: ${floor1Pending + floor2Pending}\n`);
    
    console.log('📋 Detailed Status:\n');
    console.log('Floor 1:');
    tenantList.filter(t => t.floor === 1).forEach(t => {
      console.log(`  Room ${t.room}: ${t.name} - ${t.status} (₹${t.paidAmount})`);
    });
    
    console.log('\nFloor 2:');
    tenantList.filter(t => t.floor === 2).forEach(t => {
      console.log(`  Room ${t.room}: ${t.name} - ${t.status} (₹${t.paidAmount})`);
    });
    
    // Check vacant rooms
    const roomsRef = collection(db, 'rooms');
    const roomsSnapshot = await getDocs(roomsRef);
    
    const vacantRooms = [];
    roomsSnapshot.forEach(doc => {
      const room = doc.data();
      if (room.status === 'vacant') {
        vacantRooms.push(room.roomNumber);
      }
    });
    
    console.log(`\n\n🏠 Vacant Rooms: ${vacantRooms.length}`);
    if (vacantRooms.length > 0) {
      console.log(`Rooms: ${vacantRooms.sort((a, b) => a - b).join(', ')}`);
    }
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

checkCurrentMonthStatus();
