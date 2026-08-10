/**
 * READ-ONLY diagnostic: Veer Singh paid 2 months' rent together this month.
 * Checks whether last month's record got correctly marked paid, and whether
 * there's any duplicate/double-recorded payment for the same year+month.
 *
 * Usage: node scripts/check_veer_singh.js
 * Requires ./serviceAccountKey.json. Makes NO writes.
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
  const matches = tenantsSnap.docs.filter((d) => /veer\s*si?n?gh/i.test(String(d.data().name || '')));

  if (matches.length === 0) {
    console.log('No tenant matching "Veer Singh" found in tenants collection.');
    process.exit(0);
  }

  console.log(`Found ${matches.length} matching tenant(s):`);
  matches.forEach((d) => console.log(`  id=${d.id} name=${d.data().name} room=${d.data().roomNumber ?? d.data().room}`));
  console.log('');

  for (const t of matches) {
    const tid = t.id;
    const tdata = t.data();
    console.log(`\n=== Payments for ${tdata.name} (tenantId=${tid}) ===`);

    const ps = await db.collection('payments').where('tenantId', '==', tid).get();
    const rows = ps.docs.map((d) => {
      const x = d.data();
      return {
        id: d.id,
        year: x.year,
        month: x.month,
        status: x.status,
        rent: x.rent ?? x.rentAmount,
        electricity: x.electricity ?? x.electricityAmount,
        total: x.total ?? x.totalAmount,
        paidAmount: x.paidAmount,
        paidDate: x.paidDate,
        paidAt: x.paidAt,
        createdAt: x.createdAt,
      };
    });

    rows.sort((a, b) => (a.year - b.year) || (a.month - b.month));

    rows.forEach((r) => {
      console.log(`  ${r.year}-${String(r.month).padStart(2, '0')} | status=${r.status} | rent=${r.rent} elec=${r.electricity} total=${r.total} | paidAmount=${r.paidAmount} | paidDate=${r.paidDate} | id=${r.id}`);
    });

    // Duplicate check: more than one doc for same year+month
    const byPeriod = {};
    rows.forEach((r) => {
      const key = `${r.year}-${r.month}`;
      (byPeriod[key] = byPeriod[key] || []).push(r);
    });
    const dupes = Object.entries(byPeriod).filter(([, v]) => v.length > 1);
    if (dupes.length > 0) {
      console.log('\n  ⚠️  DUPLICATE records found for the same period:');
      dupes.forEach(([key, v]) => {
        console.log(`    ${key}: ${v.length} records -> ids: ${v.map((r) => r.id).join(', ')}`);
      });
    } else {
      console.log('\n  ✅ No duplicate year+month records for this tenant.');
    }

    // Pending check: any non-paid status in the last 3 periods
    const pending = rows.filter((r) => r.status !== 'paid');
    if (pending.length > 0) {
      console.log('\n  ⚠️  Records NOT marked paid:');
      pending.forEach((r) => console.log(`    ${r.year}-${String(r.month).padStart(2, '0')} status=${r.status} id=${r.id}`));
    } else {
      console.log('  ✅ All records are marked paid.');
    }
  }

  process.exit(0);
};
run().catch((e) => { console.error('Failed:', e); process.exit(1); });
