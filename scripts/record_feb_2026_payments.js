import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, addDoc, query, where } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyDV29cmwZ9KReQMi8pLsaVZUPA-BMN_gPw",
  authDomain: "rent-collection-b5c84.firebaseapp.com",
  projectId: "rent-collection-b5c84",
  storageBucket: "rent-collection-b5c84.firebasestorage.app",
  messagingSenderId: "715608790441",
  appId: "1:715608790441:web:2f50a62c3a850f8bd7ff38"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function recordFebruaryPayments() {
  try {
    console.log('🚀 Recording February 2026 payments...\n');

    // Get all active tenants
    const tenantsRef = collection(db, 'tenants');
    const tenantsQuery = query(tenantsRef, where('isActive', '==', true));
    const tenantsSnapshot = await getDocs(tenantsQuery);
    
    const tenants = [];
    tenantsSnapshot.forEach((doc) => {
      const data = doc.data();
      // Exclude DK Singh (Room 103)
      if (data.roomNumber !== '103') {
        tenants.push({ id: doc.id, ...data });
      }
    });

    console.log(`Found ${tenants.length} tenants (excluding DK Singh)\n`);

    // Check existing payments for Feb 2026
    const paymentsRef = collection(db, 'payments');
    const existingQuery = query(
      paymentsRef,
      where('year', '==', 2026),
      where('month', '==', 2)
    );
    const existingSnapshot = await getDocs(existingQuery);
    const existingPayments = new Set();
    existingSnapshot.forEach((doc) => {
      existingPayments.add(doc.data().tenantId);
    });

    console.log(`${existingPayments.size} payments already recorded for Feb 2026\n`);

    // Record payments
    let recorded = 0;
    let skipped = 0;

    for (const tenant of tenants) {
      if (existingPayments.has(tenant.id)) {
        console.log(`⏭️  ${tenant.name} (Room ${tenant.roomNumber}) - Already paid`);
        skipped++;
        continue;
      }

      const paymentData = {
        tenantId: tenant.id,
        tenantNameSnapshot: tenant.name,
        roomNumber: tenant.roomNumber,
        year: 2026,
        month: 2,
        rent: tenant.currentRent || 0,
        electricity: 0,
        paidAmount: tenant.currentRent || 0,
        paidDate: '2026-02-25',
        paymentMethod: 'UPI',
        utr: `UPI${Date.now()}${Math.floor(Math.random() * 1000)}`,
        notes: 'February 2026 payment',
        status: 'paid',
        createdAt: new Date().toISOString()
      };

      await addDoc(paymentsRef, paymentData);
      console.log(`✅ ${tenant.name} (Room ${tenant.roomNumber}) - ₹${tenant.currentRent}`);
      recorded++;
    }

    console.log(`\n📊 Summary:`);
    console.log(`✅ Recorded: ${recorded}`);
    console.log(`⏭️  Skipped: ${skipped}`);
    console.log(`❌ Pending: DK Singh (Room 103)`);
    console.log(`\n✅ Done!`);

    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

recordFebruaryPayments();
