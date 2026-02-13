import { useState, useEffect } from 'react';
import { collection, query, where, getDocs, doc, updateDoc, orderBy } from 'firebase/firestore';
import { db } from '../firebase';

const FinancialHistoryManager = () => {
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [selectedFloor, setSelectedFloor] = useState('all');
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [editingCell, setEditingCell] = useState(null);
  const [editValue, setEditValue] = useState('');
  const [saving, setSaving] = useState(false);

  // Generate year options (2017-2025)
  const yearOptions = [];
  for (let y = 2017; y <= 2026; y++) {
    yearOptions.push(y);
  }

  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  useEffect(() => {
    fetchPayments();
  }, [selectedYear, selectedFloor]);

  const fetchPayments = async () => {
    setLoading(true);
    try {
      let q = query(
        collection(db, 'payments'),
        where('year', '==', selectedYear)
      );

      if (selectedFloor !== 'all') {
        q = query(q, where('floor', '==', Number(selectedFloor)));
      }

      const snapshot = await getDocs(q);
      const data = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      // Sort by room number and month
      data.sort((a, b) => {
        if (a.roomNumber !== b.roomNumber) {
          return a.roomNumber - b.roomNumber;
        }
        return a.month - b.month;
      });

      setPayments(data);
    } catch (error) {
      console.error('Error fetching payments:', error);
      alert('Error loading payment data');
    } finally {
      setLoading(false);
    }
  };

  const calculateSummary = () => {
    const summary = {
      totalRecords: payments.length,
      totalRent: 0,
      totalElectricity: 0,
      totalAmount: 0,
      totalPaid: 0,
      totalUnits: 0,
    };

    payments.forEach(payment => {
      summary.totalRent += payment.rent || 0;
      summary.totalElectricity += payment.electricity || 0;
      summary.totalAmount += payment.total || 0;
      summary.totalPaid += payment.paidAmount || 0;
      summary.totalUnits += payment.units || 0;
    });

    return summary;
  };

  const getMonthlySummary = () => {
    const monthly = {};
    
    for (let m = 1; m <= 12; m++) {
      monthly[m] = {
        count: 0,
        rent: 0,
        electricity: 0,
        total: 0,
        paid: 0,
        units: 0
      };
    }

    payments.forEach(payment => {
      const month = payment.month;
      if (month >= 1 && month <= 12) {
        monthly[month].count++;
        monthly[month].rent += payment.rent || 0;
        monthly[month].electricity += payment.electricity || 0;
        monthly[month].total += payment.total || 0;
        monthly[month].paid += payment.paidAmount || 0;
        monthly[month].units += payment.units || 0;
      }
    });

    return monthly;
  };

  const handleCellEdit = (paymentId, field, currentValue) => {
    setEditingCell({ paymentId, field });
    setEditValue(currentValue?.toString() || '');
  };

  const handleSaveEdit = async () => {
    if (!editingCell) return;

    setSaving(true);
    try {
      const payment = payments.find(p => p.id === editingCell.paymentId);
      if (!payment) return;

      const field = editingCell.field;
      let newValue = editValue;

      // Parse numeric fields
      if (['rent', 'oldReading', 'currentReading', 'ratePerUnit', 'paidAmount', 'units'].includes(field)) {
        newValue = Number(newValue) || 0;
      }

      // Recalculate if meter readings or rate changes
      const updates = { [field]: newValue };
      
      let oldReading = payment.oldReading;
      let currentReading = payment.currentReading;
      let ratePerUnit = payment.ratePerUnit;
      let rent = payment.rent;
      let paidAmount = payment.paidAmount;

      // Update local values
      if (field === 'oldReading') oldReading = newValue;
      if (field === 'currentReading') currentReading = newValue;
      if (field === 'ratePerUnit') ratePerUnit = newValue;
      if (field === 'rent') rent = newValue;
      if (field === 'paidAmount') paidAmount = newValue;

      // Recalculate
      const units = Math.max(0, currentReading - oldReading);
      const electricity = units * ratePerUnit;
      const total = rent + electricity;
      
      // Calculate balance
      const balance = Number((total - paidAmount).toFixed(2));
      
      // Determine balance type
      let balanceType = 'settled';
      if (balance > 0) {
        balanceType = 'due';
      } else if (balance < 0) {
        balanceType = 'advance';
      }
      
      // Determine status
      let status = 'unpaid';
      if (paidAmount === 0) {
        status = 'unpaid';
      } else if (paidAmount >= total) {
        status = balance < 0 ? 'advance' : 'paid';
      } else {
        status = 'partial';
      }

      updates.units = units;
      updates.electricity = electricity;
      updates.total = total;
      updates.balance = balance;
      updates.balanceType = balanceType;
      updates.status = status;
      updates.updatedAt = new Date().toISOString();

      // Save to Firestore
      const paymentRef = doc(db, 'payments', editingCell.paymentId);
      await updateDoc(paymentRef, updates);

      // Update local state
      setPayments(prev => prev.map(p => 
        p.id === editingCell.paymentId 
          ? { ...p, ...updates }
          : p
      ));

      setEditingCell(null);
      setEditValue('');
    } catch (error) {
      console.error('Error saving edit:', error);
      alert('Error saving changes');
    } finally {
      setSaving(false);
    }
  };

  const handleCancelEdit = () => {
    setEditingCell(null);
    setEditValue('');
  };

  const summary = calculateSummary();
  const monthlySummary = getMonthlySummary();

  return (
    <div className="p-4 lg:p-8">
      {/* Header */}
      <div className="mb-6">
        <h2 className="text-3xl font-bold text-gray-900 mb-2">📊 Financial History Manager</h2>
        <p className="text-gray-600">View and manage historical payment records by year</p>
      </div>

      {/* Filters */}
      <div className="card mb-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">Year</label>
            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(Number(e.target.value))}
              className="input"
            >
              {yearOptions.map(year => (
                <option key={year} value={year}>{year}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">Floor</label>
            <select
              value={selectedFloor}
              onChange={(e) => setSelectedFloor(e.target.value)}
              className="input"
            >
              <option value="all">All Floors</option>
              <option value="1">Floor 1 (Rooms 101-106)</option>
              <option value="2">Floor 2 (Rooms 201-206)</option>
            </select>
          </div>

          <div className="flex items-end">
            <button
              onClick={fetchPayments}
              disabled={loading}
              className="btn-primary w-full"
            >
              {loading ? '⏳ Loading...' : '🔄 Refresh Data'}
            </button>
          </div>
        </div>
      </div>

      {/* Yearly Summary */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-4 mb-6">
        <div className="card bg-blue-50 border-blue-200">
          <p className="text-xs text-blue-600 mb-1">Records</p>
          <p className="text-2xl font-bold text-blue-700">{summary.totalRecords}</p>
        </div>
        <div className="card bg-green-50 border-green-200">
          <p className="text-xs text-green-600 mb-1">Total Rent</p>
          <p className="text-2xl font-bold text-green-700">₹{summary.totalRent.toLocaleString()}</p>
        </div>
        <div className="card bg-yellow-50 border-yellow-200">
          <p className="text-xs text-yellow-600 mb-1">Total Units</p>
          <p className="text-2xl font-bold text-yellow-700">{summary.totalUnits.toLocaleString()}</p>
        </div>
        <div className="card bg-orange-50 border-orange-200">
          <p className="text-xs text-orange-600 mb-1">Electricity</p>
          <p className="text-2xl font-bold text-orange-700">₹{summary.totalElectricity.toFixed(0)}</p>
        </div>
        <div className="card bg-purple-50 border-purple-200">
          <p className="text-xs text-purple-600 mb-1">Total Amount</p>
          <p className="text-2xl font-bold text-purple-700">₹{summary.totalAmount.toFixed(0)}</p>
        </div>
        <div className="card bg-indigo-50 border-indigo-200">
          <p className="text-xs text-indigo-600 mb-1">Total Paid</p>
          <p className="text-2xl font-bold text-indigo-700">₹{summary.totalPaid.toFixed(0)}</p>
        </div>
      </div>

      {/* Monthly Summary */}
      <div className="card mb-6">
        <h3 className="text-lg font-bold text-gray-800 mb-3">Monthly Breakdown - {selectedYear}</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-gray-100">
              <tr>
                <th className="px-2 py-2 text-left font-semibold">Month</th>
                <th className="px-2 py-2 text-center font-semibold">Records</th>
                <th className="px-2 py-2 text-right font-semibold">Rent</th>
                <th className="px-2 py-2 text-right font-semibold">Units</th>
                <th className="px-2 py-2 text-right font-semibold">Electricity</th>
                <th className="px-2 py-2 text-right font-semibold">Total</th>
                <th className="px-2 py-2 text-right font-semibold">Paid</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(monthlySummary).map(([month, data]) => (
                <tr key={month} className="border-b hover:bg-gray-50">
                  <td className="px-2 py-2 font-semibold">{monthNames[Number(month) - 1]}</td>
                  <td className="px-2 py-2 text-center">{data.count}</td>
                  <td className="px-2 py-2 text-right">₹{data.rent.toLocaleString()}</td>
                  <td className="px-2 py-2 text-right">{data.units}</td>
                  <td className="px-2 py-2 text-right">₹{data.electricity.toFixed(0)}</td>
                  <td className="px-2 py-2 text-right font-semibold">₹{data.total.toFixed(0)}</td>
                  <td className="px-2 py-2 text-right">₹{data.paid.toFixed(0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Payment Records Table */}
      <div className="card">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-bold text-gray-800">
            Payment Records ({payments.length})
          </h3>
          {editingCell && (
            <div className="flex gap-2">
              <button
                onClick={handleSaveEdit}
                disabled={saving}
                className="btn-primary text-xs py-1 px-3"
              >
                {saving ? 'Saving...' : '✓ Save'}
              </button>
              <button
                onClick={handleCancelEdit}
                disabled={saving}
                className="btn-secondary text-xs py-1 px-3"
              >
                ✕ Cancel
              </button>
            </div>
          )}
        </div>

        {loading ? (
          <div className="text-center py-8 text-gray-500">
            <div className="animate-spin text-4xl mb-2">⏳</div>
            Loading payment records...
          </div>
        ) : payments.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            No payment records found for {selectedYear}
            {selectedFloor !== 'all' && ` on Floor ${selectedFloor}`}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-100 sticky top-0">
                <tr>
                  <th className="px-2 py-2 text-left font-semibold">Room</th>
                  <th className="px-2 py-2 text-left font-semibold">Floor</th>
                  <th className="px-2 py-2 text-left font-semibold">Tenant</th>
                  <th className="px-2 py-2 text-center font-semibold">Month</th>
                  <th className="px-2 py-2 text-left font-semibold">Date</th>
                  <th className="px-2 py-2 text-right font-semibold">Rent</th>
                  <th className="px-2 py-2 text-right font-semibold">Old</th>
                  <th className="px-2 py-2 text-right font-semibold">Current</th>
                  <th className="px-2 py-2 text-right font-semibold">Units</th>
                  <th className="px-2 py-2 text-right font-semibold">Rate</th>
                  <th className="px-2 py-2 text-right font-semibold">Electricity</th>
                  <th className="px-2 py-2 text-right font-semibold">Total</th>
                  <th className="px-2 py-2 text-right font-semibold">Paid</th>
                  <th className="px-2 py-2 text-right font-semibold">Balance</th>
                  <th className="px-2 py-2 text-center font-semibold">Bal Type</th>
                  <th className="px-2 py-2 text-left font-semibold">D/C</th>
                  <th className="px-2 py-2 text-left font-semibold">Remark</th>
                  <th className="px-2 py-2 text-center font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((payment) => (
                  <tr key={payment.id} className="border-b hover:bg-gray-50">
                    <td className="px-2 py-2 font-semibold">{payment.roomNumber}</td>
                    <td className="px-2 py-2">{payment.floor}</td>
                    <td className="px-2 py-2 max-w-[120px] truncate" title={payment.tenantName}>
                      {payment.tenantName}
                    </td>
                    <td className="px-2 py-2 text-center">
                      {monthNames[payment.month - 1] || payment.month}
                    </td>
                    <td className="px-2 py-2">
                      {editingCell?.paymentId === payment.id && editingCell?.field === 'date' ? (
                        <input
                          type="text"
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          className="input text-xs py-0 px-1 w-20"
                          autoFocus
                        />
                      ) : (
                        <span
                          onClick={() => handleCellEdit(payment.id, 'date', payment.date)}
                          className="cursor-pointer hover:bg-blue-50 px-1 rounded"
                        >
                          {payment.date || 'N/A'}
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-2 text-right">
                      {editingCell?.paymentId === payment.id && editingCell?.field === 'rent' ? (
                        <input
                          type="number"
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          className="input text-xs py-0 px-1 w-16 text-right"
                          autoFocus
                        />
                      ) : (
                        <span
                          onClick={() => handleCellEdit(payment.id, 'rent', payment.rent)}
                          className="cursor-pointer hover:bg-blue-50 px-1 rounded"
                        >
                          {payment.rent}
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-2 text-right">
                      {editingCell?.paymentId === payment.id && editingCell?.field === 'oldReading' ? (
                        <input
                          type="number"
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          className="input text-xs py-0 px-1 w-16 text-right"
                          autoFocus
                        />
                      ) : (
                        <span
                          onClick={() => handleCellEdit(payment.id, 'oldReading', payment.oldReading)}
                          className="cursor-pointer hover:bg-blue-50 px-1 rounded"
                        >
                          {payment.oldReading}
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-2 text-right">
                      {editingCell?.paymentId === payment.id && editingCell?.field === 'currentReading' ? (
                        <input
                          type="number"
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          className="input text-xs py-0 px-1 w-16 text-right"
                          autoFocus
                        />
                      ) : (
                        <span
                          onClick={() => handleCellEdit(payment.id, 'currentReading', payment.currentReading)}
                          className="cursor-pointer hover:bg-blue-50 px-1 rounded"
                        >
                          {payment.currentReading}
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-2 text-right font-semibold">
                      {payment.units}
                    </td>
                    <td className="px-2 py-2 text-right">
                      {editingCell?.paymentId === payment.id && editingCell?.field === 'ratePerUnit' ? (
                        <input
                          type="number"
                          step="0.1"
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          className="input text-xs py-0 px-1 w-12 text-right"
                          autoFocus
                        />
                      ) : (
                        <span
                          onClick={() => handleCellEdit(payment.id, 'ratePerUnit', payment.ratePerUnit)}
                          className="cursor-pointer hover:bg-blue-50 px-1 rounded"
                        >
                          {payment.ratePerUnit}
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-2 text-right font-semibold">
                      ₹{payment.electricity.toFixed(2)}
                    </td>
                    <td className="px-2 py-2 text-right font-bold">
                      ₹{payment.total.toFixed(2)}
                    </td>
                    <td className="px-2 py-2 text-right">
                      {editingCell?.paymentId === payment.id && editingCell?.field === 'paidAmount' ? (
                        <input
                          type="number"
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          className="input text-xs py-0 px-1 w-16 text-right"
                          autoFocus
                        />
                      ) : (
                        <span
                          onClick={() => handleCellEdit(payment.id, 'paidAmount', payment.paidAmount)}
                          className="cursor-pointer hover:bg-blue-50 px-1 rounded"
                        >
                          ₹{payment.paidAmount}
                        </span>
                      )}
                    </td>
                    <td className={`px-2 py-2 text-right font-semibold ${
                      (payment.balanceType === 'due') ? 'text-red-600' :
                      (payment.balanceType === 'advance') ? 'text-green-600' :
                      'text-gray-600'
                    }`}>
                      {payment.balance !== undefined ? (
                        <>
                          {payment.balance > 0 ? '+' : ''}₹{payment.balance.toFixed(2)}
                        </>
                      ) : (
                        '-'
                      )}
                    </td>
                    <td className="px-2 py-2 text-center">
                      {payment.balanceType ? (
                        <span className={`px-1 py-0.5 rounded text-xs font-semibold ${
                          payment.balanceType === 'due' ? 'bg-red-100 text-red-700' :
                          payment.balanceType === 'advance' ? 'bg-green-100 text-green-700' :
                          'bg-gray-100 text-gray-700'
                        }`}>
                          {payment.balanceType}
                        </span>
                      ) : (
                        '-'
                      )}
                    </td>
                    <td className="px-2 py-2 text-xs max-w-[80px] truncate" title={payment.debitCredit}>
                      {editingCell?.paymentId === payment.id && editingCell?.field === 'debitCredit' ? (
                        <input
                          type="text"
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          className="input text-xs py-0 px-1 w-20"
                          autoFocus
                        />
                      ) : (
                        <span
                          onClick={() => handleCellEdit(payment.id, 'debitCredit', payment.debitCredit)}
                          className="cursor-pointer hover:bg-blue-50 px-1 rounded"
                        >
                          {payment.debitCredit || '-'}
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-2 text-xs max-w-[100px] truncate" title={payment.remark}>
                      {editingCell?.paymentId === payment.id && editingCell?.field === 'remark' ? (
                        <input
                          type="text"
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          className="input text-xs py-0 px-1 w-24"
                          autoFocus
                        />
                      ) : (
                        <span
                          onClick={() => handleCellEdit(payment.id, 'remark', payment.remark)}
                          className="cursor-pointer hover:bg-blue-50 px-1 rounded"
                        >
                          {payment.remark || '-'}
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-2 text-center">
                      <span className={`px-2 py-1 rounded text-xs font-semibold ${
                        payment.status === 'paid' ? 'bg-green-100 text-green-700' :
                        payment.status === 'advance' ? 'bg-blue-100 text-blue-700' :
                        payment.status === 'partial' ? 'bg-yellow-100 text-yellow-700' :
                        'bg-red-100 text-red-700'
                      }`}>
                        {payment.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Help Text */}
      <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-800">
        <strong>💡 Tips:</strong>
        <ul className="ml-4 mt-2 space-y-1">
          <li>• Click on any cell to edit inline</li>
          <li>• Calculations update automatically when meter readings or rates change</li>
          <li>• Status updates automatically based on paid amount vs total</li>
          <li>• Changes are saved immediately to Firestore</li>
        </ul>
      </div>
    </div>
  );
};

export default FinancialHistoryManager;
