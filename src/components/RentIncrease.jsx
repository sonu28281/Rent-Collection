import { useState, useEffect } from 'react';
import { checkPendingIncreases, applyRentIncrease, applyBulkRentIncreases, getRecentRentIncreaseLogs } from '../utils/rentIncrease';
import { useDialog } from './ui/DialogProvider';

const RentIncrease = () => {
  const { showConfirm } = useDialog();
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
    const confirmed = await showConfirm(
      `Apply rent increase for ${tenantData.name}?\nCurrent: ₹${tenantData.currentRent} → New: ₹${Math.round(tenantData.currentRent * (1 + (tenantData.annualIncreasePercentage || 10) / 100))}`,
      { title: 'Confirm Rent Increase', confirmLabel: 'Apply Increase', intent: 'warning' }
    );
    if (!confirmed) {
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

    const confirmed = await showConfirm(`Apply rent increases for all ${pendingIncreases.length} eligible tenant(s)?`, {
      title: 'Confirm Bulk Rent Increase',
      confirmLabel: 'Apply All',
      intent: 'warning'
    });
    if (!confirmed) {
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
            <div className="rounded-2xl border border-gray-200 dark:border-slate-700 shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-200 dark:bg-slate-700 border-b-2 border-slate-300 dark:border-slate-600">
                    <tr>
                      <th className="px-3 py-2.5 text-left text-[11px] font-extrabold uppercase tracking-wider text-gray-700 dark:text-slate-200">Tenant</th>
                      <th className="px-3 py-2.5 text-left text-[11px] font-extrabold uppercase tracking-wider text-gray-700 dark:text-slate-200">Room</th>
                      <th className="px-3 py-2.5 text-right text-[11px] font-extrabold uppercase tracking-wider text-gray-700 dark:text-slate-200">Old Rent</th>
                      <th className="px-3 py-2.5 text-right text-[11px] font-extrabold uppercase tracking-wider text-gray-700 dark:text-slate-200">New Rent</th>
                      <th className="px-3 py-2.5 text-center text-[11px] font-extrabold uppercase tracking-wider text-gray-700 dark:text-slate-200">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
                    {result.results.map((item, idx) => (
                      <tr key={idx}>
                        <td className="px-3 py-2 font-medium text-gray-900 dark:text-slate-100">{item.tenantName}</td>
                        <td className="px-3 py-2 text-gray-600 dark:text-slate-300">{item.roomNumber}</td>
                        <td className="px-3 py-2 text-right text-gray-600 dark:text-slate-300">
                          {item.oldRent ? `₹${item.oldRent.toLocaleString('en-IN')}` : '-'}
                        </td>
                        <td className="px-3 py-2 text-right font-semibold text-gray-900 dark:text-slate-100">
                          {item.newRent ? `₹${item.newRent.toLocaleString('en-IN')}` : '-'}
                        </td>
                        <td className="px-3 py-2 text-center">
                          {item.status === 'success' ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-green-100 dark:bg-green-900/50 text-green-700 dark:text-green-300">✅ Success</span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 dark:bg-red-900/50 text-red-700 dark:text-red-300">❌ Failed</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
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
          <div className="rounded-2xl border border-gray-200 dark:border-slate-700 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-200 dark:bg-slate-700 border-b-2 border-slate-300 dark:border-slate-600">
                  <tr>
                    <th className="px-3 py-2.5 text-left text-[11px] font-extrabold uppercase tracking-wider text-gray-700 dark:text-slate-200">Tenant</th>
                    <th className="px-3 py-2.5 text-left text-[11px] font-extrabold uppercase tracking-wider text-gray-700 dark:text-slate-200">Room</th>
                    <th className="px-3 py-2.5 text-right text-[11px] font-extrabold uppercase tracking-wider text-gray-700 dark:text-slate-200">Current Rent</th>
                    <th className="px-3 py-2.5 text-right text-[11px] font-extrabold uppercase tracking-wider text-gray-700 dark:text-slate-200">New Rent</th>
                    <th className="px-3 py-2.5 text-center text-[11px] font-extrabold uppercase tracking-wider text-gray-700 dark:text-slate-200">Increase %</th>
                    <th className="px-3 py-2.5 text-center text-[11px] font-extrabold uppercase tracking-wider text-gray-700 dark:text-slate-200">Due Date</th>
                    <th className="px-3 py-2.5 text-center text-[11px] font-extrabold uppercase tracking-wider text-gray-700 dark:text-slate-200">Days Past</th>
                    <th className="px-3 py-2.5 text-center text-[11px] font-extrabold uppercase tracking-wider text-gray-700 dark:text-slate-200">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
                  {pendingIncreases.map((tenant) => {
                    const increasePercentage = tenant.annualIncreasePercentage || 10;
                    const newRent = Math.round(tenant.currentRent * (1 + increasePercentage / 100));

                    return (
                      <tr key={tenant.id} className="hover:bg-gray-50">
                        <td className="px-3 py-2 font-medium text-gray-900 dark:text-slate-100">{tenant.name}</td>
                        <td className="px-3 py-2 text-gray-600 dark:text-slate-300">{tenant.roomNumber}</td>
                        <td className="px-3 py-2 text-right text-gray-600 dark:text-slate-300">₹{tenant.currentRent.toLocaleString('en-IN')}</td>
                        <td className="px-3 py-2 text-right font-semibold text-green-600 dark:text-green-400">
                          ₹{newRent.toLocaleString('en-IN')}
                        </td>
                        <td className="px-3 py-2 text-center">
                          <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-xs font-bold bg-green-100 dark:bg-green-900/50 text-green-700 dark:text-green-300">
                            ▲ {increasePercentage}%
                          </span>
                        </td>
                        <td className="px-3 py-2 text-center text-gray-600 dark:text-slate-300">
                          {new Date(tenant.nextIncreaseDate).toLocaleDateString('en-IN')}
                        </td>
                        <td className="px-3 py-2 text-center">
                          <span className={tenant.daysPastDue > 30 ? 'text-red-600 dark:text-red-400 font-semibold' : 'text-gray-600 dark:text-slate-300'}>
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
