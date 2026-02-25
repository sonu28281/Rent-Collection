import { useState } from 'react';
import { collection, addDoc } from 'firebase/firestore';
import { db } from '../firebase';

const SubmitPayment = ({ tenant, room, electricityRate = 9, onClose, onSuccess }) => {
  const [formData, setFormData] = useState({
    paidAmount: '',
    rentAmount: tenant?.currentRent || room?.rent || 0,
    electricityAmount: '',
    previousReading: room?.currentReading || 0,
    currentReading: room?.currentReading || 0,
    paidDate: new Date().toISOString().split('T')[0],
    utr: '',
    screenshot: '',
    notes: ''
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (parseFloat(formData.paidAmount) <= 0) {
      setError('Please enter valid payment amount');
      return;
    }

    const previousReading = parseFloat(formData.previousReading);
    const currentReading = parseFloat(formData.currentReading);

    if (!Number.isFinite(previousReading) || previousReading < 0) {
      setError('Please enter valid previous meter reading');
      return;
    }

    if (!Number.isFinite(currentReading) || currentReading < previousReading) {
      setError('Current reading must be greater than or equal to previous reading');
      return;
    }

    try {
      setSubmitting(true);
      setError('');

      const unitsConsumed = currentReading - previousReading;
      const calculatedElectricity = unitsConsumed * electricityRate;

      // Create payment submission
      await addDoc(collection(db, 'paymentSubmissions'), {
        tenantId: tenant.id,
        tenantName: tenant.name,
        roomNumber: tenant.roomNumber,
        year: new Date().getFullYear(),
        month: new Date().getMonth() + 1,
        
        // Payment details
        paidAmount: parseFloat(formData.paidAmount),
        rentAmount: parseFloat(formData.rentAmount),
        electricityAmount: parseFloat(formData.electricityAmount) || calculatedElectricity,
        meterReading: currentReading,
        previousReading,
        unitsConsumed: unitsConsumed,
        
        paidDate: formData.paidDate,
        utr: formData.utr.trim(),
        screenshot: formData.screenshot.trim(),
        notes: formData.notes.trim(),
        
        // Status
        status: 'pending',
        submittedAt: new Date().toISOString(),
        verifiedBy: null,
        verifiedAt: null
      });

      alert('✅ Payment submitted successfully!\n\nYour payment will be verified by admin within 24 hours.');
      onSuccess();
      onClose();
    } catch (err) {
      console.error('Error submitting payment:', err);
      setError('Failed to submit payment. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const calculateTotal = () => {
    const rent = parseFloat(formData.rentAmount) || 0;
    const electricity = parseFloat(formData.electricityAmount) || 0;
    return rent + electricity;
  };

  const calculateElectricity = () => {
    const current = parseFloat(formData.currentReading) || 0;
    const previous = parseFloat(formData.previousReading) || 0;
    const units = Math.max(0, current - previous);
    return (units * electricityRate).toFixed(2);
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="bg-gradient-to-r from-green-500 to-emerald-600 text-white px-6 py-4 rounded-t-xl sticky top-0">
          <div className="flex items-center justify-between">
            <h3 className="text-xl font-bold">📝 Submit Payment Details</h3>
            <button onClick={onClose} className="text-white hover:bg-white hover:bg-opacity-20 rounded-full w-8 h-8 flex items-center justify-center transition">
              ✕
            </button>
          </div>
          <p className="text-sm text-white text-opacity-90 mt-1">Room {tenant?.roomNumber} - {tenant?.name}</p>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3">
              <p className="text-red-700 text-sm">{error}</p>
            </div>
          )}

          {/* Payment Date */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Payment Date <span className="text-red-500">*</span>
            </label>
            <input
              type="date"
              value={formData.paidDate}
              onChange={(e) => setFormData({ ...formData, paidDate: e.target.value })}
              max={new Date().toISOString().split('T')[0]}
              className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
              required
            />
          </div>

          {/* Meter Readings */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              ⚡ Meter Readings <span className="text-red-500">*</span>
            </label>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <input
                type="number"
                value={formData.previousReading}
                min="0"
                className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg bg-gray-100 text-gray-700 cursor-not-allowed"
                placeholder="Previous Reading"
                readOnly
                required
              />
              <input
                type="number"
                value={formData.currentReading}
                onChange={(e) => {
                  setFormData({
                    ...formData,
                    currentReading: e.target.value
                  });
                }}
                min={parseFloat(formData.previousReading) || 0}
                className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
                placeholder="Current Reading"
                required
              />
            </div>
            <p className="text-xs text-gray-600 mt-1">
              Previous reading is auto-filled from room data (tenant cannot edit) | Units: {Math.max(0, (parseFloat(formData.currentReading) || 0) - (parseFloat(formData.previousReading) || 0))} | Rate: ₹{electricityRate}/unit | Auto-calculated: ₹{calculateElectricity()}
            </p>
          </div>

          {/* Amount Breakdown */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Rent Amount */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                🏠 Rent Amount
              </label>
              <input
                type="number"
                value={formData.rentAmount}
                onChange={(e) => setFormData({ ...formData, rentAmount: e.target.value })}
                className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
                min="0"
                step="0.01"
                required
              />
            </div>

            {/* Electricity Amount */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                ⚡ Electricity Amount
              </label>
              <input
                type="number"
                value={formData.electricityAmount || calculateElectricity()}
                onChange={(e) => setFormData({ ...formData, electricityAmount: e.target.value })}
                className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
                min="0"
                step="0.01"
              />
            </div>
          </div>

          {/* Total Amount Paid */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              💰 Total Amount Paid <span className="text-red-500">*</span>
            </label>
            <input
              type="number"
              value={formData.paidAmount}
              onChange={(e) => setFormData({ ...formData, paidAmount: e.target.value })}
              className="w-full px-4 py-2 border-2 border-green-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 font-bold text-lg"
              min="0"
              step="0.01"
              placeholder={calculateTotal().toString()}
              required
            />
            <p className="text-xs text-gray-600 mt-1">
              Suggested: ₹{calculateTotal().toFixed(2)} (Rent + Electricity)
            </p>
          </div>

          {/* UTR Number */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              🔢 UTR / Transaction ID <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={formData.utr}
              onChange={(e) => setFormData({ ...formData, utr: e.target.value })}
              className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 font-mono"
              placeholder="Enter 12-digit UTR number from payment"
              required
            />
          </div>

          {/* Screenshot URL */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              📸 Payment Screenshot URL (Optional)
            </label>
            <input
              type="url"
              value={formData.screenshot}
              onChange={(e) => setFormData({ ...formData, screenshot: e.target.value })}
              className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
              placeholder="https://example.com/screenshot.jpg"
            />
            <p className="text-xs text-gray-500 mt-1">
              💡 Upload to Google Drive/Imgur and paste link, or share on WhatsApp
            </p>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              📝 Additional Notes (Optional)
            </label>
            <textarea
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 resize-none"
              rows="2"
              placeholder="Any additional information..."
            />
          </div>

          {/* Info Box */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <p className="text-sm font-semibold text-blue-900 mb-2">ℹ️ What happens next?</p>
            <ul className="text-xs text-blue-800 space-y-1">
              <li>✓ Your payment will be reviewed by admin</li>
              <li>✓ Verification usually takes less than 24 hours</li>
              <li>✓ You'll see "Verified" status once approved</li>
              <li>✓ Meter reading will be updated</li>
            </ul>
          </div>

          {/* Submit Button */}
          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-6 py-3 border-2 border-gray-300 text-gray-700 font-semibold rounded-lg hover:bg-gray-50 transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 px-6 py-3 bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white font-bold rounded-lg shadow-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? '⏳ Submitting...' : '✅ Submit Payment'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default SubmitPayment;
