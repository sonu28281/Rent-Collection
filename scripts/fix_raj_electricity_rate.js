/**
 * One-off fix: Raj Singh (room 104) is on a ₹8/unit electricity rate, not the
 * global ₹9. Sets his tenant customElectricityRate = 8 and recomputes any of his
 * payment records whose electricity was stored at a different rate to
 * electricity = units × 8, total = rent + electricity. paidAmount is untouched.
 *
 * Records already at ₹8 (units × 8) are left unchanged. Only Raj is affected.
 *
 * Usage:
 *   node scripts/fix_raj_electricity_rate.js           # dry run (no writes)
 *   node scripts/fix_raj_electricity_rate.js --apply    # perform the fix
 * Requires ./serviceAccountKey.json.
 */
import admin from 'firebase-admin';
import { readFile } from 'fs/promises';

const APPLY = process.argv.includes('--apply');
const RAJ_TENANT_ID = 'HKFeKedBqclpyC7HkbTX';
const RATE = 8;

try {
  const serviceAccount = JSON.parse(await readFile('./serviceAccountKey.json', 'utf8'));
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  console.log('✅ Firebase Admin initialized\n');
} catch (e) {
  console.error('❌ Init error:', e.message);
  process.exit(1);
}
const db = admin.firestore();

const isRaj = (x) =>
  x.tenantId === RAJ_TENANT_ID ||
  (String(x.roomNumber) === '104' && /raj\s*singh/i.test(String(x.tenantNameSnapshot || x.tenantName || '')));

const run = async () => {
  console.log(APPLY ? '⚠️  APPLY mode — writing changes\n' : '🔍 DRY RUN — no writes (pass --apply)\n');

  // 1) Set the tenant's custom rate
  const tenantRef = db.collection('tenants').doc(RAJ_TENANT_ID);
  const tenantSnap = await tenantRef.get();
  if (tenantSnap.exists) {
    console.log(`Tenant ${tenantSnap.data().name}: customElectricityRate ${tenantSnap.data().customElectricityRate ?? '(none)'} -> ${RATE}`);
    if (APPLY) await tenantRef.update({ customElectricityRate: RATE, updatedAt: new Date().toISOString() });
  } else {
    console.log('⚠️  Raj tenant doc not found by id — skipping rate set.');
  }

  // 2) Recompute electricity on his payment records that aren't already at ₹8
  const ps = await db.collection('payments').get();
  let fixed = 0, skipped = 0;
  for (const doc of ps.docs) {
    const x = doc.data();
    if (!isRaj(x)) continue;
    const units = Number(x.unitsConsumed ?? x.units ?? 0);
    if (!(units > 0)) { continue; } // no reading -> electricity 0, nothing to do
    const currentElec = Number(x.electricity ?? x.electricityAmount ?? 0);
    const targetElec = units * RATE;
    if (Math.abs(currentElec - targetElec) < 0.01) { skipped++; continue; } // already at ₹8
    const rent = Number(x.rent ?? x.rentAmount ?? 0);
    const newTotal = rent + targetElec;
    console.log(`  ${x.year}-${String(x.month).padStart(2,'0')} | units=${units} | elec ${currentElec} -> ${targetElec} | total -> ${newTotal} | paid=${x.paidAmount} | id=${doc.id}`);
    if (APPLY) {
      await db.collection('payments').doc(doc.id).update({
        electricity: targetElec,
        ratePerUnit: RATE,
        total: newTotal,
        totalAmount: newTotal,
        updatedAt: new Date().toISOString(),
      });
    }
    fixed++;
  }

  console.log(`\n${APPLY ? 'Fixed' : 'Would fix'}: ${fixed} record(s) | already ₹8 (skipped): ${skipped}`);
  if (!APPLY) console.log('Run again with --apply to write.');
  process.exit(0);
};
run().catch((e) => { console.error('Failed:', e); process.exit(1); });
