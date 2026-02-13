import { useState, useEffect } from 'react';
import { checkPendingIncreases, applyRentIncrease, applyBulkRentIncreases, getRecentRentIncreaseLogs } from '../utils/rentIncrease';

const RentIncrease = () => {
  const [pendingIncreases, setPendingIncreases] = useState([]);
  const [recentLogs, setRecentLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      setLoading(true);
      setError(null);

      const [pending, logs] = await Promise.all([
        checkPendingIncreases(),
        getRecentRentIncreaseLogs(20)
      ]);

      setPendingIncreases(pending);
      setRecentLogs(logs);
      setLoading(false);
    } catch (err) {
      console.error('Error fetching data:', err);
      setError('Failed to load rent increase data. Please try again.');
      setLoading(false);
    }
  };

  const handleApplySingle = async (tenantId, tenantData) => {
    if (!confirm(`Apply rent increase for ${tenantData.name}?\nCurrent: ₹${tenantData.currentRent} → New: ₹${Math.round(tenantData.currentRent * (1 + (tenantData.annualIncreasePercentage || 10) / 100))}`)) {
      return;
    }

    try {
      setProcessing(true);
      setError(null);

      await applyRentIncrease(tenantId, tenantData);
      
      alert(`✅ Rent increased successfully for ${tenantData.name}!`);
      await fetchData(); // Refresh data
      setProcessing(false);
    } catch (err) {
      console.error('Error applying rent increase:', err);
      setError(`Failed to apply rent increase for ${tenantData.name}. Please try again.`);
      setProcessing(false);
    }
  };

  const handleApplyAll = async () => {
    if (pendingIncreases.length === 0) {
      alert('No pending rent increases to apply.');
      return;
    }

    if (!confirm(`Apply rent increases for all ${pendingIncreases.length} eligible tenant(s)?`)) {
      return;
    }

    try {
      setProcessing(true);
      setError(null);
      setResult(null);

      const summary = await applyBulkRentIncreases();
      setResult(summary);
      
      await fetchData(); // Refresh data
      setProcessing(false);
    } catch (err) {
      console.error('Error applying bulk increases:', err);
      setError('Failed to apply rent increases. Please try again.');
      setProcessing(false);
    }
  };

  if (loading) {
    return (
      <div className="p-4 lg:p-8">
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
            <p className="text-gray-600">Loading rent increase data...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-8">
      {/* Header */}
      <div className="mb-6">
        <h2 className="text-3xl font-bold text-gray-900 mb-2">📈 Annual Rent Increase</h2>
        <p className="text-gray-600">Manage automatic rent increases for active tenants</p>
      </div>

      {error && (
        <div className="card bg-red-50 border border-red-200 mb-6">
          <p className="text-red-700">{error}</p>
        </div>
      )}

      {/* Bulk Apply Result */}
      {result && (
        <div className="card mb-6">
          <h3 className="text-xl font-bold text-gray-800 mb-4">Bulk Apply Results</h3>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            <div className="bg-green-50 border border-green-200 rounded-lg p-4">
              <p className="text-sm text-green-600 mb-1">Successfully Applied</p>
              <p className="text-3xl font-bold text-green-700">{result.success}</p>
            </div>
            
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <p className="text-sm text-red-600 mb-1">Failed</p>
              <p className="text-3xl font-bold text-red-700">{result.failed}</p>
            </div>
            
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <p className="text-sm text-blue-600 mb-1">Total Processed</p>
              <p className="text-3xl font-bold text-blue-700">{result.total}</p>
            </div>
          </div>

          {result.results && result.results.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-100">
                  <tr>
                    <th className="px-3 py-2 text-left">Tenant</th>
                    <th className="px-3 py-2 text-left">Room</th>
                    <th className="px-3 py-2 text-right">Old Rent</th>
                    <th className="px-3 py-2 text-right">New Rent</th>
                    <th className="px-3 py-2 text-center">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {result.results.map((item, idx) => (
                    <tr key={idx} className="border-b">
                      <td className="px-3 py-2">{item.tenantName}</td>
                      <td className="px-3 py-2">{item.roomNumber}</td>
                      <td className="px-3 py-2 text-right">
                        {item.oldRent ? `₹${item.oldRent}` : '-'}
                      </td>
                      <td className="px-3 py-2 text-right font-semibold">
                        {item.newRent ? `₹${item.newRent}` : '-'}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {item.status === 'success' ? (
                          <span className="text-green-600">✅</span>
                        ) : (
                          <span className="text-red-600">❌</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <button
            onClick={() => setResult(null)}
            className="btn-secondary mt-4"
          >
            Close
          </button>
        </div>
      )}

      {/* Pending Increases */}
      <div className="card mb-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xl font-bold text-gray-800">
            Pending Rent Increases ({pendingIncreases.length})
          </h3>
          {pendingIncreases.length > 0 && (
            <button
              onClick={handleApplyAll}
              disabled={processing}
              className="btn-primary"
            >
              {processing ? '⏳ Processing...' : '📈 Apply All Increases'}
            </button>
          )}
        </div>

        {pendingIncreases.length === 0 ? (
          <div className="text-center py-8">
            <div className="text-5xl mb-3">✅</div>
            <p className="text-gray-600">No pending rent increases</p>
            <p className="text-sm text-gray-500 mt-2">All active tenants are up to date</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-100">
                <tr>
                  <th className="px-3 py-2 text-left">Tenant</th>
                  <th className="px-3 py-2 text-left">Room</th>
                  <th className="px-3 py-2 text-right">Current Rent</th>
                  <th className="px-3 py-2 text-right">New Rent</th>
                  <th className="px-3 py-2 text-center">Increase %</th>
                  <th className="px-3 py-2 text-center">Due Date</th>
                  <th className="px-3 py-2 text-center">Days Past</th>
                  <th className="px-3 py-2 text-center">Action</th>
                </tr>
              </thead>
              <tbody>
                {pendingIncreases.map((tenant) => {
                  const increasePercentage = tenant.annualIncreasePercentage || 10;
                  const newRent = Math.round(tenant.currentRent * (1 + increasePercentage / 100));
                  
                  return (
                    <tr key={tenant.id} className="border-b hover:bg-gray-50">
                      <td className="px-3 py-2">{tenant.name}</td>
                      <td className="px-3 py-2">{tenant.roomNumber}</td>
                      <td className="px-3 py-2 text-right">₹{tenant.currentRent}</td>
                      <td className="px-3 py-2 text-right font-semibold text-green-600">
                        ₹{newRent}
                      </td>
                      <td className="px-3 py-2 text-center">{increasePercentage}%</td>
                      <td className="px-3 py-2 text-center">
                        {new Date(tenant.nextIncreaseDate).toLocaleDateString('en-IN')}
                      </td>
                      <td className="px-3 py-2 text-center">
                        <span className={tenant.daysPastDue > 30 ? 'text-red-600 font-semibold' : 'text-gray-600'}>
                          {tenant.daysPastDue}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-center">
                        <button
                          onClick={() => handleApplySingle(tenant.id, tenant)}
                          disabled={processing}
                          className="text-primary hover:text-secondary font-semibold text-xs"
                        >
                          Apply
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Recent Rent Increase History */}
      <div className="card">
        <h3 className="text-xl font-bold text-gray-800 mb-4">📜 Recent Rent Increase History</h3>

        {recentLogs.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-gray-600">No rent increase history yet</p>
          </div>
        ) : (
          <div className="space-y-3">
            {recentLogs.map((log) => (
              <div key={log.id} className="border border-gray-200 rounded-lg p-4 hover:shadow transition">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <h4 className="font-bold text-gray-800">{log.payload.tenantName}</h4>
                    <p className="text-sm text-gray-600">Room {log.payload.roomNumber}</p>
                  </div>
                  <span className={`text-xs px-2 py-1 rounded ${
                    log.status === 'success' 
                      ? 'bg-green-100 text-green-700' 
                      : 'bg-red-100 text-red-700'
                  }`}>
                    {log.status}
                  </span>
                </div>
                
                {log.status === 'success' ? (
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <p className="text-gray-500">Old Rent:</p>
                      <p className="font-semibold">₹{log.payload.oldRent}</p>
                    </div>
                    <div>
                      <p className="text-gray-500">New Rent:</p>
                      <p className="font-semibold text-green-600">₹{log.payload.newRent}</p>
                    </div>
                    <div>
                      <p className="text-gray-500">Increase:</p>
                      <p className="font-semibold">{log.payload.increasePercentage}%</p>
                    </div>
                    <div>
                      <p className="text-gray-500">Next Increase:</p>
                      <p className="font-semibold">
                        {new Date(log.payload.nextIncreaseDate).toLocaleDateString('en-IN')}
                      </p>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-red-600">{log.payload.error}</p>
                )}
                
                <p className="text-xs text-gray-400 mt-2">
                  {new Date(log.timestamp).toLocaleString('en-IN')}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default RentIncrease;
