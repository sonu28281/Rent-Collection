/**
 * One-off: complete Ravi Singh's (Room 202) checkout using the final bill
 * given by the admin — same logic CheckoutTenantModal now applies for future
 * checkouts: record the settlement as a payments doc (with the final meter
 * reading), mark the tenant inactive, and mark the room vacant with the
 * final reading saved on the room doc for the next tenant.
 *
 * Usage:
 *   node scripts/checkout_ravi_singh.js           # dry run
 *   node scripts/checkout_ravi_singh.js --apply    # write
 * Requires ./serviceAccountKey.json.
 */
import admin from 'firebase-admin';
import { readFile } from 'fs/promises';

const APPLY = process.argv.includes('--apply');
const TENANT_ID = 'w8P0VRCZdmOS247GlGwC'; // Ravi Singh
const ROOM_ID = 'yzky8kILVyXTWBlG7MeZ';   // Room 202

const CHECKOUT_DATE = '2026-08-08'; // 8 days into August, per the given bill
const PREVIOUS_READING = 1502;
const CURRENT_READING = 1538;
const UNITS = 36;
const RATE = 9;
const ELECTRICITY = 324;
const RENT = 640; // 8 days, prorated
const PAID_AMOUNT = 964;

try {
  const sa = JSON.parse(await readFile('./serviceAccountKey.json', 'utf8'));
  admin.initializeApp({ credential: admin.credential.cert(sa) });
  console.log('✅ Firebase Admin initialized\n');
} catch (e) { console.error('Init error:', e.message); process.exit(1); }
const db = admin.firestore();

const run = async () => {
  console.log(APPLY ? '⚠️  APPLY mode — writing changes\n' : '🔍 DRY RUN — no writes (pass --apply)\n');

  const tenantSnap = await db.collection('tenants').doc(TENANT_ID).get();
  const roomSnap = await db.collection('rooms').doc(ROOM_ID).get();
  if (!tenantSnap.exists) { console.error('Tenant not found'); process.exit(1); }
  if (!roomSnap.exists) { console.error('Room not found'); process.exit(1); }
  const tenant = { id: tenantSnap.id, ...tenantSnap.data() };
  const room = { id: roomSnap.id, ...roomSnap.data() };

  const checkoutDateObj = new Date(CHECKOUT_DATE);
  const year = checkoutDateObj.getFullYear();
  const month = checkoutDateObj.getMonth() + 1;

  console.log(`Tenant: ${tenant.name} (Room ${room.roomNumber}) | currently isActive=${tenant.isActive}`);
  console.log(`Room current status=${room.status} currentReading=${room.currentReading} currentTenantId=${room.currentTenantId}\n`);
  console.log('Planned final settlement record:');
  console.log(`  ${year}-${String(month).padStart(2, '0')} | rent=${RENT} electricity=${ELECTRICITY} (${UNITS} units @ ₹${RATE}) | paidAmount=${PAID_AMOUNT} | status=paid`);
  console.log(`  reading: ${PREVIOUS_READING} -> ${CURRENT_READING}`);
  console.log('\nPlanned tenant update: isActive=false, status=inactive, checkOutDate=' + CHECKOUT_DATE);
  console.log(`Planned room update: status=vacant, currentTenantId=null, currentReading=${CURRENT_READING}`);

  if (!APPLY) { console.log('\nRun again with --apply to write.'); process.exit(0); }

  const nowIso = new Date().toISOString();
  const batch = db.batch();

  const existingSnap = await db.collection('payments')
    .where('tenantId', '==', TENANT_ID)
    .where('year', '==', year)
    .where('month', '==', month)
    .get();

  const paymentPayload = {
    tenantId: TENANT_ID,
    tenantNameSnapshot: tenant.name,
    roomNumber: room.roomNumber,
    year,
    month,
    rent: RENT,
    electricity: ELECTRICITY,
    paidAmount: PAID_AMOUNT,
    status: 'paid',
    oldReading: PREVIOUS_READING,
    previousReading: PREVIOUS_READING,
    currentReading: CURRENT_READING,
    meterReading: CURRENT_READING,
    units: UNITS,
    unitsConsumed: UNITS,
    paidDate: CHECKOUT_DATE,
    paymentMethod: 'checkout-settlement',
    notes: 'Final checkout settlement',
    isCheckoutSettlement: true,
    updatedAt: nowIso
  };

  if (!existingSnap.empty) {
    batch.set(db.collection('payments').doc(existingSnap.docs[0].id), paymentPayload, { merge: true });
  } else {
    batch.set(db.collection('payments').doc(), { ...paymentPayload, createdAt: nowIso });
  }

  batch.set(db.collection('tenants').doc(TENANT_ID), {
    status: 'inactive',
    isActive: false,
    checkOutDate: CHECKOUT_DATE,
    updatedAt: nowIso
  }, { merge: true });

  batch.set(db.collection('rooms').doc(ROOM_ID), {
    status: 'vacant',
    currentTenantId: null,
    currentReading: CURRENT_READING,
    lastStatusUpdatedAt: nowIso
  }, { merge: true });

  await batch.commit();

  await db.collection('roomStatusLogs').add({
    roomId: ROOM_ID,
    roomNumber: room.roomNumber,
    oldStatus: room.status || 'occupied',
    newStatus: 'vacant',
    changedBy: 'script',
    changedByEmail: 'admin',
    changedAt: nowIso,
    remark: `Checkout: ${tenant.name}`
  });

  console.log('\n✅ Applied. Ravi Singh checked out, Room 202 vacant, reading 1538 saved.');
  process.exit(0);
};
run().catch((e) => { console.error('Failed:', e); process.exit(1); });
