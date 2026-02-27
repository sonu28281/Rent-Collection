import { useState } from 'react';
import { collection, addDoc, getDocs, limit, query, where } from 'firebase/firestore';
import { db } from '../firebase';

const SubmitPayment = ({ tenant, room, rooms = [], electricityRate = 9, language = 'en', onClose, onSuccess }) => {
  const t = (en, hi) => (language === 'hi' ? hi : en);
  const effectiveRooms = Array.isArray(rooms) && rooms.length > 0
    ? rooms
    : (room ? [room] : []);

  const isMultiRoom = effectiveRooms.length > 1;
  const initialRoomBreakdown = effectiveRooms.map((roomEntry) => ({
    roomNumber: String(roomEntry.roomNumber),
    previousReading: Number(roomEntry.currentReading || 0),
    currentReading: Number(roomEntry.currentReading || 0),
    rentAmount: Number(roomEntry.rent || 0)
  }));

  const initialRentAmount = initialRoomBreakdown.reduce((sum, entry) => sum + (Number(entry.rentAmount) || 0), 0);

  const [formData, setFormData] = useState({
    paidAmount: '',
    rentAmount: initialRentAmount || tenant?.currentRent || room?.rent || 0,
    electricityAmount: '',
    previousReading: room?.currentReading || 0,
    currentReading: room?.currentReading || 0,
    roomBreakdown: initialRoomBreakdown,
    paidDate: new Date().toISOString().split('T')[0],
    utr: '',
    screenshot: '',
    notes: ''
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const normalizeUtr = (value) => value.replace(/\s+/g, '').toUpperCase();

  const isValidUtr = (value) => /^[A-Z0-9]{10,30}$/.test(value);

  const compressImageToDataUrl = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const maxWidth = 1280;
        const scale = Math.min(1, maxWidth / img.width);
        const width = Math.round(img.width * scale);
        const height = Math.round(img.height * scale);

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Image processing failed'));
          return;
        }

        ctx.drawImage(img, 0, 0, width, height);

        let quality = 0.8;
        let dataUrl = canvas.toDataURL('image/jpeg', quality);
        while (dataUrl.length > 350000 && quality > 0.45) {
          quality -= 0.1;
          dataUrl = canvas.toDataURL('image/jpeg', quality);
        }

        if (dataUrl.length > 450000) {
          reject(new Error('Screenshot file is too large. Please upload a smaller image.'));
          return;
        }

        resolve(dataUrl);
      };

      img.onerror = () => reject(new Error('Invalid image file'));
      img.src = reader.result;
    };

    reader.onerror = () => reject(new Error('Failed to read image file'));
    reader.readAsDataURL(file);
  });

  const checkDuplicateUtr = async (normalizedUtr) => {
    const submissionsRef = collection(db, 'paymentSubmissions');
    const submissionsQuery = query(submissionsRef, where('utr', '==', normalizedUtr), limit(1));
    const submissionsSnapshot = await getDocs(submissionsQuery);

    if (!submissionsSnapshot.empty) {
      return true;
    }

    const paymentsRef = collection(db, 'payments');
    const paymentsQuery = query(paymentsRef, where('utr', '==', normalizedUtr), limit(1));
    const paymentsSnapshot = await getDocs(paymentsQuery);

    return !paymentsSnapshot.empty;
  };

  const calculateRoomElectricity = (roomEntry) => {
    const previous = Number(roomEntry.previousReading || 0);
    const current = Number(roomEntry.currentReading || 0);
    const units = Math.max(0, current - previous);
    return {
      units,
      electricityAmount: units * electricityRate
    };
  };

  const getBreakdownTotals = () => {
    const safeBreakdown = Array.isArray(formData.roomBreakdown) ? formData.roomBreakdown : [];
    const enriched = safeBreakdown.map((entry) => {
      const { units, electricityAmount } = calculateRoomElectricity(entry);
      const rentAmount = Number(entry.rentAmount || 0);

      return {
        roomNumber: String(entry.roomNumber),
        previousReading: Number(entry.previousReading || 0),
        currentReading: Number(entry.currentReading || 0),
        unitsConsumed: units,
        rentAmount,
        electricityAmount,
        totalAmount: rentAmount + electricityAmount
      };
    });

    const rentAmount = enriched.reduce((sum, entry) => sum + entry.rentAmount, 0);
    const electricityAmount = enriched.reduce((sum, entry) => sum + entry.electricityAmount, 0);
    return {
      roomBreakdown: enriched,
      rentAmount,
      electricityAmount,
      totalAmount: rentAmount + electricityAmount
    };
  };

  const handleScreenshotFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) {
      setFormData({ ...formData, screenshot: '' });
      return;
    }

    if (!file.type.startsWith('image/')) {
      setError('Please upload a valid image file for payment screenshot');
      return;
    }

    setError('');

    try {
      const compressedDataUrl = await compressImageToDataUrl(file);
      setFormData({ ...formData, screenshot: compressedDataUrl });
    } catch (imgError) {
      setFormData({ ...formData, screenshot: '' });
      setError(imgError.message || 'Failed to process screenshot');
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (parseFloat(formData.paidAmount) <= 0) {
      setError('Please enter valid payment amount');
      return;
    }

    let previousReading = parseFloat(formData.previousReading);
    let currentReading = parseFloat(formData.currentReading);
    let submissionRoomBreakdown = [];
    let submissionRentAmount = parseFloat(formData.rentAmount) || 0;
    let submissionElectricityAmount = parseFloat(formData.electricityAmount) || 0;

    if (isMultiRoom) {
      const totals = getBreakdownTotals();
      submissionRoomBreakdown = totals.roomBreakdown;
      submissionRentAmount = totals.rentAmount;
      submissionElectricityAmount = totals.electricityAmount;

      const invalidEntry = submissionRoomBreakdown.find((entry) => {
        if (!Number.isFinite(entry.previousReading) || entry.previousReading < 0) return true;
        if (!Number.isFinite(entry.currentReading) || entry.currentReading < entry.previousReading) return true;
        return false;
      });

      if (invalidEntry) {
        setError(`Invalid reading in room ${invalidEntry.roomNumber}. Current reading must be greater than or equal to previous.`);
        return;
      }

      previousReading = submissionRoomBreakdown.reduce((sum, entry) => sum + entry.previousReading, 0);
      currentReading = submissionRoomBreakdown.reduce((sum, entry) => sum + entry.currentReading, 0);
    } else {
      if (!Number.isFinite(previousReading) || previousReading < 0) {
        setError('Please enter valid previous meter reading');
        return;
      }

      if (!Number.isFinite(currentReading) || currentReading < previousReading) {
        setError('Current reading must be greater than or equal to previous reading');
        return;
      }
    }

    const normalizedUtr = normalizeUtr(formData.utr || '');
    if (!isValidUtr(normalizedUtr)) {
      setError('Please enter a valid UTR/Transaction ID (10-30 letters/numbers)');
      return;
    }

    if (!formData.screenshot) {
      setError('Payment screenshot is required for verification');
      return;
    }

    try {
      setSubmitting(true);
      setError('');

      const duplicateUtr = await checkDuplicateUtr(normalizedUtr);
      if (duplicateUtr) {
        setError('This UTR/Transaction ID already exists. Please check and enter correct UTR.');
        setSubmitting(false);
        return;
      }

      const unitsConsumed = currentReading - previousReading;
      const calculatedElectricity = unitsConsumed * electricityRate;
      const primaryRoomNumber = submissionRoomBreakdown[0]?.roomNumber || tenant.roomNumber;
      const roomNumbers = (submissionRoomBreakdown.length > 0
        ? submissionRoomBreakdown.map((entry) => entry.roomNumber)
        : [String(tenant.roomNumber)]
      );

      // Create payment submission
      await addDoc(collection(db, 'paymentSubmissions'), {
        tenantId: tenant.id,
        tenantName: tenant.name,
        roomNumber: primaryRoomNumber,
        roomNumbers,
        isMultiRoomSubmission: submissionRoomBreakdown.length > 1,
        year: new Date().getFullYear(),
        month: new Date().getMonth() + 1,
        
        // Payment details
        paidAmount: parseFloat(formData.paidAmount),
        rentAmount: submissionRentAmount,
        electricityAmount: submissionElectricityAmount || calculatedElectricity,
        meterReading: currentReading,
        previousReading,
        unitsConsumed: unitsConsumed,
        roomBreakdown: submissionRoomBreakdown,
        
        paidDate: formData.paidDate,
        utr: normalizedUtr,
        screenshot: formData.screenshot,
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
    if (isMultiRoom) {
      return getBreakdownTotals().totalAmount;
    }
    const rent = parseFloat(formData.rentAmount) || 0;
    const electricity = parseFloat(calculateElectricity()) || 0;
    return rent + electricity;
  };

  const calculateElectricity = () => {
    const current = parseFloat(formData.currentReading) || 0;
    const previous = parseFloat(formData.previousReading) || 0;
    const units = Math.max(0, current - previous);
    return (units * electricityRate).toFixed(2);
  };

  const expectedTotal = calculateTotal();
  const paidAmountValue = parseFloat(formData.paidAmount) || 0;
  const remainingBalance = Math.max(expectedTotal - paidAmountValue, 0);
  const isPartialPayment = paidAmountValue > 0 && paidAmountValue < expectedTotal;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="bg-gradient-to-r from-green-500 to-emerald-600 text-white px-4 py-3 rounded-t-xl sticky top-0">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-bold">{t('📝 Submit Payment', '📝 पेमेंट सबमिट')}</h3>
            <button onClick={onClose} className="text-white hover:bg-white hover:bg-opacity-20 rounded-full w-8 h-8 flex items-center justify-center transition">
              ✕
            </button>
          </div>
          <p className="text-sm text-white text-opacity-90 mt-1">
            Room{effectiveRooms.length > 1 ? 's' : ''} {effectiveRooms.map((entry) => entry.roomNumber).join(', ') || tenant?.roomNumber} - {tenant?.name}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-3">
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3">
              <p className="text-red-700 text-sm">{error}</p>
            </div>
          )}

          <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
            <p className="text-xs text-gray-600 mb-2">{t('Payable Summary', 'देय भुगतान सारांश')}</p>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <p>{t('Rent', 'किराया')}: <span className="font-semibold">₹{(isMultiRoom ? getBreakdownTotals().rentAmount : (parseFloat(formData.rentAmount) || 0)).toLocaleString('en-IN')}</span></p>
              <p>{t('Electricity', 'बिजली')}: <span className="font-semibold">₹{(isMultiRoom ? getBreakdownTotals().electricityAmount : Number(calculateElectricity())).toFixed(2)}</span></p>
              <p className="col-span-2">{t('Total Payable', 'कुल देय')}: <span className="font-bold">₹{expectedTotal.toFixed(2)}</span></p>
            </div>
          </div>

          {/* Meter Readings */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              {t('⚡ Meter Readings', '⚡ मीटर रीडिंग')} <span className="text-red-500">*</span>
            </label>

            {isMultiRoom ? (
              <div className="space-y-3">
                {formData.roomBreakdown.map((entry, index) => {
                  const electricityInfo = calculateRoomElectricity(entry);
                  return (
                    <div key={entry.roomNumber} className="border border-gray-200 rounded-lg p-3 bg-gray-50">
                      <p className="text-sm font-semibold text-gray-800 mb-2">Room {entry.roomNumber}</p>
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          type="number"
                          value={entry.previousReading}
                          min="0"
                          className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg bg-gray-100 text-gray-700 cursor-not-allowed"
                          placeholder={t('Previous Reading', 'पुरानी रीडिंग')}
                          readOnly
                          required
                        />
                        <input
                          type="number"
                          value={entry.currentReading}
                          onChange={(event) => {
                            const value = event.target.value;
                            const updatedBreakdown = [...formData.roomBreakdown];
                            updatedBreakdown[index] = {
                              ...updatedBreakdown[index],
                              currentReading: value
                            };
                            setFormData({
                              ...formData,
                              roomBreakdown: updatedBreakdown
                            });
                          }}
                          min={Number(entry.previousReading) || 0}
                          className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
                          placeholder={t('Current Reading', 'नई रीडिंग')}
                          required
                        />
                      </div>
                      <p className="text-xs text-gray-600 mt-2">
                        {t('Units', 'यूनिट')}: {electricityInfo.units} | {t('Rate', 'रेट')}: ₹{electricityRate}/unit | {t('Electricity', 'बिजली')}: ₹{electricityInfo.electricityAmount.toFixed(2)}
                      </p>
                    </div>
                  );
                })}
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="number"
                    value={formData.previousReading}
                    min="0"
                    className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg bg-gray-100 text-gray-700 cursor-not-allowed"
                    placeholder={t('Previous Reading', 'पुरानी रीडिंग')}
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
                    placeholder={t('Current Reading', 'नई रीडिंग')}
                    required
                  />
                </div>
                <p className="text-xs text-gray-600 mt-1">
                  {t('Previous reading is auto-filled from room data (tenant cannot edit)', 'पुरानी रीडिंग ऑटो-फिल है (टेनेंट एडिट नहीं कर सकता)')} | {t('Units', 'यूनिट')}: {Math.max(0, (parseFloat(formData.currentReading) || 0) - (parseFloat(formData.previousReading) || 0))} | {t('Rate', 'रेट')}: ₹{electricityRate}/unit | {t('Auto-calculated', 'ऑटो-गणना')}: ₹{calculateElectricity()}
                </p>
              </>
            )}
          </div>

          {/* Total Amount Paid */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              {t('💰 Amount You Paid', '💰 आपने कितना भुगतान किया')} <span className="text-red-500">*</span>
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
              {t('Suggested', 'सुझाव')}: ₹{expectedTotal.toFixed(2)} ({t('Rent + Electricity', 'किराया + बिजली')})
            </p>
            {paidAmountValue > 0 && (
              <div className={`mt-2 rounded-lg border p-2 text-sm ${isPartialPayment ? 'bg-amber-50 border-amber-300 text-amber-900' : 'bg-green-50 border-green-300 text-green-900'}`}>
                {isPartialPayment ? (
                  <>
                    <p className="font-semibold">{t('Partial Payment', 'आंशिक भुगतान')} ⚠️</p>
                    <p>{t('Balance Remaining', 'शेष बकाया')}: <span className="font-bold">₹{remainingBalance.toFixed(2)}</span></p>
                  </>
                ) : (
                  <p className="font-semibold">{t('Full payment entered', 'पूरा भुगतान दर्ज किया गया')} ✅</p>
                )}
              </div>
            )}
          </div>

          {/* UTR Number */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              {t('🔢 UTR / Transaction ID', '🔢 UTR / ट्रांजैक्शन ID')} <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={formData.utr}
              onChange={(e) => setFormData({ ...formData, utr: e.target.value })}
              className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 font-mono"
              placeholder={t('Enter UTR/Txn ID (10-30 letters/numbers)', 'UTR/Txn ID दर्ज करें (10-30 अक्षर/अंक)')}
              minLength={10}
              maxLength={30}
              required
            />
          </div>

          {/* Screenshot Proof */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              {t('📸 Payment Screenshot (Required)', '📸 पेमेंट स्क्रीनशॉट (जरूरी)')} <span className="text-red-500">*</span>
            </label>
            <input
              type="file"
              accept="image/*"
              onChange={handleScreenshotFileChange}
              className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
              required
            />
            {formData.screenshot && (
              <div className="mt-3">
                <img
                  src={formData.screenshot}
                  alt="Payment proof preview"
                  className="max-h-56 w-auto rounded-lg border border-gray-300"
                />
              </div>
            )}
            <p className="text-xs text-gray-500 mt-1">
              {t('💡 Please upload the payment confirmation screenshot from your phone gallery', '💡 फोन गैलरी से payment confirmation screenshot upload करें')}
            </p>
          </div>

          {/* Info Box */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
            <p className="text-sm font-semibold text-blue-900 mb-2">{t('ℹ️ What happens next?', 'ℹ️ आगे क्या होगा?')}</p>
            <ul className="text-xs text-blue-800 space-y-1">
              <li>{t('✓ Your payment will be reviewed by admin', '✓ आपकी पेमेंट admin verify करेंगे')}</li>
              <li>{t('✓ Verification usually takes less than 24 hours', '✓ वेरिफिकेशन आमतौर पर 24 घंटे से कम में हो जाता है')}</li>
              <li>{t('✓ Duplicate UTR submissions are automatically blocked', '✓ duplicate UTR अपने-आप block हो जाता है')}</li>
            </ul>
          </div>

          {/* Submit Button */}
          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-6 py-3 border-2 border-gray-300 text-gray-700 font-semibold rounded-lg hover:bg-gray-50 transition"
            >
              {t('Cancel', 'रद्द करें')}
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 px-6 py-3 bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white font-bold rounded-lg shadow-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? t('⏳ Submitting...', '⏳ सबमिट हो रहा है...') : t('✅ Submit Payment', '✅ पेमेंट सबमिट करें')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default SubmitPayment;
