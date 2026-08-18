import { useState, useEffect, useMemo } from 'react';
import { collection, query, where, getDocs, doc, writeBatch, addDoc, serverTimestamp } from '../utils/firestoreCounted';
import { db } from '../firebase';
import { calculateElectricityCharges, calculateSettlement } from '../utils/checkoutUtils';
import { useAuth } from '../AuthContext';
import { useDialog } from './ui/DialogProvider';

// Admin-initiated final checkout: captures the final meter reading and
// settlement amount, then in one batch marks the tenant inactive, the room
// vacant (with the final reading saved on the room doc so the next tenant's
// "previous reading" auto-fills correctly), and records the settlement as a
// normal payments record so it shows up in income reports.
const CheckoutTenantModal = ({ tenant, room, checkoutRequestId, defaultCheckoutDate, onClose, onSuccess }) => {
  const { currentUser } = useAuth();
  const { showAlert } = useDialog();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const [checkoutDate, setCheckoutDate] = useState(defaultCheckoutDate || new Date().toISOString().split('T')[0]);
  const [previousReading, setPreviousReading] = useState(0);
  const [currentReading, setCurrentReading] = useState('');
  const [ratePerUnit, setRatePerUnit] = useState(9);
  const [rentAmount, setRentAmount] = useState(Number(tenant?.currentRent) || 0);
  const [extraCharges, setExtraCharges] = useState('');
  const [damageCharges, setDamageCharges] = useState('');
  const [adjustDeposit, setAdjustDeposit] = useState(false);
  const [notes, setNotes] = useState('');

  useEffect(() => {
    const loadDefaults = async () => {
      try {
        setLoading(true);

        // Electricity rate: tenant's custom rate overrides the global default.
        if (tenant?.customElectricityRate) {
          setRatePerUnit(Number(tenant.customElectricityRate));
        } else {
          const settingsSnap = await getDocs(collection(db, 'settings'));
          if (!settingsSnap.empty) {
            setRatePerUnit(Number(settingsSnap.docs[0].data().electricityRate) || 9);
          }
        }

        // Previous reading: latest recorded reading for this tenant, else the
        // room's own currentReading field, else 0.
        let latestReading = Number(room?.currentReading) || 0;
        if (tenant?.id) {
          const paymentsSnap = await getDocs(query(collection(db, 'payments'), where('tenantId', '==', tenant.id)));
          let latestIdx = -1;
          paymentsSnap.docs.forEach((docSnap) => {
            const p = docSnap.data();
            if (!p.year || !p.month) return;
            const reading = Number(p.currentReading ?? p.meterReading);
            if (!Number.isFinite(reading) || reading <= 0) return;
            const idx = Number(p.year) * 12 + (Number(p.month) - 1);
            if (idx > latestIdx) { latestIdx = idx; latestReading = reading; }
          });
        }
        setPreviousReading(latestReading);
      } catch (err) {
        console.error('Error loading checkout defaults:', err);
      } finally {
        setLoading(false);
      }
    };
    loadDefaults();
  }, [tenant, room]);

  const electricity = useMemo(
    () => calculateElectricityCharges(currentReading, previousReading, ratePerUnit),
    [currentReading, previousReading, ratePerUnit]
  );

  const settlement = useMemo(() => calculateSettlement({
    pendingRent: Number(rentAmount) || 0,
    electricityCharges: electricity.electricityCharges,
    extraCharges: Number(extraCharges) || 0,
    damageCharges: Number(damageCharges) || 0,
    securityDeposit: Number(tenant?.securityDeposit) || 0,
    adjustDeposit
  }), [rentAmount, electricity, extraCharges, damageCharges, tenant, adjustDeposit]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!checkoutDate) { setError('Please select a checkout date'); return; }
    const currentReadingNum = parseFloat(currentReading);
    if (!Number.isFinite(currentReadingNum) || currentReadingNum < previousReading) {
      setError(`Current reading must be a number >= previous reading (${previousReading})`);
      return;
    }
    if (!room?.id) { setError('Room data is missing — cannot proceed'); return; }

    try {
      setSaving(true);
      const nowIso = new Date().toISOString();
      const checkoutDateObj = new Date(checkoutDate);
      const year = checkoutDateObj.getFullYear();
      const month = checkoutDateObj.getMonth() + 1;

      const batch = writeBatch(db);

      // 1. Final settlement payment record for the checkout month.
      const existingSnap = await getDocs(query(
        collection(db, 'payments'),
        where('tenantId', '==', tenant.id),
        where('year', '==', year),
        where('month', '==', month)
      ));
      const paymentPayload = {
        tenantId: tenant.id,
        tenantNameSnapshot: tenant.name,
        roomNumber: room.roomNumber,
        year,
        month,
        rent: Number(rentAmount) || 0,
        electricity: electricity.electricityCharges,
        extraCharges: Number(extraCharges) || 0,
        damageCharges: Number(damageCharges) || 0,
        depositAdjustment: settlement.depositAdjustment,
        paidAmount: settlement.finalTotal,
        status: 'paid',
        oldReading: previousReading,
        previousReading,
        currentReading: currentReadingNum,
        meterReading: currentReadingNum,
        units: electricity.units,
        unitsConsumed: electricity.units,
        paidDate: checkoutDate,
        paymentMethod: 'checkout-settlement',
        notes: notes.trim() || 'Final checkout settlement',
        isCheckoutSettlement: true,
        verifiedBy: currentUser?.email || 'admin',
        verifiedAt: nowIso,
        updatedAt: nowIso
      };
      if (!existingSnap.empty) {
        batch.set(doc(db, 'payments', existingSnap.docs[0].id), paymentPayload, { merge: true });
      } else {
        batch.set(doc(collection(db, 'payments')), { ...paymentPayload, createdAt: nowIso });
      }

      // 2. Tenant becomes a past tenant.
      batch.set(doc(db, 'tenants', tenant.id), {
        status: 'inactive',
        isActive: false,
        checkOutDate: checkoutDate,
        checkoutRequestId: null,
        proposedCheckoutDate: null,
        updatedAt: serverTimestamp()
      }, { merge: true });

      // 3. Room becomes vacant — with the final reading saved so the next
      // tenant's "previous reading" auto-fills correctly.
      batch.set(doc(db, 'rooms', room.id), {
        status: 'vacant',
        currentTenantId: null,
        currentReading: currentReadingNum,
        lastStatusUpdatedAt: serverTimestamp(),
        lastStatusUpdatedBy: currentUser?.uid || 'admin'
      }, { merge: true });

      // 4. If this came from a tenant-submitted checkout request, close it out.
      if (checkoutRequestId) {
        batch.set(doc(db, 'checkoutRequests', checkoutRequestId), {
          status: 'completed',
          completedAt: serverTimestamp(),
          completedBy: currentUser?.email || 'admin'
        }, { merge: true });
      }

      await batch.commit();

      // Room status log (best-effort, outside the batch — matches Rooms.jsx's logging pattern).
      try {
        await addDoc(collection(db, 'roomStatusLogs'), {
          roomId: room.id,
          roomNumber: room.roomNumber,
          oldStatus: room.status || 'occupied',
          newStatus: 'vacant',
          changedBy: currentUser?.uid || 'system',
          changedByEmail: currentUser?.email || 'system',
          changedAt: serverTimestamp(),
          remark: `Checkout: ${tenant.name}`
        });
      } catch (logErr) {
        console.warn('Room status log skipped:', logErr);
      }

      await showAlert(`✅ ${tenant.name} (Room ${room.roomNumber}) checked out.\nFinal settlement ₹${settlement.finalTotal.toLocaleString('en-IN')} recorded, room vacant, reading ${currentReadingNum} saved for next tenant.`, { intent: 'success' });
      if (onSuccess) onSuccess();
      onClose();
    } catch (err) {
      console.error('Error completing checkout:', err);
      setError(err.message || 'Failed to complete checkout. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-slate-800 rounded-lg shadow-xl max-w-lg w-full max-h-[90vh] overflow-hidden flex flex-col">
        <div className="bg-gradient-to-r from-orange-500 to-red-500 text-white px-6 py-4 flex-shrink-0">
          <h2 className="text-xl font-bold">🚪 Checkout Tenant</h2>
          <p className="text-sm text-white/90 mt-1">{tenant?.name} · Room {room?.roomNumber}</p>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-4">
          {error && (
            <div className="bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-300 px-4 py-3 rounded-lg text-sm">
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-semibold text-gray-700 dark:text-slate-200 mb-1">Checkout Date *</label>
            <input
              type="date"
              value={checkoutDate}
              onChange={(e) => setCheckoutDate(e.target.value)}
              required
              className="w-full px-4 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-slate-100 [color-scheme:light] dark:[color-scheme:dark]"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-semibold text-gray-700 dark:text-slate-200 mb-1">Previous Reading</label>
              <input type="number" value={previousReading} disabled className="w-full px-4 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-slate-400" />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 dark:text-slate-200 mb-1">Current Reading *</label>
              <input
                type="number"
                value={currentReading}
                onChange={(e) => setCurrentReading(e.target.value)}
                required
                disabled={loading}
                className="w-full px-4 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-slate-100"
              />
            </div>
          </div>

          <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg p-3 text-sm text-blue-900 dark:text-blue-200">
            Units: <span className="font-semibold">{electricity.units}</span> · Rate: ₹{ratePerUnit}/unit · Electricity: <span className="font-semibold">₹{electricity.electricityCharges.toLocaleString('en-IN')}</span>
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 dark:text-slate-200 mb-1">Rent for Final Period (₹) *</label>
            <input
              type="number"
              value={rentAmount}
              onChange={(e) => setRentAmount(e.target.value)}
              required
              className="w-full px-4 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-slate-100"
            />
            <p className="text-xs text-gray-500 dark:text-slate-400 mt-1">Adjust for a partial month (e.g. prorated days) if needed — full month&apos;s rent is pre-filled.</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-semibold text-gray-700 dark:text-slate-200 mb-1">Extra Charges (₹)</label>
              <input type="number" value={extraCharges} onChange={(e) => setExtraCharges(e.target.value)} placeholder="0" className="w-full px-4 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-slate-100" />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 dark:text-slate-200 mb-1">Damage Charges (₹)</label>
              <input type="number" value={damageCharges} onChange={(e) => setDamageCharges(e.target.value)} placeholder="0" className="w-full px-4 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-slate-100" />
            </div>
          </div>

          {Number(tenant?.securityDeposit) > 0 && (
            <label className="flex items-start gap-2 text-sm text-gray-700 dark:text-slate-200 cursor-pointer">
              <input type="checkbox" checked={adjustDeposit} onChange={(e) => setAdjustDeposit(e.target.checked)} className="w-4 h-4 mt-0.5" />
              Adjust against security deposit (₹{Number(tenant.securityDeposit).toLocaleString('en-IN')} held)
            </label>
          )}

          <div>
            <label className="block text-sm font-semibold text-gray-700 dark:text-slate-200 mb-1">Notes</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="w-full px-4 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-slate-100" />
          </div>

          <div className="bg-gray-50 dark:bg-slate-900/50 border border-gray-200 dark:border-slate-700 rounded-lg p-4 space-y-1.5 text-sm">
            <div className="flex justify-between"><span className="text-gray-600 dark:text-slate-400">Rent</span><span className="font-medium text-gray-900 dark:text-slate-100">₹{(Number(rentAmount) || 0).toLocaleString('en-IN')}</span></div>
            <div className="flex justify-between"><span className="text-gray-600 dark:text-slate-400">Electricity</span><span className="font-medium text-gray-900 dark:text-slate-100">₹{electricity.electricityCharges.toLocaleString('en-IN')}</span></div>
            {Number(extraCharges) > 0 && <div className="flex justify-between"><span className="text-gray-600 dark:text-slate-400">Extra</span><span className="font-medium text-gray-900 dark:text-slate-100">₹{Number(extraCharges).toLocaleString('en-IN')}</span></div>}
            {Number(damageCharges) > 0 && <div className="flex justify-between"><span className="text-gray-600 dark:text-slate-400">Damage</span><span className="font-medium text-gray-900 dark:text-slate-100">₹{Number(damageCharges).toLocaleString('en-IN')}</span></div>}
            {settlement.depositAdjustment > 0 && <div className="flex justify-between text-green-700 dark:text-green-400"><span>Deposit Adjusted</span><span className="font-medium">− ₹{settlement.depositAdjustment.toLocaleString('en-IN')}</span></div>}
            <div className="border-t border-gray-200 dark:border-slate-700 pt-1.5 flex justify-between font-bold text-gray-900 dark:text-slate-100">
              <span>{settlement.finalPayable >= 0 ? 'Final Payable' : 'Refundable'}</span>
              <span>₹{Math.abs(settlement.finalPayable).toLocaleString('en-IN')}</span>
            </div>
          </div>

          <div className="flex gap-3 pt-2 pb-2">
            <button type="button" onClick={onClose} disabled={saving} className="flex-1 px-4 py-2 border border-gray-300 dark:border-slate-600 text-gray-700 dark:text-slate-200 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors disabled:opacity-50">
              Cancel
            </button>
            <button type="submit" disabled={saving || loading} className="flex-1 px-4 py-2 bg-gradient-to-r from-orange-500 to-red-500 text-white rounded-lg hover:from-orange-600 hover:to-red-600 transition-colors disabled:opacity-50 font-medium">
              {saving ? 'Processing...' : '✅ Complete Checkout'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default CheckoutTenantModal;
