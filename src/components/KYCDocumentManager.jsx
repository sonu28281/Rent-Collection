import { useState, useEffect } from 'react';
import { collection, getDocs, deleteDoc, doc, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import { useDialog } from './ui/DialogProvider';

function KYCDocumentManager() {
  const { showConfirm, showAlert } = useDialog();
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [kycApplications, setKycApplications] = useState([]);
  const [profilesByAppId, setProfilesByAppId] = useState({});
  const [stats, setStats] = useState(null);
  const [error, setError] = useState(null);
  const [filterStatus, setFilterStatus] = useState('all'); // all, pending_approval, rejected
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedIds, setSelectedIds] = useState(new Set());

  useEffect(() => {
    loadKycApplications();
  }, []);

  const loadKycApplications = async () => {
    setLoading(true);
    setError(null);
    try {
      console.log('📋 Fetching KYC applications...');
      
      const applicationsRef = collection(db, 'tenantApplications');
      const applicationsSnapshot = await getDocs(applicationsRef);
      
      const applications = applicationsSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      // Sort by submitted date (newest first)
      applications.sort((a, b) => {
        const dateA = a.submittedAt ? new Date(a.submittedAt).getTime() : 0;
        const dateB = b.submittedAt ? new Date(b.submittedAt).getTime() : 0;
        return dateB - dateA;
      });

      // Load corresponding tenant profiles for detailed KYC info
      const profilesRef = collection(db, 'tenantProfiles');
      const profilesSnapshot = await getDocs(profilesRef);
      const profileMap = {};
      profilesSnapshot.forEach((snapshot) => {
        profileMap[snapshot.id] = snapshot.data() || {};
      });

      setKycApplications(applications);
      setProfilesByAppId(profileMap);
      
      // Calculate stats
      const stats = {
        total: applications.length,
        pending: applications.filter(a => a.status === 'pending_approval').length,
        rejected: applications.filter(a => a.status === 'rejected').length,
        approved: applications.filter(a => a.status === 'approved').length,
      };
      setStats(stats);
      
      console.log('✅ Loaded KYC applications:', stats);
    } catch (err) {
      console.error('❌ Error loading KYC applications:', err);
      setError(err.message);
      showAlert(`Error loading KYC applications: ${err.message}`, { intent: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const filteredApplications = kycApplications.filter(app => {
    const statusMatch = filterStatus === 'all' || app.status === filterStatus;
    const searchMatch = 
      app.fullName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      app.phone?.includes(searchTerm) ||
      app.id.toLowerCase().includes(searchTerm.toLowerCase());
    return statusMatch && searchMatch;
  });

  const handleDeleteApplication = async (application) => {
    const confirmed = await showConfirm(
      `Delete KYC application from ${application.fullName}?\n\nPhone: ${application.phone}\nStatus: ${application.status}\n\nThis action cannot be undone!`,
      {
        title: 'Delete KYC Application',
        intent: 'danger',
        confirmLabel: 'Delete'
      }
    );

    if (!confirmed) return;

    setDeleting(true);
    try {
      console.log('🗑️ Deleting KYC application:', application.id);
      await deleteDoc(doc(db, 'tenantApplications', application.id));
      
      console.log('✅ KYC application deleted');
      showAlert(`✅ KYC application from ${application.fullName} deleted successfully`, { intent: 'success' });
      
      // Reload list
      await loadKycApplications();
    } catch (err) {
      console.error('❌ Error deleting KYC application:', err);
      showAlert(`Failed to delete: ${err.message}`, { intent: 'error' });
    } finally {
      setDeleting(false);
    }
  };

  const handleDeleteMultiple = async (applications) => {
    const confirmed = await showConfirm(
      `Delete ${applications.length} KYC applications?\n\nThis action cannot be undone!`,
      {
        title: 'Delete Multiple Applications',
        intent: 'danger',
        confirmLabel: 'Delete All'
      }
    );

    if (!confirmed) return;

    setDeleting(true);
    try {
      console.log('🗑️ Deleting', applications.length, 'KYC applications...');
      
      for (const app of applications) {
        await deleteDoc(doc(db, 'tenantApplications', app.id));
      }
      
      console.log('✅ All KYC applications deleted');
      showAlert(`✅ ${applications.length} KYC applications deleted successfully`, { intent: 'success' });
      
      // Clear selection
      setSelectedIds(new Set());
      
      // Reload list
      await loadKycApplications();
    } catch (err) {
      console.error('❌ Error deleting KYC applications:', err);
      showAlert(`Failed to delete: ${err.message}`, { intent: 'error' });
    } finally {
      setDeleting(false);
    }
  };

  const toggleSelection = (appId) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(appId)) {
      newSelected.delete(appId);
    } else {
      newSelected.add(appId);
    }
    setSelectedIds(newSelected);
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredApplications.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredApplications.map(app => app.id)));
    }
  };

  const deleteSelected = async () => {
    const selectedApps = kycApplications.filter(app => selectedIds.has(app.id));
    await handleDeleteMultiple(selectedApps);
  };

  // Status badge colors
  const getStatusColor = (status) => {
    switch (status) {
      case 'pending_approval':
        return 'bg-yellow-100 text-yellow-800 border-yellow-300';
      case 'rejected':
        return 'bg-red-100 text-red-800 border-red-300';
      case 'approved':
        return 'bg-green-100 text-green-800 border-green-300';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-300';
    }
  };

  const getStatusLabel = (status) => {
    switch (status) {
      case 'pending_approval':
        return '⏳ Pending';
      case 'rejected':
        return '❌ Rejected';
      case 'approved':
        return '✅ Approved';
      default:
        return '❓ Unknown';
    }
  };

  return (
    <div className="p-4 lg:p-8 min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border-2 border-blue-300 rounded-xl p-6">
          <h1 className="text-3xl font-bold text-blue-900 mb-2">🗑️ KYC Document Manager</h1>
          <p className="text-sm text-blue-700">Delete old KYC applications and documents to keep your database clean and organized.</p>
        </div>

        {/* Stats */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-white rounded-lg border border-gray-200 p-4">
              <p className="text-gray-600 text-sm">Total Applications</p>
              <p className="text-3xl font-bold text-gray-900">{stats.total}</p>
            </div>
            <div className="bg-yellow-50 rounded-lg border border-yellow-200 p-4">
              <p className="text-yellow-700 text-sm font-medium">⏳ Pending</p>
              <p className="text-3xl font-bold text-yellow-900">{stats.pending}</p>
            </div>
            <div className="bg-red-50 rounded-lg border border-red-200 p-4">
              <p className="text-red-700 text-sm font-medium">❌ Rejected</p>
              <p className="text-3xl font-bold text-red-900">{stats.rejected}</p>
            </div>
            <div className="bg-green-50 rounded-lg border border-green-200 p-4">
              <p className="text-green-700 text-sm font-medium">✅ Approved</p>
              <p className="text-3xl font-bold text-green-900">{stats.approved}</p>
            </div>
          </div>
        )}

        {/* Controls */}
        <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {/* Search */}
            <input
              type="text"
              placeholder="Search by name, phone, or ID..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
            />

            {/* Filter */}
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
            >
              <option value="all">All Applications ({stats?.total || 0})</option>
              <option value="pending_approval">Pending ({stats?.pending || 0})</option>
              <option value="rejected">Rejected ({stats?.rejected || 0})</option>
              <option value="approved">Approved ({stats?.approved || 0})</option>
            </select>

            {/* Bulk Delete Rejected */}
            {stats?.rejected > 0 && (
              <button
                onClick={() => handleDeleteMultiple(kycApplications.filter(a => a.status === 'rejected'))}
                disabled={deleting || loading}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors text-sm"
              >
                {deleting ? '🗑️ Deleting...' : `🗑️ Delete All ${stats?.rejected} Rejected`}
              </button>
            )}

            {/* Refresh Button */}
            <button
              onClick={loadKycApplications}
              disabled={loading}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors text-sm"
            >
              {loading ? '⏳ Refreshing...' : '🔄 Refresh'}
            </button>
          </div>

          {/* Selection Toolbar */}
          {filteredApplications.length > 0 && (
            <div className="flex items-center justify-between bg-blue-50 border border-blue-200 rounded-lg p-3">
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedIds.size === filteredApplications.length && filteredApplications.length > 0}
                    onChange={toggleSelectAll}
                    className="w-4 h-4 rounded border-gray-300"
                  />
                  <span className="text-sm font-medium text-gray-700">
                    {selectedIds.size === 0 ? 'Select All' : `Select All (${filteredApplications.length})`}
                  </span>
                </label>
              </div>

              {selectedIds.size > 0 && (
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-gray-700">{selectedIds.size} selected</span>
                  <button
                    onClick={deleteSelected}
                    disabled={deleting}
                    className="px-3 py-1 bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors text-sm"
                  >
                    {deleting ? '🗑️ Deleting...' : '🗑️ Delete Selected'}
                  </button>
                  <button
                    onClick={() => setSelectedIds(new Set())}
                    disabled={deleting}
                    className="px-3 py-1 bg-gray-400 hover:bg-gray-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors text-sm"
                  >
                    Clear
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* List */}
        {loading ? (
          <div className="bg-white rounded-lg border border-gray-200 p-8 text-center">
            <div className="inline-block animate-spin h-8 w-8 border-4 border-blue-500 border-t-transparent rounded-full mb-4"></div>
            <p className="text-gray-600">Loading KYC applications...</p>
          </div>
        ) : error ? (
          <div className="bg-red-50 border-2 border-red-300 rounded-lg p-4">
            <p className="text-red-800">❌ Error: {error}</p>
          </div>
        ) : filteredApplications.length === 0 ? (
          <div className="bg-gray-50 rounded-lg border border-gray-200 p-8 text-center">
            <p className="text-gray-600">📭 No KYC applications found</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredApplications.map((app) => {
              const profile = profilesByAppId[app.id] || {};
              const isDigiLockerVerified = profile.digiLockerVerified === true;
              const aadharVerified = profile.aadharDocStatus === 'verified' && !!(profile.aadharExtractedNumber || profile.aadharNumber);
              const panVerified = profile.panDocStatus === 'verified' && !!(profile.panExtractedNumber || profile.panNumber);
              const aadharMismatched = profile.aadharDocStatus === 'mismatched';
              const panMismatched = profile.panDocStatus === 'mismatched';

              return (
              <div key={app.id} className={`bg-white rounded-lg border-2 p-4 hover:shadow-md transition-all ${selectedIds.has(app.id) ? 'border-blue-500 bg-blue-50' : 'border-gray-200'}`}>
                <div className="flex items-start justify-between gap-4">
                  {/* Checkbox */}
                  <input
                    type="checkbox"
                    checked={selectedIds.has(app.id)}
                    onChange={() => toggleSelection(app.id)}
                    className="w-5 h-5 mt-1 rounded border-gray-300 cursor-pointer"
                  />

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    {/* Header */}
                    <div className="flex items-center gap-3 mb-3 flex-wrap">
                      <h3 className="font-semibold text-gray-900 truncate">{app.fullName}</h3>
                      <span className={`px-2 py-1 text-xs font-medium rounded border ${getStatusColor(app.status)}`}>
                        {getStatusLabel(app.status)}
                      </span>
                    </div>

                    {/* Basic Info */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm text-gray-600 mb-3">
                      <div>
                        <span className="text-gray-500">Phone:</span> {app.phone}
                      </div>
                      <div>
                        <span className="text-gray-500">Email:</span> {app.email || 'N/A'}
                      </div>
                      <div>
                        <span className="text-gray-500">Submitted:</span> {app.submittedAt ? new Date(app.submittedAt).toLocaleDateString('en-IN') : 'N/A'}
                      </div>
                    </div>

                    {/* KYC Status Tags */}
                    <div className="flex flex-wrap gap-2 mb-3">
                      {/* DigiLocker */}
                      <div className={`px-3 py-1 rounded-full text-xs font-medium flex items-center gap-1 ${
                        isDigiLockerVerified 
                          ? 'bg-green-100 text-green-800 border border-green-300' 
                          : 'bg-gray-100 text-gray-700 border border-gray-300'
                      }`}>
                        🏛️ DigiLocker {isDigiLockerVerified ? '✓' : '✗'}
                      </div>

                      {/* Aadhar */}
                      <div className={`px-3 py-1 rounded-full text-xs font-medium flex items-center gap-1 ${
                        aadharVerified 
                          ? 'bg-blue-100 text-blue-800 border border-blue-300'
                          : aadharMismatched
                          ? 'bg-orange-100 text-orange-800 border border-orange-300'
                          : 'bg-gray-100 text-gray-700 border border-gray-300'
                      }`}>
                        📋 Aadhar {aadharVerified ? '✓' : aadharMismatched ? '⚠️' : '✗'}
                      </div>

                      {/* PAN */}
                      <div className={`px-3 py-1 rounded-full text-xs font-medium flex items-center gap-1 ${
                        panVerified 
                          ? 'bg-purple-100 text-purple-800 border border-purple-300'
                          : panMismatched
                          ? 'bg-orange-100 text-orange-800 border border-orange-300'
                          : 'bg-gray-100 text-gray-700 border border-gray-300'
                      }`}>
                        📝 PAN {panVerified ? '✓' : panMismatched ? '⚠️' : '✗'}
                      </div>
                    </div>

                    {/* KYC Details */}
                    {(isDigiLockerVerified || aadharVerified || aadharMismatched || panVerified || panMismatched) && (
                      <div className="bg-gray-50 p-3 rounded-lg mb-3 text-xs space-y-2">
                        {isDigiLockerVerified && (
                          <div className="border-l-4 border-green-400 pl-2">
                            <p className="font-semibold text-gray-700">🏛️ DigiLocker Verified</p>
                            <p className="text-gray-600">Name: {profile.digiLockerName || 'N/A'}</p>
                            <p className="text-gray-600">DOB: {profile.digiLockerDob || 'N/A'}</p>
                            <p className="text-gray-600">Aadhaar: {profile.digiLockerAadhaarNumber ? `****${profile.digiLockerAadhaarNumber.slice(-4)}` : 'N/A'}</p>
                          </div>
                        )}

                        {(aadharVerified || aadharMismatched) && (
                          <div className={`border-l-4 ${aadharMismatched ? 'border-orange-400' : 'border-blue-400'} pl-2`}>
                            <p className="font-semibold text-gray-700">
                              📋 Aadhar {aadharMismatched ? '⚠️ Mismatch' : 'Verified'}
                            </p>
                            <p className="text-gray-600">Number: {profile.aadharExtractedNumber ? `****${profile.aadharExtractedNumber.slice(-4)}` : 'N/A'}</p>
                            {aadharMismatched && profile.aadharDocReason && (
                              <p className="text-orange-600 font-medium">⚠️ {profile.aadharDocReason}</p>
                            )}
                          </div>
                        )}

                        {(panVerified || panMismatched) && (
                          <div className={`border-l-4 ${panMismatched ? 'border-orange-400' : 'border-purple-400'} pl-2`}>
                            <p className="font-semibold text-gray-700">
                              📝 PAN {panMismatched ? '⚠️ Mismatch' : 'Verified'}
                            </p>
                            <p className="text-gray-600">Number: {profile.panNumber || 'N/A'}</p>
                            {panMismatched && profile.panDocReason && (
                              <p className="text-orange-600 font-medium">⚠️ {profile.panDocReason}</p>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {app.notes && (
                      <div className="text-xs text-gray-700 bg-yellow-50 p-2 rounded border border-yellow-200 mb-2">
                        <span className="text-gray-600 font-medium">📌 Notes: </span>{app.notes}
                      </div>
                    )}

                    <div className="text-xs text-gray-500">
                      ID: {app.id}
                    </div>
                  </div>

                  {/* Delete Button */}
                  <button
                    onClick={() => handleDeleteApplication(app)}
                    disabled={deleting}
                    className="px-3 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors text-sm whitespace-nowrap"
                  >
                    {deleting ? '🗑️...' : '🗑️ Delete'}
                  </button>
                </div>
              </div>
              );
            })}
          </div>
        )}

        {/* Info Box */}
        <div className="bg-blue-50 border-2 border-blue-200 rounded-lg p-4">
          <p className="text-sm text-blue-800">
            <strong>💡 Tip:</strong> You can safely delete rejected applications and old pending applications to clean up your database. Approved applications linked to tenants should be kept.
          </p>
        </div>
      </div>
    </div>
  );
}

export default KYCDocumentManager;
