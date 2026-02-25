import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, query, where } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyDWWq75KGKe-5l22mn39KjvvW5VoWYAEy0",
  authDomain: "rent-collection-b7a77.firebaseapp.com",
  projectId: "rent-collection-b7a77",
  storageBucket: "rent-collection-b7a77.firebasestorage.app",
  messagingSenderId: "830018950517",
  appId: "1:830018950517:web:5dc75a18e0d93084c9b7ee"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function check2017Data() {
  console.log('\n=== Checking 2017 Payment Records ===\n');
  
  const paymentsRef = collection(db, 'payments');
  const q = query(paymentsRef, where('year', '==', 2017));
  const snapshot = await getDocs(q);
  
  let totalRent = 0;
  let totalElectricity = 0;
  let totalTotal = 0;
  let totalPaidAmount = 0;
  let recordCount = 0;
  
  console.log('Record Details:');
  console.log('=====================================');
  
  const records = [];
  snapshot.forEach((doc) => {
    const data = doc.data();
    records.push({
      id: doc.id,
      room: data.roomNumber,
      month: data.month,
      rent: Number(data.rent) || 0,
      electricity: Number(data.electricity) || 0,
      total: Number(data.total || data.totalAmount) || 0,
      paidAmount: Number(data.paidAmount) || 0
    });
  });
  
  // Sort by month and room
  records.sort((a, b) => {
    if (a.month !== b.month) return a.month - b.month;
    return a.room - b.room;
  });
  
  records.forEach((record) => {
    console.log(`Room ${record.room}, Month ${record.month}:`);
    console.log(`  Rent: ₹${record.rent}`);
    console.log(`  Electricity: ₹${record.electricity}`);
    console.log(`  Total (stored): ₹${record.total}`);
    console.log(`  Calculated (rent+elec): ₹${record.rent + record.electricity}`);
    console.log(`  PaidAmount: ₹${record.paidAmount}`);
    console.log(`  Match: ${record.total === (record.rent + record.electricity) ? '✅' : '❌ MISMATCH!'}`);
    console.log('-------------------------------------');
    
    totalRent += record.rent;
    totalElectricity += record.electricity;
    totalTotal += record.total;
    totalPaidAmount += record.paidAmount;
    recordCount++;
  });
  
  console.log('\n=== 2017 TOTALS ===');
  console.log(`Total Records: ${recordCount}`);
  console.log(`Total Rent: ₹${totalRent.toLocaleString('en-IN')}`);
  console.log(`Total Electricity: ₹${totalElectricity.toLocaleString('en-IN')}`);
  console.log(`Total (from 'total' field): ₹${totalTotal.toLocaleString('en-IN')}`);
  console.log(`Calculated Total (rent+elec): ₹${(totalRent + totalElectricity).toLocaleString('en-IN')}`);
  console.log(`Total Paid Amount: ₹${totalPaidAmount.toLocaleString('en-IN')}`);
  console.log('\nExpected by user:');
  console.log(`  Rent: ₹33,300`);
  console.log(`  Electricity: ₹3,420`);
  console.log(`  Total: ₹36,720`);
  
  process.exit(0);
}

check2017Data().catch(console.error);
