import { useEffect, useMemo, useState } from 'react';
import { addDoc, collection, doc, getDocs, writeBatch } from 'firebase/firestore';
import { db } from '../firebase';
import Papa from 'papaparse';
import jsPDF from 'jspdf';
import 'jspdf-autotable';

const BackupExport = () => {
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [backupBusy, setBackupBusy] = useState(false);
  const [restoreBusy, setRestoreBusy] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [backupHistory, setBackupHistory] = useState([]);
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState('');

  const currentDate = new Date();
  const currentYear = currentDate.getFullYear();
  const currentMonth = currentDate.getMonth() + 1;

  const [fromYear, setFromYear] = useState(currentYear);
  const [fromMonth, setFromMonth] = useState(currentMonth);
  const [toYear, setToYear] = useState(currentYear);
  const [toMonth, setToMonth] = useState(currentMonth);

  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  useEffect(() => {
    fetchPayments();
    fetchBackupHistory();
  }, []);

  const fetchPayments = async () => {
    try {
      setLoading(true);
      setError(null);
      const snapshot = await getDocs(collection(db, 'payments'));
      const rows = snapshot.docs.map((paymentDoc) => ({ id: paymentDoc.id, ...paymentDoc.data() }));
      setPayments(rows);
    } catch (err) {
      console.error('Error loading payments:', err);
      setError('Failed to load payment records. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const fetchBackupHistory = async () => {
    try {
      const snapshot = await getDocs(collection(db, 'monthlyBackups'));
      const historyRows = snapshot.docs
        .map((backupDoc) => ({ id: backupDoc.id, ...backupDoc.data() }))
        .sort((a, b) => {
          const aTime = new Date(a.backupDateISO || a.createdAt || 0).getTime();
          const bTime = new Date(b.backupDateISO || b.createdAt || 0).getTime();
          return bTime - aTime;
        });
      setBackupHistory(historyRows);
    } catch (err) {
      console.error('Error loading backup history:', err);
    }
  };

  const years = useMemo(() => {
    const yearSet = new Set(payments.map((payment) => Number(payment.year)).filter(Boolean));
    if (yearSet.size === 0) {
      yearSet.add(currentYear);
    }
    return Array.from(yearSet).sort((a, b) => b - a);
  }, [payments, currentYear]);

  const toMonthKey = (year, month) => Number(year) * 100 + Number(month);

  const getPaymentMonthKey = (payment) => toMonthKey(Number(payment.year || 0), Number(payment.month || 0));

  const toNumber = (value, fallback = 0) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };

  const filterByCustomPeriod = (records) => {
    const startKey = toMonthKey(fromYear, fromMonth);
    const endKey = toMonthKey(toYear, toMonth);
    const minKey = Math.min(startKey, endKey);
    const maxKey = Math.max(startKey, endKey);

    return records.filter((payment) => {
      const key = getPaymentMonthKey(payment);
      return key >= minKey && key <= maxKey;
    });
  };

  const filterByRecentMonths = (records, monthsBack) => {
    const currentKey = toMonthKey(currentYear, currentMonth);
    const startDate = new Date(currentYear, currentMonth - monthsBack, 1);
    const startKey = toMonthKey(startDate.getFullYear(), startDate.getMonth() + 1);

    return records.filter((payment) => {
      const key = getPaymentMonthKey(payment);
      return key >= startKey && key <= currentKey;
    });
  };

  const normalizeBackupRows = (records) => records.map((record) => {
    const rent = toNumber(record.rent, 0);
    const oldReading = toNumber(record.oldReading, 0);
    const currentReading = toNumber(record.currentReading, 0);
    const units = toNumber(record.units, currentReading - oldReading);
    const ratePerUnit = toNumber(record.ratePerUnit, 0);
    const electricity = toNumber(record.electricity, units * ratePerUnit);
    const total = toNumber(record.total, rent + electricity);
    const paidAmount = toNumber(record.paidAmount, 0);

    return {
      docId: record.id,
      roomNumber: record.roomNumber || '',
      tenantName: record.tenantNameSnapshot || record.tenantName || '',
      year: toNumber(record.year, currentYear),
      month: toNumber(record.month, currentMonth),
      rent,
      oldReading,
      currentReading,
      units: units < 0 ? 0 : units,
      ratePerUnit,
      electricity,
      total,
      totalAmount: toNumber(record.totalAmount, total),
      paidAmount,
      status: record.status || (paidAmount >= total ? 'paid' : paidAmount > 0 ? 'partial' : 'pending'),
      roomStatus: record.roomStatus || 'occupied',
      paymentDate: record.paymentDate || '',
      paymentMode: record.paymentMode || '',
      balance: toNumber(record.balance, total - paidAmount)
    };
  });

  const createBackupCSV = async (records, label, periodType) => {
    try {
      setBackupBusy(true);
      setError(null);
      setSuccessMessage('');

      if (records.length === 0) {
        setError('No records found for selected backup period.');
        return;
      }

      const backupRows = normalizeBackupRows(records);
      const csv = Papa.unparse(backupRows);
      const fileName = `${label}.csv`;

      await addDoc(collection(db, 'monthlyBackups'), {
        type: 'comprehensive-backup',
        periodType,
        fileName,
        backupDateLabel: label,
        backupDateISO: new Date().toISOString(),
        recordCount: backupRows.length,
        records: backupRows,
        createdAt: new Date().toISOString()
      });

      downloadFile(csv, fileName, 'text/csv');
      setSuccessMessage(`✅ Backup downloaded: ${fileName}`);
      fetchBackupHistory();
      setTimeout(() => setSuccessMessage(''), 5000);
    } catch (err) {
      console.error('Backup error:', err);
      setError('Failed to create backup. Please try again.');
    } finally {
      setBackupBusy(false);
    }
  };

  const createFullBackup = async () => {
    const label = `full-backup_${new Date().toISOString().split('T')[0]}`;
    await createBackupCSV(payments, label, 'full');
  };

  const createCustomPeriodBackup = async () => {
    const selected = filterByCustomPeriod(payments);
    const label = `${String(fromMonth).padStart(2, '0')}-${fromYear}_to_${String(toMonth).padStart(2, '0')}-${toYear}`;
    await createBackupCSV(selected, label, 'custom');
  };

  const handleRestoreBackupFile = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const confirmed = window.confirm(
      'Restore backup from selected CSV file?\n\nThis can overwrite existing payment records for matching docId.'
    );

    if (!confirmed) {
      event.target.value = '';
      return;
    }

    setRestoreBusy(true);
    setError(null);
    setSuccessMessage('');

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (results) => {
        try {
          const rows = (results.data || []).filter((row) => Object.keys(row || {}).length > 0);
          if (rows.length === 0) {
            setError('Restore file is empty.');
            return;
          }

          const batchSize = 400;
          let restoredCount = 0;

          for (let i = 0; i < rows.length; i += batchSize) {
            const chunk = rows.slice(i, i + batchSize);
            const batch = writeBatch(db);

            chunk.forEach((row, index) => {
              const roomNumberRaw = String(row.roomNumber || '').trim();
              const roomNumberNumeric = toNumber(roomNumberRaw, 0);
              const year = toNumber(row.year, currentYear);
              const month = toNumber(row.month, currentMonth);
              const docId = String(row.docId || '').trim() || `restore_${year}_${month}_${roomNumberRaw || 'unknown'}_${i + index + 1}`;

              const rent = toNumber(row.rent, 0);
              const oldReading = toNumber(row.oldReading, 0);
              const currentReading = toNumber(row.currentReading, 0);
              const unitsFromRow = toNumber(row.units, currentReading - oldReading);
              const units = unitsFromRow < 0 ? 0 : unitsFromRow;
              const ratePerUnit = toNumber(row.ratePerUnit, 0);
              const electricity = toNumber(row.electricity, units * ratePerUnit);
              const total = toNumber(row.total, rent + electricity);
              const paidAmount = toNumber(row.paidAmount, 0);

              let status = String(row.status || '').toLowerCase();
              if (!status) {
                status = paidAmount >= total ? 'paid' : paidAmount > 0 ? 'partial' : 'pending';
              }

              const payload = {
                roomNumber: roomNumberNumeric || roomNumberRaw,
                tenantNameSnapshot: String(row.tenantName || row.tenantNameSnapshot || '').trim(),
                year,
                month,
                rent,
                oldReading,
                currentReading,
                units,
                ratePerUnit,
                electricity,
                total,
                totalAmount: toNumber(row.totalAmount, total),
                paidAmount,
                status,
                roomStatus: String(row.roomStatus || 'occupied').toLowerCase() === 'vacant' ? 'vacant' : 'occupied',
                paymentDate: row.paymentDate || '',
                paymentMode: row.paymentMode || '',
                balance: toNumber(row.balance, total - paidAmount),
                restoredAt: new Date().toISOString(),
                restoreSource: file.name,
                updatedAt: new Date().toISOString()
              };

              batch.set(doc(db, 'payments', docId), payload, { merge: true });
              restoredCount += 1;
            });

            await batch.commit();
          }

          setSuccessMessage(`✅ Restore complete: ${restoredCount} record(s) restored from ${file.name}`);
          setTimeout(() => setSuccessMessage(''), 6000);
          fetchPayments();
        } catch (err) {
          console.error('Restore error:', err);
          setError('Failed to restore backup CSV. Please verify file format.');
        } finally {
          setRestoreBusy(false);
          event.target.value = '';
        }
      },
      error: (parseError) => {
        console.error('Parse error:', parseError);
        setError('Invalid CSV file.');
        setRestoreBusy(false);
        event.target.value = '';
      }
    });
  };

  const createStatementPDF = async (mode) => {
    try {
      setPdfBusy(true);
      setError(null);
      setSuccessMessage('');

      let selectedRecords = [];
      let titleLabel = '';

      if (mode === 'custom') {
        selectedRecords = filterByCustomPeriod(payments);
        titleLabel = `Selected Period (${monthNames[fromMonth - 1]} ${fromYear} - ${monthNames[toMonth - 1]} ${toYear})`;
      } else if (mode === '3m') {
        selectedRecords = filterByRecentMonths(payments, 3);
        titleLabel = 'Last 3 Months';
      } else if (mode === '6m') {
        selectedRecords = filterByRecentMonths(payments, 6);
        titleLabel = 'Last 6 Months';
      } else {
        selectedRecords = filterByRecentMonths(payments, 12);
        titleLabel = 'Last 1 Year';
      }

      if (selectedRecords.length === 0) {
        setError('No records found for selected statement period.');
        return;
      }

      const sorted = [...selectedRecords].sort((a, b) => {
        const aKey = getPaymentMonthKey(a);
        const bKey = getPaymentMonthKey(b);
        if (bKey !== aKey) return bKey - aKey;
        return toNumber(a.roomNumber, 0) - toNumber(b.roomNumber, 0);
      });

      const pdf = new jsPDF();

      pdf.setFontSize(18);
      pdf.text('Rent Statement', 14, 20);
      pdf.setFontSize(14);
      pdf.text(titleLabel, 14, 28);

      const tableData = sorted.map((record) => {
        const rent = toNumber(record.rent, 0);
        const electricity = toNumber(record.electricity, 0);
        const total = toNumber(record.total ?? record.totalAmount, rent + electricity);
        const paidAmount = toNumber(record.paidAmount, 0);

        return [
          `${monthNames[toNumber(record.month, 1) - 1]} ${record.year || ''}`,
          String(record.roomNumber || '-'),
          String(record.tenantNameSnapshot || record.tenantName || '-'),
          `₹${rent.toLocaleString('en-IN')}`,
          `₹${electricity.toLocaleString('en-IN')}`,
          `₹${total.toLocaleString('en-IN')}`,
          `₹${paidAmount.toLocaleString('en-IN')}`,
          String(record.status || 'pending')
        ];
      });

      const totalAmount = sorted.reduce((sum, row) => {
        const rent = toNumber(row.rent, 0);
        const electricity = toNumber(row.electricity, 0);
        return sum + toNumber(row.total ?? row.totalAmount, rent + electricity);
      }, 0);

      const totalPaid = sorted.reduce((sum, row) => sum + toNumber(row.paidAmount, 0), 0);

      pdf.setFontSize(10);
      pdf.text(`Generated on: ${new Date().toLocaleString('en-IN')}`, 14, 34);

      pdf.autoTable({
        startY: 38,
        head: [['Month', 'Room', 'Tenant', 'Rent', 'Electricity', 'Total', 'Paid', 'Status']],
        body: tableData,
        theme: 'striped',
        styles: { fontSize: 8 },
        headStyles: { fillColor: [41, 128, 185] }
      });

      const summaryY = pdf.lastAutoTable.finalY + 10;
      pdf.setFontSize(11);
      pdf.text(`Total Amount: ₹${totalAmount.toLocaleString('en-IN')}`, 14, summaryY);
      pdf.text(`Total Paid: ₹${totalPaid.toLocaleString('en-IN')}`, 14, summaryY + 7);
      pdf.text(`Total Balance: ₹${(totalAmount - totalPaid).toLocaleString('en-IN')}`, 14, summaryY + 14);

      const fileTag = mode === 'custom' ? 'selected-period' : mode;
      pdf.save(`statement_${fileTag}_${new Date().toISOString().split('T')[0]}.pdf`);
      setSuccessMessage(`✅ PDF statement generated: ${titleLabel}`);
      setTimeout(() => setSuccessMessage(''), 4000);
    } catch (err) {
      console.error('PDF generation error:', err);
      setError('Failed to generate statement PDF.');
    } finally {
      setPdfBusy(false);
    }
  };

  const downloadFile = (content, filename, mimeType) => {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <div className="p-4 lg:p-8">
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
            <p className="text-gray-600">Loading backup manager...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-8">
      <div className="mb-6">
        <h2 className="text-3xl font-bold text-gray-900 mb-2">💾 Backup & Restore</h2>
        <p className="text-gray-600">Create backups, restore data, and generate statement PDFs</p>
      </div>

      {error && (
        <div className="card bg-red-50 border border-red-200 mb-6">
          <p className="text-red-700">{error}</p>
        </div>
      )}

      {successMessage && (
        <div className="card bg-green-50 border border-green-200 mb-6">
          <p className="text-green-700">{successMessage}</p>
        </div>
      )}

      <div className="card mb-6">
        <h3 className="text-xl font-bold text-gray-800 mb-4">📦 Backup</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <button
            onClick={createFullBackup}
            disabled={backupBusy || restoreBusy || pdfBusy}
            className="btn-primary"
          >
            {backupBusy ? '⏳ Creating...' : '📥 Full Data Backup (CSV)'}
          </button>
          <button
            onClick={createCustomPeriodBackup}
            disabled={backupBusy || restoreBusy || pdfBusy}
            className="btn-secondary"
          >
            📥 Selected Period Backup (CSV)
          </button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">From Month</label>
            <select value={fromMonth} onChange={(e) => setFromMonth(Number(e.target.value))} className="w-full px-2 py-2 border border-gray-300 rounded-md text-sm">
              {monthNames.map((monthName, index) => (
                <option key={monthName} value={index + 1}>{monthName}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">From Year</label>
            <select value={fromYear} onChange={(e) => setFromYear(Number(e.target.value))} className="w-full px-2 py-2 border border-gray-300 rounded-md text-sm">
              {years.map((year) => (
                <option key={`fy-${year}`} value={year}>{year}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">To Month</label>
            <select value={toMonth} onChange={(e) => setToMonth(Number(e.target.value))} className="w-full px-2 py-2 border border-gray-300 rounded-md text-sm">
              {monthNames.map((monthName, index) => (
                <option key={`tm-${monthName}`} value={index + 1}>{monthName}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">To Year</label>
            <select value={toYear} onChange={(e) => setToYear(Number(e.target.value))} className="w-full px-2 py-2 border border-gray-300 rounded-md text-sm">
              {years.map((year) => (
                <option key={`ty-${year}`} value={year}>{year}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="card mb-6">
        <h3 className="text-xl font-bold text-gray-800 mb-4">♻️ Restore</h3>
        <p className="text-sm text-gray-600 mb-3">Upload backup CSV and restore payment records.</p>
        <label className="btn-primary inline-flex items-center cursor-pointer">
          {restoreBusy ? '⏳ Restoring...' : '📤 Upload Backup CSV & Restore'}
          <input
            type="file"
            accept=".csv"
            onChange={handleRestoreBackupFile}
            className="hidden"
            disabled={restoreBusy || backupBusy || pdfBusy}
          />
        </label>
        <p className="text-xs text-red-600 mt-2">
          ⚠️ Restore can overwrite existing records when CSV has matching docId.
        </p>
      </div>

      <div className="card mb-6">
        <h3 className="text-xl font-bold text-gray-800 mb-4">📄 Statement PDF</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <button
            onClick={() => createStatementPDF('custom')}
            disabled={pdfBusy || backupBusy || restoreBusy}
            className="btn-secondary"
          >
            {pdfBusy ? '⏳ Generating...' : 'Selected Period PDF'}
          </button>
          <button
            onClick={() => createStatementPDF('3m')}
            disabled={pdfBusy || backupBusy || restoreBusy}
            className="btn-secondary"
          >
            Last 3 Months PDF
          </button>
          <button
            onClick={() => createStatementPDF('6m')}
            disabled={pdfBusy || backupBusy || restoreBusy}
            className="btn-secondary"
          >
            Last 6 Months PDF
          </button>
          <button
            onClick={() => createStatementPDF('1y')}
            disabled={pdfBusy || backupBusy || restoreBusy}
            className="btn-secondary"
          >
            Last 1 Year PDF
          </button>
        </div>
      </div>

      <div className="card">
        <h3 className="text-xl font-bold text-gray-800 mb-4">🕘 Backup History</h3>
        {backupHistory.length === 0 ? (
          <p className="text-sm text-gray-500">No backups created yet.</p>
        ) : (
          <div className="space-y-2 max-h-72 overflow-auto pr-1">
            {backupHistory.slice(0, 20).map((backup) => (
              <div key={backup.id} className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-gray-800">{backup.fileName || backup.backupDateLabel || 'Backup'}</p>
                  <span className="text-xs text-gray-500">{backup.recordCount || 0} records</span>
                </div>
                <p className="text-xs text-gray-600 mt-1">
                  {backup.periodType || 'period'} • {backup.backupDateISO ? new Date(backup.backupDateISO).toLocaleString('en-IN') : '-'}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default BackupExport;
