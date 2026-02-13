import { useState, useEffect } from 'react';
import { collection, query, orderBy, limit, getDocs } from 'firebase/firestore';
import { db } from '../firebase';

const ImportLogsPage = () => {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedLog, setSelectedLog] = useState(null);
  const [showDetails, setShowDetails] = useState(false);

  useEffect(() => {
    fetchImportLogs();
  }, []);

  const fetchImportLogs = async () => {
    setLoading(true);
    try {
      const logsQuery = query(
        collection(db, 'importLogs'),
        orderBy('timestamp', 'desc'),
        limit(50)
      );
      
      const snapshot = await getDocs(logsQuery);
      const logsData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      
      setLogs(logsData);
    } catch (error) {
      console.error('Error fetching import logs:', error);
      alert('Error loading import logs');
    } finally {
      setLoading(false);
    }
  };

  const viewDetails = (log) => {
    setSelectedLog(log);
    setShowDetails(true);
  };

  const closeDetails = () => {
    setShowDetails(false);
    setSelectedLog(null);
  };

  const downloadErrorsCSV = (log) => {
    if (!log.errors || log.errors.length === 0) {
      alert('No errors to download');
      return;
    }

    // Create CSV content
    const headers = ['Row', 'Error Message'];
    const rows = log.errors.map(err => [err, '']);
    
    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.join(','))
    ].join('\n');

    // Download
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `import_errors_${log.id}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  };

  const formatDate = (timestamp) => {
    if (!timestamp) return 'N/A';
    try {
      const date = new Date(timestamp);
      return date.toLocaleString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return timestamp;
    }
  };

  const getLogType = (log) => {
    if (log.type === 'backup_and_reset') return 'Backup & Reset';
    if (log.fileName) return 'CSV Import';
    return 'Unknown';
  };

  return (
    <div className="p-4 lg:p-8">
      {/* Header */}
      <div className="mb-6">
        <h2 className="text-3xl font-bold text-gray-900 mb-2">📋 Import Logs</h2>
        <p className="text-gray-600">View history of all import operations and backups</p>
      </div>

      {/* Refresh Button */}
      <div className="mb-4">
        <button
          onClick={fetchImportLogs}
          disabled={loading}
          className="btn-primary"
        >
          {loading ? '⏳ Loading...' : '🔄 Refresh Logs'}
        </button>
      </div>

      {/* Logs Table */}
      <div className="card">
        {loading ? (
          <div className="text-center py-8 text-gray-500">
            <div className="animate-spin text-4xl mb-2">⏳</div>
            Loading import logs...
          </div>
        ) : logs.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            No import logs found. Logs will appear here after you import CSV files or run backup operations.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-100">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold">Date & Time</th>
                  <th className="px-4 py-3 text-left font-semibold">Type</th>
                  <th className="px-4 py-3 text-left font-semibold">File Name</th>
                  <th className="px-4 py-3 text-center font-semibold">Total</th>
                  <th className="px-4 py-3 text-center font-semibold">Success</th>
                  <th className="px-4 py-3 text-center font-semibold">Updated</th>
                  <th className="px-4 py-3 text-center font-semibold">Errors</th>
                  <th className="px-4 py-3 text-center font-semibold">Warnings</th>
                  <th className="px-4 py-3 text-center font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id} className="border-b hover:bg-gray-50">
                    <td className="px-4 py-3">{formatDate(log.timestamp)}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-1 rounded text-xs font-semibold ${
                        log.type === 'backup_and_reset' ? 'bg-purple-100 text-purple-700' :
                        'bg-blue-100 text-blue-700'
                      }`}>
                        {getLogType(log)}
                      </span>
                    </td>
                    <td className="px-4 py-3 max-w-xs truncate" title={log.fileName}>
                      {log.fileName || log.backupCollectionName || '-'}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {log.totalRows || log.originalCount || '-'}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="text-green-600 font-semibold">
                        {log.successCount || log.backedUpCount || 0}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="text-blue-600 font-semibold">
                        {log.updatedCount || 0}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`font-semibold ${
                        (log.errorCount || 0) > 0 ? 'text-red-600' : 'text-gray-400'
                      }`}>
                        {log.errorCount || 0}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`font-semibold ${
                        (log.warningCount || 0) > 0 ? 'text-yellow-600' : 'text-gray-400'
                      }`}>
                        {log.warningCount || 0}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex gap-2 justify-center">
                        <button
                          onClick={() => viewDetails(log)}
                          className="text-xs text-blue-600 hover:underline"
                        >
                          📄 Details
                        </button>
                        {log.errors && log.errors.length > 0 && (
                          <button
                            onClick={() => downloadErrorsCSV(log)}
                            className="text-xs text-red-600 hover:underline"
                          >
                            ⬇️ Errors
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Details Modal */}
      {showDetails && selectedLog && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
              <h3 className="text-xl font-bold text-gray-900">Import Log Details</h3>
              <button
                onClick={closeDetails}
                className="text-gray-400 hover:text-gray-600 text-2xl"
              >
                ×
              </button>
            </div>

            {/* Modal Body */}
            <div className="px-6 py-4 overflow-y-auto flex-1">
              {/* Summary */}
              <div className="mb-6">
                <h4 className="font-semibold text-gray-800 mb-3">Summary</h4>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="bg-gray-50 p-3 rounded">
                    <p className="text-xs text-gray-600">Type</p>
                    <p className="text-sm font-semibold">{getLogType(selectedLog)}</p>
                  </div>
                  <div className="bg-gray-50 p-3 rounded">
                    <p className="text-xs text-gray-600">Date</p>
                    <p className="text-sm font-semibold">{formatDate(selectedLog.timestamp)}</p>
                  </div>
                  <div className="bg-gray-50 p-3 rounded">
                    <p className="text-xs text-gray-600">Total Rows</p>
                    <p className="text-sm font-semibold">
                      {selectedLog.totalRows || selectedLog.originalCount || '-'}
                    </p>
                  </div>
                  <div className="bg-gray-50 p-3 rounded">
                    <p className="text-xs text-gray-600">Status</p>
                    <p className="text-sm font-semibold">
                      {selectedLog.status || (selectedLog.verificationPassed ? 'Success' : 'Unknown')}
                    </p>
                  </div>
                </div>
              </div>

              {/* File Info */}
              {selectedLog.fileName && (
                <div className="mb-6">
                  <h4 className="font-semibold text-gray-800 mb-2">File Information</h4>
                  <div className="bg-gray-50 p-3 rounded">
                    <p className="text-sm"><strong>File Name:</strong> {selectedLog.fileName}</p>
                  </div>
                </div>
              )}

              {/* Counts */}
              <div className="mb-6">
                <h4 className="font-semibold text-gray-800 mb-3">Counts</h4>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="bg-green-50 p-3 rounded border border-green-200">
                    <p className="text-xs text-green-600">✅ Created</p>
                    <p className="text-2xl font-bold text-green-700">
                      {selectedLog.successCount || selectedLog.backedUpCount || 0}
                    </p>
                  </div>
                  <div className="bg-blue-50 p-3 rounded border border-blue-200">
                    <p className="text-xs text-blue-600">🔄 Updated</p>
                    <p className="text-2xl font-bold text-blue-700">
                      {selectedLog.updatedCount || 0}
                    </p>
                  </div>
                  <div className="bg-yellow-50 p-3 rounded border border-yellow-200">
                    <p className="text-xs text-yellow-600">⚠️ Warnings</p>
                    <p className="text-2xl font-bold text-yellow-700">
                      {selectedLog.warningCount || 0}
                    </p>
                  </div>
                  <div className="bg-red-50 p-3 rounded border border-red-200">
                    <p className="text-xs text-red-600">❌ Errors</p>
                    <p className="text-2xl font-bold text-red-700">
                      {selectedLog.errorCount || 0}
                    </p>
                  </div>
                </div>
              </div>

              {/* Warnings */}
              {selectedLog.warnings && selectedLog.warnings.length > 0 && (
                <div className="mb-6">
                  <h4 className="font-semibold text-gray-800 mb-2">
                    ⚠️ Warnings ({selectedLog.warnings.length})
                  </h4>
                  <div className="bg-yellow-50 border border-yellow-200 rounded p-3 max-h-60 overflow-y-auto">
                    <ul className="text-xs text-yellow-800 space-y-1">
                      {selectedLog.warnings.map((warning, idx) => (
                        <li key={idx}>• {warning}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}

              {/* Errors */}
              {selectedLog.errors && selectedLog.errors.length > 0 && (
                <div className="mb-6">
                  <h4 className="font-semibold text-gray-800 mb-2 flex justify-between items-center">
                    <span>❌ Errors ({selectedLog.errors.length})</span>
                    <button
                      onClick={() => downloadErrorsCSV(selectedLog)}
                      className="text-xs text-red-600 hover:underline"
                    >
                      ⬇️ Download Errors
                    </button>
                  </h4>
                  <div className="bg-red-50 border border-red-200 rounded p-3 max-h-60 overflow-y-auto">
                    <ul className="text-xs text-red-800 space-y-1">
                      {selectedLog.errors.map((error, idx) => (
                        <li key={idx}>• {error}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}

              {/* Backup Info */}
              {selectedLog.backupCollectionName && (
                <div className="mb-6">
                  <h4 className="font-semibold text-gray-800 mb-2">Backup Information</h4>
                  <div className="bg-purple-50 border border-purple-200 rounded p-3">
                    <p className="text-sm mb-2">
                      <strong>Backup Collection:</strong> {selectedLog.backupCollectionName}
                    </p>
                    {selectedLog.verificationPassed !== undefined && (
                      <p className="text-sm">
                        <strong>Verification:</strong>{' '}
                        <span className={selectedLog.verificationPassed ? 'text-green-600' : 'text-red-600'}>
                          {selectedLog.verificationPassed ? '✅ Passed' : '❌ Failed'}
                        </span>
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-4 border-t border-gray-200 flex justify-end">
              <button
                onClick={closeDetails}
                className="btn-secondary"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ImportLogsPage;
