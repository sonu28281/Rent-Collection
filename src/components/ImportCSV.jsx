import { useState } from 'react';
import Papa from 'papaparse';
import { collection, doc, setDoc, getDocs, query, where } from 'firebase/firestore';
import { db } from '../firebase';

const ImportCSV = () => {
  const [file, setFile] = useState(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [preview, setPreview] = useState(null);

  const handleFileChange = (e) => {
    const selectedFile = e.target.files[0];
    if (selectedFile && selectedFile.type === 'text/csv') {
      setFile(selectedFile);
      setError(null);
      
      // Preview first 5 rows
      Papa.parse(selectedFile, {
        header: true,
        preview: 5,
        complete: (results) => {
          setPreview(results.data);
        }
      });
    } else {
      setError('Please select a valid CSV file');
      setFile(null);
      setPreview(null);
    }
  };

  const handleImport = async () => {
    if (!file) {
      setError('Please select a file first');
      return;
    }

    setImporting(true);
    setError(null);
    setResult(null);

    try {
      // Parse CSV
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: async (results) => {
          const data = results.data;
          
          if (data.length === 0) {
            setError('CSV file is empty');
            setImporting(false);
            return;
          }

          let successCount = 0;
          let errorCount = 0;
          const errors = [];

          // Validate required columns
          const requiredColumns = ['tenantName', 'roomNumber', 'year', 'month', 'rent'];
          const headers = Object.keys(data[0]);
          const missingColumns = requiredColumns.filter(col => !headers.includes(col));
          
          if (missingColumns.length > 0) {
            setError(`Missing required columns: ${missingColumns.join(', ')}`);
            setImporting(false);
            return;
          }

          // Get existing tenants to map names to IDs
          const tenantsRef = collection(db, 'tenants');
          const tenantsSnapshot = await getDocs(tenantsRef);
          const tenantMap = {};
          tenantsSnapshot.forEach((doc) => {
            const data = doc.data();
            tenantMap[data.name.toLowerCase()] = doc.id;
          });

          // Import records
          for (let i = 0; i < data.length; i++) {
            try {
              const row = data[i];
              
              // Find tenant ID and name
              const tenantName = row.tenantName.trim();
              const tenantId = tenantMap[tenantName.toLowerCase()];
              
              if (!tenantId) {
                errors.push(`Row ${i + 1}: Tenant "${tenantName}" not found`);
                errorCount++;
                continue;
              }

              // Convert to numbers
              const year = Number(row.year);
              const month = Number(row.month);
              const rentAmount = Number(row.rent) || 0;
              const electricityAmount = Number(row.electricity) || 0;
              const totalAmount = rentAmount + electricityAmount;

              // Create payment ID: tenantId_year_month
              const paymentId = `${tenantId}_${year}_${month}`;
              
              // Check for duplicates in payments collection
              const existingDoc = await getDocs(
                query(
                  collection(db, 'payments'),
                  where('tenantId', '==', tenantId),
                  where('year', '==', year),
                  where('month', '==', month)
                )
              );
              
              if (!existingDoc.empty) {
                errors.push(`Row ${i + 1}: Payment already exists for ${tenantName} - ${month}/${year}`);
                errorCount++;
                continue;
              }

              // Prepare payment data according to required schema
              const paymentData = {
                tenantId,
                tenantName,
                roomNumber: row.roomNumber.toString(),
                rentAmount,
                electricityAmount,
                totalAmount,
                month,
                year,
                paymentDate: row.paymentDate ? new Date(row.paymentDate).toISOString() : new Date().toISOString(),
                paymentMode: row.paymentMode || 'cash',
                status: row.status || 'paid',
                createdAt: new Date().toISOString(),
                importedAt: new Date().toISOString()
              };

              await setDoc(doc(db, 'payments', paymentId), paymentData);
              successCount++;
            } catch (err) {
              errors.push(`Row ${i + 1}: ${err.message}`);
              errorCount++;
            }
          }

          // Create import log
          const logData = {
            fileName: file.name,
            rowsImported: successCount,
            rowsFailed: errorCount,
            errors: errors.slice(0, 100), // Store first 100 errors
            importedAt: new Date().toISOString()
          };
          
          await setDoc(doc(db, 'importLogs', `import_${Date.now()}`), logData);

          setResult({
            success: successCount,
            errors: errorCount,
            errorDetails: errors
          });
          
          setImporting(false);
        },
        error: (err) => {
          setError(`CSV parsing error: ${err.message}`);
          setImporting(false);
        }
      });
    } catch (err) {
      console.error('Import error:', err);
      setError(`Import failed: ${err.message}`);
      setImporting(false);
    }
  };

  return (
    <div className="p-4 lg:p-8">
      {/* Header */}
      <div className="mb-6">
        <h2 className="text-3xl font-bold text-gray-900 mb-2">📥 Import Historical Data</h2>
        <p className="text-gray-600">Import monthly records from CSV file</p>
      </div>

      {/* Instructions */}
      <div className="card mb-6 bg-blue-50 border border-blue-200">
        <h3 className="font-semibold text-blue-900 mb-2">📋 CSV Format Requirements:</h3>
        <ul className="text-sm text-blue-800 space-y-1">
          <li>• <strong>Required columns:</strong> tenantName, roomNumber, year, month, rent</li>
          <li>• <strong>Optional columns:</strong> electricity, paymentDate, paymentMode, status</li>
          <li>• Tenant names must match exactly with existing tenants in the system</li>
          <li>• Year format: YYYY (e.g., 2024) - <strong>stored as number</strong></li>
          <li>• Month format: 1-12 (January = 1, December = 12) - <strong>stored as number</strong></li>
          <li>• rent and electricity: numeric values - <strong>stored as numbers</strong></li>
          <li>• Duplicate records will be skipped</li>
          <li>• Data will be imported into <strong>payments</strong> collection</li>
        </ul>
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
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        {/* Preview */}
        {preview && preview.length > 0 && (
          <div className="mb-4">
            <h4 className="font-semibold text-gray-700 mb-2">Preview (first 5 rows):</h4>
            <div className="overflow-x-auto">
              <table className="w-full text-xs border border-gray-200">
                <thead className="bg-gray-100">
                  <tr>
                    {Object.keys(preview[0]).map((header) => (
                      <th key={header} className="px-2 py-1 text-left font-semibold border-b">
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.map((row, idx) => (
                    <tr key={idx} className="border-b">
                      {Object.values(row).map((value, vidx) => (
                        <td key={vidx} className="px-2 py-1">{value}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <button
          onClick={handleImport}
          disabled={!file || importing}
          className="btn-primary"
        >
          {importing ? '⏳ Importing...' : '📥 Import Data'}
        </button>
      </div>

      {/* Results */}
      {result && (
        <div className="card">
          <h3 className="text-xl font-bold text-gray-800 mb-4">Import Results</h3>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div className="bg-green-50 border border-green-200 rounded-lg p-4">
              <p className="text-sm text-green-600 mb-1">Successfully Imported</p>
              <p className="text-3xl font-bold text-green-700">{result.success}</p>
            </div>
            
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <p className="text-sm text-red-600 mb-1">Errors/Skipped</p>
              <p className="text-3xl font-bold text-red-700">{result.errors}</p>
            </div>
          </div>

          {result.errorDetails && result.errorDetails.length > 0 && (
            <div>
              <h4 className="font-semibold text-gray-700 mb-2">Error Details:</h4>
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
                setPreview(null);
                setResult(null);
                setError(null);
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
