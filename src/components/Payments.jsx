import { useState, useEffect, useCallback } from 'react';
import { collection, getDocs, addDoc, query, where, updateDoc, doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import ViewModeToggle from './ui/ViewModeToggle';
import useResponsiveViewMode from '../utils/useResponsiveViewMode';
import JSZip from 'jszip';

const Payments = () => {
  const [tenants, setTenants] = useState([]);
  const [payments, setPayments] = useState([]);
  const [allPayments, setAllPayments] = useState([]); // For payment history
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [selectedTenant, setSelectedTenant] = useState(null);
  const [filter, setFilter] = useState('all');
  const [tenantDirectPayEnabled, setTenantDirectPayEnabled] = useState(false);
  const [savingDirectPaySetting, setSavingDirectPaySetting] = useState(false);
  const [historyMonthFilter, setHistoryMonthFilter] = useState('all');
  const [cleanupMonths, setCleanupMonths] = useState(6);
  const [cleaningScreenshots, setCleaningScreenshots] = useState(false);
  const [downloadingHistoryZip, setDownloadingHistoryZip] = useState(false);

  const now = new Date();
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState(now.getFullYear());
  const { viewMode, setViewMode, isCardView } = useResponsiveViewMode('payments-view-mode', 'table');

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const tenantsRef = collection(db, 'tenants');
      const tenantsQuery = query(tenantsRef, where('isActive', '==', true));
      const tenantsSnapshot = await getDocs(tenantsQuery);
      const tenantsData = [];
      tenantsSnapshot.forEach((doc) => {
        tenantsData.push({ id: doc.id, ...doc.data() });
      });

      const paymentsRef = collection(db, 'payments');
      const paymentsQuery = query(
        paymentsRef,
        where('year', '==', selectedYear),
        where('month', '==', selectedMonth)
      );
      const paymentsSnapshot = await getDocs(paymentsQuery);
      const paymentsData = [];
      paymentsSnapshot.forEach((doc) => {
        paymentsData.push({ id: doc.id, ...doc.data() });
      });

      // Fetch all payments for history
      const allPaymentsSnapshot = await getDocs(collection(db, 'payments'));
      const allPaymentsData = [];
      allPaymentsSnapshot.forEach((doc) => {
        allPaymentsData.push({ id: doc.id, ...doc.data() });
      });

      const settingsDocRef = doc(db, 'settings', 'global');
      const settingsDocSnap = await getDoc(settingsDocRef);
      if (settingsDocSnap.exists()) {
        const settingsData = settingsDocSnap.data();
        const directPayFlag = settingsData?.tenantDirectPayEnabled;
        const fallbackFromMode = String(settingsData?.paymentMode || '').toLowerCase() === 'automatic';
        setTenantDirectPayEnabled(typeof directPayFlag === 'boolean' ? directPayFlag : fallbackFromMode);
      } else {
        setTenantDirectPayEnabled(false);
      }

      setTenants(tenantsData);
      setPayments(paymentsData);
      setAllPayments(allPaymentsData);
      setLoading(false);
    } catch (err) {
      console.error('Error fetching data:', err);
      setError('Failed to load data. Please try again.');
      setLoading(false);
    }
  }, [selectedMonth, selectedYear]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleRecordPayment = (tenant) => {
    setSelectedTenant(tenant);
    setShowForm(true);
  };

  const handleFormClose = () => {
    setShowForm(false);
    setSelectedTenant(null);
  };

  const handleFormSuccess = () => {
    setShowForm(false);
    setSelectedTenant(null);
    fetchData();
  };

  const getTenantMonthPayments = (tenant) => {
    const tenantName = String(tenant.name || '').trim().toLowerCase();
    const tenantRoom = String(tenant.roomNumber || '').trim();

    return payments.filter((payment) => {
      if (payment.status !== 'paid') return false;

      const byTenantId = payment.tenantId && payment.tenantId === tenant.id;
      const byRoom = String(payment.roomNumber || '').trim() === tenantRoom;
      const paymentTenantName = String(payment.tenantNameSnapshot || payment.tenantName || '').trim().toLowerCase();
      const byName = paymentTenantName && paymentTenantName === tenantName;

      return byTenantId || (byRoom && byName) || byRoom;
    });
  };

  const getTenantPaymentSummary = (tenant) => {
    const matchedPayments = getTenantMonthPayments(tenant);
    if (matchedPayments.length === 0) {
      return {
        isPaid: false,
        totalPaid: 0,
        latestPaidDate: null,
        utrDisplay: '-',
        paymentCount: 0
      };
    }

    const sortedByDate = [...matchedPayments].sort((a, b) => {
      const aTime = a?.paidDate ? new Date(a.paidDate).getTime() : 0;
      const bTime = b?.paidDate ? new Date(b.paidDate).getTime() : 0;
      return bTime - aTime;
    });

    const latestPayment = sortedByDate[0];
    const totalPaid = matchedPayments.reduce((sum, payment) => sum + (Number(payment.paidAmount) || 0), 0);
    const utrValues = matchedPayments
      .map((payment) => String(payment.utr || '').trim())
      .filter(Boolean);

    return {
      isPaid: true,
      totalPaid,
      latestPaidDate: latestPayment?.paidDate || null,
      utrDisplay: utrValues.length > 0 ? Array.from(new Set(utrValues)).join(', ') : '-',
      paymentCount: matchedPayments.length
    };
  };

  const filteredTenants = tenants.filter(tenant => {
    const { isPaid } = getTenantPaymentSummary(tenant);
    if (filter === 'paid') return isPaid;
    if (filter === 'pending') return !isPaid;
    return true;
  });

  if (loading) {
    return (
      <div className="p-4 lg:p-8">
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
            <p className="text-gray-600">Loading payments...</p>
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

  const paidCount = tenants.filter((tenant) => getTenantPaymentSummary(tenant).isPaid).length;
  const pendingCount = tenants.length - paidCount;
  const totalCollected = payments
    .filter(p => p.status === 'paid')
    .reduce((sum, p) => sum + (p.paidAmount || 0), 0);
  const totalExpected = tenants.reduce((sum, t) => sum + (t.currentRent || 0), 0);

  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 
                      'July', 'August', 'September', 'October', 'November', 'December'];

  const handlePreviousMonth = () => {
    if (selectedMonth === 1) {
      setSelectedMonth(12);
      setSelectedYear(selectedYear - 1);
    } else {
      setSelectedMonth(selectedMonth - 1);
    }
  };

  const handleNextMonth = () => {
    if (selectedMonth === 12) {
      setSelectedMonth(1);
      setSelectedYear(selectedYear + 1);
    } else {
      setSelectedMonth(selectedMonth + 1);
    }
  };

  const getPreviousPayment = (tenantId) => {
    // Get most recent payment before current month
    const tenantPayments = allPayments
      .filter(p => p.tenantId === tenantId && p.status === 'paid')
      .filter(p => {
        if (p.year < selectedYear) return true;
        if (p.year === selectedYear && p.month < selectedMonth) return true;
        return false;
      })
      .sort((a, b) => {
        if (b.year !== a.year) return b.year - a.year;
        return b.month - a.month;
      });
    return tenantPayments[0] || null;
  };

  const handleToggleTenantDirectPay = async () => {
    const nextValue = !tenantDirectPayEnabled;
    try {
      setSavingDirectPaySetting(true);
      await setDoc(doc(db, 'settings', 'global'), {
        tenantDirectPayEnabled: nextValue,
        updatedAt: new Date().toISOString()
      }, { merge: true });
      setTenantDirectPayEnabled(nextValue);
    } catch (toggleError) {
      console.error('Error updating tenant direct pay setting:', toggleError);
      alert('Failed to update setting. Please try again.');
    } finally {
      setSavingDirectPaySetting(false);
    }
  };

  const getPaymentScreenshot = (payment) => payment?.screenshot || payment?.paymentScreenshot || payment?.proofScreenshot || payment?.proofImageUrl || '';

  const handleDownloadScreenshot = (payment) => {
    const screenshotUrl = getPaymentScreenshot(payment);
    if (!screenshotUrl) return;

    const tenantLabel = String(payment?.tenantNameSnapshot || payment?.tenantName || payment?.tenantId || 'tenant').replace(/\s+/g, '_');
    const monthLabel = `${String(payment?.month || '').padStart(2, '0')}-${payment?.year || 'unknown'}`;
    const paidDateLabel = payment?.paidDate || 'date';
    const fileName = `payment-proof_${tenantLabel}_${monthLabel}_${paidDateLabel}.png`;

    const anchor = document.createElement('a');
    anchor.href = screenshotUrl;
    anchor.download = fileName;
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
  };

  const handleDeleteScreenshot = async (payment) => {
    const screenshotUrl = getPaymentScreenshot(payment);
    if (!screenshotUrl) return;

    const ok = window.confirm(
      `Delete screenshot proof for Room ${payment.roomNumber || '-'} (${payment.tenantNameSnapshot || payment.tenantName || 'Tenant'})?\n\nThis will remove historical proof from this payment record.`
    );
    if (!ok) return;

    try {
      await updateDoc(doc(db, 'payments', payment.id), {
        screenshot: '',
        paymentScreenshot: '',
        proofScreenshot: '',
        proofImageUrl: '',
        screenshotDeletedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
      fetchData();
    } catch (deleteError) {
      console.error('Error deleting screenshot proof:', deleteError);
      alert('Failed to delete screenshot. Please try again.');
    }
  };

  const getPaymentSortTime = (payment) => {
    if (payment?.paidDate) {
      const fromPaidDate = new Date(payment.paidDate).getTime();
      if (!Number.isNaN(fromPaidDate)) return fromPaidDate;
    }

    const year = Number(payment?.year || 0);
    const month = Number(payment?.month || 1);
    return new Date(year, Math.max(month - 1, 0), 1).getTime();
  };

  const getHistoryMonthLabel = (payment) => {
    const month = Number(payment?.month || 0);
    const year = Number(payment?.year || 0);
    if (!month || !year) return 'Unknown';
    return `${monthNames[month - 1]} ${year}`;
  };

  const allPaidWithScreenshots = allPayments
    .filter((payment) => payment.status === 'paid' && !!getPaymentScreenshot(payment))
    .sort((a, b) => getPaymentSortTime(b) - getPaymentSortTime(a));

  const historyMonthOptions = Array.from(
    new Set(
      allPaidWithScreenshots.map((payment) => {
        const month = Number(payment?.month || 0);
        const year = Number(payment?.year || 0);
        return month && year ? `${year}-${String(month).padStart(2, '0')}` : null;
      }).filter(Boolean)
    )
  ).sort((a, b) => (a > b ? -1 : 1));

  const filteredHistoryScreenshots = allPaidWithScreenshots.filter((payment) => {
    if (historyMonthFilter === 'all') return true;
    const paymentKey = `${payment.year}-${String(payment.month).padStart(2, '0')}`;
    return paymentKey === historyMonthFilter;
  });

  const getCutoffDate = (months) => {
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - Number(months || 0));
    cutoff.setHours(0, 0, 0, 0);
    return cutoff;
  };

  const isOlderThanMonths = (payment, months) => {
    const paymentTime = getPaymentSortTime(payment);
    const cutoffTime = getCutoffDate(months).getTime();
    return paymentTime < cutoffTime;
  };

  const oldScreenshotCandidates = filteredHistoryScreenshots.filter((payment) => isOlderThanMonths(payment, cleanupMonths));

  const handleBulkDeleteOldScreenshots = async () => {
    if (oldScreenshotCandidates.length === 0) {
      alert(`No screenshots older than ${cleanupMonths} month(s) in current history filter.`);
      return;
    }

    const ok = window.confirm(
      `Delete ${oldScreenshotCandidates.length} screenshot(s) older than ${cleanupMonths} month(s)?\n\nTip: Download important proofs before cleanup.`
    );
    if (!ok) return;

    try {
      setCleaningScreenshots(true);
      for (const payment of oldScreenshotCandidates) {
        await updateDoc(doc(db, 'payments', payment.id), {
          screenshot: '',
          paymentScreenshot: '',
          proofScreenshot: '',
          proofImageUrl: '',
          screenshotDeletedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        });
      }
      alert(`✅ Deleted ${oldScreenshotCandidates.length} old screenshot(s).`);
      fetchData();
    } catch (bulkError) {
      console.error('Error deleting old screenshots:', bulkError);
      alert('Failed to delete old screenshots. Please try again.');
    } finally {
      setCleaningScreenshots(false);
    }
  };

  const fetchScreenshotBlob = async (url) => {
    if (!url) return null;

    if (url.startsWith('data:')) {
      const response = await fetch(url);
      return response.blob();
    }

    const response = await fetch(url, { mode: 'cors' });
    if (!response.ok) {
      throw new Error(`Failed to fetch screenshot: ${response.status}`);
    }
    return response.blob();
  };

  const sanitizeFilePart = (value) => String(value || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_');

  const handleDownloadVisibleAsZip = async () => {
    if (filteredHistoryScreenshots.length === 0) {
      alert('No screenshots available in current filter to download.');
      return;
    }

    try {
      setDownloadingHistoryZip(true);
      const zip = new JSZip();
      let addedCount = 0;

      for (const payment of filteredHistoryScreenshots) {
        const screenshotUrl = getPaymentScreenshot(payment);
        if (!screenshotUrl) continue;

        try {
          const blob = await fetchScreenshotBlob(screenshotUrl);
          if (!blob) continue;

          const tenantPart = sanitizeFilePart(payment.tenantNameSnapshot || payment.tenantName || payment.tenantId);
          const roomPart = sanitizeFilePart(payment.roomNumber || 'room');
          const monthPart = `${String(payment.month || '').padStart(2, '0')}-${payment.year || 'unknown'}`;
          const datePart = sanitizeFilePart(payment.paidDate || 'date');
          const ext = blob.type && blob.type.includes('jpeg') ? 'jpg' : 'png';
          const fileName = `${monthPart}/${roomPart}_${tenantPart}_${datePart}.${ext}`;

          zip.file(fileName, blob);
          addedCount += 1;
        } catch (itemError) {
          console.warn('Skipping screenshot in ZIP due to fetch error:', itemError);
        }
      }

      if (addedCount === 0) {
        alert('Could not fetch screenshots for ZIP. Please try individual download for blocked files.');
        return;
      }

      const zipBlob = await zip.generateAsync({ type: 'blob' });
      const timestamp = new Date().toISOString().slice(0, 10);
      const zipUrl = URL.createObjectURL(zipBlob);
      const anchor = document.createElement('a');
      anchor.href = zipUrl;
      anchor.download = `payment-screenshots_${historyMonthFilter === 'all' ? 'all' : historyMonthFilter}_${timestamp}.zip`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(zipUrl);

      alert(`✅ Downloaded ZIP with ${addedCount} screenshot(s).`);
    } catch (zipError) {
      console.error('Error generating screenshots ZIP:', zipError);
      alert('Failed to generate ZIP. Please try again.');
    } finally {
      setDownloadingHistoryZip(false);
    }
  };

  return (
    <div className="p-4 lg:p-8">
      {/* Header with Month Navigation */}
      <div className="mb-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between mb-2">
          <h2 className="text-2xl md:text-3xl font-bold text-gray-900">💳 Payments</h2>
          <div className="flex items-center gap-2 w-full md:w-auto">
            <button
              onClick={handlePreviousMonth}
              className="px-2.5 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition font-semibold text-sm md:text-base"
            >
              ← Prev
            </button>
            <div className="flex-1 md:flex-none text-center px-3 py-2 bg-primary text-white rounded-lg font-bold text-sm md:text-lg whitespace-nowrap">
              {monthNames[selectedMonth - 1]} {selectedYear}
            </div>
            <button
              onClick={handleNextMonth}
              className="px-2.5 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition font-semibold text-sm md:text-base"
            >
              Next →
            </button>
          </div>
        </div>
        <p className="text-gray-600">Record rent payments for active tenants</p>
        <div className="mt-3 flex flex-col sm:flex-row sm:items-center gap-3">
          <ViewModeToggle viewMode={viewMode} onChange={setViewMode} />
          <div className="inline-flex items-center gap-2 bg-gray-100 border border-gray-200 rounded-lg px-3 py-2">
            <span className="text-sm font-semibold text-gray-700">Tenant Make Payment</span>
            <button
              type="button"
              onClick={handleToggleTenantDirectPay}
              disabled={savingDirectPaySetting}
              className={`px-3 py-1 rounded-md text-xs font-bold transition ${
                tenantDirectPayEnabled
                  ? 'bg-green-600 text-white hover:bg-green-700'
                  : 'bg-gray-300 text-gray-800 hover:bg-gray-400'
              } disabled:opacity-60 disabled:cursor-not-allowed`}
            >
              {savingDirectPaySetting ? 'Saving...' : tenantDirectPayEnabled ? 'Enabled' : 'Disabled'}
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <div className="card bg-gradient-to-br from-blue-500 to-blue-600 text-white">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-blue-100 text-sm mb-1">Total Tenants</p>
              <p className="text-3xl font-bold">{tenants.length}</p>
            </div>
            <div className="text-4xl">👥</div>
          </div>
        </div>

        <div className="card bg-gradient-to-br from-green-500 to-green-600 text-white">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-green-100 text-sm mb-1">Paid</p>
              <p className="text-3xl font-bold">{paidCount}</p>
            </div>
            <div className="text-4xl">✅</div>
          </div>
        </div>

        <div className="card bg-gradient-to-br from-orange-500 to-orange-600 text-white">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-orange-100 text-sm mb-1">Pending</p>
              <p className="text-3xl font-bold">{pendingCount}</p>
            </div>
            <div className="text-4xl">⏳</div>
          </div>
        </div>

        <div className="card bg-gradient-to-br from-purple-500 to-purple-600 text-white">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-purple-100 text-sm mb-1">Collected</p>
              <p className="text-2xl font-bold">₹{totalCollected.toLocaleString('en-IN')}</p>
              <p className="text-purple-200 text-xs">of ₹{totalExpected.toLocaleString('en-IN')}</p>
            </div>
            <div className="text-4xl">💰</div>
          </div>
        </div>
      </div>

      <div className="card mb-6">
        <div className="flex gap-2">
          <button
            onClick={() => setFilter('all')}
            className={`px-4 py-2 rounded-lg font-semibold transition ${
              filter === 'all'
                ? 'bg-primary text-white'
                : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
            }`}
          >
            All ({tenants.length})
          </button>
          <button
            onClick={() => setFilter('paid')}
            className={`px-4 py-2 rounded-lg font-semibold transition ${
              filter === 'paid'
                ? 'bg-green-500 text-white'
                : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
            }`}
          >
            Paid ({paidCount})
          </button>
          <button
            onClick={() => setFilter('pending')}
            className={`px-4 py-2 rounded-lg font-semibold transition ${
              filter === 'pending'
                ? 'bg-orange-500 text-white'
                : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
            }`}
          >
            Pending ({pendingCount})
          </button>
        </div>
      </div>

      <div className="card">
        <h3 className="text-xl font-bold text-gray-800 mb-4">Tenant Payment Status</h3>
        
        {filteredTenants.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            <div className="text-5xl mb-2">📋</div>
            <p>No tenants found</p>
          </div>
        ) : isCardView ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filteredTenants.map((tenant) => {
              const paymentSummary = getTenantPaymentSummary(tenant);
              const isPaid = paymentSummary.isPaid;

              return (
                <div
                  key={tenant.id}
                  className={`rounded-lg border p-4 ${isPaid ? 'border-green-200 bg-green-50' : 'border-orange-200 bg-orange-50'}`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-xs font-semibold text-gray-500 uppercase">Room</p>
                      <p className="text-lg font-bold text-gray-900">{tenant.roomNumber}</p>
                      <p className="text-sm font-semibold text-gray-900 mt-1">{tenant.name}</p>
                      <p className="text-sm text-gray-600">{tenant.phone || '-'}</p>
                      {isPaid && (
                        <div className="mt-1 space-y-1">
                          <p className="text-xs text-gray-700">
                            UTR: <span className="font-mono font-semibold">{paymentSummary.utrDisplay}</span>
                          </p>
                          {(() => {
                            const monthPayments = getTenantMonthPayments(tenant);
                            const latestPayment = monthPayments.sort((a, b) => getPaymentSortTime(b) - getPaymentSortTime(a))[0];
                            const screenshotUrl = getPaymentScreenshot(latestPayment);
                            if (!screenshotUrl) return null;
                            return (
                              <div className="flex flex-wrap gap-2">
                                <a
                                  href={screenshotUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-[11px] font-semibold text-blue-700 hover:underline"
                                >
                                  📸 View Proof
                                </a>
                                <button
                                  type="button"
                                  onClick={() => handleDownloadScreenshot(latestPayment)}
                                  className="text-[11px] font-semibold text-indigo-700 hover:underline"
                                >
                                  ⬇️ Download
                                </button>
                              </div>
                            );
                          })()}
                        </div>
                      )}
                    </div>
                    <p className="text-lg font-bold text-gray-900">
                      ₹{(isPaid ? paymentSummary.totalPaid : (tenant.currentRent || 0)).toLocaleString('en-IN')}
                    </p>
                  </div>

                  <div className="mt-3 flex items-center justify-between">
                    {isPaid ? (
                      <div className="flex flex-col">
                        <span className="px-3 py-1 rounded-full text-xs font-semibold bg-green-200 text-green-900 w-fit">
                          ✅ Paid
                        </span>
                        {paymentSummary.latestPaidDate && (
                          <span className="text-xs text-gray-600 mt-1">
                            {new Date(paymentSummary.latestPaidDate).toLocaleDateString('en-IN')}
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="px-3 py-1 rounded-full text-xs font-semibold bg-orange-200 text-orange-900">
                        ⏳ Pending
                      </span>
                    )}

                    {!isPaid && (
                      <button
                        onClick={() => handleRecordPayment(tenant)}
                        className="px-3 py-1.5 bg-primary text-white rounded-lg hover:bg-blue-700 transition text-xs font-semibold"
                      >
                        💰 Record
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold text-gray-700">Room</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-700">Tenant</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-700">Phone</th>
                  <th className="px-4 py-3 text-right font-semibold text-gray-700">Rent</th>
                  <th className="px-4 py-3 text-center font-semibold text-gray-700">Payment Date</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-700">UTR</th>
                  <th className="px-4 py-3 text-center font-semibold text-gray-700">Screenshot</th>
                  <th className="px-4 py-3 text-center font-semibold text-gray-700">Status</th>
                  <th className="px-4 py-3 text-center font-semibold text-gray-700">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {filteredTenants.map((tenant) => {
                  const paymentSummary = getTenantPaymentSummary(tenant);
                  const isPaid = paymentSummary.isPaid;
                  const monthPayments = getTenantMonthPayments(tenant);
                  const latestPayment = monthPayments.sort((a, b) => getPaymentSortTime(b) - getPaymentSortTime(a))[0];
                  const screenshotUrl = getPaymentScreenshot(latestPayment);
                  
                  return (
                    <tr key={tenant.id} className={`hover:bg-gray-50 ${isPaid ? 'bg-green-50' : ''}`}>
                      <td className="px-4 py-3 font-bold text-gray-900">
                        {tenant.roomNumber}
                      </td>
                      <td className="px-4 py-3 font-semibold text-gray-900">
                        {tenant.name}
                      </td>
                      <td className="px-4 py-3 text-gray-600">
                        {tenant.phone || '-'}
                      </td>
                      <td className="px-4 py-3 text-right font-bold text-gray-900">
                        ₹{(isPaid ? paymentSummary.totalPaid : (tenant.currentRent || 0)).toLocaleString('en-IN')}
                      </td>
                      <td className="px-4 py-3 text-center text-sm text-gray-700">
                        {paymentSummary.latestPaidDate
                          ? new Date(paymentSummary.latestPaidDate).toLocaleDateString('en-IN')
                          : '-'}
                      </td>
                      <td className="px-4 py-3 text-xs font-mono text-gray-700 max-w-[180px] truncate" title={paymentSummary.utrDisplay}>
                        {isPaid ? paymentSummary.utrDisplay : '-'}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {isPaid && screenshotUrl ? (
                          <div className="flex flex-col items-center gap-1">
                            <a
                              href={screenshotUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs font-semibold text-blue-700 hover:underline"
                            >
                              View
                            </a>
                            <button
                              type="button"
                              onClick={() => handleDownloadScreenshot(latestPayment)}
                              className="text-xs font-semibold text-indigo-700 hover:underline"
                            >
                              Download
                            </button>
                          </div>
                        ) : (
                          <span className="text-xs text-gray-400">-</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {isPaid ? (
                          <div className="flex flex-col items-center">
                            <span className="px-3 py-1 rounded-full text-xs font-semibold bg-green-200 text-green-900 mb-1">
                              ✅ Paid
                            </span>
                          </div>
                        ) : (
                          <span className="px-3 py-1 rounded-full text-xs font-semibold bg-orange-200 text-orange-900">
                            ⏳ Pending
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {!isPaid && (
                          <button
                            onClick={() => handleRecordPayment(tenant)}
                            className="px-3 py-1.5 bg-primary text-white rounded-lg hover:bg-blue-700 transition text-xs font-semibold"
                          >
                            💰 Record
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card mt-6">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between mb-4">
          <div>
            <h3 className="text-xl font-bold text-gray-800">📸 Screenshot History</h3>
            <p className="text-sm text-gray-600">Verified payment proofs from payment records (historical archive).</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 w-full lg:w-auto">
            <select
              value={historyMonthFilter}
              onChange={(e) => setHistoryMonthFilter(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
            >
              <option value="all">All Months</option>
              {historyMonthOptions.map((optionValue) => {
                const [yearValue, monthValue] = optionValue.split('-');
                return (
                  <option key={optionValue} value={optionValue}>
                    {monthNames[Number(monthValue) - 1]} {yearValue}
                  </option>
                );
              })}
            </select>

            <select
              value={cleanupMonths}
              onChange={(e) => setCleanupMonths(Number(e.target.value))}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
            >
              <option value={3}>Older than 3 months</option>
              <option value={6}>Older than 6 months</option>
              <option value={12}>Older than 12 months</option>
            </select>

            <button
              type="button"
              onClick={handleBulkDeleteOldScreenshots}
              disabled={cleaningScreenshots}
              className="px-3 py-2 bg-red-600 text-white rounded-lg text-sm font-semibold hover:bg-red-700 disabled:opacity-60"
            >
              {cleaningScreenshots ? 'Cleaning...' : `Delete Old (${oldScreenshotCandidates.length})`}
            </button>
          </div>
        </div>

        <div className="mb-4 flex justify-end">
          <button
            type="button"
            onClick={handleDownloadVisibleAsZip}
            disabled={downloadingHistoryZip || filteredHistoryScreenshots.length === 0}
            className="px-3 py-2 bg-indigo-600 text-white rounded-lg text-sm font-semibold hover:bg-indigo-700 disabled:opacity-60"
          >
            {downloadingHistoryZip ? 'Preparing ZIP...' : `⬇️ Download Visible as ZIP (${filteredHistoryScreenshots.length})`}
          </button>
        </div>

        {filteredHistoryScreenshots.length === 0 ? (
          <div className="text-center py-10 text-gray-500">
            <p>No screenshots found for selected filter.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold text-gray-700">Month</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-700">Room</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-700">Tenant</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-700">Paid Date</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-700">UTR</th>
                  <th className="px-3 py-2 text-center font-semibold text-gray-700">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {filteredHistoryScreenshots.map((payment) => {
                  const screenshotUrl = getPaymentScreenshot(payment);
                  const isOld = isOlderThanMonths(payment, cleanupMonths);
                  return (
                    <tr key={payment.id} className={isOld ? 'bg-amber-50' : ''}>
                      <td className="px-3 py-2 text-gray-700">{getHistoryMonthLabel(payment)}</td>
                      <td className="px-3 py-2 font-semibold text-gray-900">{payment.roomNumber || '-'}</td>
                      <td className="px-3 py-2 text-gray-900">{payment.tenantNameSnapshot || payment.tenantName || '-'}</td>
                      <td className="px-3 py-2 text-gray-700">{payment.paidDate ? new Date(payment.paidDate).toLocaleDateString('en-IN') : '-'}</td>
                      <td className="px-3 py-2 text-xs font-mono text-gray-700 max-w-[200px] truncate" title={payment.utr || '-'}>{payment.utr || '-'}</td>
                      <td className="px-3 py-2">
                        <div className="flex items-center justify-center gap-3">
                          <a
                            href={screenshotUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs font-semibold text-blue-700 hover:underline"
                          >
                            View
                          </a>
                          <button
                            type="button"
                            onClick={() => handleDownloadScreenshot(payment)}
                            className="text-xs font-semibold text-indigo-700 hover:underline"
                          >
                            Download
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteScreenshot(payment)}
                            className="text-xs font-semibold text-red-700 hover:underline"
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showForm && selectedTenant && (
        <PaymentForm
          tenant={selectedTenant}
          currentMonth={selectedMonth}
          currentYear={selectedYear}
          previousPayment={getPreviousPayment(selectedTenant.id)}
          onClose={handleFormClose}
          onSuccess={handleFormSuccess}
        />
      )}
    </div>
  );
};

const PaymentForm = ({ tenant, currentMonth, currentYear, previousPayment, onClose, onSuccess }) => {
  const [formData, setFormData] = useState({
    paidAmount: tenant.currentRent || 0,
    paidDate: new Date().toISOString().split('T')[0],
    paymentMethod: 'UPI',
    utr: '',
    notes: ''
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 
                      'July', 'August', 'September', 'October', 'November', 'December'];

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!formData.paidAmount || parseFloat(formData.paidAmount) <= 0) {
      setError('Please enter a valid amount');
      return;
    }

    if (!formData.paidDate) {
      setError('Please select payment date');
      return;
    }

    try {
      setSaving(true);
      setError('');

      const paymentsRef = collection(db, 'payments');
      const existingQuery = query(
        paymentsRef,
        where('tenantId', '==', tenant.id),
        where('year', '==', currentYear),
        where('month', '==', currentMonth)
      );
      const existingSnapshot = await getDocs(existingQuery);

      if (!existingSnapshot.empty) {
        const paymentDoc = existingSnapshot.docs[0];
        await updateDoc(doc(db, 'payments', paymentDoc.id), {
          paidAmount: parseFloat(formData.paidAmount),
          paidDate: formData.paidDate,
          paymentMethod: formData.paymentMethod,
          utr: formData.utr.trim(),
          notes: formData.notes.trim(),
          status: 'paid',
          updatedAt: new Date().toISOString()
        });
      } else {
        await addDoc(paymentsRef, {
          tenantId: tenant.id,
          tenantNameSnapshot: tenant.name,
          roomNumber: tenant.roomNumber,
          year: currentYear,
          month: currentMonth,
          rent: tenant.currentRent || 0,
          electricity: 0,
          paidAmount: parseFloat(formData.paidAmount),
          paidDate: formData.paidDate,
          paymentMethod: formData.paymentMethod,
          utr: formData.utr.trim(),
          notes: formData.notes.trim(),
          status: 'paid',
          createdAt: new Date().toISOString()
        });
      }

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
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full max-h-[90vh] overflow-hidden flex flex-col">
        <div className="bg-gradient-to-r from-blue-500 to-purple-600 text-white px-6 py-4 rounded-t-lg flex-shrink-0">
          <div className="flex items-center justify-between">
            <h3 className="text-xl font-bold">💳 Record Payment</h3>
            <button onClick={onClose} className="text-white hover:bg-white hover:bg-opacity-20 rounded-full w-8 h-8 flex items-center justify-center transition">
              ✕
            </button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6">
          <div className="bg-blue-50 rounded-lg p-4 mb-4">
            <div className="flex justify-between items-start mb-2">
              <div>
                <p className="text-sm text-blue-600 mb-1">Tenant</p>
                <p className="font-bold text-blue-900 text-lg">{tenant.name}</p>
              </div>
              <span className="px-3 py-1 bg-blue-500 text-white rounded-full text-xs font-semibold">
                Room {tenant.roomNumber}
              </span>
            </div>
            <p className="text-sm text-blue-700">
              {monthNames[currentMonth - 1]} {currentYear}
            </p>
          </div>

          {/* Previous Payment Info */}
          {previousPayment && (
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 mb-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-lg">📜</span>
                <p className="text-sm font-semibold text-gray-700">Previous Payment</p>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-gray-600">Month</p>
                  <p className="font-bold text-gray-900">
                    {monthNames[previousPayment.month - 1]} {previousPayment.year}
                  </p>
                </div>
                <div>
                  <p className="text-gray-600">Amount</p>
                  <p className="font-bold text-gray-900">
                    ₹{(previousPayment.paidAmount || 0).toLocaleString('en-IN')}
                  </p>
                </div>
                <div>
                  <p className="text-gray-600">Date Paid</p>
                  <p className="font-bold text-gray-900">
                    {previousPayment.paidDate ? new Date(previousPayment.paidDate).toLocaleDateString('en-IN') : '-'}
                  </p>
                </div>
                <div>
                  <p className="text-gray-600">UTR</p>
                  <p className="font-mono text-xs text-gray-900">
                    {previousPayment.utr || 'N/A'}
                  </p>
                </div>
              </div>
            </div>
          )}

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4">
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          <div className="mb-4">
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Amount (₹) *
            </label>
            <input
              type="number"
              name="paidAmount"
              value={formData.paidAmount}
              onChange={handleChange}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
              placeholder="5000"
              min="0"
              step="1"
              required
            />
          </div>

          <div className="mb-4">
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Payment Date *
            </label>
            <input
              type="date"
              name="paidDate"
              value={formData.paidDate}
              onChange={handleChange}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
              required
            />
          </div>

          <div className="mb-4">
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Payment Method
            </label>
            <div className="w-full px-4 py-2 border border-gray-300 rounded-lg bg-gray-50 text-gray-700 font-semibold flex items-center gap-2">
              <span className="text-xl">📱</span>
              UPI
            </div>
          </div>

          <div className="mb-4">
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              UTR / Transaction ID (Optional)
            </label>
            <input
              type="text"
              name="utr"
              value={formData.utr}
              onChange={handleChange}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
              placeholder="Enter UTR number"
            />
          </div>

          <div className="mb-6">
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Notes (Optional)
            </label>
            <textarea
              name="notes"
              value={formData.notes}
              onChange={handleChange}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
              rows="2"
              placeholder="Any additional notes..."
            />
          </div>

          <div className="flex gap-3 sticky bottom-0 bg-white pt-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2.5 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition font-semibold"
              disabled={saving}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 px-4 py-2.5 bg-primary text-white rounded-lg hover:bg-blue-700 transition font-semibold disabled:opacity-50"
              disabled={saving}
            >
              {saving ? 'Saving...' : '💾 Save Payment'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default Payments;
