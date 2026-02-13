import { useState, useEffect } from 'react';
import { 
  collection, 
  query, 
  where, 
  orderBy, 
  onSnapshot,
  doc,
  updateDoc,
  writeBatch,
  getDocs,
  serverTimestamp 
} from 'firebase/firestore';
import { db, auth } from '../firebase';
import Papa from 'papaparse';

const HistoryManager = () => {
  // State Management
  const [years, setYears] = useState([]);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [selectedMonth, setSelectedMonth] = useState('all');
  const [payments, setPayments] = useState([]);
  const [filteredPayments, setFilteredPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);
  
  // Edit & Selection State
  const [editingId, setEditingId] = useState(null);
  const [editData, setEditData] = useState({});
  const [selectedIds, setSelectedIds] = useState(new Set());
  
  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(100);
  
  // UI State
  const [showImportModal, setShowImportModal] = useState(false);
  const [importPreview, setImportPreview] = useState(null);
  const [toast, setToast] = useState({ show: false, message: '', type: 'success' });

  const ADMIN_EMAIL = 'sonu28281@gmail.com';

  // Month names for tabs
  const MONTHS = [
    { num: 1, name: 'Jan' }, { num: 2, name: 'Feb' }, { num: 3, name: 'Mar' },
    { num: 4, name: 'Apr' }, { num: 5, name: 'May' }, { num: 6, name: 'Jun' },
    { num: 7, name: 'Jul' }, { num: 8, name: 'Aug' }, { num: 9, name: 'Sep' },
    { num: 10, name: 'Oct' }, { num: 11, name: 'Nov' }, { num: 12, name: 'Dec' }
  ];

  // Check Admin Access
  useEffect(() => {
    const checkAdmin = () => {
      const user = auth.currentUser;
      if (user && user.email === ADMIN_EMAIL) {
        setIsAdmin(true);
      } else {
        setIsAdmin(false);
      }
      setCheckingAuth(false);
    };

    const unsubscribe = auth.onAuthStateChanged(checkAdmin);
    return () => unsubscribe();
  }, []);

  // Fetch Available Years
  useEffect(() => {
    const fetchYears = async () => {
      try {
        const paymentsRef = collection(db, 'payments');
        const snapshot = await getDocs(paymentsRef);
        const yearSet = new Set();
        
        snapshot.forEach((doc) => {
          const data = doc.data();
          if (data.year) yearSet.add(data.year);
        });
        
        const sortedYears = Array.from(yearSet).sort((a, b) => b - a);
        setYears(sortedYears);
        
        if (sortedYears.length > 0 && !sortedYears.includes(selectedYear)) {
          setSelectedYear(sortedYears[0]);
        }
      } catch (error) {
        console.error('Error fetching years:', error);
        showToast('Failed to load years', 'error');
      }
    };

    if (isAdmin) {
      fetchYears();
    }
  }, [isAdmin]);

  // Real-time Payments Listener
  useEffect(() => {
    if (!isAdmin || !selectedYear) return;

    setLoading(true);
    const paymentsRef = collection(db, 'payments');
    const q = query(
      paymentsRef,
      where('year', '==', selectedYear),
      orderBy('month', 'asc'),
      orderBy('roomNumber', 'asc')
    );

    const unsubscribe = onSnapshot(q, 
      (snapshot) => {
        const paymentsData = [];
        snapshot.forEach((doc) => {
          paymentsData.push({ id: doc.id, ...doc.data() });
        });
        setPayments(paymentsData);
        setLoading(false);
      },
      (error) => {
        console.error('Error fetching payments:', error);
        showToast('Failed to load payments', 'error');
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [selectedYear, isAdmin]);

  // Filter Payments by Month
  useEffect(() => {
    if (selectedMonth === 'all') {
      setFilteredPayments(payments);
    } else {
      setFilteredPayments(payments.filter(p => p.month === selectedMonth));
    }
    setCurrentPage(1);
    setSelectedIds(new Set());
  }, [selectedMonth, payments]);

  // Pagination
  const indexOfLastItem = currentPage * itemsPerPage;
  const indexOfFirstItem = indexOfLastItem - itemsPerPage;
  const currentItems = filteredPayments.slice(indexOfFirstItem, indexOfLastItem);
  const totalPages = Math.ceil(filteredPayments.length / itemsPerPage);

  // Toast Helper
  const showToast = (message, type = 'success') => {
    setToast({ show: true, message, type });
    setTimeout(() => setToast({ show: false, message: '', type: 'success' }), 3000);
  };

  // Edit Handlers
  const startEdit = (payment) => {
    setEditingId(payment.id);
    setEditData({
      rent: payment.rent || 0,
      electricity: payment.electricity || 0,
      paidAmount: payment.paidAmount || 0,
      tenantNameSnapshot: payment.tenantNameSnapshot || payment.tenantName || '',
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditData({});
  };

  const saveEdit = async (paymentId) => {
    try {
      const rent = Number(editData.rent) || 0;
      const electricity = Number(editData.electricity) || 0;
      const paidAmount = Number(editData.paidAmount) || 0;
      const total = rent + electricity;
      
      let status = 'unpaid';
      if (paidAmount >= total) {
        status = 'paid';
      } else if (paidAmount > 0) {
        status = 'partial';
      }

      const docRef = doc(db, 'payments', paymentId);
      await updateDoc(docRef, {
        rent,
        electricity,
        totalAmount: total,
        paidAmount,
        status,
        tenantNameSnapshot: editData.tenantNameSnapshot,
        updatedAt: serverTimestamp()
      });

      showToast('Payment updated successfully', 'success');
      setEditingId(null);
      setEditData({});
    } catch (error) {
      console.error('Error saving payment:', error);
      showToast('Failed to save payment', 'error');
    }
  };

  // Mark Paid Handler
  const markPaid = async (paymentId, total) => {
    try {
      const docRef = doc(db, 'payments', paymentId);
      await updateDoc(docRef, {
        paidAmount: total,
        status: 'paid',
        paymentDate: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      showToast('Marked as paid', 'success');
    } catch (error) {
      console.error('Error marking paid:', error);
      showToast('Failed to mark as paid', 'error');
    }
  };

  // Bulk Mark Paid
  const bulkMarkPaid = async () => {
    if (selectedIds.size === 0) {
      showToast('No payments selected', 'error');
      return;
    }

    try {
      const batch = writeBatch(db);
      const selectedPayments = filteredPayments.filter(p => selectedIds.has(p.id));
      
      selectedPayments.forEach(payment => {
        const docRef = doc(db, 'payments', payment.id);
        batch.update(docRef, {
          paidAmount: payment.totalAmount || 0,
          status: 'paid',
          paymentDate: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
      });

      await batch.commit();
      showToast(`${selectedIds.size} payments marked as paid`, 'success');
      setSelectedIds(new Set());
    } catch (error) {
      console.error('Error bulk marking paid:', error);
      showToast('Bulk update failed', 'error');
    }
  };

  // Selection Handlers
  const toggleSelect = (id) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedIds(newSelected);
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === currentItems.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(currentItems.map(p => p.id)));
    }
  };

  // CSV Export
  const exportCSV = () => {
    const csvData = filteredPayments.map(p => ({
      docId: p.id,
      roomNumber: p.roomNumber,
      tenantNameSnapshot: p.tenantNameSnapshot || p.tenantName || '',
      year: p.year,
      month: p.month,
      rent: p.rent || 0,
      electricity: p.electricity || 0,
      totalAmount: p.totalAmount || 0,
      paidAmount: p.paidAmount || 0,
      status: p.status,
      paymentDate: p.paymentDate ? new Date(p.paymentDate).toISOString() : '',
      assignedFrom2022: p.assignedFrom2022 || false
    }));

    const csv = Papa.unparse(csvData);
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `payments_${selectedYear}_${selectedMonth === 'all' ? 'all' : selectedMonth}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
    showToast('CSV exported successfully', 'success');
  };

  // CSV Import - File Selection
  const handleImportFile = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        setImportPreview(results.data);
        setShowImportModal(true);
      },
      error: (error) => {
        showToast(`CSV parse error: ${error.message}`, 'error');
      }
    });
  };

  // CSV Import - Confirm Import
  const confirmImport = async () => {
    if (!importPreview) return;

    try {
      let updateCount = 0;
      const batchSize = 500;
      
      for (let i = 0; i < importPreview.length; i += batchSize) {
        const batch = writeBatch(db);
        const chunk = importPreview.slice(i, i + batchSize);
        
        for (const row of chunk) {
          let docId = row.docId;
          
          // If no docId, find by roomNumber + year + month
          if (!docId) {
            const matchingPayment = payments.find(
              p => p.roomNumber === Number(row.roomNumber) && 
                   p.year === Number(row.year) && 
                   p.month === Number(row.month)
            );
            if (matchingPayment) {
              docId = matchingPayment.id;
            }
          }
          
          if (!docId) {
            console.warn(`No match found for row:`, row);
            continue;
          }

          const rent = Number(row.rent) || 0;
          const electricity = Number(row.electricity) || 0;
          const paidAmount = Number(row.paidAmount) || 0;
          const total = rent + electricity;
          
          let status = 'unpaid';
          if (paidAmount >= total) {
            status = 'paid';
          } else if (paidAmount > 0) {
            status = 'partial';
          }

          const docRef = doc(db, 'payments', docId);
          batch.update(docRef, {
            roomNumber: Number(row.roomNumber),
            tenantNameSnapshot: row.tenantNameSnapshot || '',
            rent,
            electricity,
            totalAmount: total,
            paidAmount,
            status,
            updatedAt: serverTimestamp()
          });
          
          updateCount++;
        }
        
        await batch.commit();
      }

      showToast(`${updateCount} payments updated from CSV`, 'success');
      setShowImportModal(false);
      setImportPreview(null);
    } catch (error) {
      console.error('Error importing CSV:', error);
      showToast('CSV import failed', 'error');
    }
  };

  // Authorization Check
  if (checkingAuth) {
    return (
      <div className="p-4 lg:p-8 flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-gray-600">Checking permissions...</p>
        </div>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="p-4 lg:p-8">
        <div className="card bg-red-50 border border-red-200 text-center">
          <div className="text-5xl mb-4">🔒</div>
          <h2 className="text-2xl font-bold text-red-800 mb-2">Access Denied</h2>
          <p className="text-red-700">You don't have permission to access this page.</p>
          <p className="text-sm text-red-600 mt-2">Admin access required.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-8 pb-24">
      {/* Header */}
      <div className="mb-6">
        <h2 className="text-3xl font-bold text-gray-900 mb-2">📚 Payment History Manager</h2>
        <p className="text-gray-600">View, edit, and manage historical payment records</p>
      </div>

      {/* Year Selector & Actions */}
      <div className="card mb-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex items-center gap-4">
            <label className="font-semibold text-gray-700">Year:</label>
            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(Number(e.target.value))}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
            >
              {years.map(year => (
                <option key={year} value={year}>{year}</option>
              ))}
            </select>
            
            <div className="text-sm text-gray-600">
              {filteredPayments.length} payment{filteredPayments.length !== 1 ? 's' : ''}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={exportCSV}
              className="btn-secondary text-sm"
              disabled={filteredPayments.length === 0}
            >
              📥 Export CSV
            </button>
            
            <label className="btn-secondary text-sm cursor-pointer">
              📤 Import CSV
              <input
                type="file"
                accept=".csv"
                onChange={handleImportFile}
                className="hidden"
              />
            </label>
            
            <button
              onClick={bulkMarkPaid}
              disabled={selectedIds.size === 0}
              className="btn-primary text-sm"
            >
              ✅ Mark Paid ({selectedIds.size})
            </button>
          </div>
        </div>
      </div>

      {/* Month Tabs */}
      <div className="card mb-6 overflow-x-auto">
        <div className="flex gap-2 min-w-max pb-2">
          <button
            onClick={() => setSelectedMonth('all')}
            className={`px-4 py-2 rounded-lg font-semibold transition ${
              selectedMonth === 'all'
                ? 'bg-primary text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            All Months
          </button>
          {MONTHS.map(month => {
            const count = payments.filter(p => p.month === month.num).length;
            return (
              <button
                key={month.num}
                onClick={() => setSelectedMonth(month.num)}
                className={`px-4 py-2 rounded-lg font-semibold transition ${
                  selectedMonth === month.num
                    ? 'bg-primary text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {month.name}
                {count > 0 && <span className="ml-1 text-xs">({count})</span>}
              </button>
            );
          })}
        </div>
      </div>

      {/* Payments Table */}
      {loading ? (
        <div className="card text-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-gray-600">Loading payments...</p>
        </div>
      ) : filteredPayments.length === 0 ? (
        <div className="card text-center py-12">
          <div className="text-5xl mb-4">📋</div>
          <p className="text-gray-600">No payments found for {selectedYear}</p>
        </div>
      ) : (
        <>
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 sticky top-0">
                <tr>
                  <th className="px-2 py-3 text-center">
                    <input
                      type="checkbox"
                      checked={selectedIds.size === currentItems.length && currentItems.length > 0}
                      onChange={toggleSelectAll}
                      className="w-4 h-4 cursor-pointer"
                    />
                  </th>
                  <th className="px-3 py-3 text-left font-semibold text-gray-700">Room</th>
                  <th className="px-3 py-3 text-left font-semibold text-gray-700">Month</th>
                  <th className="px-3 py-3 text-left font-semibold text-gray-700">Tenant</th>
                  <th className="px-3 py-3 text-right font-semibold text-gray-700">Rent</th>
                  <th className="px-3 py-3 text-right font-semibold text-gray-700">Electricity</th>
                  <th className="px-3 py-3 text-right font-semibold text-gray-700">Total</th>
                  <th className="px-3 py-3 text-right font-semibold text-gray-700">Paid</th>
                  <th className="px-3 py-3 text-center font-semibold text-gray-700">Status</th>
                  <th className="px-3 py-3 text-center font-semibold text-gray-700">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {currentItems.map((payment) => {
                  const isEditing = editingId === payment.id;
                  const total = payment.totalAmount || (payment.rent + payment.electricity);
                  const tenantName = payment.tenantNameSnapshot || payment.tenantName || 'Unknown';
                  const isAutoAssigned = payment.assignedFrom2022 === true;
                  
                  return (
                    <tr key={payment.id} className={`hover:bg-gray-50 ${isAutoAssigned ? 'bg-blue-50' : ''}`}>
                      <td className="px-2 py-3 text-center">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(payment.id)}
                          onChange={() => toggleSelect(payment.id)}
                          className="w-4 h-4 cursor-pointer"
                        />
                      </td>
                      
                      <td className="px-3 py-3 font-semibold">{payment.roomNumber}</td>
                      
                      <td className="px-3 py-3">{MONTHS[payment.month - 1]?.name}</td>
                      
                      <td className="px-3 py-3">
                        {isEditing ? (
                          <input
                            type="text"
                            value={editData.tenantNameSnapshot}
                            onChange={(e) => setEditData({...editData, tenantNameSnapshot: e.target.value})}
                            className="w-full px-2 py-1 border border-gray-300 rounded"
                          />
                        ) : (
                          <div>
                            <div className={isAutoAssigned ? 'font-semibold text-blue-700' : ''}>
                              {tenantName}
                            </div>
                            {isAutoAssigned && (
                              <span className="text-xs text-blue-600">Auto-populated</span>
                            )}
                          </div>
                        )}
                      </td>
                      
                      <td className="px-3 py-3 text-right">
                        {isEditing ? (
                          <input
                            type="number"
                            value={editData.rent}
                            onChange={(e) => setEditData({...editData, rent: e.target.value})}
                            className="w-24 px-2 py-1 border border-gray-300 rounded text-right"
                          />
                        ) : (
                          `₹${payment.rent?.toLocaleString('en-IN')}`
                        )}
                      </td>
                      
                      <td className="px-3 py-3 text-right">
                        {isEditing ? (
                          <input
                            type="number"
                            value={editData.electricity}
                            onChange={(e) => setEditData({...editData, electricity: e.target.value})}
                            className="w-24 px-2 py-1 border border-gray-300 rounded text-right"
                          />
                        ) : (
                          `₹${payment.electricity?.toLocaleString('en-IN')}`
                        )}
                      </td>
                      
                      <td className="px-3 py-3 text-right font-semibold">
                        ₹{total?.toLocaleString('en-IN')}
                      </td>
                      
                      <td className="px-3 py-3 text-right">
                        {isEditing ? (
                          <input
                            type="number"
                            value={editData.paidAmount}
                            onChange={(e) => setEditData({...editData, paidAmount: e.target.value})}
                            className="w-24 px-2 py-1 border border-gray-300 rounded text-right"
                          />
                        ) : (
                          `₹${payment.paidAmount?.toLocaleString('en-IN')}`
                        )}
                      </td>
                      
                      <td className="px-3 py-3 text-center">
                        <span className={`px-2 py-1 rounded-full text-xs font-semibold ${
                          payment.status === 'paid' 
                            ? 'bg-green-100 text-green-800'
                            : payment.status === 'partial'
                            ? 'bg-yellow-100 text-yellow-800'
                            : 'bg-red-100 text-red-800'
                        }`}>
                          {payment.status}
                        </span>
                      </td>
                      
                      <td className="px-3 py-3">
                        {isEditing ? (
                          <div className="flex gap-1 justify-center">
                            <button
                              onClick={() => saveEdit(payment.id)}
                              className="px-2 py-1 bg-green-500 text-white rounded text-xs hover:bg-green-600"
                            >
                              Save
                            </button>
                            <button
                              onClick={cancelEdit}
                              className="px-2 py-1 bg-gray-500 text-white rounded text-xs hover:bg-gray-600"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <div className="flex gap-1 justify-center">
                            <button
                              onClick={() => startEdit(payment)}
                              className="px-2 py-1 bg-blue-500 text-white rounded text-xs hover:bg-blue-600"
                            >
                              Edit
                            </button>
                            {payment.status !== 'paid' && (
                              <button
                                onClick={() => markPaid(payment.id, total)}
                                className="px-2 py-1 bg-green-500 text-white rounded text-xs hover:bg-green-600"
                              >
                                Paid
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="card mt-4 flex items-center justify-between">
              <div className="text-sm text-gray-600">
                Showing {indexOfFirstItem + 1}-{Math.min(indexOfLastItem, filteredPayments.length)} of {filteredPayments.length}
              </div>
              
              <div className="flex gap-2">
                <button
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="px-3 py-1 border border-gray-300 rounded disabled:opacity-50"
                >
                  Previous
                </button>
                
                <div className="flex items-center gap-1">
                  {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                    let pageNum;
                    if (totalPages <= 5) {
                      pageNum = i + 1;
                    } else if (currentPage <= 3) {
                      pageNum = i + 1;
                    } else if (currentPage >= totalPages - 2) {
                      pageNum = totalPages - 4 + i;
                    } else {
                      pageNum = currentPage - 2 + i;
                    }
                    
                    return (
                      <button
                        key={pageNum}
                        onClick={() => setCurrentPage(pageNum)}
                        className={`px-3 py-1 rounded ${
                          currentPage === pageNum
                            ? 'bg-primary text-white'
                            : 'border border-gray-300 hover:bg-gray-100'
                        }`}
                      >
                        {pageNum}
                      </button>
                    );
                  })}
                </div>
                
                <button
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  className="px-3 py-1 border border-gray-300 rounded disabled:opacity-50"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Import Modal */}
      {showImportModal && importPreview && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
            <div className="p-6 border-b">
              <h3 className="text-xl font-bold text-gray-800">Confirm CSV Import</h3>
              <p className="text-sm text-gray-600 mt-1">Review the data before importing</p>
            </div>
            
            <div className="p-6 overflow-auto flex-1">
              <div className="mb-4 bg-blue-50 border border-blue-200 rounded-lg p-4">
                <p className="text-sm text-blue-800">
                  <strong>Important:</strong> {importPreview.length} rows found. 
                  Matching will be done by docId or roomNumber+year+month.
                  Missing tenant names will be imported as-is without validation.
                </p>
              </div>
              
              <div className="overflow-x-auto">
                <table className="w-full text-xs border">
                  <thead className="bg-gray-100">
                    <tr>
                      {Object.keys(importPreview[0] || {}).map(key => (
                        <th key={key} className="px-2 py-1 text-left border">{key}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {importPreview.slice(0, 10).map((row, idx) => (
                      <tr key={idx} className="border-b">
                        {Object.values(row).map((val, vidx) => (
                          <td key={vidx} className="px-2 py-1 border">{val}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {importPreview.length > 10 && (
                  <p className="text-xs text-gray-500 mt-2">
                    ... and {importPreview.length - 10} more rows
                  </p>
                )}
              </div>
            </div>
            
            <div className="p-6 border-t flex justify-end gap-3">
              <button
                onClick={() => {
                  setShowImportModal(false);
                  setImportPreview(null);
                }}
                className="btn-secondary"
              >
                Cancel
              </button>
              <button
                onClick={confirmImport}
                className="btn-primary"
              >
                Confirm Import
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast Notification */}
      {toast.show && (
        <div className={`fixed bottom-4 right-4 z-50 px-6 py-3 rounded-lg shadow-lg ${
          toast.type === 'success' ? 'bg-green-500' : 'bg-red-500'
        } text-white font-semibold animate-slide-up`}>
          {toast.message}
        </div>
      )}
    </div>
  );
};

export default HistoryManager;
