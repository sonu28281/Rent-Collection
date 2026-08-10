/**
 * One-off correction: Veer Singh's August 2026 payment (paidAmount=7356) was
 * recorded as a single month, but it actually covers July (missing entirely)
 * + August. Splits it using the same oldest-first allocation logic now used
 * by the VerifyPayments approve flow (see src/utils/financial.js
 * allocateMultiMonthPayment): July gets its plain rent, August keeps its
 * rent+electricity, and any leftover stays on August as an extra/advance.
 *
 * Usage:
 *   node scripts/fix_veer_singh_backlog_split.js           # dry run
 *   node scripts/fix_veer_singh_backlog_split.js --apply    # write
 * Requires ./serviceAccountKey.json.
 */
import admin from 'firebase-admin';
import { readFile } from 'fs/promises';

const APPLY = process.argv.includes('--apply');
const TENANT_ID = 'SC7SuIsuP4ey16G41Te5'; // Veer Singh, Room 205

try {
  const sa = JSON.parse(await readFile('./serviceAccountKey.json', 'utf8'));
  admin.initializeApp({ credential: admin.credential.cert(sa) });
  console.log('✅ Firebase Admin initialized\n');
} catch (e) { console.error('Init error:', e.message); process.exit(1); }
const db = admin.firestore();

// Same algorithm as src/utils/financial.js getPriorPendingMonths — kept
// inline so this script has no dependency on the client SDK / Firebase web
// config. Anchors the gap to the tenant's LAST RECORDED payment (not
// check-in), capped at maxLookback months.
const getPriorPendingMonths = (tenant, allPayments, beforeYear, beforeMonth, maxLookback = 6) => {
  const beforeIdx = beforeYear * 12 + (beforeMonth - 1);
  let lastRecordedIdx = null;
  allPayments.forEach((p) => {
    if (!p.year || !p.month) return;
    const idx = Number(p.year) * 12 + (Number(p.month) - 1);
    if (idx < beforeIdx && (lastRecordedIdx === null || idx > lastRecordedIdx)) lastRecordedIdx = idx;
  });
  const checkIn = tenant.checkInDate ? new Date(tenant.checkInDate) : null;
  const checkInIdx = checkIn && !isNaN(checkIn.getTime()) ? checkIn.getFullYear() * 12 + checkIn.getMonth() : beforeIdx;
  const anchorIdx = lastRecordedIdx !== null ? lastRecordedIdx : checkInIdx - 1;
  const startIdx = Math.max(anchorIdx + 1, beforeIdx - maxLookback);
  const months = [];
  for (let idx = startIdx; idx < beforeIdx; idx++) {
    months.push({ year: Math.floor(idx / 12), month: (idx % 12) + 1 });
  }
  return months;
};

const allocateMultiMonthPayment = (priorMonths, targetMonth, totalPaidAmount) => {
  let remaining = Number(totalPaidAmount) || 0;
  const targetRent = Number(targetMonth.rent) || 0;
  const targetElectricity = Number(targetMonth.electricity) || 0;
  const allocations = priorMonths.map(({ year, month }) => {
    const amount = Math.min(remaining, targetRent);
    remaining -= amount;
    return { year, month, rent: targetRent, electricity: 0, paidAmount: amount, status: amount >= targetRent ? 'paid' : 'partial' };
  });
  const targetExpected = targetRent + targetElectricity;
  allocations.push({
    year: targetMonth.year, month: targetMonth.month, rent: targetRent, electricity: targetElectricity,
    paidAmount: remaining, status: remaining >= targetExpected ? 'paid' : 'partial'
  });
  return allocations;
};

const run = async () => {
  console.log(APPLY ? '⚠️  APPLY mode — writing changes\n' : '🔍 DRY RUN — no writes (pass --apply)\n');

  const tenantSnap = await db.collection('tenants').doc(TENANT_ID).get();
  if (!tenantSnap.exists) { console.error('Tenant not found'); process.exit(1); }
  const tenant = { id: tenantSnap.id, ...tenantSnap.data() };

  const paymentsSnap = await db.collection('payments').where('tenantId', '==', TENANT_ID).get();
  const payments = paymentsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

  // The combined record: the paid month whose paidAmount exceeds its own rent+electricity.
  const combined = payments.find((p) => {
    const expected = (Number(p.rent) || 0) + (Number(p.electricity) || 0);
    return p.status === 'paid' && Number(p.paidAmount) > expected + 1;
  });
  if (!combined) { console.log('No combined/over-paid record found — nothing to split.'); process.exit(0); }

  const priorMonths = getPriorPendingMonths(tenant, payments, combined.year, combined.month);
  if (priorMonths.length === 0) { console.log('No prior pending months — nothing to split.'); process.exit(0); }

  const allocations = allocateMultiMonthPayment(
    priorMonths,
    { year: combined.year, month: combined.month, rent: combined.rent, electricity: combined.electricity },
    combined.paidAmount
  );

  console.log(`Tenant: ${tenant.name} (Room ${tenant.roomNumber})`);
  console.log(`Combined record: ${combined.year}-${String(combined.month).padStart(2, '0')} | id=${combined.id} | paidAmount=${combined.paidAmount}\n`);
  console.log('Planned allocation:');
  allocations.forEach((a) => {
    const isTarget = a.year === combined.year && a.month === combined.month;
    console.log(`  ${a.year}-${String(a.month).padStart(2, '0')} | rent=${a.rent} elec=${a.electricity} paidAmount=${a.paidAmount} status=${a.status} ${isTarget ? '(update existing record ' + combined.id + ')' : '(new record)'}`);
  });

  if (!APPLY) { console.log('\nRun again with --apply to write.'); process.exit(0); }

  const nowIso = new Date().toISOString();
  for (const a of allocations) {
    const isTarget = a.year === combined.year && a.month === combined.month;
    if (isTarget) {
      await db.collection('payments').doc(combined.id).update({
        paidAmount: a.paidAmount,
        status: a.status,
        isMultiMonthSplit: true,
        splitOriginalAmount: combined.paidAmount,
        splitCorrectedAt: nowIso
      });
    } else {
      await db.collection('payments').add({
        tenantId: tenant.id,
        tenantNameSnapshot: tenant.name,
        roomNumber: combined.roomNumber,
        year: a.year,
        month: a.month,
        rent: a.rent,
        electricity: a.electricity,
        paidAmount: a.paidAmount,
        status: a.status,
        paidDate: combined.paidDate,
        paymentMethod: combined.paymentMethod || 'UPI',
        utr: combined.utr || '',
        notes: 'Backfilled: split from combined multi-month payment',
        isMultiMonthSplit: true,
        splitFromPaymentId: combined.id,
        createdAt: nowIso
      });
    }
  }
  console.log('\n✅ Applied.');
  process.exit(0);
};
run().catch((e) => { console.error('Failed:', e); process.exit(1); });
