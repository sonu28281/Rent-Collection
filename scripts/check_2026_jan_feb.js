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

// Check 2026 payments (Jan & Feb)
async function check2026Payments() {
  console.log('🔍 Checking 2026 Jan & Feb payments...\n');
  
  try {
    // Get all 2026 payments
    const paymentsRef = collection(db, 'payments');
    const q2026 = query(
      paymentsRef,
      where('year', '==', 2026)
    );
    const snapshot = await getDocs(q2026);
    
    console.log(`📊 Total 2026 payment records: ${snapshot.size}\n`);
    
    // Group by month
    const byMonth = {};
    let totalPaidAmount = 0;
    let totalBilled = 0;
    
    snapshot.forEach(doc => {
      const data = doc.data();
      const month = data.month;
      
      if (!byMonth[month]) {
        byMonth[month] = {
          count: 0,
          totalRent: 0,
          totalElectricity: 0,
          totalBilled: 0,
          totalPaid: 0,
          payments: []
        };
      }
      
      const rent = Number(data.rent) || 0;
      const electricity = Number(data.electricity) || 0;
      const billed = rent + electricity;
      const paid = Number(data.paidAmount) || 0;
      
      byMonth[month].count++;
      byMonth[month].totalRent += rent;
      byMonth[month].totalElectricity += electricity;
      byMonth[month].totalBilled += billed;
      byMonth[month].totalPaid += paid;
      
      totalBilled += billed;
      totalPaidAmount += paid;
      
      byMonth[month].payments.push({
        room: data.roomNumber,
        tenant: data.tenantNameSnapshot || data.tenantName || '-',
        status: data.status,
        rent,
        electricity,
        billed,
        paid
      });
    });
    
    // Display results
    const monthNames = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    
    for (let m = 1; m <= 12; m++) {
      if (byMonth[m]) {
        const month = byMonth[m];
        console.log(`\n📅 ${monthNames[m]} 2026:`);
        console.log(`  Records: ${month.count}`);
        console.log(`  Rent: ₹${month.totalRent}`);
        console.log(`  Electricity: ₹${month.totalElectricity}`);
        console.log(`  Total Billed: ₹${month.totalBilled}`);
        console.log(`  Total Paid: ₹${month.totalPaid}`);
        console.log(`  Status Summary:`);
        
        // Status breakdown
        const statuses = {};
        month.payments.forEach(p => {
          if (!statuses[p.status]) statuses[p.status] = 0;
          statuses[p.status]++;
        });
        
        for (const [status, count] of Object.entries(statuses)) {
          console.log(`    ${status}: ${count}`);
        }
      }
    }
    
    console.log(`\n\n💰 2026 Total Summary:`);
    console.log(`  Total Billed: ₹${totalBilled}`);
    console.log(`  Total Collected: ₹${totalPaidAmount}`);
    console.log(`  Difference: ₹${totalBilled - totalPaidAmount}`);
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

check2026Payments();
