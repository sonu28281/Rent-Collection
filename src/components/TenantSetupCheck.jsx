import { useState } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../firebase';

/**
 * TenantSetupCheck Component
 * 
 * Diagnostic tool to verify tenant portal setup
 * - Checks if tenants have uniqueToken
 * - Shows portal links for each tenant
 * - Helps debug "Access Denied" errors
 */
const TenantSetupCheck = () => {
  const [loading, setLoading] = useState(false);
  const [tenants, setTenants] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [error, setError] = useState(null);

  const checkSetup = async () => {
    setLoading(true);
    setError(null);

    try {
      // Load all tenants
      const tenantsRef = collection(db, 'tenants');
      const tenantsSnapshot = await getDocs(tenantsRef);
      
      const tenantsList = [];
      tenantsSnapshot.forEach(doc => {
        tenantsList.push({ id: doc.id, ...doc.data() });
      });

      // Sort by room number
      tenantsList.sort((a, b) => {
        const roomA = Number(a.roomNumber) || 0;
        const roomB = Number(b.roomNumber) || 0;
        return roomA - roomB;
      });

      setTenants(tenantsList);

      // Load all rooms
      const roomsRef = collection(db, 'rooms');
      const roomsSnapshot = await getDocs(roomsRef);
      
      const roomsList = [];
      roomsSnapshot.forEach(doc => {
        roomsList.push({ id: doc.id, ...doc.data() });
      });

      setRooms(roomsList);

    } catch (err) {
      console.error('Error checking setup:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const copyLink = (tenant) => {
    if (!tenant.uniqueToken) {
      alert('⚠️ No portal link!\n\nThis tenant does not have a uniqueToken.\n\nPlease run Setup 2026 Tenants first.');
      return;
    }

    const portalUrl = `${window.location.origin}/t/${tenant.uniqueToken}`;
    navigator.clipboard.writeText(portalUrl)
      .then(() => alert(`✅ Link copied!\n\nRoom ${tenant.roomNumber} - ${tenant.name}\n\nPaste in WhatsApp to share.`))
      .catch(() => prompt('Copy this link:', portalUrl));
  };

  const testLink = (tenant) => {
    if (!tenant.uniqueToken) {
      alert('⚠️ No portal link!\n\nPlease run Setup 2026 Tenants first.');
      return;
    }

    const portalUrl = `${window.location.origin}/t/${tenant.uniqueToken}`;
    window.open(portalUrl, '_blank');
  };

  const tenantsWithToken = tenants.filter(t => t.uniqueToken);
  const tenantsWithoutToken = tenants.filter(t => !t.uniqueToken);
  const activeTenants = tenants.filter(t => t.isActive);
  const inactiveTenants = tenants.filter(t => !t.isActive);

  return (
    <div className="max-w-6xl mx-auto p-6">
      <div className="bg-white rounded-lg shadow-lg p-6">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <span className="text-3xl">🔍</span>
          <div>
            <h1 className="text-2xl font-bold text-gray-800">Tenant Setup Diagnostic</h1>
            <p className="text-sm text-gray-600">
              Check tenant portal configuration and troubleshoot "Access Denied" errors
            </p>
          </div>
        </div>

        {/* Info Box */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
          <h3 className="font-semibold text-blue-900 mb-2">🛠️ Use this tool to:</h3>
          <ul className="text-blue-800 text-sm space-y-1 list-disc list-inside">
            <li>Verify which tenants have portal links</li>
            <li>Check if uniqueToken exists for each tenant</li>
            <li>Identify tenants who need setup</li>
            <li>Copy and test portal links directly</li>
            <li>Debug "Access Denied" errors</li>
          </ul>
        </div>

        {/* Error Display */}
        {error && (
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
            <strong>Error:</strong> {error}
          </div>
        )}

        {/* Check Button */}
        {tenants.length === 0 && (
          <button
            onClick={checkSetup}
            disabled={loading}
            className="w-full bg-blue-500 hover:bg-blue-600 text-white font-semibold py-3 px-6 rounded-lg transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
          >
            {loading ? '⏳ Checking...' : '🔍 Check Tenant Setup'}
          </button>
        )}

        {/* Loading State */}
        {loading && (
          <div className="text-center py-8">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
            <p className="text-gray-600">Checking tenant setup...</p>
          </div>
        )}

        {/* Results */}
        {tenants.length > 0 && (
          <div className="space-y-6">
            {/* Summary Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <p className="text-sm text-blue-700 mb-1">Total Tenants</p>
                <p className="text-3xl font-bold text-blue-900">{tenants.length}</p>
              </div>
              <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                <p className="text-sm text-green-700 mb-1">With Portal Link</p>
                <p className="text-3xl font-bold text-green-900">{tenantsWithToken.length}</p>
              </div>
              <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                <p className="text-sm text-red-700 mb-1">Missing Link</p>
                <p className="text-3xl font-bold text-red-900">{tenantsWithoutToken.length}</p>
              </div>
              <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
                <p className="text-sm text-purple-700 mb-1">Total Rooms</p>
                <p className="text-3xl font-bold text-purple-900">{rooms.length}</p>
              </div>
            </div>

            {/* Tenants with Portal Links */}
            {tenantsWithToken.length > 0 && (
              <div className="bg-green-50 border-2 border-green-300 rounded-lg p-4">
                <h3 className="text-lg font-bold text-green-800 mb-3">
                  ✅ Tenants Ready ({tenantsWithToken.length})
                </h3>
                <div className="space-y-2">
                  {tenantsWithToken.map((tenant) => (
                    <div 
                      key={tenant.id}
                      className="bg-white border border-green-200 rounded-lg p-4"
                    >
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-bold text-gray-800">
                              Room {tenant.roomNumber} - {tenant.name}
                            </span>
                            {tenant.isActive ? (
                              <span className="px-2 py-1 bg-green-100 text-green-800 text-xs font-semibold rounded">
                                Active
                              </span>
                            ) : (
                              <span className="px-2 py-1 bg-gray-100 text-gray-800 text-xs font-semibold rounded">
                                Inactive
                              </span>
                            )}
                          </div>
                          {tenant.phone && (
                            <p className="text-sm text-gray-600">📱 {tenant.phone}</p>
                          )}
                          <p className="text-xs text-gray-500 font-mono mt-1 break-all">
                            Token: {tenant.uniqueToken.substring(0, 30)}...
                          </p>
                        </div>
                        <div className="flex gap-2 ml-4">
                          <button
                            onClick={() => testLink(tenant)}
                            className="px-3 py-1 bg-blue-500 text-white rounded hover:bg-blue-600 text-sm whitespace-nowrap"
                          >
                            🔗 Test
                          </button>
                          <button
                            onClick={() => copyLink(tenant)}
                            className="px-3 py-1 bg-green-500 text-white rounded hover:bg-green-600 text-sm whitespace-nowrap"
                          >
                            📋 Copy
                          </button>
                        </div>
                      </div>
                      <div className="bg-gray-50 rounded p-2 text-xs font-mono break-all">
                        {window.location.origin}/t/{tenant.uniqueToken}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Tenants Missing Portal Links */}
            {tenantsWithoutToken.length > 0 && (
              <div className="bg-red-50 border-2 border-red-300 rounded-lg p-4">
                <h3 className="text-lg font-bold text-red-800 mb-3">
                  ⚠️ Tenants Need Setup ({tenantsWithoutToken.length})
                </h3>
                <p className="text-sm text-red-700 mb-3">
                  These tenants do not have portal links. Run <strong>Setup 2026 Tenants</strong> to create them.
                </p>
                <div className="space-y-2">
                  {tenantsWithoutToken.map((tenant) => (
                    <div 
                      key={tenant.id}
                      className="bg-white border border-red-200 rounded-lg p-3"
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <span className="font-bold text-gray-800">
                            Room {tenant.roomNumber} - {tenant.name}
                          </span>
                          {tenant.phone && (
                            <p className="text-sm text-gray-600">📱 {tenant.phone}</p>
                          )}
                        </div>
                        <span className="px-3 py-1 bg-red-100 text-red-800 text-xs font-semibold rounded">
                          No Portal Link
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex gap-3">
              <button
                onClick={checkSetup}
                className="flex-1 bg-gray-200 hover:bg-gray-300 text-gray-800 font-semibold py-2 px-4 rounded-lg"
              >
                🔄 Refresh
              </button>
              <button
                onClick={() => window.location.href = '/setup-2026'}
                className="flex-1 bg-blue-500 hover:bg-blue-600 text-white font-semibold py-2 px-4 rounded-lg"
              >
                🚀 Go to Setup 2026
              </button>
              <button
                onClick={() => window.location.href = '/tenants'}
                className="flex-1 bg-green-500 hover:bg-green-600 text-white font-semibold py-2 px-4 rounded-lg"
              >
                👥 View All Tenants
              </button>
            </div>

            {/* Help Section */}
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
              <h3 className="font-semibold text-yellow-900 mb-2">💡 Troubleshooting "Access Denied"</h3>
              <ul className="text-yellow-800 text-sm space-y-2 list-disc list-inside">
                <li><strong>If tenant marked as "No Portal Link":</strong> Run Setup 2026 Tenants first</li>
                <li><strong>If tenant is "Inactive":</strong> Edit tenant and set status to Active</li>
                <li><strong>If link copied but still error:</strong> Click Test button to verify link works</li>
                <li><strong>If Test button shows error:</strong> Delete and recreate tenant in Setup 2026</li>
                <li><strong>After making changes:</strong> Click Refresh button to reload data</li>
              </ul>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default TenantSetupCheck;
