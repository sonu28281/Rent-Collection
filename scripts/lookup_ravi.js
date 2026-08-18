/**
 * READ-ONLY lookup: find Ravi's tenant record (Room 202) and his payment
 * history, to prep the checkout settlement script with the right anchors
 * (tenant id, room doc id, last recorded month/reading).
 * Usage: node scripts/lookup_ravi.js
 */
import admin from 'firebase-admin';
import { readFile } from 'fs/promises';

try {
  const sa = JSON.parse(await readFile('./serviceAccountKey.json', 'utf8'));
  admin.initializeApp({ credential: admin.credential.cert(sa) });
  console.log('✅ Firebase Admin initialized\n');
} catch (e) { console.error('Init error:', e.message); process.exit(1); }
const db = admin.firestore();

const run = async () => {
  const tenantsSnap = await db.collection('tenants').get();
  const matches = tenantsSnap.docs.filter((d) => {
    const x = d.data();
    return /ravi/i.test(String(x.name || '')) || String(x.roomNumber) === '202';
  });

  console.log(`Found ${matches.length} candidate tenant(s):`);
  matches.forEach((d) => {
    const x = d.data();
    console.log(`  id=${d.id} name=${x.name} room=${x.roomNumber} isActive=${x.isActive} checkIn=${x.checkInDate} rent=${x.currentRent}`);
  });

  const roomsSnap = await db.collection('rooms').where('roomNumber', '==', 202).get();
  console.log(`\nRoom 202 doc(s): ${roomsSnap.size}`);
  roomsSnap.docs.forEach((d) => {
    const x = d.data();
    console.log(`  id=${d.id} status=${x.status} currentTenantId=${x.currentTenantId} currentReading=${x.currentReading}`);
  });

  for (const t of matches) {
    console.log(`\n=== Payments for ${t.data().name} (${t.id}) ===`);
    const ps = await db.collection('payments').where('tenantId', '==', t.id).get();
    const rows = ps.docs.map((d) => ({ id: d.id, ...d.data() }));
    rows.sort((a, b) => (a.year - b.year) || (a.month - b.month));
    rows.forEach((r) => {
      console.log(`  ${r.year}-${String(r.month).padStart(2, '0')} | status=${r.status} | rent=${r.rent} elec=${r.electricity} paidAmount=${r.paidAmount} | reading=${r.currentReading ?? r.meterReading} | id=${r.id}`);
    });
  }
  process.exit(0);
};
run().catch((e) => { console.error('Failed:', e); process.exit(1); });
