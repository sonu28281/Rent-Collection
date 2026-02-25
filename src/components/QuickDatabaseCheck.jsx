import { useState } from 'react';
import { collection, getDocs, query, limit } from 'firebase/firestore';
import { db } from '../firebase';

/**
 * Quick Database Check
 * Ultra-simple diagnostic to see what's actually in the database
 */
const QuickDatabaseCheck = () => {
  const [checking, setChecking] = useState(false);
  const [results, setResults] = useState(null);

  const checkDatabase = async () => {
    setChecking(true);
    setResults(null);

    try {
      const report = {
        tenants: [],
        rooms: [],
        totalTenants: 0,
        tenantsWithToken: 0,
        activeTenants: 0,
        totalRooms: 0,
        timestamp: new Date().toLocaleTimeString()
      };

      // Check tenants collection
      const tenantsRef = collection(db, 'tenants');
      const tenantsSnapshot = await getDocs(tenantsRef);
      
      report.totalTenants = tenantsSnapshot.size;
      
      tenantsSnapshot.forEach(doc => {
        const data = doc.data();
        report.tenants.push({
          id: doc.id,
          roomNumber: data.roomNumber,
          name: data.name,
          hasToken: !!data.uniqueToken,
          tokenPreview: data.uniqueToken ? data.uniqueToken.substring(0, 20) + '...' : 'NONE',
          fullToken: data.uniqueToken || 'NONE',
          isActive: data.isActive,
          phone: data.phone
        });
        
        if (data.uniqueToken) report.tenantsWithToken++;
        if (data.isActive) report.activeTenants++;
      });

      // Sort by room number
      report.tenants.sort((a, b) => {
        const roomA = Number(a.roomNumber) || 0;
        const roomB = Number(b.roomNumber) || 0;
        return roomA - roomB;
      });

      // Check rooms collection
      const roomsRef = collection(db, 'rooms');
      const roomsSnapshot = await getDocs(roomsRef);
      
      report.totalRooms = roomsSnapshot.size;
      
      roomsSnapshot.forEach(doc => {
        const data = doc.data();
        report.rooms.push({
          id: doc.id,
          roomNumber: data.roomNumber,
          status: data.status
        });
      });

      setResults(report);
    } catch (err) {
      console.error('Database check error:', err);
      setResults({ error: err.message });
    } finally {
      setChecking(false);
    }
  };

  const generatePortalLink = (token) => {
    return `${window.location.origin}/t/${token}`;
  };

  const copyToken = (token) => {
    const link = generatePortalLink(token);
    navigator.clipboard.writeText(link)
      .then(() => alert('✅ Link copied to clipboard!'))
      .catch(() => prompt('Copy this link:', link));
  };

  const testPortal = (token) => {
    const link = generatePortalLink(token);
    window.open(link, '_blank');
  };

  return (
    <div className="min-h-screen bg-gray-100 p-4">
      <div className="max-w-6xl mx-auto">
        <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
          <h1 className="text-3xl font-bold mb-2">🔍 Quick Database Check</h1>
          <p className="text-gray-600 mb-4">
            Raw database inspection - see exactly what's stored
          </p>

          {!results && (
            <button
              onClick={checkDatabase}
              disabled={checking}
              className="w-full bg-blue-500 hover:bg-blue-600 text-white font-bold py-3 px-6 rounded-lg disabled:bg-gray-400"
            >
              {checking ? '⏳ Checking Database...' : '🔍 Check Database Now'}
            </button>
          )}
        </div>

        {results && results.error && (
          <div className="bg-red-100 border-2 border-red-300 rounded-lg p-6">
            <h2 className="text-xl font-bold text-red-800 mb-2">❌ Error</h2>
            <p className="text-red-700">{results.error}</p>
          </div>
        )}

        {results && !results.error && (
          <div className="space-y-6">
            {/* Summary */}
            <div className="bg-white rounded-lg shadow-lg p-6">
              <h2 className="text-2xl font-bold mb-4">📊 Summary</h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-blue-50 border border-blue-200 rounded p-4">
                  <p className="text-sm text-blue-700">Total Tenants</p>
                  <p className="text-4xl font-bold text-blue-900">{results.totalTenants}</p>
                </div>
                <div className="bg-green-50 border border-green-200 rounded p-4">
                  <p className="text-sm text-green-700">With Token</p>
                  <p className="text-4xl font-bold text-green-900">{results.tenantsWithToken}</p>
                </div>
                <div className="bg-purple-50 border border-purple-200 rounded p-4">
                  <p className="text-sm text-purple-700">Active</p>
                  <p className="text-4xl font-bold text-purple-900">{results.activeTenants}</p>
                </div>
                <div className="bg-orange-50 border border-orange-200 rounded p-4">
                  <p className="text-sm text-orange-700">Total Rooms</p>
                  <p className="text-4xl font-bold text-orange-900">{results.totalRooms}</p>
                </div>
              </div>
              <p className="text-xs text-gray-500 mt-3">Checked at: {results.timestamp}</p>
            </div>

            {/* Critical Issue Warning */}
            {results.totalTenants === 0 && (
              <div className="bg-red-100 border-2 border-red-400 rounded-lg p-6">
                <h2 className="text-2xl font-bold text-red-800 mb-2">🚨 NO TENANTS FOUND</h2>
                <p className="text-red-700 mb-4">
                  Your database has ZERO tenants. This is why you're getting "Access Denied".
                </p>
                <div className="bg-white rounded p-4 mb-4">
                  <h3 className="font-bold mb-2">How to Fix:</h3>
                  <ol className="list-decimal list-inside space-y-2 text-sm">
                    <li>Go to <strong>Settings</strong> page</li>
                    <li>Find <strong>"Setup 2026 Tenants"</strong> in Admin Tools</li>
                    <li>Click <strong>"Open Setup →"</strong> button</li>
                    <li>Click <strong>"Floor 1"</strong> button and wait for success</li>
                    <li>Click <strong>"Floor 2"</strong> button and wait for success</li>
                    <li>Come back here and click refresh button below</li>
                  </ol>
                </div>
              </div>
            )}

            {results.totalTenants > 0 && results.tenantsWithToken === 0 && (
              <div className="bg-yellow-100 border-2 border-yellow-400 rounded-lg p-6">
                <h2 className="text-2xl font-bold text-yellow-800 mb-2">⚠️ TOKENS MISSING</h2>
                <p className="text-yellow-700 mb-4">
                  You have {results.totalTenants} tenants, but NONE have portal tokens.
                  Run Setup 2026 to generate tokens.
                </p>
              </div>
            )}

            {/* Tenants List */}
            {results.totalTenants > 0 && (
              <div className="bg-white rounded-lg shadow-lg p-6">
                <h2 className="text-2xl font-bold mb-4">👥 Tenants ({results.totalTenants})</h2>
                
                <div className="space-y-3">
                  {results.tenants.map((tenant, idx) => (
                    <div 
                      key={idx}
                      className={`border-2 rounded-lg p-4 ${
                        tenant.hasToken && tenant.isActive 
                          ? 'bg-green-50 border-green-300' 
                          : tenant.hasToken 
                          ? 'bg-yellow-50 border-yellow-300'
                          : 'bg-red-50 border-red-300'
                      }`}
                    >
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-lg font-bold">
                              Room {tenant.roomNumber} - {tenant.name}
                            </span>
                            {tenant.hasToken && tenant.isActive && (
                              <span className="px-2 py-1 bg-green-600 text-white text-xs font-bold rounded">
                                ✓ READY
                              </span>
                            )}
                            {tenant.hasToken && !tenant.isActive && (
                              <span className="px-2 py-1 bg-yellow-600 text-white text-xs font-bold rounded">
                                ⚠ INACTIVE
                              </span>
                            )}
                            {!tenant.hasToken && (
                              <span className="px-2 py-1 bg-red-600 text-white text-xs font-bold rounded">
                                ✗ NO TOKEN
                              </span>
                            )}
                          </div>
                          {tenant.phone && (
                            <p className="text-sm text-gray-600">📱 {tenant.phone}</p>
                          )}
                        </div>
                      </div>

                      {tenant.hasToken ? (
                        <div className="space-y-2">
                          <div className="bg-white rounded p-3 border border-gray-300">
                            <p className="text-xs text-gray-500 mb-1">Token Preview:</p>
                            <p className="font-mono text-sm text-gray-800 break-all">
                              {tenant.tokenPreview}
                            </p>
                          </div>
                          <div className="bg-gray-100 rounded p-3 border border-gray-300">
                            <p className="text-xs text-gray-500 mb-1">Full Token:</p>
                            <p className="font-mono text-xs text-gray-800 break-all">
                              {tenant.fullToken}
                            </p>
                          </div>
                          <div className="bg-blue-50 rounded p-3 border border-blue-300">
                            <p className="text-xs text-blue-600 mb-1">Portal Link:</p>
                            <p className="font-mono text-xs text-blue-800 break-all">
                              {generatePortalLink(tenant.fullToken)}
                            </p>
                          </div>
                          <div className="flex gap-2">
                            <button
                              onClick={() => testPortal(tenant.fullToken)}
                              className="flex-1 bg-blue-500 hover:bg-blue-600 text-white font-semibold py-2 px-4 rounded"
                            >
                              🔗 Test Portal
                            </button>
                            <button
                              onClick={() => copyToken(tenant.fullToken)}
                              className="flex-1 bg-green-500 hover:bg-green-600 text-white font-semibold py-2 px-4 rounded"
                            >
                              📋 Copy Link
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="bg-red-100 rounded p-3 border border-red-300">
                          <p className="text-sm text-red-800 font-semibold">
                            ⚠️ This tenant has NO portal token. Run Setup 2026 to create one.
                          </p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex gap-3">
              <button
                onClick={checkDatabase}
                className="flex-1 bg-gray-600 hover:bg-gray-700 text-white font-bold py-3 px-6 rounded-lg"
              >
                🔄 Check Again
              </button>
              <button
                onClick={() => window.location.href = '/setup-2026'}
                className="flex-1 bg-blue-500 hover:bg-blue-600 text-white font-bold py-3 px-6 rounded-lg"
              >
                🚀 Go to Setup 2026
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default QuickDatabaseCheck;
