import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, query, where } from 'firebase/firestore';
import * as dotenv from 'dotenv';

dotenv.config();

const firebaseConfig = {
  apiKey: process.env.VITE_FIREBASE_API_KEY,
  authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.VITE_FIREBASE_APP_ID
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function check2017Electricity() {
  console.log('\n=== Checking 2017 Electricity Data ===\n');
  
  const paymentsRef = collection(db, 'payments');
  const q = query(paymentsRef, where('year', '==', 2017));
  const snapshot = await getDocs(q);
  
  let totalRent = 0;
  let totalElectricity = 0;
  let recordCount = 0;
  
  const records = [];
  snapshot.forEach((doc) => {
    const data = doc.data();
    records.push({
      room: data.roomNumber,
      month: data.month,
      rent: Number(data.rent) || 0,
      electricity: Number(data.electricity) || 0,
      units: Number(data.units) || 0,
      oldReading: Number(data.oldReading) || 0,
      currentReading: Number(data.currentReading) || 0,
      ratePerUnit: Number(data.ratePerUnit) || 0
    });
  });
  
  records.sort((a, b) => {
    if (a.month !== b.month) return a.month - b.month;
    return a.room - b.room;
  });
  
  console.log('Record Details:');
  console.log('=========================================');
  records.forEach((record) => {
    console.log(`Room ${record.room}, Month ${record.month}:`);
    console.log(`  Rent: ₹${record.rent}`);
    console.log(`  Electricity: ₹${record.electricity}`);
    console.log(`  Old Reading: ${record.oldReading}, Current: ${record.currentReading}`);
    console.log(`  Units: ${record.units}, Rate: ₹${record.ratePerUnit}`);
    console.log(`  Calculated Elec: ₹${record.units * record.ratePerUnit}`);
    console.log('-------------------------------------');
    
    totalRent += record.rent;
    totalElectricity += record.electricity;
    recordCount++;
  });
  
  console.log('\n=== 2017 TOTALS ===');
  console.log(`Total Records: ${recordCount}`);
  console.log(`Total Rent: ₹${totalRent.toLocaleString('en-IN')}`);
  console.log(`Total Electricity: ₹${totalElectricity.toLocaleString('en-IN')}`);
  console.log(`Expected Electricity: ₹3,420`);
  console.log(`Difference: ₹${(3420 - totalElectricity).toLocaleString('en-IN')}`);
  
  process.exit(0);
}

check2017Electricity().catch(console.error);
