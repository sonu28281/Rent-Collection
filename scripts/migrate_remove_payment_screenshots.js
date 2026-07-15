/**
 * One-time migration: remove embedded base64 screenshots from `payments` docs.
 *
 * The proof image is already retained on the linked `paymentSubmissions` doc
 * (referenced by each payment's `sourceSubmissionId`). Removing it from the
 * payment docs makes full-collection payment reads far lighter (the app now
 * loads proofs on demand from the submission).
 *
 * SAFETY: a payment's screenshot field is only cleared when its submission
 * still exists AND still holds a screenshot. Anything that can't be verified
 * is skipped and reported — no proof is ever lost.
 *
 * Usage:
 *   node scripts/migrate_remove_payment_screenshots.js            # dry run (no writes)
 *   node scripts/migrate_remove_payment_screenshots.js --apply    # perform the migration
 *
 * Requires ./serviceAccountKey.json (same as the other admin scripts).
 */

import admin from 'firebase-admin';
import { readFile } from 'fs/promises';

const APPLY = process.argv.includes('--apply');
const serviceAccountPath = './serviceAccountKey.json';

try {
  const serviceAccount = JSON.parse(await readFile(serviceAccountPath, 'utf8'));
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  console.log('✅ Firebase Admin initialized\n');
} catch (error) {
  console.error('❌ Error initializing Firebase:', error.message);
  process.exit(1);
}

const db = admin.firestore();

const hasShot = (data) => {
  const s = data?.screenshot || data?.paymentScreenshot || data?.proofScreenshot || data?.proofImageUrl;
  return !!(s && String(s).length > 100);
};

const run = async () => {
  console.log(APPLY ? '⚠️  APPLY mode — will write changes\n' : '🔍 DRY RUN — no changes will be written (pass --apply to migrate)\n');

  const paymentsSnap = await db.collection('payments').get();
  const withShot = [];
  paymentsSnap.forEach((docSnap) => {
    const data = docSnap.data();
    if (hasShot(data)) withShot.push({ id: docSnap.id, subId: data.sourceSubmissionId || null });
  });

  console.log(`Payment docs with an embedded screenshot: ${withShot.length}\n`);

  let cleared = 0;
  let skipped = 0;
  const skippedIds = [];

  for (const p of withShot) {
    // Safety: only clear when the linked submission still holds the proof.
    let safe = false;
    if (p.subId) {
      const subDoc = await db.collection('paymentSubmissions').doc(p.subId).get();
      if (subDoc.exists && hasShot(subDoc.data())) safe = true;
    }

    if (!safe) {
      skipped++;
      skippedIds.push(p.id);
      console.log(`  SKIP payment ${p.id} — proof not confirmed in submission (${p.subId || 'no sourceSubmissionId'})`);
      continue;
    }

    if (APPLY) {
      await db.collection('payments').doc(p.id).update({
        screenshot: admin.firestore.FieldValue.delete(),
        paymentScreenshot: admin.firestore.FieldValue.delete(),
        proofScreenshot: admin.firestore.FieldValue.delete(),
        proofImageUrl: admin.firestore.FieldValue.delete(),
        screenshotMovedToSubmissionAt: new Date().toISOString(),
      });
    }
    cleared++;
  }

  console.log('\n----------------------------------------');
  console.log(`${APPLY ? 'Cleared' : 'Would clear'}: ${cleared}`);
  console.log(`Skipped (kept, unverified): ${skipped}`);
  if (skippedIds.length) console.log(`Skipped ids: ${skippedIds.join(', ')}`);
  console.log('----------------------------------------');
  if (!APPLY) console.log('\nRun again with --apply to perform the migration.');
  process.exit(0);
};

run().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
