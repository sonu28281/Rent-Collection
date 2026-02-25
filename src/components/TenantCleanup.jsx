import { useState } from 'react';
import { collection, getDocs, deleteDoc, doc } from 'firebase/firestore';
import { db } from '../firebase';

/**
 * Tenant Cleanup Tool
 * Removes duplicate tenant records to fix "Access Denied" issues
 */
const TenantCleanup = () => {
  const [loading, setLoading] = useState(false);
  const [tenants, setTenants] = useState([]);
  const [duplicates, setDuplicates] = useState([]);
  const [selectedForDeletion, setSelectedForDeletion] = useState([]);
  const [deleting, setDeleting] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const scanTenants = async () => {
    setLoading(true);
    try {
      const tenantsRef = collection(db, 'tenants');
      const snapshot = await getDocs(tenantsRef);
      
      const allTenants = [];
      snapshot.forEach(doc => {
        allTenants.push({
          docId: doc.id,
          ...doc.data()
        });
      });

      // Sort by room number
      allTenants.sort((a, b) => {
        const roomA = Number(a.roomNumber) || 0;
        const roomB = Number(b.roomNumber) || 0;
        return roomA - roomB;
      });

      setTenants(allTenants);

      // Find duplicates by room number
      const roomGroups = {};
      allTenants.forEach(tenant => {
        const room = tenant.roomNumber;
        if (!roomGroups[room]) {
          roomGroups[room] = [];
        }
        roomGroups[room].push(tenant);
      });

      // Identify duplicate groups
      const dupeGroups = [];
      Object.keys(roomGroups).forEach(room => {
        if (roomGroups[room].length > 1) {
          dupeGroups.push({
            roomNumber: room,
            count: roomGroups[room].length,
            tenants: roomGroups[room]
          });
        }
      });

      setDuplicates(dupeGroups);
    } catch (err) {
      console.error('Scan error:', err);
      alert('Error scanning tenants: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const toggleSelection = (docId) => {
    setSelectedForDeletion(prev => {
      if (prev.includes(docId)) {
        return prev.filter(id => id !== docId);
      } else {
        return [...prev, docId];
      }
    });
  };

  const selectAllDuplicates = () => {
    const allDupeIds = [];
    duplicates.forEach(group => {
      // Select all except the first one (keep one for each room)
      group.tenants.slice(1).forEach(tenant => {
        allDupeIds.push(tenant.docId);
      });
    });
    setSelectedForDeletion(allDupeIds);
  };

  const deleteAllTenants = () => {
    setSelectedForDeletion(tenants.map(t => t.docId));
  };

  const handleDelete = async () => {
    if (selectedForDeletion.length === 0) {
      alert('Please select tenants to delete');
      return;
    }

    setDeleting(true);
    try {
      let deleted = 0;
      for (const docId of selectedForDeletion) {
        await deleteDoc(doc(db, 'tenants', docId));
        deleted++;
      }

      alert(`✅ Deleted ${deleted} tenant records successfully!`);
      setSelectedForDeletion([]);
      setShowConfirm(false);
      
      // Rescan
      await scanTenants();
    } catch (err) {
      console.error('Delete error:', err);
      alert('Error deleting tenants: ' + err.message);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 p-4">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
          <h1 className="text-3xl font-bold mb-2">🗑️ Tenant Cleanup Tool</h1>
          <p className="text-gray-600 mb-4">
            Remove duplicate tenant records to fix portal access issues
          </p>

          {tenants.length === 0 ? (
            <button
              onClick={scanTenants}
              disabled={loading}
              className="w-full bg-blue-500 hover:bg-blue-600 text-white font-bold py-3 px-6 rounded-lg disabled:bg-gray-400"
            >
              {loading ? '⏳ Scanning...' : '🔍 Scan Tenant Database'}
            </button>
          ) : (
            <div className="flex gap-3">
              <button
                onClick={scanTenants}
                disabled={loading}
                className="flex-1 bg-gray-500 hover:bg-gray-600 text-white font-bold py-2 px-4 rounded-lg"
              >
                🔄 Rescan
              </button>
              <button
                onClick={() => window.location.href = '/setup-2026'}
                className="flex-1 bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 px-4 rounded-lg"
              >
                🚀 Go to Setup 2026
              </button>
            </div>
          )}
        </div>

        {/* Results */}
        {tenants.length > 0 && (
          <div className="space-y-6">
            {/* Summary */}
            <div className="bg-white rounded-lg shadow-lg p-6">
              <h2 className="text-2xl font-bold mb-4">📊 Summary</h2>
              <div className="grid grid-cols-3 gap-4">
                <div className="bg-blue-50 border border-blue-200 rounded p-4">
                  <p className="text-sm text-blue-700">Total Records</p>
                  <p className="text-4xl font-bold text-blue-900">{tenants.length}</p>
                </div>
                <div className="bg-red-50 border border-red-200 rounded p-4">
                  <p className="text-sm text-red-700">Duplicate Rooms</p>
                  <p className="text-4xl font-bold text-red-900">{duplicates.length}</p>
                </div>
                <div className="bg-purple-50 border border-purple-200 rounded p-4">
                  <p className="text-sm text-purple-700">Selected for Delete</p>
                  <p className="text-4xl font-bold text-purple-900">{selectedForDeletion.length}</p>
                </div>
              </div>
            </div>

            {/* Critical Warning if Duplicates Found */}
            {duplicates.length > 0 && (
              <div className="bg-red-100 border-2 border-red-400 rounded-lg p-6">
                <h2 className="text-2xl font-bold text-red-800 mb-2">🚨 DUPLICATES FOUND!</h2>
                <p className="text-red-700 mb-4">
                  You have {duplicates.length} rooms with duplicate tenant records. 
                  This is causing the "Access Denied" error because the portal finds multiple tenants for the same room.
                </p>
                <div className="bg-white rounded p-4 mb-4">
                  <h3 className="font-bold mb-2">How to Fix:</h3>
                  <ol className="list-decimal list-inside space-y-2 text-sm">
                    <li><strong>Option 1 (Recommended):</strong> Click "Select All Duplicates" below - this will keep ONE record per room and delete the rest</li>
                    <li><strong>Option 2:</strong> Manually select which records to keep by clicking on them</li>
                    <li><strong>Option 3 (Nuclear):</strong> Click "Delete ALL Tenants" and start fresh with Setup 2026</li>
                    <li>After deleting, go to Setup 2026 and regenerate tenants</li>
                  </ol>
                </div>

                <div className="flex gap-3">
                  <button
                    onClick={selectAllDuplicates}
                    className="bg-orange-500 hover:bg-orange-600 text-white font-bold py-2 px-6 rounded-lg"
                  >
                    ⚡ Select All Duplicates (Keep 1 per Room)
                  </button>
                  <button
                    onClick={deleteAllTenants}
                    className="bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-6 rounded-lg"
                  >
                    💣 Delete ALL Tenants (Nuclear Option)
                  </button>
                </div>
              </div>
            )}

            {/* Duplicates List */}
            {duplicates.length > 0 && (
              <div className="bg-white rounded-lg shadow-lg p-6">
                <h2 className="text-2xl font-bold mb-4 text-red-800">
                  ⚠️ Duplicate Rooms ({duplicates.length})
                </h2>
                <p className="text-sm text-gray-600 mb-4">
                  Click on records to select them for deletion. First record in each group is recommended to KEEP.
                </p>

                <div className="space-y-6">
                  {duplicates.map((group, idx) => (
                    <div key={idx} className="border-2 border-red-300 rounded-lg p-4 bg-red-50">
                      <h3 className="text-lg font-bold mb-3">
                        Room {group.roomNumber} - {group.count} duplicate records
                      </h3>
                      
                      <div className="space-y-2">
                        {group.tenants.map((tenant, tenantIdx) => (
                          <div
                            key={tenant.docId}
                            onClick={() => toggleSelection(tenant.docId)}
                            className={`p-4 rounded border-2 cursor-pointer transition-all ${
                              selectedForDeletion.includes(tenant.docId)
                                ? 'bg-red-200 border-red-600'
                                : tenantIdx === 0
                                ? 'bg-green-50 border-green-400'
                                : 'bg-white border-gray-300 hover:border-blue-400'
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex-1">
                                <div className="flex items-center gap-2 mb-1">
                                  {tenantIdx === 0 && (
                                    <span className="px-2 py-1 bg-green-600 text-white text-xs font-bold rounded">
                                      ✓ KEEP (Recommended)
                                    </span>
                                  )}
                                  {selectedForDeletion.includes(tenant.docId) && (
                                    <span className="px-2 py-1 bg-red-600 text-white text-xs font-bold rounded">
                                      ✗ WILL DELETE
                                    </span>
                                  )}
                                  <span className="text-sm text-gray-500">
                                    Document ID: {tenant.docId}
                                  </span>
                                </div>
                                <p className="font-bold">{tenant.name}</p>
                                {tenant.phone && <p className="text-sm text-gray-600">📱 {tenant.phone}</p>}
                                <p className="text-xs text-gray-500 mt-1">
                                  Token: {tenant.uniqueToken ? tenant.uniqueToken.substring(0, 30) + '...' : 'NONE'}
                                </p>
                                <p className="text-xs text-gray-500">
                                  Active: {tenant.isActive ? 'Yes' : 'No'}
                                </p>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* All Tenants List */}
            <div className="bg-white rounded-lg shadow-lg p-6">
              <h2 className="text-2xl font-bold mb-4">
                👥 All Tenant Records ({tenants.length})
              </h2>
              <p className="text-sm text-gray-600 mb-4">
                Click on any record to toggle selection for deletion
              </p>

              <div className="space-y-2">
                {tenants.map((tenant) => (
                  <div
                    key={tenant.docId}
                    onClick={() => toggleSelection(tenant.docId)}
                    className={`p-3 rounded border cursor-pointer transition-all ${
                      selectedForDeletion.includes(tenant.docId)
                        ? 'bg-red-100 border-red-400'
                        : 'bg-gray-50 border-gray-300 hover:border-blue-400'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <span className="font-bold mr-2">Room {tenant.roomNumber}</span>
                        <span>{tenant.name}</span>
                        {selectedForDeletion.includes(tenant.docId) && (
                          <span className="ml-2 px-2 py-1 bg-red-500 text-white text-xs font-bold rounded">
                            ✗ SELECTED
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-gray-500">
                        ID: {tenant.docId}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Delete Actions */}
            {selectedForDeletion.length > 0 && (
              <div className="bg-white rounded-lg shadow-lg p-6 border-2 border-red-400">
                <h2 className="text-2xl font-bold text-red-800 mb-4">
                  ⚠️ Delete Confirmation
                </h2>
                <p className="text-red-700 mb-4">
                  You have selected <strong>{selectedForDeletion.length}</strong> tenant records for deletion.
                  This action cannot be undone.
                </p>

                {!showConfirm ? (
                  <button
                    onClick={() => setShowConfirm(true)}
                    className="bg-red-600 hover:bg-red-700 text-white font-bold py-3 px-6 rounded-lg"
                  >
                    🗑️ Continue to Delete
                  </button>
                ) : (
                  <div className="space-y-4">
                    <div className="bg-red-100 border border-red-300 rounded p-4">
                      <p className="font-bold text-red-900 mb-2">⚠️ FINAL WARNING</p>
                      <p className="text-sm text-red-800">
                        You are about to permanently delete {selectedForDeletion.length} tenant records.
                        They will be removed from the database immediately.
                      </p>
                    </div>

                    <div className="flex gap-3">
                      <button
                        onClick={handleDelete}
                        disabled={deleting}
                        className="bg-red-600 hover:bg-red-700 text-white font-bold py-3 px-6 rounded-lg disabled:bg-gray-400"
                      >
                        {deleting ? '🗑️ Deleting...' : '✅ Yes, Delete Now'}
                      </button>
                      <button
                        onClick={() => {
                          setShowConfirm(false);
                          setSelectedForDeletion([]);
                        }}
                        disabled={deleting}
                        className="bg-gray-500 hover:bg-gray-600 text-white font-bold py-3 px-6 rounded-lg"
                      >
                        ❌ Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Success State - No Duplicates */}
        {tenants.length > 0 && duplicates.length === 0 && (
          <div className="bg-green-100 border-2 border-green-400 rounded-lg p-6">
            <h2 className="text-2xl font-bold text-green-800 mb-2">✅ No Duplicates Found!</h2>
            <p className="text-green-700 mb-4">
              Your database has {tenants.length} tenant records with no duplicates.
              If you're still getting "Access Denied", try these steps:
            </p>
            <ol className="list-decimal list-inside space-y-2 text-sm text-green-800 mb-4">
              <li>Go to Setup 2026 and regenerate tenant tokens</li>
              <li>Make sure tenant status is Active</li>
              <li>Use the "Test" button to verify portal links</li>
              <li>Check /db-check to see full token details</li>
            </ol>
            <button
              onClick={() => window.location.href = '/setup-2026'}
              className="bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-6 rounded-lg"
            >
              🚀 Go to Setup 2026
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default TenantCleanup;
