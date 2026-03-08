import { useState } from 'react';
import { doc, setDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';

const TenantCheckoutRequest = ({ tenant, room, onClose, onSuccess }) => {
  const [proposedCheckoutDate, setProposedCheckoutDate] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const getMinDate = () => new Date().toISOString().split('T')[0];

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!proposedCheckoutDate) {
      setError('Please select a checkout date');
      return;
    }

    const checkoutDate = new Date(proposedCheckoutDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (checkoutDate < today) {
      setError('Checkout date cannot be in the past');
      return;
    }

    if (tenant.checkInDate) {
      const checkInDate = new Date(tenant.checkInDate);
      if (checkoutDate < checkInDate) {
        setError('Checkout date cannot be before check-in date');
        return;
      }
    }

    if (!tenant?.id) {
      setError('Tenant information is missing. Please refresh and try again.');
      return;
    }

    try {
      setSubmitting(true);

      const checkoutRequestRef = doc(collection(db, 'checkoutRequests'));
      await setDoc(checkoutRequestRef, {
        tenantId: tenant.id,
        tenantName: tenant.name,
        roomNumber: tenant.roomNumber || room?.roomNumber,
        proposedCheckoutDate,
        status: 'pending',
        requestedAt: serverTimestamp(),
        requestedBy: 'tenant',
      });

      const tenantRef = doc(db, 'tenants', tenant.id);
      await setDoc(tenantRef, {
        status: 'checkout_requested',
        checkoutRequestId: checkoutRequestRef.id,
        proposedCheckoutDate,
        updatedAt: serverTimestamp()
      }, { merge: true });

      if (onSuccess) onSuccess();
    } catch (err) {
      console.error('Error submitting checkout request:', err);
      if (err.code === 'permission-denied') {
        setError('Permission denied. Please contact the administrator.');
      } else {
        setError(`Failed to submit request: ${err.message || 'Please try again.'}`);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
        <div className="bg-gradient-to-r from-orange-500 to-red-500 text-white px-6 py-4 rounded-t-lg">
          <h2 className="text-xl font-bold">Request Checkout</h2>
          <p className="text-sm text-white/90 mt-1">
            Room {tenant.roomNumber || room?.roomNumber}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-lg text-sm">
              {error}
            </div>
          )}

          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <p className="text-sm text-blue-900">
              <strong>Note:</strong> Checkout request admin ko jayegi. Admin aapki pending payments check karega.
              Jab tak sab payments clear nahi ho jaati, checkout approve nahi hoga.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Proposed Checkout Date <span className="text-red-500">*</span>
            </label>
            <input
              type="date"
              value={proposedCheckoutDate}
              onChange={(e) => setProposedCheckoutDate(e.target.value)}
              min={getMinDate()}
              required
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
            />
          </div>

          <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-600">Name:</span>
              <span className="font-medium text-gray-900">{tenant.name}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Room:</span>
              <span className="font-medium text-gray-900">{tenant.roomNumber || room?.roomNumber}</span>
            </div>
            {tenant.checkInDate && (
              <div className="flex justify-between">
                <span className="text-gray-600">Check-in Date:</span>
                <span className="font-medium text-gray-900">
                  {new Date(tenant.checkInDate).toLocaleDateString('en-IN')}
                </span>
              </div>
            )}
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 px-4 py-2 bg-gradient-to-r from-orange-500 to-red-500 text-white rounded-lg hover:from-orange-600 hover:to-red-600 transition-colors disabled:opacity-50 font-medium"
            >
              {submitting ? 'Submitting...' : 'Submit Request'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default TenantCheckoutRequest;
