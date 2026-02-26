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
  deleteDoc,
  serverTimestamp 
} from 'firebase/firestore';
import { db, auth } from '../firebase';
import Papa from 'papaparse';

const HistoryManager = () => {
  // State Management
  const [years, setYears] = useState([]);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [selectedMonth, setSelectedMonth] = useState('all');
  const [selectedFloor, setSelectedFloor] = useState('all'); // New floor filter
  const [payments, setPayments] = useState([]);
  const [filteredPayments, setFilteredPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);
  
  // Edit & Selection State
  const [editingId, setEditingId] = useState(null);
  const [editData, setEditData] = useState({});
  const [selectedIds, setSelectedIds] = useState(new Set());
  
  // UI State
  const [showImportModal, setShowImportModal] = useState(false);
  const [importPreview, setImportPreview] = useState(null);
  const [toast, setToast] = useState({ show: false, message: '', type: 'success' });
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

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

  // Filter Payments by Month and Floor
  useEffect(() => {
    let filtered = payments;
    
    // Month filter
    if (selectedMonth !== 'all') {
      filtered = filtered.filter(p => p.month === selectedMonth);
    }
    
    // No floor filter here - we'll separate floors in the rendering
    
    setFilteredPayments(filtered);
    setSelectedIds(new Set());
  }, [selectedMonth, payments]);

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
      oldReading: payment.oldReading || 0,
      currentReading: payment.currentReading || 0,
      ratePerUnit: payment.ratePerUnit || 0,
      paidAmount: payment.paidAmount || 0,
      tenantNameSnapshot: payment.tenantNameSnapshot || payment.tenantName || '',
      roomStatus: payment.roomStatus || 'occupied',
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditData({});
  };

  const saveEdit = async (paymentId) => {
    try {
      const rent = Number(editData.rent) || 0;
      const oldReading = Number(editData.oldReading) || 0;
      const currentReading = Number(editData.currentReading) || 0;
      const ratePerUnit = Number(editData.ratePerUnit) || 0;
      const paidAmount = Number(editData.paidAmount) || 0;
      const roomStatus = editData.roomStatus === 'vacant' ? 'vacant' : 'occupied';
      const tenantNameSnapshot = roomStatus === 'vacant'
        ? ''
        : (editData.tenantNameSnapshot || '').trim();
      
      // Calculate units (defensive check)
      let units = currentReading - oldReading;
      if (units < 0) {
        units = 0;
      }
      
      // Calculate electricity
      const electricity = units * ratePerUnit;
      
      // Calculate total
      const total = rent + electricity;
      
      // Determine status
      let status = 'pending';
      if (paidAmount >= total) {
        status = 'paid';
      } else if (paidAmount > 0) {
        status = 'partial';
      }

      const docRef = doc(db, 'payments', paymentId);
      await updateDoc(docRef, {
        rent,
        oldReading,
        currentReading,
        units,
        ratePerUnit,
        electricity,
        total,
        totalAmount: total, // legacy field
        paidAmount,
        status,
        roomStatus,
        tenantNameSnapshot,
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
        const total = payment.total || payment.totalAmount || 0;
        const docRef = doc(db, 'payments', payment.id);
        batch.update(docRef, {
          paidAmount: total,
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

  // Delete by Year/Month
  const deleteByYearMonth = async () => {
    try {
      const recordsToDelete = filteredPayments;
      
      if (recordsToDelete.length === 0) {
        showToast('No records to delete', 'error');
        return;
      }

      const batch = writeBatch(db);
      
      recordsToDelete.forEach(payment => {
        const docRef = doc(db, 'payments', payment.id);
        batch.delete(docRef);
      });

      await batch.commit();
      
      const monthName = selectedMonth === 'all' 
        ? 'All Months' 
        : MONTHS.find(m => m.num === selectedMonth)?.name || `Month ${selectedMonth}`;
      
      showToast(`✅ Deleted ${recordsToDelete.length} records from ${monthName} ${selectedYear}`, 'success');
      setShowDeleteConfirm(false);
      setSelectedIds(new Set());
    } catch (error) {
      console.error('Error deleting records:', error);
      showToast('Delete failed: ' + error.message, 'error');
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

  // CSV Export
  const exportCSV = () => {
    const csvData = filteredPayments.map(p => ({
      docId: p.id,
      roomNumber: p.roomNumber,
      floor: p.floor || (p.roomNumber < 200 ? 1 : 2),
      tenantNameSnapshot: p.tenantNameSnapshot || p.tenantName || '',
      year: p.year,
      month: p.month,
      rent: p.rent || 0,
      oldReading: p.oldReading || 0,
      currentReading: p.currentReading || 0,
      units: p.units || 0,
      ratePerUnit: p.ratePerUnit || 0,
      electricity: p.electricity || 0,
      total: p.total || p.totalAmount || 0,
      paidAmount: p.paidAmount || 0,
      status: p.status,
      paymentDate: p.paymentDate ? new Date(p.paymentDate).toISOString() : '',
      paymentMode: p.paymentMode || '',
      assignedFrom2022: p.assignedFrom2022 || false
    }));

    const csv = Papa.unparse(csvData);
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const floorSuffix = selectedFloor !== 'all' ? `_floor${selectedFloor}` : '';
    a.download = `payments_${selectedYear}_${selectedMonth === 'all' ? 'all' : selectedMonth}${floorSuffix}.csv`;
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
          const oldReading = Number(row.oldReading) || 0;
          const currentReading = Number(row.currentReading) || 0;
          const ratePerUnit = Number(row.ratePerUnit) || 0;
          const paidAmount = Number(row.paidAmount) || 0;
          
          // Calculate units (defensive)
          let units = currentReading - oldReading;
          if (units < 0) units = 0;
          
          // Calculate electricity
          const electricity = units * ratePerUnit;
          
          // Calculate total
          const total = rent + electricity;
          
          // Determine status
          let status = 'pending';
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
            oldReading,
            currentReading,
            units,
            ratePerUnit,
            electricity,
            total,
            totalAmount: total, // legacy field
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
        <div className="flex flex-col gap-4">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div className="flex items-center gap-4 flex-wrap">
              <div className="flex items-center gap-2">
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
              </div>
              
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
              
              <button
                onClick={() => setShowDeleteConfirm(true)}
                disabled={filteredPayments.length === 0}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
              >
                🗑️ Delete {selectedMonth === 'all' ? selectedYear : MONTHS.find(m => m.num === selectedMonth)?.name + ' ' + selectedYear}
              </button>
            </div>
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

      {/* Payments Tables by Floor */}
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
          {/* Helper function to render floor section */}
          {(() => {
            const selectedPeriod = selectedMonth === 'all' 
              ? `${selectedYear} (All Months)` 
              : `${MONTHS.find(m => m.num === selectedMonth)?.name} ${selectedYear}`;

            // Separate payments by floor
            const floor1Payments = filteredPayments.filter(p => {
              const floor = p.floor || (p.roomNumber < 200 ? 1 : 2);
              return floor === 1;
            });

            const floor2Payments = filteredPayments.filter(p => {
              const floor = p.floor || (p.roomNumber < 200 ? 1 : 2);
              return floor === 2;
            });

            // Function to calculate totals for a floor
            const calculateTotals = (payments) => {
              return payments.reduce((acc, payment) => {
                const rent = Number(payment.rent) || 0;
                const electricity = Number(payment.electricity) || 0;
                acc.rent += rent;
                acc.electricity += electricity;
                acc.total += (rent + electricity);
                acc.paidAmount += Number(payment.paidAmount) || 0;
                acc.balance += Number(payment.balance) || 0;
                return acc;
              }, { rent: 0, electricity: 0, total: 0, paidAmount: 0, balance: 0 });
            };

            // Function to render a floor section
            const renderFloorSection = (floorNum, floorPayments, colorScheme) => {
              if (floorPayments.length === 0) return null;

              const totals = calculateTotals(floorPayments);
              const roomRange = floorNum === 1 ? '101-106' : '201-212';

              return (
                <div key={`floor-${floorNum}`} className="mb-8">
                  {/* Floor Summary Card */}
                  <div className={`card mb-4 bg-gradient-to-r ${colorScheme.gradient} border-2 ${colorScheme.border}`}>
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <h3 className="text-xl font-bold text-gray-800">
                          🏠 Floor {floorNum} - {selectedPeriod}
                        </h3>
                        <p className="text-sm font-semibold text-gray-600 mt-1">
                          📍 Rooms {roomRange}
                        </p>
                      </div>
                      <div className={`text-sm font-semibold px-4 py-2 rounded-full ${colorScheme.badge}`}>
                        {floorPayments.length} record{floorPayments.length !== 1 ? 's' : ''}
                      </div>
                    </div>
                    
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                      <div className="bg-white rounded-lg p-3 border border-blue-200">
                        <p className="text-xs text-gray-600 mb-1">Total Rent</p>
                        <p className="text-xl font-bold text-blue-600">₹{totals.rent.toLocaleString('en-IN')}</p>
                      </div>
                      <div className="bg-white rounded-lg p-3 border border-purple-200">
                        <p className="text-xs text-gray-600 mb-1">Total Electricity</p>
                        <p className="text-xl font-bold text-purple-600">₹{totals.electricity.toLocaleString('en-IN')}</p>
                      </div>
                      <div className="bg-white rounded-lg p-3 border border-green-200">
                        <p className="text-xs text-gray-600 mb-1">Grand Total</p>
                        <p className="text-xl font-bold text-green-600">₹{totals.total.toLocaleString('en-IN')}</p>
                      </div>
                      <div className="bg-white rounded-lg p-3 border border-teal-200">
                        <p className="text-xs text-gray-600 mb-1">Total Paid</p>
                        <p className="text-xl font-bold text-teal-600">₹{totals.paidAmount.toLocaleString('en-IN')}</p>
                      </div>
                      <div className="bg-white rounded-lg p-3 border border-orange-200">
                        <p className="text-xs text-gray-600 mb-1">Total Balance</p>
                        <p className={`text-xl font-bold ${totals.balance < 0 ? 'text-red-600' : 'text-orange-600'}`}>
                          ₹{totals.balance.toLocaleString('en-IN')}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Floor Table */}
                  <div className="card overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 sticky top-0">
                        <tr>
                          <th className="px-2 py-3 text-center">
                            <input
                              type="checkbox"
                              onChange={(e) => {
                                const floorPaymentIds = floorPayments.map(p => p.id);
                                if (e.target.checked) {
                                  setSelectedIds(new Set([...selectedIds, ...floorPaymentIds]));
                                } else {
                                  const newSelected = new Set(selectedIds);
                                  floorPaymentIds.forEach(id => newSelected.delete(id));
                                  setSelectedIds(newSelected);
                                }
                              }}
                              className="w-4 h-4 cursor-pointer"
                            />
                          </th>
                          <th className="px-3 py-3 text-left font-semibold text-gray-700">Room</th>
                          <th className="px-3 py-3 text-left font-semibold text-gray-700">Status</th>
                          <th className="px-3 py-3 text-left font-semibold text-gray-700">
                            Tenant {selectedMonth !== 'all' ? `(${MONTHS.find(m => m.num === selectedMonth)?.name})` : '(All Months)'}
                          </th>
                          <th className="px-3 py-3 text-right font-semibold text-gray-700">Rent</th>
                          <th className="px-3 py-3 text-right font-semibold text-gray-700">Old Reading</th>
                          <th className="px-3 py-3 text-right font-semibold text-gray-700">Current Reading</th>
                          <th className="px-3 py-3 text-right font-semibold text-gray-700">Units</th>
                          <th className="px-3 py-3 text-right font-semibold text-gray-700">Rate</th>
                          <th className="px-3 py-3 text-right font-semibold text-gray-700">Electricity</th>
                          <th className="px-3 py-3 text-right font-semibold text-gray-700">Total</th>
                          <th className="px-3 py-3 text-right font-semibold text-gray-700">Paid</th>
                          <th className="px-3 py-3 text-center font-semibold text-gray-700">Status</th>
                          <th className="px-3 py-3 text-center font-semibold text-gray-700">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200">
                        {floorPayments.map((payment) => {
                  const isEditing = editingId === payment.id;
                  
                  // Get values with fallbacks
                  const rent = payment.rent || 0;
                  const oldReading = payment.oldReading || 0;
                  const currentReading = payment.currentReading || 0;
                  const ratePerUnit = payment.ratePerUnit || 0;
                  const units = payment.units || (currentReading - oldReading);
                  const electricity = payment.electricity || (units * ratePerUnit);
                  const total = payment.total || payment.totalAmount || (rent + electricity);
                  const paidAmount = payment.paidAmount || 0;
                  const floor = payment.floor || (payment.roomNumber < 200 ? 1 : 2);
                  
                  const tenantName = payment.roomStatus === 'vacant'
                    ? ''
                    : (payment.tenantNameSnapshot || payment.tenantName || 'Unknown');
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
                      
                      <td className="px-3 py-3">
                        {isEditing ? (
                          <select
                            value={editData.roomStatus}
                            onChange={(e) => setEditData({ ...editData, roomStatus: e.target.value })}
                            className="px-2 py-1 border border-gray-300 rounded text-xs"
                          >
                            <option value="occupied">Occupied</option>
                            <option value="vacant">Vacant</option>
                          </select>
                        ) : (
                          <span className={`inline-flex items-center whitespace-nowrap px-2 py-1 rounded-full text-xs font-semibold leading-none ${
                            (payment.roomStatus || 'occupied') === 'vacant'
                              ? 'bg-gray-100 text-gray-800'
                              : 'bg-green-100 text-green-800'
                          }`}>
                            {(payment.roomStatus || 'occupied') === 'vacant' ? '⬜ Vacant' : '✅ Occupied'}
                          </span>
                        )}
                      </td>
                      
                      <td className="px-3 py-3">
                        {isEditing ? (
                          editData.roomStatus === 'vacant' ? (
                            <span className="text-gray-400 italic">-</span>
                          ) : (
                            <input
                              type="text"
                              value={editData.tenantNameSnapshot}
                              onChange={(e) => setEditData({...editData, tenantNameSnapshot: e.target.value})}
                              className="w-full px-2 py-1 border border-gray-300 rounded"
                            />
                          )
                        ) : (
                          <div>
                            <div className={isAutoAssigned ? 'font-semibold text-blue-700' : ''}>
                              {tenantName || '-'}
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
                          `₹${rent.toLocaleString('en-IN')}`
                        )}
                      </td>
                      
                      <td className="px-3 py-3 text-right">
                        {isEditing ? (
                          <input
                            type="number"
                            value={editData.oldReading}
                            onChange={(e) => setEditData({...editData, oldReading: e.target.value})}
                            className="w-24 px-2 py-1 border border-gray-300 rounded text-right"
                          />
                        ) : (
                          oldReading
                        )}
                      </td>
                      
                      <td className="px-3 py-3 text-right">
                        {isEditing ? (
                          <input
                            type="number"
                            value={editData.currentReading}
                            onChange={(e) => setEditData({...editData, currentReading: e.target.value})}
                            className="w-24 px-2 py-1 border border-gray-300 rounded text-right"
                          />
                        ) : (
                          currentReading
                        )}
                      </td>
                      
                      <td className="px-3 py-3 text-right">
                        {isEditing ? (
                          <span className="text-blue-600 font-semibold">
                            {(Number(editData.currentReading) - Number(editData.oldReading)) || 0}
                          </span>
                        ) : (
                          units
                        )}
                      </td>
                      
                      <td className="px-3 py-3 text-right">
                        {isEditing ? (
                          <input
                            type="number"
                            step="0.01"
                            value={editData.ratePerUnit}
                            onChange={(e) => setEditData({...editData, ratePerUnit: e.target.value})}
                            className="w-20 px-2 py-1 border border-gray-300 rounded text-right"
                          />
                        ) : (
                          `₹${ratePerUnit.toFixed(2)}`
                        )}
                      </td>
                      
                      <td className="px-3 py-3 text-right">
                        {isEditing ? (
                          <span className="text-blue-600 font-semibold">
                            ₹{((Number(editData.currentReading) - Number(editData.oldReading)) * Number(editData.ratePerUnit)).toFixed(2)}
                          </span>
                        ) : (
                          `₹${electricity.toLocaleString('en-IN')}`
                        )}
                      </td>
                      
                      <td className="px-3 py-3 text-right font-semibold">
                        {isEditing ? (
                          <span className="text-green-600">
                            ₹{(Number(editData.rent) + ((Number(editData.currentReading) - Number(editData.oldReading)) * Number(editData.ratePerUnit))).toFixed(2)}
                          </span>
                        ) : (
                          `₹${total.toLocaleString('en-IN')}`
                        )}
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
                          `₹${paidAmount.toLocaleString('en-IN')}`
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
        </div>
              );
            };

            // Define color schemes for each floor
            const floor1Colors = {
              gradient: 'from-green-50 to-emerald-50',
              border: 'border-green-200',
              badge: 'bg-green-200 text-green-800'
            };

            const floor2Colors = {
              gradient: 'from-purple-50 to-indigo-50',
              border: 'border-purple-200',
              badge: 'bg-purple-200 text-purple-800'
            };

            // Calculate overall totals (both floors combined)
            const overallTotals = calculateTotals(filteredPayments);

            // Render both floor sections
            return (
              <div className="space-y-6">
                {/* Overall Summary Card - Both Floors Combined */}
                <div className="card bg-gradient-to-r from-blue-50 via-indigo-50 to-purple-50 border-2 border-indigo-300 shadow-lg">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h3 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
                        💰 Overall Summary - {selectedPeriod}
                      </h3>
                      <p className="text-sm font-semibold text-gray-600 mt-1">
                        🏢 Both Floors Combined (All Rooms)
                      </p>
                    </div>
                    <div className="text-sm font-semibold px-5 py-2.5 rounded-full bg-indigo-200 text-indigo-900">
                      {filteredPayments.length} record{filteredPayments.length !== 1 ? 's' : ''}
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                    <div className="bg-white rounded-lg p-4 border-2 border-blue-300 shadow-sm">
                      <p className="text-xs text-gray-600 mb-1 font-semibold">Total Rent Received</p>
                      <p className="text-2xl font-bold text-blue-700">₹{overallTotals.rent.toLocaleString('en-IN')}</p>
                    </div>
                    <div className="bg-white rounded-lg p-4 border-2 border-purple-300 shadow-sm">
                      <p className="text-xs text-gray-600 mb-1 font-semibold">Total Electricity</p>
                      <p className="text-2xl font-bold text-purple-700">₹{overallTotals.electricity.toLocaleString('en-IN')}</p>
                    </div>
                    <div className="bg-white rounded-lg p-4 border-2 border-green-300 shadow-sm">
                      <p className="text-xs text-gray-600 mb-1 font-semibold">Grand Total</p>
                      <p className="text-2xl font-bold text-green-700">₹{overallTotals.total.toLocaleString('en-IN')}</p>
                    </div>
                    <div className="bg-white rounded-lg p-4 border-2 border-teal-300 shadow-sm">
                      <p className="text-xs text-gray-600 mb-1 font-semibold">Total Paid</p>
                      <p className="text-2xl font-bold text-teal-700">₹{overallTotals.paidAmount.toLocaleString('en-IN')}</p>
                    </div>
                    <div className="bg-white rounded-lg p-4 border-2 border-orange-300 shadow-sm">
                      <p className="text-xs text-gray-600 mb-1 font-semibold">Total Balance</p>
                      <p className={`text-2xl font-bold ${overallTotals.balance < 0 ? 'text-red-700' : 'text-orange-700'}`}>
                        ₹{overallTotals.balance.toLocaleString('en-IN')}
                      </p>
                    </div>
                  </div>
                </div>

                {renderFloorSection(1, floor1Payments, floor1Colors)}
                {renderFloorSection(2, floor2Payments, floor2Colors)}
              </div>
            );
          })()}
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

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-md w-full p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center">
                <span className="text-2xl">⚠️</span>
              </div>
              <div>
                <h3 className="text-xl font-bold text-gray-800">Confirm Delete</h3>
                <p className="text-sm text-gray-600">This action cannot be undone</p>
              </div>
            </div>
            
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
              <p className="text-red-800 font-semibold mb-2">
                You are about to delete:
              </p>
              <ul className="text-red-700 space-y-1 ml-4">
                <li>• <strong>{filteredPayments.length}</strong> payment record{filteredPayments.length !== 1 ? 's' : ''}</li>
                <li>• Year: <strong>{selectedYear}</strong></li>
                <li>• Month: <strong>{selectedMonth === 'all' ? 'All Months' : MONTHS.find(m => m.num === selectedMonth)?.name}</strong></li>
              </ul>
              <p className="text-red-800 font-bold mt-3">
                ⚠️ This will permanently delete all matching records from the database!
              </p>
            </div>
            
            <div className="flex gap-3">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="flex-1 px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 font-medium"
              >
                Cancel
              </button>
              <button
                onClick={deleteByYearMonth}
                className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 font-medium"
              >
                🗑️ Delete {filteredPayments.length} Record{filteredPayments.length !== 1 ? 's' : ''}
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
