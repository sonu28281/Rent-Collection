import { useState } from 'react';
import Papa from 'papaparse';
import { collection, doc, setDoc, getDocs, query, where, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useDialog } from './ui/DialogProvider';

const ImportCSV = () => {
  const { showConfirm } = useDialog();
  const [file, setFile] = useState(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [parsedData, setParsedData] = useState(null);
  const [previewData, setPreviewData] = useState(null);
  const [showFullPreview, setShowFullPreview] = useState(false);
  const [warnings, setWarnings] = useState([]);

  // Column mapping - Excel to Firestore
  const COLUMN_MAPPING = {
    'Room No.': 'roomNumber',
    'Room No': 'roomNumber',
    'roomNumber': 'roomNumber',
    'room': 'roomNumber',
    
    'Tenant Name': 'tenantName',
    'Tenant': 'tenantName',
    'tenantName': 'tenantName',
    'name': 'tenantName',
    
    'Year': 'year',
    'year': 'year',
    
    'Month': 'month',
    'month': 'month',
    
    'Date': 'date',
    'date': 'date',
    'Payment Date': 'date',
    'paymentDate': 'date',
    
    'Rent': 'rent',
    'rent': 'rent',
    'Monthly Rent': 'rent',
    
    'Reading (Prev.)': 'oldReading',
    'Old Reading': 'oldReading',
    'Previous Reading': 'oldReading',
    'oldReading': 'oldReading',
    'prevReading': 'oldReading',
    
    'Reading (Curr.)': 'currentReading',
    'Current Reading': 'currentReading',
    'currentReading': 'currentReading',
    'currReading': 'currentReading',
    
    'Price/Unit': 'ratePerUnit',
    'Rate/Unit': 'ratePerUnit',
    'Rate Per Unit': 'ratePerUnit',
    'ratePerUnit': 'ratePerUnit',
    'rate': 'ratePerUnit',
    
    'Paid': 'paidAmount',
    'Paid Amount': 'paidAmount',
    'Amount Paid': 'paidAmount',
    'paidAmount': 'paidAmount',
    'paid': 'paidAmount',
    
    'Payment Mode': 'paymentMode',
    'Mode': 'paymentMode',
    'paymentMode': 'paymentMode',
    
    'Debit/Credit': 'debitCredit',
    'DebitCredit': 'debitCredit',
    'debitCredit': 'debitCredit',
    'Debit': 'debitCredit',
    'Credit': 'debitCredit',
    
    'Remark': 'remark',
    'Remarks': 'remark',
    'remark': 'remark',
    'remarks': 'remark',
    'Notes': 'remark',
    'notes': 'remark',
  };

  const mapColumns = (csvRow) => {
    const mapped = {};
    for (const [csvKey, csvValue] of Object.entries(csvRow)) {
      const firebaseKey = COLUMN_MAPPING[csvKey];
      if (firebaseKey) {
        mapped[firebaseKey] = csvValue;
      }
    }
    return mapped;
  };

  const calculateRecordData = (row, rowIndex) => {
    const warnings = [];
    
    // Map columns
    const mappedRow = mapColumns(row);
    
    // Parse roomNumber
    const roomNumber = Number(mappedRow.roomNumber);
    if (!roomNumber || isNaN(roomNumber)) {
      throw new Error('Invalid room number');
    }
    
    // Auto-detect floor
    const floor = roomNumber < 200 ? 1 : 2;
    
    // Tenant name (stored as snapshot, NEVER validated)
    const tenantName = (mappedRow.tenantName || '').trim();
    if (!tenantName) {
      throw new Error('Tenant name is required');
    }
    
    // Year and month
    const year = Number(mappedRow.year);
    const month = Number(mappedRow.month);
    
    if (!year || year < 2000 || year > 2100) {
      throw new Error(`Invalid year: ${mappedRow.year}`);
    }
    
    if (!month || month < 1 || month > 12) {
      warnings.push(`Invalid month: ${month}`);
    }
    
    // Date (optional, can be null)
    let date = mappedRow.date || null;
    if (date && date.trim() === '') {
      date = null;
    }
    if (!date) {
      warnings.push('Date is missing');
    }
    
    // Rent
    const rent = Number(mappedRow.rent) || 0;
    if (rent === 0) {
      warnings.push('Rent is 0 or missing');
    }
    
    // Meter readings
    const oldReading = Number(mappedRow.oldReading) || 0;
    const currentReading = Number(mappedRow.currentReading) || 0;
    
    if (oldReading === 0) {
      warnings.push('Old reading is 0 or missing');
    }
    if (currentReading === 0) {
      warnings.push('Current reading is 0 or missing');
    }
    
    // Rate per unit
    const ratePerUnit = Number(mappedRow.ratePerUnit) || 0;
    if (ratePerUnit === 0) {
      warnings.push('Rate per unit is 0 or missing');
    }
    
    // Calculate units (defensive check for negative)
    let units = currentReading - oldReading;
    if (units < 0) {
      warnings.push(`Negative units detected (${units}), setting to 0`);
      units = 0;
    }
    
    // Calculate electricity
    const electricity = units * ratePerUnit;
    
    // Calculate total
    const total = rent + electricity;
    
    // Paid amount
    const paidAmount = Number(mappedRow.paidAmount) || 0;
    
    // Payment mode
    const paymentMode = (mappedRow.paymentMode || 'cash').toLowerCase();
    
    // Debit/Credit (raw text from sheet)
    const debitCredit = (mappedRow.debitCredit || '').trim() || null;
    
    // Remark (free text notes)
    const remark = (mappedRow.remark || '').trim() || null;
    
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
    
    return {
      data: {
        roomNumber,
        tenantName,
        year,
        month,
        date,
        rent,
        oldReading,
        currentReading,
        units,
        ratePerUnit,
        electricity,
        total,
        paidAmount,
        balance,
        balanceType,
        debitCredit,
        remark,
        paymentMode,
        status,
        floor,
        source: 'csv_import',
        notes: null,
        tenantValidated: false, // Never validated
      },
      warnings
    };
  };

  const handleFileChange = (e) => {
    const selectedFile = e.target.files[0];
    if (selectedFile && selectedFile.type === 'text/csv') {
      setFile(selectedFile);
      setError(null);
      setParsedData(null);
      setPreviewData(null);
      setWarnings([]);
      
      // Parse entire file for preview
      Papa.parse(selectedFile, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
          try {
            const data = results.data;
            
            if (data.length === 0) {
              setError('CSV file is empty');
              return;
            }
            
            // Check required columns
            const headers = Object.keys(data[0]);
            const requiredFields = ['roomNumber', 'tenantName', 'year', 'month', 'rent', 'oldReading', 'currentReading', 'ratePerUnit', 'paidAmount'];
            
            // Check if any mapping exists for required fields
            const mappedHeaders = headers.map(h => COLUMN_MAPPING[h]).filter(Boolean);
            const missingFields = requiredFields.filter(field => !mappedHeaders.includes(field));
            
            if (missingFields.length > 0) {
              setError(`Missing required columns: ${missingFields.join(', ')}\n\nDetected columns: ${headers.join(', ')}`);
              return;
            }
            
            // Process all rows for preview
            const processedRows = [];
            const allWarnings = [];
            
            for (let i = 0; i < data.length; i++) {
              try {
                const result = calculateRecordData(data[i], i + 1);
                processedRows.push({
                  rowNumber: i + 1,
                  ...result.data,
                  rowWarnings: result.warnings
                });
                
                if (result.warnings.length > 0) {
                  allWarnings.push(`Row ${i + 1}: ${result.warnings.join(', ')}`);
                }
              } catch (err) {
                allWarnings.push(`Row ${i + 1}: ERROR - ${err.message}`);
              }
            }
            
            setParsedData(processedRows);
            setPreviewData(processedRows.slice(0, 200)); // First 200 rows
            setWarnings(allWarnings);
            
          } catch (err) {
            setError(`Preview error: ${err.message}`);
          }
        },
        error: (err) => {
          setError(`CSV parsing error: ${err.message}`);
        }
      });
    } else {
      setError('Please select a valid CSV file');
      setFile(null);
      setParsedData(null);
      setPreviewData(null);
    }
  };

  const handleImport = async () => {
    if (!parsedData || parsedData.length === 0) {
      setError('No data to import');
      return;
    }

    const confirmed = await showConfirm(
      `Import ${parsedData.length} records?\n\n${warnings.length} warnings detected.\n\nExisting records (same room + year + month) will be UPDATED.`,
      { title: 'Confirm Import', confirmLabel: 'Import Records', intent: 'warning' }
    );
    if (!confirmed) {
      return;
    }

    setImporting(true);
    setError(null);
    setResult(null);

    try {
      let successCount = 0;
      let updatedCount = 0;
      let errorCount = 0;
      const errors = [];
      const importLog = {
        timestamp: new Date().toISOString(),
        fileName: file.name,
        totalRows: parsedData.length,
        successCount: 0,
        updatedCount: 0,
        errorCount: 0,
        warningCount: warnings.length,
        warnings: warnings.slice(0, 100),
        errors: []
      };

      // Import records
      for (let i = 0; i < parsedData.length; i++) {
        try {
          const record = parsedData[i];
          
          // Create payment ID: roomNumber_year_month
          const paymentId = `${record.roomNumber}_${record.year}_${record.month}`;
          
          // Check for duplicates
          const existingDoc = await getDocs(
            query(
              collection(db, 'payments'),
              where('roomNumber', '==', record.roomNumber),
              where('year', '==', record.year),
              where('month', '==', record.month)
            )
          );
          
          const now = new Date().toISOString();
          const paymentData = {
            roomNumber: record.roomNumber,
            tenantName: record.tenantName,
            year: record.year,
            month: record.month,
            date: record.date,
            rent: record.rent,
            oldReading: record.oldReading,
            currentReading: record.currentReading,
            units: record.units,
            ratePerUnit: record.ratePerUnit,
            electricity: record.electricity,
            total: record.total,
            paidAmount: record.paidAmount,
            balance: record.balance,
            balanceType: record.balanceType,
            debitCredit: record.debitCredit,
            remark: record.remark,
            paymentMode: record.paymentMode,
            status: record.status,
            floor: record.floor,
            source: record.source,
            notes: record.notes,
            tenantValidated: false,
            updatedAt: now
          };
          
          if (!existingDoc.empty) {
            // UPDATE existing record
            const existingDocId = existingDoc.docs[0].id;
            await updateDoc(doc(db, 'payments', existingDocId), paymentData);
            updatedCount++;
          } else {
            // CREATE new record
            paymentData.createdAt = now;
            paymentData.importedAt = now;
            await setDoc(doc(db, 'payments', paymentId), paymentData);
            successCount++;
          }
          
          // Progress update every 50 records
          if ((successCount + updatedCount) % 50 === 0) {
            console.log(`Processed ${successCount + updatedCount} records...`);
          }
          
        } catch (err) {
          errors.push(`Row ${i + 1}: ${err.message}`);
          errorCount++;
        }
      }

      // Save import log
      importLog.successCount = successCount;
      importLog.updatedCount = updatedCount;
      importLog.errorCount = errorCount;
      importLog.errors = errors.slice(0, 100);
      
      await setDoc(doc(db, 'importLogs', `import_${Date.now()}`), importLog);

      setResult({
        success: successCount,
        updated: updatedCount,
        errors: errorCount,
        warnings: warnings.length,
        errorDetails: errors,
        warningDetails: warnings
      });
      
      setImporting(false);
    } catch (err) {
      console.error('Import processing error:', err);
      setError(`Import processing failed: ${err.message}`);
      setImporting(false);
    }
  };

  return (
    <div className="p-4 lg:p-8">
      {/* Header */}
      <div className="mb-6">
        <h2 className="text-3xl font-bold text-gray-900 mb-2">📥 Import Historical Payment Data</h2>
        <p className="text-gray-600">Import monthly records with complete meter-based electricity calculation</p>
      </div>

      {/* Instructions */}
      <div className="card mb-6 bg-blue-50 border border-blue-200">
        <h3 className="font-semibold text-blue-900 mb-3">📋 CSV Format Requirements - METER-BASED SYSTEM:</h3>
        <div className="text-sm text-blue-800 space-y-2">
          <div className="mb-3">
            <strong className="text-blue-900">✅ SUPPORTED EXCEL COLUMN NAMES (Auto-Mapped):</strong>
            <div className="grid grid-cols-2 gap-2 ml-4 mt-2 bg-blue-100 p-3 rounded">
              <div>
                <div className="font-semibold mb-1">Excel Column → System Field:</div>
                <ul className="space-y-1 text-xs">
                  <li>• "Room No." → roomNumber</li>
                  <li>• "Tenant Name" → tenantName</li>
                  <li>• "Year" → year</li>
                  <li>• "Month" → month (1-12)</li>
                  <li>• "Date" → date</li>
                </ul>
              </div>
              <div>
                <div className="font-semibold mb-1">&nbsp;</div>
                <ul className="space-y-1 text-xs">
                  <li>• "Rent" → rent</li>
                  <li>• "Reading (Prev.)" → oldReading</li>
                  <li>• "Reading (Curr.)" → currentReading</li>
                  <li>• "Price/Unit" → ratePerUnit</li>
                  <li>• "Paid" → paidAmount</li>
                </ul>
              </div>
            </div>
          </div>
          
          <div className="bg-green-100 border border-green-300 rounded p-3 mt-3">
            <strong className="text-green-900">🔧 AUTO-CALCULATIONS (No Manual Input Needed):</strong>
            <ul className="ml-4 mt-1 space-y-1">
              <li>• <strong>floor</strong> = roomNumber &lt; 200 ? 1 : 2</li>
              <li>• <strong>units</strong> = max(0, currentReading - oldReading)</li>
              <li>• <strong>electricity</strong> = units × ratePerUnit</li>
              <li>• <strong>total</strong> = rent + electricity</li>
              <li>• <strong>status</strong> = auto-determined from paidAmount vs total</li>
            </ul>
          </div>
          
          <div className="bg-yellow-100 border border-yellow-300 rounded p-3 mt-3">
            <strong className="text-yellow-900">⚠️ DEFENSIVE SAFEGUARDS:</strong>
            <ul className="ml-4 mt-1 space-y-1">
              <li>• Negative units → automatically set to 0 (with warning)</li>
              <li>• Missing oldReading → defaults to 0</li>
              <li>• Missing currentReading → defaults to 0</li>
              <li>• Missing ratePerUnit → defaults to 0</li>
              <li>• Missing paidAmount → defaults to 0</li>
              <li>• Missing date → allowed (stored as null)</li>
              <li>• Tenant names stored as snapshots - NEVER validated</li>
              <li>• Duplicates (room + year + month) → UPDATED, not rejected</li>
            </ul>
          </div>
        </div>
      </div>

      {/* File Upload */}
      <div className="card mb-6">
        <h3 className="text-xl font-bold text-gray-800 mb-4">Select CSV File</h3>
        
        <div className="mb-4">
          <input
            type="file"
            accept=".csv"
            onChange={handleFileChange}
            className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-primary file:text-white hover:file:bg-secondary"
            disabled={importing}
          />
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4">
            <p className="text-sm text-red-700 whitespace-pre-wrap">{error}</p>
          </div>
        )}

        {/* Warnings Summary */}
        {warnings.length > 0 && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 mb-4">
            <p className="text-sm font-semibold text-yellow-800 mb-2">
              ⚠️ {warnings.length} Warning(s) Detected
            </p>
            <details className="text-xs text-yellow-700">
              <summary className="cursor-pointer font-semibold mb-1">View warnings</summary>
              <ul className="ml-4 mt-2 space-y-1 max-h-40 overflow-y-auto">
                {warnings.slice(0, 50).map((warn, idx) => (
                  <li key={idx}>• {warn}</li>
                ))}
                {warnings.length > 50 && (
                  <li className="font-semibold">... and {warnings.length - 50} more warnings</li>
                )}
              </ul>
            </details>
          </div>
        )}

        {/* Preview with calculations */}
        {previewData && previewData.length > 0 && (
          <div className="mb-4">
            <div className="flex justify-between items-center mb-2">
              <h4 className="font-semibold text-gray-700">
                Preview: {previewData.length} rows (of {parsedData.length} total)
              </h4>
              {parsedData.length > 200 && (
                <button
                  onClick={() => setShowFullPreview(!showFullPreview)}
                  className="text-xs text-blue-600 hover:underline"
                >
                  {showFullPreview ? 'Show first 200 rows' : 'Show all rows'}
                </button>
              )}
            </div>
            <div className="overflow-x-auto max-h-96 overflow-y-auto border border-gray-200 rounded">
              <table className="w-full text-xs">
                <thead className="bg-gray-100 sticky top-0">
                  <tr>
                    <th className="px-2 py-1 text-left font-semibold border-b">#</th>
                    <th className="px-2 py-1 text-left font-semibold border-b">Room</th>
                    <th className="px-2 py-1 text-left font-semibold border-b">Floor</th>
                    <th className="px-2 py-1 text-left font-semibold border-b">Tenant</th>
                    <th className="px-2 py-1 text-left font-semibold border-b">Year</th>
                    <th className="px-2 py-1 text-left font-semibold border-b">Month</th>
                    <th className="px-2 py-1 text-left font-semibold border-b">Date</th>
                    <th className="px-2 py-1 text-right font-semibold border-b">Rent</th>
                    <th className="px-2 py-1 text-right font-semibold border-b">Old</th>
                    <th className="px-2 py-1 text-right font-semibold border-b">Curr</th>
                    <th className="px-2 py-1 text-right font-semibold border-b">Units</th>
                    <th className="px-2 py-1 text-right font-semibold border-b">Rate</th>
                    <th className="px-2 py-1 text-right font-semibold border-b">Elec</th>
                    <th className="px-2 py-1 text-right font-semibold border-b">Total</th>
                    <th className="px-2 py-1 text-right font-semibold border-b">Paid</th>
                    <th className="px-2 py-1 text-right font-semibold border-b">Balance</th>
                    <th className="px-2 py-1 text-center font-semibold border-b">Bal Type</th>
                    <th className="px-2 py-1 text-left font-semibold border-b">D/C</th>
                    <th className="px-2 py-1 text-left font-semibold border-b">Remark</th>
                    <th className="px-2 py-1 text-center font-semibold border-b">Status</th>
                    <th className="px-2 py-1 text-left font-semibold border-b">⚠️</th>
                  </tr>
                </thead>
                <tbody>
                  {(showFullPreview ? parsedData : previewData).map((row) => (
                    <tr key={row.rowNumber} className="border-b hover:bg-gray-50">
                      <td className="px-2 py-1">{row.rowNumber}</td>
                      <td className="px-2 py-1">{row.roomNumber}</td>
                      <td className="px-2 py-1">{row.floor}</td>
                      <td className="px-2 py-1 max-w-[150px] truncate">{row.tenantName}</td>
                      <td className="px-2 py-1">{row.year}</td>
                      <td className={`px-2 py-1 ${row.month > 12 || row.month < 1 ? 'bg-red-100' : ''}`}>
                        {row.month}
                      </td>
                      <td className={`px-2 py-1 ${!row.date ? 'bg-yellow-100' : ''}`}>
                        {row.date || 'N/A'}
                      </td>
                      <td className={`px-2 py-1 text-right ${row.rent === 0 ? 'bg-yellow-100' : ''}`}>
                        {row.rent}
                      </td>
                      <td className={`px-2 py-1 text-right ${row.oldReading === 0 ? 'bg-yellow-100' : ''}`}>
                        {row.oldReading}
                      </td>
                      <td className={`px-2 py-1 text-right ${row.currentReading === 0 ? 'bg-yellow-100' : ''}`}>
                        {row.currentReading}
                      </td>
                      <td className={`px-2 py-1 text-right font-semibold ${row.units < 0 ? 'bg-red-100' : ''}`}>
                        {row.units}
                      </td>
                      <td className={`px-2 py-1 text-right ${row.ratePerUnit === 0 ? 'bg-yellow-100' : ''}`}>
                        {row.ratePerUnit}
                      </td>
                      <td className="px-2 py-1 text-right font-semibold">
                        {row.electricity.toFixed(2)}
                      </td>
                      <td className="px-2 py-1 text-right font-bold">
                        {row.total.toFixed(2)}
                      </td>
                      <td className="px-2 py-1 text-right">
                        {row.paidAmount}
                      </td>
                      <td className={`px-2 py-1 text-right font-semibold ${
                        row.balanceType === 'due' ? 'text-red-600' :
                        row.balanceType === 'advance' ? 'text-green-600' :
                        'text-gray-600'
                      }`}>
                        {row.balance > 0 ? '+' : ''}{row.balance.toFixed(2)}
                      </td>
                      <td className="px-2 py-1 text-center">
                        <span className={`px-1 py-0.5 rounded text-xs font-semibold ${
                          row.balanceType === 'due' ? 'bg-red-100 text-red-700' :
                          row.balanceType === 'advance' ? 'bg-green-100 text-green-700' :
                          'bg-gray-100 text-gray-700'
                        }`}>
                          {row.balanceType}
                        </span>
                      </td>
                      <td className="px-2 py-1 text-xs max-w-[80px] truncate" title={row.debitCredit}>
                        {row.debitCredit || '-'}
                      </td>
                      <td className="px-2 py-1 text-xs max-w-[100px] truncate" title={row.remark}>
                        {row.remark || '-'}
                      </td>
                      <td className="px-2 py-1 text-center">
                        <span className={`px-2 py-0.5 rounded text-xs font-semibold ${
                          row.status === 'paid' ? 'bg-green-100 text-green-700' :
                          row.status === 'advance' ? 'bg-blue-100 text-blue-700' :
                          row.status === 'partial' ? 'bg-yellow-100 text-yellow-700' :
                          'bg-red-100 text-red-700'
                        }`}>
                          {row.status}
                        </span>
                      </td>
                      <td className="px-2 py-1">
                        {row.rowWarnings && row.rowWarnings.length > 0 && (
                          <span className="text-yellow-600" title={row.rowWarnings.join(', ')}>
                            ⚠️
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            
            <div className="mt-3 p-3 bg-gray-50 rounded text-xs">
              <strong>Legend:</strong>
              <span className="ml-3 inline-block bg-yellow-100 px-2 py-1 rounded">Yellow = Missing/Zero</span>
              <span className="ml-2 inline-block bg-red-100 px-2 py-1 rounded">Red = Invalid/Error</span>
            </div>
          </div>
        )}

        <button
          onClick={handleImport}
          disabled={!parsedData || parsedData.length === 0 || importing}
          className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {importing ? '⏳ Importing...' : `✅ Confirm & Import ${parsedData ? parsedData.length : 0} Records`}
        </button>
      </div>

      {/* Results */}
      {result && (
        <div className="card">
          <h3 className="text-xl font-bold text-gray-800 mb-4">Import Results</h3>
          
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
            <div className="bg-green-50 border border-green-200 rounded-lg p-4">
              <p className="text-sm text-green-600 mb-1">✅ Created</p>
              <p className="text-3xl font-bold text-green-700">{result.success}</p>
            </div>
            
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <p className="text-sm text-blue-600 mb-1">🔄 Updated</p>
              <p className="text-3xl font-bold text-blue-700">{result.updated}</p>
            </div>
            
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
              <p className="text-sm text-yellow-600 mb-1">⚠️ Warnings</p>
              <p className="text-3xl font-bold text-yellow-700">{result.warnings}</p>
            </div>
            
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <p className="text-sm text-red-600 mb-1">❌ Errors</p>
              <p className="text-3xl font-bold text-red-700">{result.errors}</p>
            </div>
          </div>

          {result.errorDetails && result.errorDetails.length > 0 && (
            <div className="mb-4">
              <h4 className="font-semibold text-gray-700 mb-2">❌ Error Details:</h4>
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 max-h-60 overflow-y-auto">
                <ul className="text-xs text-red-700 space-y-1">
                  {result.errorDetails.map((err, idx) => (
                    <li key={idx}>• {err}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          <div className="mt-4 flex gap-3">
            <button
              onClick={() => {
                setFile(null);
                setParsedData(null);
                setPreviewData(null);
                setResult(null);
                setError(null);
                setWarnings([]);
              }}
              className="btn-secondary"
            >
              Import Another File
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default ImportCSV;
