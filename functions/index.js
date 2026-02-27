const admin = require('firebase-admin');
const { onDocumentCreated, onDocumentUpdated } = require('firebase-functions/v2/firestore');
const { onSchedule } = require('firebase-functions/v2/scheduler');

admin.initializeApp();

const db = admin.firestore();
const messaging = admin.messaging();

const sendPushToRole = async ({ role, title, body, path = '/', tenantId = null, data = {} }) => {
  let tokenQuery = db.collection('deviceTokens').where('role', '==', role).where('isActive', '==', true);

  if (tenantId) {
    tokenQuery = tokenQuery.where('tenantId', '==', tenantId);
  }

  const tokenSnapshot = await tokenQuery.get();
  if (tokenSnapshot.empty) return;

  const tokens = tokenSnapshot.docs
    .map((tokenDoc) => tokenDoc.data()?.token)
    .filter(Boolean);

  if (tokens.length === 0) return;

  const payload = {
    notification: { title, body },
    data: {
      path,
      ...Object.fromEntries(Object.entries(data).map(([key, value]) => [String(key), String(value)]))
    },
    tokens,
    webpush: {
      fcmOptions: {
        link: path
      },
      notification: {
        title,
        body,
        icon: '/icons/icon-192x192.png'
      }
    }
  };

  await messaging.sendEachForMulticast(payload);
};

const markEventIfNew = async (eventKey) => {
  const eventRef = db.collection('notificationEvents').doc(eventKey);
  const eventSnapshot = await eventRef.get();
  if (eventSnapshot.exists) return false;

  await eventRef.set({
    createdAt: new Date().toISOString(),
    eventKey
  });

  return true;
};

exports.onNewVerificationRequest = onDocumentCreated('paymentSubmissions/{submissionId}', async (event) => {
  const submission = event.data?.data();
  if (!submission) return;
  if ((submission.status || 'pending') !== 'pending') return;

  const amount = Number(submission.paidAmount || 0).toFixed(2);
  const eventKey = `admin_pending_${event.params.submissionId}`;
  const shouldNotify = await markEventIfNew(eventKey);
  if (!shouldNotify) return;

  await sendPushToRole({
    role: 'admin',
    title: '💳 New Payment Verification Request',
    body: `${submission.tenantName || 'Tenant'} ne ₹${amount} send kiya hai.`,
    path: '/verify-payments',
    data: {
      submissionId: event.params.submissionId,
      tenantName: submission.tenantName || 'Tenant',
      amount
    }
  });
});

exports.onSubmissionStatusChanged = onDocumentUpdated('paymentSubmissions/{submissionId}', async (event) => {
  const before = event.data?.before?.data();
  const after = event.data?.after?.data();
  if (!before || !after) return;

  if (before.status === after.status) return;

  const tenantId = after.tenantId || null;
  if (!tenantId) return;

  if (after.status === 'rejected') {
    const eventKey = `tenant_rejected_${event.params.submissionId}`;
    const shouldNotify = await markEventIfNew(eventKey);
    if (!shouldNotify) return;

    await sendPushToRole({
      role: 'tenant',
      tenantId,
      title: '❌ Payment Rejected',
      body: 'Aapki last payment reject ho gayi hai. Kripya dubara submit karein.',
      path: '/tenant-portal',
      data: { status: 'rejected', submissionId: event.params.submissionId }
    });
  }

  if (after.status === 'verified') {
    const amount = Number(after.paidAmount || 0).toFixed(2);
    const eventKey = `tenant_verified_${event.params.submissionId}`;
    const shouldNotify = await markEventIfNew(eventKey);
    if (!shouldNotify) return;

    await sendPushToRole({
      role: 'tenant',
      tenantId,
      title: '✅ Payment Verified',
      body: `Aapki ₹${amount} payment verify ho gayi hai aur account me add ho gayi hai.`,
      path: '/tenant-portal',
      data: { status: 'verified', submissionId: event.params.submissionId, amount }
    });
  }
});

exports.notifyOverdueRentDaily = onSchedule('every day 10:00', async () => {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  const currentDate = now.getDate();

  const tenantsSnapshot = await db.collection('tenants').where('isActive', '==', true).get();
  if (tenantsSnapshot.empty) return;

  const paymentsSnapshot = await db
    .collection('payments')
    .where('year', '==', currentYear)
    .where('month', '==', currentMonth)
    .where('status', '==', 'paid')
    .get();

  const paidByTenantId = new Set(
    paymentsSnapshot.docs
      .map((paymentDoc) => paymentDoc.data()?.tenantId)
      .filter(Boolean)
  );

  const notifyPromises = [];

  tenantsSnapshot.forEach((tenantDoc) => {
    const tenant = tenantDoc.data() || {};
    const tenantId = tenantDoc.id;
    const dueDate = Number(tenant.dueDate || 20);

    if (currentDate <= dueDate) return;
    if (paidByTenantId.has(tenantId)) return;

    const eventKey = `tenant_due_${tenantId}_${currentYear}_${currentMonth}`;
    notifyPromises.push(
      markEventIfNew(eventKey).then((shouldNotify) => {
        if (!shouldNotify) return;
        return sendPushToRole({
          role: 'tenant',
          tenantId,
          title: '⏰ Rent Due Alert',
          body: 'Aapka rent due date nikal gaya hai. Kripya payment submit karein.',
          path: '/tenant-portal',
          data: { type: 'rent_due', month: currentMonth, year: currentYear }
        });
      })
    );
  });

  await Promise.all(notifyPromises);
});
