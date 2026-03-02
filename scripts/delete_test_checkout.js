const admin = require('firebase-admin');
const serviceAccount = require('../firebase-admin-key.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function deleteTestCheckoutRequest() {
  try {
    console.log('🔍 Finding checkout requests for tenant 101...\n');
    
    // First, find the tenant
    const tenantSnapshot = await db.collection('tenants').where('roomNumber', '==', '101').get();
    
    if (tenantSnapshot.empty) {
      console.log('❌ No tenant found with room number 101');
      return;
    }
    
    const tenant = tenantSnapshot.docs[0];
    const tenantId = tenant.id;
    const tenantData = tenant.data();
    
    console.log(`✅ Found tenant 101: ${tenantData.name} (ID: ${tenantId})`);
    console.log(`   Current Status: ${tenantData.status}`);
    console.log(`   Checkout Request ID: ${tenantData.checkoutRequestId}\n`);
    
    // Find checkout requests for this tenant
    const checkoutSnapshot = await db.collection('checkoutRequests')
      .where('tenantId', '==', tenantId)
      .get();
    
    if (checkoutSnapshot.empty) {
      console.log('❌ No checkout requests found for this tenant');
      return;
    }
    
    console.log(`📋 Found ${checkoutSnapshot.docs.length} checkout request(s):\n`);
    
    // Delete each request
    for (const doc of checkoutSnapshot.docs) {
      const requestData = doc.data();
      console.log(`📌 Request ID: ${doc.id}`);
      console.log(`   Status: ${requestData.status}`);
      console.log(`   Proposed Date: ${new Date(requestData.proposedCheckoutDate).toLocaleDateString('en-IN')}`);
      console.log(`   Created: ${new Date(requestData.requestedAt.toDate()).toLocaleDateString('en-IN')}`);
      
      // Delete the checkout request
      await db.collection('checkoutRequests').doc(doc.id).delete();
      console.log(`   ✅ DELETED\n`);
    }
    
    // Reset tenant status
    console.log('🔄 Resetting tenant status to active...');
    await db.collection('tenants').doc(tenantId).update({
      status: 'active',
      checkoutRequestId: null,
      proposedCheckoutDate: null,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    
    console.log('✅ Tenant status reset to active\n');
    console.log('🎉 Test checkout request deleted successfully!');
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

deleteTestCheckoutRequest();
