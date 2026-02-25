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

// Check Room 101 payment records for 2026
async function checkRoom101Payments() {
  console.log('🔍 Checking Room 101 payment records...\n');
  
  try {
    // Query for Room 101 payments
    const paymentsRef = collection(db, 'payments');
    const roomQuery = query(
      paymentsRef,
      where('roomNumber', '==', 101)
    );
    
    const snapshot = await getDocs(roomQuery);
    console.log(`📊 Total payment records for Room 101: ${snapshot.size}\n`);
    
    if (snapshot.size === 0) {
      console.log('❌ No payment records found for Room 101!');
      process.exit(0);
    }
    
    // Collect and sort records
    const records = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      records.push({
        id: doc.id,
        year: data.year,
        month: data.month,
        status: data.status,
        rent: data.rent,
        electricity: data.electricity,
        total: (data.rent || 0) + (data.electricity || 0)
      });
    });
    
    // Sort by year and month (descending)
    records.sort((a, b) => {
      if (b.year !== a.year) return b.year - a.year;
      return b.month - a.month;
    });
    
    console.log('📋 Latest 15 payment records:\n');
    records.slice(0, 15).forEach((r, i) => {
      const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      console.log(`${i + 1}. ${monthNames[r.month - 1]} ${r.year}: ₹${r.total} (${r.status})`);
    });
    
    // Check specifically for Jan and Feb 2026
    console.log('\n🔍 Checking for Jan & Feb 2026 specifically:\n');
    
    const jan2026 = records.find(r => r.year === 2026 && r.month === 1);
    const feb2026 = records.find(r => r.year === 2026 && r.month === 2);
    
    if (jan2026) {
      console.log('✅ Jan 2026 found:', {
        id: jan2026.id,
        status: jan2026.status,
        rent: jan2026.rent,
        electricity: jan2026.electricity,
        total: jan2026.total
      });
    } else {
      console.log('❌ Jan 2026 NOT found');
    }
    
    if (feb2026) {
      console.log('✅ Feb 2026 found:', {
        id: feb2026.id,
        status: feb2026.status,
        rent: feb2026.rent,
        electricity: feb2026.electricity,
        total: feb2026.total
      });
    } else {
      console.log('❌ Feb 2026 NOT found');
    }
    
    // Check tenant data
    console.log('\n👤 Checking tenant data for Room 101:\n');
    const tenantsRef = collection(db, 'tenants');
    const tenantQuery = query(
      tenantsRef,
      where('roomNumber', '==', '101')
    );
    const tenantSnapshot = await getDocs(tenantQuery);
    
    if (!tenantSnapshot.empty) {
      const tenant = tenantSnapshot.docs[0].data();
      console.log('✅ Tenant found:', {
        name: tenant.name,
        roomNumber: tenant.roomNumber,
        roomNumberType: typeof tenant.roomNumber,
        currentRent: tenant.currentRent
      });
    } else {
      console.log('⚠️ Checking with number type...');
      const tenantQuery2 = query(
        tenantsRef,
        where('roomNumber', '==', 101)
      );
      const tenantSnapshot2 = await getDocs(tenantQuery2);
      if (!tenantSnapshot2.empty) {
        const tenant = tenantSnapshot2.docs[0].data();
        console.log('✅ Tenant found (number):', {
          name: tenant.name,
          roomNumber: tenant.roomNumber,
          roomNumberType: typeof tenant.roomNumber
        });
      } else {
        console.log('❌ Tenant not found!');
      }
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
  }
  
  process.exit(0);
}

checkRoom101Payments();
