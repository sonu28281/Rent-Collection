import { useState, useEffect } from 'react';
import { collection, getDocs, doc, setDoc, query, where, orderBy, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';

const Payments = () => {
  const [tenants, setTenants] = useState([]);
  const [monthlyRecords, setMonthlyRecords] = useState([]);
  const [payments, setPayments] = useState([]);
  const [bankAccounts, setBankAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState(null);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      setLoading(true);
      setError(null);

      // Fetch tenants
      const tenantsRef = collection(db, 'tenants');
      const tenantsSnapshot = await getDocs(tenantsRef);
      const tenantsData = [];
      tenantsSnapshot.forEach((doc) => {
        tenantsData.push({ id: doc.id, ...doc.data() });
      });

      // Fetch monthly records (pending/overdue)
      const recordsRef = collection(db, 'monthlyRecords');
      const recordsSnapshot = await getDocs(recordsRef);
      const recordsData = [];
      recordsSnapshot.forEach((doc) => {
        const data = doc.data();
        if (data.status === 'pending' || data.status === 'overdue') {
          recordsData.push({ id: doc.id, ...data });
        }
      });

      // Fetch recent payments
      const paymentsRef = collection(db, 'payments');
      const paymentsSnapshot = await getDocs(query(paymentsRef, orderBy('createdAt', 'desc')));
      const paymentsData = [];
      paymentsSnapshot.forEach((doc) => {
        paymentsData.push({ id: doc.id, ...doc.data() });
      });

      // Fetch bank accounts
      const accountsRef = collection(db, 'bankAccounts');
      const accountsSnapshot = await getDocs(accountsRef);
      const accountsData = [];
      accountsSnapshot.forEach((doc) => {
        accountsData.push({ id: doc.id, ...doc.data() });
      });

      setTenants(tenantsData);
      setMonthlyRecords(recordsData);
      setPayments(paymentsData);
      setBankAccounts(accountsData);
      setLoading(false);
    } catch (err) {
      console.error('Error fetching data:', err);
      setError('Failed to load payment data. Please try again.');
      setLoading(false);
    }
  };

  const handleRecordPayment = (record) => {
    setSelectedRecord(record);
    setShowForm(true);
  };

  const handleFormClose = () => {
    setShowForm(false);
    setSelectedRecord(null);
  };

  const handleFormSuccess = () => {
    setShowForm(false);
    setSelectedRecord(null);
    fetchData();
  };

  const getTenantName = (tenantId) => {
    const tenant = tenants.find(t => t.id === tenantId);
    return tenant ? tenant.name : 'Unknown';
  };

  if (loading) {
    return (
      <div className="p-4 lg:p-8">
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
            <p className="text-gray-600">Loading payments data...</p>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 lg:p-8">
        <div className="card bg-red-50 border border-red-200">
          <p className="text-red-700">{error}</p>
          <button onClick={fetchData} className="btn-primary mt-4">
            Retry
          </button>
        </div>
      </div>
    );
  }

  const totalPending = monthlyRecords.reduce((sum, record) => sum + (record.total || 0), 0);
  const totalReceived = payments
    .filter(p => p.status === 'verified' || p.status === 'paid')
    .reduce((sum, payment) => sum + (payment.totalAmount || payment.amount || 0), 0);

  return (
    <div className="p-4 lg:p-8">
      {/* Header */}
      <div className="mb-6">
        <h2 className="text-3xl font-bold text-gray-900 mb-2">💳 Payments Management</h2>
        <p className="text-gray-600">Record and verify tenant payments</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <div className="card bg-gradient-to-br from-red-500 to-red-600 text-white">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-red-100 text-sm mb-1">Total Pending</p>
              <p className="text-3xl font-bold">₹{totalPending.toLocaleString('en-IN')}</p>
            </div>
            <div className="text-5xl">⚠️</div>
          </div>
        </div>

        <div className="card bg-gradient-to-br from-green-500 to-green-600 text-white">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-green-100 text-sm mb-1">Total Received</p>
              <p className="text-3xl font-bold">₹{totalReceived.toLocaleString('en-IN')}</p>
            </div>
            <div className="text-5xl">✅</div>
          </div>
        </div>
      </div>

      {/* Pending Payments */}
      <div className="card mb-6">
        <h3 className="text-xl font-bold text-gray-800 mb-4">📋 Pending Payments</h3>
        
        {monthlyRecords.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <div className="text-5xl mb-2">🎉</div>
            <p>No pending payments</p>
          </div>
        ) : (
          <div className="space-y-3">
            {monthlyRecords.map((record) => (
              <div key={record.id} className="border border-gray-200 rounded-lg p-4 hover:shadow-md transition">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <p className="font-bold text-gray-800">{getTenantName(record.tenantId)}</p>
                    <p className="text-sm text-gray-600">
                      Room {record.roomNumber} • {getMonthName(record.month)} {record.year}
                    </p>
                  </div>
                  <span className={`px-3 py-1 rounded-full text-xs font-semibold ${
                    record.status === 'overdue' 
                      ? 'bg-red-100 text-red-800' 
                      : 'bg-yellow-100 text-yellow-800'
                  }`}>
                    {record.status === 'overdue' ? '⚠️ Overdue' : '⏳ Pending'}
                  </span>
                </div>

                <div className="flex items-center justify-between">
                  <div className="text-sm text-gray-600">
                    <span>Amount: </span>
                    <span className="font-bold text-lg text-gray-800">₹{record.total.toLocaleString('en-IN')}</span>
                  </div>
                  <button
                    onClick={() => handleRecordPayment(record)}
                    className="btn-primary text-sm"
                  >
                    💰 Record Payment
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Recent Payments */}
      <div className="card">
        <h3 className="text-xl font-bold text-gray-800 mb-4">📊 Recent Payments</h3>
        
        {payments.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <div className="text-5xl mb-2">📋</div>
            <p>No payments recorded yet</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold text-gray-700">Tenant</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-700">Amount</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-700">UTR</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-700">Date</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-700">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {payments.slice(0, 10).map((payment) => (
                  <tr key={payment.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      {payment.tenantNameSnapshot || getTenantName(payment.tenantId) || 'Unknown'}
                    </td>
                    <td className="px-4 py-3 font-semibold">₹{(payment.totalAmount || payment.amount || 0).toLocaleString('en-IN')}</td>
                    <td className="px-4 py-3 font-mono text-xs">{payment.utr || 'N/A'}</td>
                    <td className="px-4 py-3">
                      {new Date(payment.paymentDate).toLocaleDateString('en-IN')}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-1 rounded-full text-xs font-semibold ${
                        payment.status === 'verified' || payment.status === 'paid'
                          ? 'bg-green-100 text-green-800' 
                          : payment.status === 'partial'
                          ? 'bg-yellow-100 text-yellow-800'
                          : 'bg-red-100 text-red-800'
                      }`}>
                        {payment.status === 'verified' || payment.status === 'paid' ? '✅ Paid' : 
                         payment.status === 'partial' ? '⏳ Partial' : '❌ Unpaid'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Payment Form Modal */}
      {showForm && selectedRecord && (
        <PaymentForm
          record={selectedRecord}
          tenantName={getTenantName(selectedRecord.tenantId)}
          bankAccounts={bankAccounts}
          onClose={handleFormClose}
          onSuccess={handleFormSuccess}
        />
      )}
    </div>
  );
};

const PaymentForm = ({ record, tenantName, bankAccounts, onClose, onSuccess }) => {
  const [formData, setFormData] = useState({
    amount: record.total,
    paymentDate: new Date().toISOString().split('T')[0],
    utr: '',
    receivedAccountId: '',
    notes: ''
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!formData.amount || parseFloat(formData.amount) <= 0) {
      setError('Please enter a valid amount');
      return;
    }

    if (!formData.paymentDate) {
      setError('Please select payment date');
      return;
    }

    try {
      setSaving(true);
      setError('');

      const paymentId = `payment_${Date.now()}`;

      // Create payment record
      const paymentData = {
        tenantId: record.tenantId,
        roomNumber: record.roomNumber,
        ledgerId: record.id,
        amount: parseFloat(formData.amount),
        paymentDate: formData.paymentDate,
        utr: formData.utr.trim(),
        screenshotUrl: null, // Future: storage adapter
        receivedAccountId: formData.receivedAccountId || null,
        status: 'verified', // Auto-verify for now
        notes: formData.notes.trim(),
        createdAt: new Date().toISOString()
      };

      await setDoc(doc(db, 'payments', paymentId), paymentData);

      // Update monthly record status
      await updateDoc(doc(db, 'monthlyRecords', record.id), {
        status: 'paid',
        paidAt: new Date().toISOString()
      });

      alert('✅ Payment recorded successfully!');
      onSuccess();
    } catch (err) {
      console.error('Error recording payment:', err);
      setError('Failed to record payment. Please try again.');
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xl font-bold text-gray-800">💳 Record Payment</h3>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl">
              ×
            </button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="p-6">
          {/* Record Info */}
          <div className="bg-blue-50 rounded-lg p-4 mb-4">
            <p className="text-sm text-blue-600 mb-1">Tenant</p>
            <p className="font-bold text-blue-900">{tenantName}</p>
            <p className="text-sm text-blue-700">
              Room {record.roomNumber} • {getMonthName(record.month)} {record.year}
            </p>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4">
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          {/* Amount */}
          <div className="mb-4">
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Amount (₹) *
            </label>
            <input
              type="number"
              name="amount"
              value={formData.amount}
              onChange={handleChange}
              className="input-field"
              placeholder="5000"
              min="0"
              step="0.01"
              required
            />
          </div>

          {/* Payment Date */}
          <div className="mb-4">
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Payment Date *
            </label>
            <input
              type="date"
              name="paymentDate"
              value={formData.paymentDate}
              onChange={handleChange}
              className="input-field"
              required
            />
          </div>

          {/* UTR */}
          <div className="mb-4">
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              UTR / Transaction ID
            </label>
            <input
              type="text"
              name="utr"
              value={formData.utr}
              onChange={handleChange}
              className="input-field"
              placeholder="Enter UTR number"
            />
          </div>

          {/* Received Account */}
          {bankAccounts.length > 0 && (
            <div className="mb-4">
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                Received in Account
              </label>
              <select
                name="receivedAccountId"
                value={formData.receivedAccountId}
                onChange={handleChange}
                className="input-field"
              >
                <option value="">Select account</option>
                {bankAccounts.map(account => (
                  <option key={account.id} value={account.id}>
                    {account.upiId} {account.nickname ? `(${account.nickname})` : ''}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Notes */}
          <div className="mb-4">
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Notes (Optional)
            </label>
            <textarea
              name="notes"
              value={formData.notes}
              onChange={handleChange}
              className="input-field"
              rows="2"
              placeholder="Any additional notes..."
            />
          </div>

          {/* Buttons */}
          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="btn-secondary flex-1"
              disabled={saving}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn-primary flex-1"
              disabled={saving}
            >
              {saving ? 'Saving...' : '💾 Record Payment'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

const getMonthName = (monthNum) => {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return months[monthNum - 1] || monthNum;
};

export default Payments;
