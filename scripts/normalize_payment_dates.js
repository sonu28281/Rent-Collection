/**
 * SAFE, targeted: backfill paidAt from paidDate ONLY when paidDate is a real
 * payment date for that record's own period (its year+month match the record's
 * year/month). This adds paidAt to records that have a genuine paidDate but no
 * paidAt (e.g. 2026-03..08), so the date shows whether the UI reads paidDate or
 * paidAt — WITHOUT ever copying an import timestamp (which is dated 2026-02-25
 * regardless of the record's period).
 *
 * Records whose paidDate doesn't match their own period, or that have no
 * paidDate, are left completely untouched.
 *
 * Usage:
 *   node scripts/normalize_payment_dates.js           # dry run
 *   node scripts/normalize_payment_dates.js --apply    # write
 * Requires ./serviceAccountKey.json.
 */
import admin from 'firebase-admin';
import { readFile } from 'fs/promises';

const APPLY = process.argv.includes('--apply');
try {
  const sa = JSON.parse(await readFile('./serviceAccountKey.json', 'utf8'));
  admin.initializeApp({ credential: admin.credential.cert(sa) });
  console.log('✅ Firebase Admin initialized\n');
} catch (e) { console.error('Init error:', e.message); process.exit(1); }
const db = admin.firestore();

const toDate = (v) => {
  if (!v) return null;
  if (typeof v === 'object' && typeof v.toDate === 'function') return v.toDate();
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

const run = async () => {
  console.log(APPLY ? '⚠️  APPLY mode\n' : '🔍 DRY RUN (pass --apply to write)\n');
  // Only records that could need this (2026), to keep reads low.
  const ps = await db.collection('payments').where('year', '==', 2026).get();
  let updated = 0, skipped = 0;
  const samples = [];

  for (const doc of ps.docs) {
    const x = doc.data();
    const pd = toDate(x.paidDate);
    if (!pd) { skipped++; continue; }                 // no paidDate -> leave alone
    // Only trust paidDate if it belongs to this record's own period.
    const samePeriod = (pd.getFullYear() === Number(x.year)) && (pd.getMonth() + 1 === Number(x.month));
    if (!samePeriod) { skipped++; continue; }          // e.g. import date on an old row -> skip
    if (toDate(x.paidAt)) { skipped++; continue; }     // already has paidAt
    if (samples.length < 12) samples.push(`  ${x.year}-${String(x.month).padStart(2,'0')} | set paidAt = ${x.paidDate} | id=${doc.id}`);
    if (APPLY) await doc.ref.update({ paidAt: pd.toISOString(), dateSyncedAt: new Date().toISOString() });
    updated++;
  }

  console.log('Sample changes:');
  samples.forEach((s) => console.log(s));
  console.log(`\n${APPLY ? 'Updated' : 'Would update'}: ${updated} | skipped (no real same-period paidDate / already has paidAt): ${skipped}`);
  if (!APPLY) console.log('Run with --apply to write.');
  process.exit(0);
};
run().catch((e) => { console.error('Failed:', e); process.exit(1); });
