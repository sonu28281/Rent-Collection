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

// Test the due date logic
async function testDueDateLogic() {
  console.log('🧪 Testing Due Date Logic for Room 101...\n');
  
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
      dueDate: tenant.dueDate
    });
    
    // Get payment records
    const paymentsRef = collection(db, 'payments');
    const paymentsQuery = query(paymentsRef, where('roomNumber', '==', 101));
    const paymentsSnapshot = await getDocs(paymentsQuery);
    
    console.log(`\n📊 Total payment records: ${paymentsSnapshot.size}`);
    
    // Filter by tenant name
    const records = [];
    paymentsSnapshot.forEach(doc => {
      const data = doc.data();
      if (data.tenantNameSnapshot === tenant.name || data.tenantName === tenant.name) {
        records.push({ id: doc.id, ...data });
      }
    });
    
    console.log(`📋 Records for ${tenant.name}: ${records.length}\n`);
    
    // Sort records
    records.sort((a, b) => {
      if (b.year !== a.year) return b.year - a.year;
      return b.month - a.month;
    });
    
    // Show latest 5 records
    console.log('🔝 Latest 5 payment records:');
    records.slice(0, 5).forEach((r, i) => {
      console.log(`${i + 1}. ${r.month}/${r.year}: ₹${(r.rent || 0) + (r.electricity || 0)} - ${r.status}`);
    });
    
    // Test due date logic
    const today = new Date();
    const currentYear = today.getFullYear();
    const currentMonth = today.getMonth() + 1;
    const currentDay = today.getDate();
    const dueDay = tenant.dueDate || 20;
    
    console.log('\n📅 Current Date Info:');
    console.log(`  Today: ${currentDay}/${currentMonth}/${currentYear}`);
    console.log(`  Due Day: ${dueDay} of every month`);
    
    // Check current month payment
    const currentMonthPayment = records.find(
      p => p.year === currentYear && p.month === currentMonth
    );
    
    console.log('\n💳 Current Month Payment:');
    if (currentMonthPayment) {
      console.log(`  ✅ Found: ${currentMonthPayment.month}/${currentMonthPayment.year}`);
      console.log(`  Status: ${currentMonthPayment.status}`);
      console.log(`  Amount: ₹${(currentMonthPayment.rent || 0) + (currentMonthPayment.electricity || 0)}`);
    } else {
      console.log('  ❌ Not found');
    }
    
    // Calculate what should be shown
    let nextDueMonth, nextDueYear, status, statusText;
    
    if (currentMonthPayment && currentMonthPayment.status === 'paid') {
      // Current month paid - show NEXT month
      if (currentMonth === 12) {
        nextDueMonth = 1;
        nextDueYear = currentYear + 1;
      } else {
        nextDueMonth = currentMonth + 1;
        nextDueYear = currentYear;
      }
      status = 'paid';
      statusText = 'Current Month Paid ✅';
    } else if (currentDay <= dueDay) {
      // Before due date
      nextDueMonth = currentMonth;
      nextDueYear = currentYear;
      status = 'due';
      statusText = 'Payment Due This Month';
    } else {
      // After due date, not paid
      nextDueMonth = currentMonth;
      nextDueYear = currentYear;
      status = 'overdue';
      statusText = 'Payment Overdue!';
    }
    
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const dueDateStr = `${dueDay} ${monthNames[nextDueMonth - 1]} ${nextDueYear}`;
    
    console.log('\n🎯 Expected UI Display:');
    console.log(`  Status: ${status.toUpperCase()}`);
    console.log(`  Status Text: "${statusText}"`);
    console.log(`  Due Date: ${dueDateStr}`);
    console.log(`  Color: ${status === 'paid' ? '🟢 GREEN' : status === 'due' ? '🔵 BLUE' : '🔴 RED'}`);
    
  } catch (error) {
    console.error('❌ Error:', error);
  }
  
  process.exit(0);
}

testDueDateLogic();
