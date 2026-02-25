import { initializeApp } from 'firebase/app';
import { getFirestore, collection, doc, setDoc, getDocs, query, where } from 'firebase/firestore';

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

// Create Jan & Feb 2026 payments for Room 101
async function createPaymentsForRoom101() {
  console.log('🔧 Creating Jan & Feb 2026 payments for Room 101...\n');
  
  try {
    // Get Room 101 tenant
    const tenantsRef = collection(db, 'tenants');
    const tenantQuery = query(tenantsRef, where('roomNumber', '==', '101'));
    const tenantSnapshot = await getDocs(tenantQuery);
    
    if (tenantSnapshot.empty) {
      console.log('❌ Tenant not found for Room 101');
      process.exit(1);
    }
    
    const tenant = tenantSnapshot.docs[0].data();
    console.log('👤 Tenant:', {
      name: tenant.name,
      roomNumber: tenant.roomNumber,
      currentRent: tenant.currentRent
    });
    
    const roomNumber = 101;
    const rent = tenant.currentRent || 3200;
    const floor = 1;
    
    // Jan 2026 Payment
    const jan2026 = {
      roomNumber,
      floor,
      tenantNameSnapshot: tenant.name,
      tenantName: tenant.name, // Backward compatibility
      year: 2026,
      month: 1,
      rent,
      oldReading: 0,
      currentReading: 0,
      units: 0,
      ratePerUnit: 8.5,
      electricity: 0,
      total: rent,
      paidAmount: rent,
      status: 'paid',
      paymentDate: new Date('2026-01-15'),
      paidAt: new Date('2026-01-15').toISOString(),
      paymentMode: 'upi',
      paymentMethod: 'UPI',
      createdAt: new Date(),
      updatedAt: new Date()
    };
    
    // Feb 2026 Payment
    const feb2026 = {
      roomNumber,
      floor,
      tenantNameSnapshot: tenant.name,
      tenantName: tenant.name,
      year: 2026,
      month: 2,
      rent,
      oldReading: 0,
      currentReading: 0,
      units: 0,
      ratePerUnit: 8.5,
      electricity: 0,
      total: rent,
      paidAmount: rent,
      status: 'paid',
      paymentDate: new Date('2026-02-10'),
      paidAt: new Date('2026-02-10').toISOString(),
      paymentMode: 'upi',
      paymentMethod: 'UPI',
      createdAt: new Date(),
      updatedAt: new Date()
    };
    
    // Create payment documents
    const paymentsRef = collection(db, 'payments');
    
    console.log('\n📝 Creating Jan 2026 payment...');
    await setDoc(doc(paymentsRef, `101_2026_1`), jan2026);
    console.log('✅ Jan 2026 created');
    
    console.log('\n📝 Creating Feb 2026 payment...');
    await setDoc(doc(paymentsRef, `101_2026_2`), feb2026);
    console.log('✅ Feb 2026 created');
    
    console.log('\n🎉 Success! Created 2 payment records for Room 101');
    console.log(`   Tenant: ${tenant.name}`);
    console.log(`   Jan 2026: ₹${rent} (paid on 15-Jan-2026)`);
    console.log(`   Feb 2026: ₹${rent} (paid on 10-Feb-2026)`);
    
  } catch (error) {
    console.error('❌ Error:', error);
  }
  
  process.exit(0);
}

createPaymentsForRoom101();
