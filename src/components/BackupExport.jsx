import { useState } from 'react';
import { collection, getDocs, query, orderBy } from 'firebase/firestore';
import { db } from '../firebase';
import Papa from 'papaparse';
import jsPDF from 'jspdf';
import 'jspdf-autotable';

const BackupExport = () => {
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState(null);

  const exportTenantsCSV = async () => {
    try {
      setExporting(true);
      setError(null);

      const tenantsRef = collection(db, 'tenants');
      const tenantsSnapshot = await getDocs(query(tenantsRef, orderBy('createdAt', 'desc')));
      
      const data = [];
      tenantsSnapshot.forEach((doc) => {
        const tenant = doc.data();
        data.push({
          id: doc.id,
          name: tenant.name,
          phone: tenant.phone,
          roomNumber: tenant.roomNumber,
          checkInDate: tenant.checkInDate,
          checkOutDate: tenant.checkOutDate || '',
          isActive: tenant.isActive,
          baseRent: tenant.baseRent,
          currentRent: tenant.currentRent,
          securityDeposit: tenant.securityDeposit || 0
        });
      });

      const csv = Papa.unparse(data);
      downloadFile(csv, `tenants_backup_${new Date().toISOString().split('T')[0]}.csv`, 'text/csv');
      
      setExporting(false);
      alert('✅ Tenants exported successfully!');
    } catch (err) {
      console.error('Export error:', err);
      setError('Failed to export tenants. Please try again.');
      setExporting(false);
    }
  };

  const exportMonthlyRecordsCSV = async () => {
    try {
      setExporting(true);
      setError(null);

      const recordsRef = collection(db, 'monthlyRecords');
      const recordsSnapshot = await getDocs(query(recordsRef, orderBy('year', 'desc'), orderBy('month', 'desc')));
      
      // Get tenants for name mapping
      const tenantsRef = collection(db, 'tenants');
      const tenantsSnapshot = await getDocs(tenantsRef);
      const tenantMap = {};
      tenantsSnapshot.forEach((doc) => {
        tenantMap[doc.id] = doc.data().name;
      });

      const data = [];
      recordsSnapshot.forEach((doc) => {
        const record = doc.data();
        data.push({
          tenantName: tenantMap[record.tenantId] || 'Unknown',
          roomNumber: record.roomNumber,
          year: record.year,
          month: record.month,
          rent: record.rent,
          electricity: record.electricity || 0,
          extraCharges: record.extraCharges || 0,
          lateFee: record.lateFee || 0,
          total: record.total,
          status: record.status,
          dueDate: record.dueDate || '',
          paidAt: record.paidAt || ''
        });
      });

      const csv = Papa.unparse(data);
      downloadFile(csv, `monthly_records_backup_${new Date().toISOString().split('T')[0]}.csv`, 'text/csv');
      
      setExporting(false);
      alert('✅ Monthly records exported successfully!');
    } catch (err) {
      console.error('Export error:', err);
      setError('Failed to export records. Please try again.');
      setExporting(false);
    }
  };

  const generateYearlyPDF = async (year) => {
    try {
      setExporting(true);
      setError(null);

      // Fetch data
      const recordsRef = collection(db, 'monthlyRecords');
      const recordsSnapshot = await getDocs(query(recordsRef, orderBy('month', 'asc')));
      
      const tenantsRef = collection(db, 'tenants');
      const tenantsSnapshot = await getDocs(tenantsRef);
      const tenantMap = {};
      tenantsSnapshot.forEach((doc) => {
        tenantMap[doc.id] = doc.data().name;
      });

      // Filter by year
      const yearRecords = [];
      recordsSnapshot.forEach((doc) => {
        const record = doc.data();
        if (record.year === parseInt(year)) {
          yearRecords.push({
            ...record,
            tenantName: tenantMap[record.tenantId] || 'Unknown'
          });
        }
      });

      if (yearRecords.length === 0) {
        alert(`No records found for year ${year}`);
        setExporting(false);
        return;
      }

      // Generate PDF
      const pdf = new jsPDF();
      
      pdf.setFontSize(18);
      pdf.text('Autoxweb Rent Management', 14, 20);
      pdf.setFontSize(14);
      pdf.text(`Yearly Report - ${year}`, 14, 28);
      
      const tableData = yearRecords.map(record => [
        record.tenantName,
        record.roomNumber,
        getMonthName(record.month),
        `₹${record.rent}`,
        `₹${record.electricity || 0}`,
        `₹${record.total}`,
        record.status
      ]);

      pdf.autoTable({
        startY: 35,
        head: [['Tenant', 'Room', 'Month', 'Rent', 'Electricity', 'Total', 'Status']],
        body: tableData,
        theme: 'striped',
        styles: { fontSize: 9 },
        headStyles: { fillColor: [59, 130, 246] }
      });

      // Summary
      const totalRentCollected = yearRecords
        .filter(r => r.status === 'paid')
        .reduce((sum, r) => sum + r.total, 0);
      
      const finalY = pdf.lastAutoTable.finalY + 10;
      pdf.setFontSize(12);
      pdf.text(`Total Collected: ₹${totalRentCollected.toLocaleString('en-IN')}`, 14, finalY);

      pdf.save(`rent_report_${year}.pdf`);
      
      setExporting(false);
      alert('✅ PDF generated successfully!');
    } catch (err) {
      console.error('PDF generation error:', err);
      setError('Failed to generate PDF. Please try again.');
      setExporting(false);
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

  const getMonthName = (monthNum) => {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return months[monthNum - 1] || monthNum;
  };

  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 10 }, (_, i) => currentYear - i);

  return (
    <div className="p-4 lg:p-8">
      {/* Header */}
      <div className="mb-6">
        <h2 className="text-3xl font-bold text-gray-900 mb-2">💾 Backup & Export</h2>
        <p className="text-gray-600">Export your data for backup or analysis</p>
      </div>

      {error && (
        <div className="card bg-red-50 border border-red-200 mb-6">
          <p className="text-red-700">{error}</p>
        </div>
      )}

      {/* CSV Exports */}
      <div className="card mb-6">
        <h3 className="text-xl font-bold text-gray-800 mb-4">📊 Export as CSV</h3>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="border border-gray-200 rounded-lg p-4">
            <div className="flex items-center gap-3 mb-3">
              <div className="text-4xl">👥</div>
              <div>
                <h4 className="font-bold text-gray-800">Tenants</h4>
                <p className="text-sm text-gray-600">All tenant information</p>
              </div>
            </div>
            <button
              onClick={exportTenantsCSV}
              disabled={exporting}
              className="btn-primary w-full"
            >
              {exporting ? '⏳ Exporting...' : '📥 Export Tenants'}
            </button>
          </div>

          <div className="border border-gray-200 rounded-lg p-4">
            <div className="flex items-center gap-3 mb-3">
              <div className="text-4xl">📋</div>
              <div>
                <h4 className="font-bold text-gray-800">Monthly Records</h4>
                <p className="text-sm text-gray-600">All payment records</p>
              </div>
            </div>
            <button
              onClick={exportMonthlyRecordsCSV}
              disabled={exporting}
              className="btn-primary w-full"
            >
              {exporting ? '⏳ Exporting...' : '📥 Export Records'}
            </button>
          </div>
        </div>
      </div>

      {/* Yearly PDF Reports */}
      <div className="card">
        <h3 className="text-xl font-bold text-gray-800 mb-4">📄 Generate Yearly PDF Report</h3>
        
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {years.map(year => (
            <button
              key={year}
              onClick={() => generateYearlyPDF(year)}
              disabled={exporting}
              className="btn-secondary text-sm"
            >
              {year}
            </button>
          ))}
        </div>

        <p className="text-xs text-gray-500 mt-4">
          💡 PDF reports include all monthly records for the selected year
        </p>
      </div>
    </div>
  );
};

export default BackupExport;
