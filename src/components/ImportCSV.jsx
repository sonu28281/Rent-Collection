import { useState } from 'react';
import Papa from 'papaparse';
import { collection, doc, setDoc, getDocs, query, where, updateDoc } from 'firebase/firestore';
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
          let updatedCount = 0;
          let errorCount = 0;
          const errors = [];

          // Validate required columns for meter-based system
          const requiredColumns = ['roomNumber', 'tenantName', 'year', 'month', 'rent', 'oldReading', 'currentReading', 'ratePerUnit', 'paidAmount'];
          const headers = Object.keys(data[0]);
          const missingColumns = requiredColumns.filter(col => !headers.includes(col));
          
          if (missingColumns.length > 0) {
            setError(`Missing required columns: ${missingColumns.join(', ')}`);
            setImporting(false);
            return;
          }

          // Import records
          for (let i = 0; i < data.length; i++) {
            try {
              const row = data[i];
              
              // Store tenant name as plain text snapshot from CSV (NEVER validated)
              const tenantNameSnapshot = row.tenantName.trim();
              const roomNumber = Number(row.roomNumber);
              
              // Auto-detect floor based on room number
              const floor = roomNumber < 200 ? 1 : 2;

              // Convert to numbers
              const year = Number(row.year);
              const month = Number(row.month);
              const rent = Number(row.rent) || 0;
              
              // Meter readings
              const oldReading = Number(row.oldReading) || 0;
              const currentReading = Number(row.currentReading) || 0;
              const ratePerUnit = Number(row.ratePerUnit) || 0;
              
              // Calculate units (defensive check for negative)
              let units = currentReading - oldReading;
              if (units < 0) {
                errors.push(`Row ${i + 1}: WARNING - Negative units detected (${units}). Setting to 0.`);
                units = 0;
              }
              
              // Calculate electricity
              const electricity = units * ratePerUnit;
              
              // Calculate total
              const total = rent + electricity;
              
              // Get paid amount
              const paidAmount = Number(row.paidAmount) || 0;
              
              // Determine status based on paidAmount vs total
              let status = 'pending';
              if (paidAmount >= total) {
                status = 'paid';
              } else if (paidAmount > 0) {
                status = 'partial';
              }

              // Create payment ID: roomNumber_year_month (room-based)
              const paymentId = `${roomNumber}_${year}_${month}`;
              
              // Check for duplicates based on roomNumber + year + month
              const existingDoc = await getDocs(
                query(
                  collection(db, 'payments'),
                  where('roomNumber', '==', roomNumber),
                  where('year', '==', year),
                  where('month', '==', month)
                )
              );
              
              // Prepare payment data according to meter-based schema
              const paymentData = {
                roomNumber,
                floor,
                tenantNameSnapshot, // Plain text from CSV - never validated
                year,
                month,
                rent,
                oldReading,
                currentReading,
                units,
                ratePerUnit,
                electricity,
                total,
                paidAmount,
                status,
                paymentDate: row.paymentDate ? new Date(row.paymentDate).toISOString() : null,
                paymentMode: row.paymentMode || 'cash',
                updatedAt: new Date().toISOString()
              };
              
              if (!existingDoc.empty) {
                // UPDATE existing record instead of rejecting
                const existingDocId = existingDoc.docs[0].id;
                await updateDoc(doc(db, 'payments', existingDocId), paymentData);
                updatedCount++;
              } else {
                // CREATE new record
                paymentData.createdAt = new Date().toISOString();
                paymentData.importedAt = new Date().toISOString();
                await setDoc(doc(db, 'payments', paymentId), paymentData);
                successCount++;
              }
            } catch (err) {
              errors.push(`Row ${i + 1}: ${err.message}`);
              errorCount++;
            }
          }

          // Create import log
          const logData = {
            fileName: file.name,
            rowsImported: successCount,
            rowsUpdated: updatedCount,
            rowsFailed: errorCount,
            errors: errors.slice(0, 100), // Store first 100 errors
            importedAt: new Date().toISOString()
          };
          
          await setDoc(doc(db, 'importLogs', `import_${Date.now()}`), logData);

          setResult({
            success: successCount,
            updated: updatedCount,
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
              const paymentId = `${roomNumber}_${year}_${month}`;
              
              // Check for duplicates based on roomNumber + year + month
              const existingDoc = await getDocs(
                query(
                  collection(db, 'payments'),
                  where('roomNumber', '==', roomNumber),
                  where('year', '==', year),
                  where('month', '==', month)
                )
              );
              
              if (!existingDoc.empty) {
                errors.push(`Row ${i + 1}: Payment already exists for Room ${roomNumber} - ${month}/${year}`);
                errorCount++;
                continue;
              }

              // Prepare payment data according to room-based schema
              const paymentData = {
                roomNumber,
                tenantNameSnapshot, // Plain text from CSV - never validated
                rent,
                electricity,
                totalAmount,
                paidAmount,
                month,
                year,
                paymentDate: row.paymentDate ? new Date(row.paymentDate).toISOString() : null,
                paymentMode: row.paymentMode || 'cash',
                status,
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
        <h2 className="text-3xl font-bold text-gray-900 mb-2">📥 Import Historical Payment Data</h2>
        <p className="text-gray-600">Import monthly records with complete meter-based electricity calculation</p>
      </div>

      {/* Instructions */}
      <div className="card mb-6 bg-blue-50 border border-blue-200">
        <h3 className="font-semibold text-blue-900 mb-3">📋 CSV Format Requirements (METER-BASED SYSTEM):</h3>
        <div className="text-sm text-blue-800 space-y-2">
          <div className="mb-3">
            <strong className="text-blue-900">Required Columns:</strong>
            <ul className="ml-4 mt-1 space-y-1">
              <li>• <strong>roomNumber</strong> - Room number (e.g., 101, 201) - stored as number</li>
              <li>• <strong>tenantName</strong> - Tenant name (plain text, NOT validated)</li>
              <li>• <strong>year</strong> - Year (YYYY format, e.g., 2024) - stored as number</li>
              <li>• <strong>month</strong> - Month (1-12) - stored as number</li>
              <li>• <strong>rent</strong> - Monthly rent amount</li>
              <li>• <strong>oldReading</strong> - Previous meter reading</li>
              <li>• <strong>currentReading</strong> - Current meter reading</li>
              <li>• <strong>ratePerUnit</strong> - Electricity rate per unit (e.g., 8.5)</li>
              <li>• <strong>paidAmount</strong> - Amount paid by tenant</li>
            </ul>
          </div>
          
          <div className="mb-3">
            <strong className="text-blue-900">Optional Columns:</strong>
            <ul className="ml-4 mt-1 space-y-1">
              <li>• <strong>paymentDate</strong> - Date of payment (ISO format)</li>
              <li>• <strong>paymentMode</strong> - cash, upi, bank (default: cash)</li>
            </ul>
          </div>
          
          <div className="bg-blue-100 border border-blue-300 rounded p-3 mt-3">
            <strong className="text-blue-900">🔧 Auto-Calculations:</strong>
            <ul className="ml-4 mt-1 space-y-1">
              <li>• <strong>floor</strong> = roomNumber &lt; 200 ? 1 : 2</li>
              <li>• <strong>units</strong> = currentReading - oldReading</li>
              <li>• <strong>electricity</strong> = units × ratePerUnit</li>
              <li>• <strong>total</strong> = rent + electricity</li>
              <li>• <strong>status</strong> = auto-determined from paidAmount vs total</li>
            </ul>
          </div>
          
          <div className="mt-3">
            <strong className="text-blue-900">⚠️ Important Notes:</strong>
            <ul className="ml-4 mt-1 space-y-1">
              <li>• Tenant names stored as snapshots - NOT validated against tenants collection</li>
              <li>• Duplicate prevention: roomNumber + year + month</li>
              <li>• If duplicate exists, record will be UPDATED instead of rejected</li>
              <li>• Negative units automatically set to 0 with warning</li>
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
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            <div className="bg-green-50 border border-green-200 rounded-lg p-4">
              <p className="text-sm text-green-600 mb-1">Successfully Created</p>
              <p className="text-3xl font-bold text-green-700">{result.success}</p>
            </div>
            
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <p className="text-sm text-blue-600 mb-1">Updated Existing</p>
              <p className="text-3xl font-bold text-blue-700">{result.updated}</p>
            </div>
            
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <p className="text-sm text-red-600 mb-1">Errors/Warnings</p>
              <p className="text-3xl font-bold text-red-700">{result.errors}</p>
            </div>
          </div>

          {result.errorDetails && result.errorDetails.length > 0 && (
            <div>
              <h4 className="font-semibold text-gray-700 mb-2">Error/Warning Details:</h4>
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
