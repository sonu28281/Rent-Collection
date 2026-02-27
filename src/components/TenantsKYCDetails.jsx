import { useEffect, useMemo, useState } from 'react';
import { collection, getDocs, query, orderBy } from 'firebase/firestore';
import { db } from '../firebase';
import useResponsiveViewMode from '../utils/useResponsiveViewMode';

const getStatusBadge = (status) => {
  const normalized = String(status || 'not_uploaded').toLowerCase();
  const map = {
    verified: { label: 'Verified ✅', className: 'bg-green-100 text-green-800' },
    name_mismatch: { label: 'Name Mismatch ⚠️', className: 'bg-red-100 text-red-800' },
    number_not_found: { label: 'Number Missing ⚠️', className: 'bg-orange-100 text-orange-800' },
    recheck_needed: { label: 'Recheck Needed', className: 'bg-amber-100 text-amber-800' },
    checking: { label: 'Checking...', className: 'bg-blue-100 text-blue-800' },
    error: { label: 'OCR Error', className: 'bg-red-100 text-red-800' },
    not_uploaded: { label: 'Not Uploaded', className: 'bg-gray-100 text-gray-700' }
  };

  return map[normalized] || { label: status || 'Unknown', className: 'bg-gray-100 text-gray-700' };
};

const getAssignedRooms = (tenantRecord) => {
  if (Array.isArray(tenantRecord?.assignedRooms) && tenantRecord.assignedRooms.length > 0) {
    return tenantRecord.assignedRooms.map((room) => String(room));
  }
  if (tenantRecord?.roomNumber !== undefined && tenantRecord?.roomNumber !== null && tenantRecord?.roomNumber !== '') {
    return [String(tenantRecord.roomNumber)];
  }
  return [];
};

const completionFromProfile = (profile = {}) => {
  const aadharVerified = profile.aadharDocStatus === 'verified' && !!(profile.aadharExtractedNumber || profile.aadharNumber);
  const panVerified = profile.panDocStatus === 'verified' && !!(profile.panExtractedNumber || profile.panNumber);
  const checks = [
    !!profile.firstName,
    !!profile.lastName,
    !!profile.phoneNumber,
    !!profile.occupation,
    aadharVerified,
    panVerified,
    !!profile.selfieImage,
    !!profile.agreementAccepted,
    !!profile.agreementSignature
  ];

  const filled = checks.filter(Boolean).length;
  const total = checks.length;
  return {
    filled,
    total,
    percentage: Math.round((filled / total) * 100)
  };
};

const TenantsKYCDetails = () => {
  const [tenants, setTenants] = useState([]);
  const [profilesByTenantId, setProfilesByTenantId] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [floorFilter, setFloorFilter] = useState('all');
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const [selectedTenant, setSelectedTenant] = useState(null);
  const { viewMode, setViewMode, isCardView } = useResponsiveViewMode('tenants-kyc-view-mode', 'table');

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        setError('');

        const tenantsSnapshot = await getDocs(query(collection(db, 'tenants'), orderBy('createdAt', 'desc')));
        const tenantsData = tenantsSnapshot.docs.map((snapshot) => ({ id: snapshot.id, ...snapshot.data() }));

        const profilesSnapshot = await getDocs(collection(db, 'tenantProfiles'));
        const profileMap = {};
        profilesSnapshot.forEach((snapshot) => {
          profileMap[snapshot.id] = snapshot.data() || {};
        });

        setTenants(tenantsData);
        setProfilesByTenantId(profileMap);
      } catch (fetchError) {
        console.error('Error loading tenant KYC details:', fetchError);
        setError('Failed to load KYC details. Please try again.');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const mediaQuery = window.matchMedia('(max-width: 768px)');
    const updateViewport = () => setIsMobileViewport(mediaQuery.matches);

    updateViewport();
    mediaQuery.addEventListener('change', updateViewport);
    return () => mediaQuery.removeEventListener('change', updateViewport);
  }, []);

  const isRoomOnFloor = (rooms, floor) => {
    const roomNumbers = (rooms || []).map((room) => Number.parseInt(room, 10));
    if (floor === 'floor1') return roomNumbers.some((room) => Number.isFinite(room) && room >= 101 && room < 200);
    if (floor === 'floor2') return roomNumbers.some((room) => Number.isFinite(room) && room >= 200 && room < 300);
    return true;
  };

  const rows = useMemo(() => {
    return tenants
      .map((tenant) => {
        const profile = profilesByTenantId[tenant.id] || {};
        const rooms = getAssignedRooms(tenant);
        const completion = completionFromProfile(profile);

        return {
          id: tenant.id,
          name: tenant.name || '-',
          isActive: !!tenant.isActive,
          rooms,
          firstName: profile.firstName || '',
          lastName: profile.lastName || '',
          phoneNumber: profile.phoneNumber || tenant.phone || '',
          occupation: profile.occupation || '',
          aadharNumber: profile.aadharExtractedNumber || profile.aadharNumber || '',
          panNumber: profile.panExtractedNumber || profile.panNumber || '',
          aadharImage: profile.aadharImage || '',
          panImage: profile.panImage || '',
          selfieImage: profile.selfieImage || '',
          aadharDocStatus: profile.aadharDocStatus || 'not_uploaded',
          panDocStatus: profile.panDocStatus || 'not_uploaded',
          aadharDocReason: profile.aadharDocReason || '',
          panDocReason: profile.panDocReason || '',
          aadharExtractedNumber: profile.aadharExtractedNumber || '',
          panExtractedNumber: profile.panExtractedNumber || '',
          aadharDocConfidence: Number(profile.aadharDocConfidence || 0),
          panDocConfidence: Number(profile.panDocConfidence || 0),
          aadharNameMatched: !!profile.aadharNameMatched,
          panNameMatched: !!profile.panNameMatched,
          agreementAccepted: !!profile.agreementAccepted,
          agreementSignature: profile.agreementSignature || '',
          agreementSignedAt: profile.agreementSignedAt || '',
          completion
        };
      })
      .sort((a, b) => {
        const roomA = Number(a.rooms[0] || Number.MAX_SAFE_INTEGER);
        const roomB = Number(b.rooms[0] || Number.MAX_SAFE_INTEGER);
        if (roomA !== roomB) return roomA - roomB;
        return a.name.localeCompare(b.name);
      });
  }, [profilesByTenantId, tenants]);

  const filteredRows = useMemo(() => rows.filter((row) => isRoomOnFloor(row.rooms, floorFilter)), [rows, floorFilter]);

  const verificationSummary = useMemo(() => {
    const aadharVerified = filteredRows.filter((row) => row.aadharDocStatus === 'verified').length;
    const panVerified = filteredRows.filter((row) => row.panDocStatus === 'verified').length;
    const aadharMismatched = filteredRows.filter((row) => ['name_mismatch', 'number_not_found', 'error', 'recheck_needed'].includes(row.aadharDocStatus)).length;
    const panMismatched = filteredRows.filter((row) => ['name_mismatch', 'number_not_found', 'error', 'recheck_needed'].includes(row.panDocStatus)).length;

    return { aadharVerified, panVerified, aadharMismatched, panMismatched };
  }, [filteredRows]);

  if (loading) {
    return (
      <div className="p-4 lg:p-8">
        <div className="flex items-center justify-center min-h-[320px]">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
            <p className="text-gray-600">Loading tenants KYC details...</p>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 lg:p-8">
        <div className="card bg-red-50 border border-red-200">
          <p className="text-red-700">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-8">
      <div className="mb-6">
        <h2 className="text-3xl font-bold text-gray-900 mb-2">🪪 Tenants KYC Details</h2>
        <p className="text-gray-600">All tenants KYC information and agreement status.</p>
      </div>

      <div className="card mb-4">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <p className="text-sm text-gray-700">
            Total tenants: <span className="font-semibold">{filteredRows.length}</span>
            {floorFilter !== 'all' && <span className="text-gray-500"> (filtered)</span>}
          </p>
          <div className="hidden md:flex flex-wrap gap-2">
            <button
              onClick={() => setFloorFilter('all')}
              className={`px-3 py-1.5 rounded-lg text-sm font-semibold ${floorFilter === 'all' ? 'bg-purple-500 text-white' : 'bg-gray-200 text-gray-700'}`}
            >
              All Floors
            </button>
            <button
              onClick={() => setFloorFilter('floor1')}
              className={`px-3 py-1.5 rounded-lg text-sm font-semibold ${floorFilter === 'floor1' ? 'bg-blue-500 text-white' : 'bg-gray-200 text-gray-700'}`}
            >
              Floor 1
            </button>
            <button
              onClick={() => setFloorFilter('floor2')}
              className={`px-3 py-1.5 rounded-lg text-sm font-semibold ${floorFilter === 'floor2' ? 'bg-indigo-500 text-white' : 'bg-gray-200 text-gray-700'}`}
            >
              Floor 2
            </button>
          </div>
        </div>

        <div className="mt-3 flex items-center gap-2">
          <button
            onClick={() => setViewMode('table')}
            className={`px-3 py-1.5 rounded-lg text-sm font-semibold ${viewMode === 'table' ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700'}`}
          >
            Grid View
          </button>
          <button
            onClick={() => setViewMode('card')}
            className={`px-3 py-1.5 rounded-lg text-sm font-semibold ${viewMode === 'card' ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700'}`}
          >
            Card View
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4">
        <div className="card bg-green-50 border border-green-200">
          <p className="text-xs text-green-700">Aadhaar Verified</p>
          <p className="text-2xl font-bold text-green-900">{verificationSummary.aadharVerified}</p>
        </div>
        <div className="card bg-red-50 border border-red-200">
          <p className="text-xs text-red-700">Aadhaar Mismatch</p>
          <p className="text-2xl font-bold text-red-900">{verificationSummary.aadharMismatched}</p>
        </div>
        <div className="card bg-green-50 border border-green-200">
          <p className="text-xs text-green-700">PAN Verified</p>
          <p className="text-2xl font-bold text-green-900">{verificationSummary.panVerified}</p>
        </div>
        <div className="card bg-red-50 border border-red-200">
          <p className="text-xs text-red-700">PAN Mismatch</p>
          <p className="text-2xl font-bold text-red-900">{verificationSummary.panMismatched}</p>
        </div>
      </div>

      {!isCardView ? (
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-100">
              <tr>
                <th className="px-3 py-2 text-left">Room(s)</th>
                <th className="px-3 py-2 text-left">Tenant</th>
                <th className="px-3 py-2 text-left">Phone</th>
                <th className="px-3 py-2 text-left">Occupation</th>
                <th className="px-3 py-2 text-left">Aadhaar (Captured)</th>
                <th className="px-3 py-2 text-left">PAN (Captured)</th>
                <th className="px-3 py-2 text-center">Verification</th>
                <th className="px-3 py-2 text-center">Aadhaar Img</th>
                <th className="px-3 py-2 text-center">PAN Img</th>
                <th className="px-3 py-2 text-center">Selfie</th>
                <th className="px-3 py-2 text-center">Agreement</th>
                <th className="px-3 py-2 text-center">Completion</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row) => (
                <tr
                  key={row.id}
                  className={`border-b hover:bg-gray-50 align-top ${
                    (row.aadharDocStatus !== 'verified' && row.aadharImage) || (row.panDocStatus !== 'verified' && row.panImage)
                      ? 'bg-red-50/40'
                      : ''
                  }`}
                >
                  <td className="px-3 py-2 font-semibold">{row.rooms.length ? row.rooms.join(', ') : '-'}</td>
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      onClick={() => setSelectedTenant(row)}
                      className="font-semibold text-gray-900 hover:text-blue-700 underline-offset-2 hover:underline text-left"
                    >
                      {row.name}
                    </button>
                    <div className="text-xs text-gray-500">
                      {row.firstName || row.lastName ? `${row.firstName} ${row.lastName}`.trim() : 'KYC name missing'}
                    </div>
                    <div className="text-xs mt-1">
                      <span className={`px-2 py-0.5 rounded ${row.isActive ? 'bg-green-100 text-green-800' : 'bg-gray-200 text-gray-700'}`}>
                        {row.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                  </td>
                  <td className="px-3 py-2">{row.phoneNumber || '-'}</td>
                  <td className="px-3 py-2">{row.occupation || '-'}</td>
                  <td className="px-3 py-2">
                    <div className="font-mono text-xs">{row.aadharNumber || '-'}</div>
                    {row.aadharExtractedNumber && (
                      <p className="text-[11px] text-gray-500 mt-1">OCR: {row.aadharExtractedNumber}</p>
                    )}
                    <p className="text-[11px] text-gray-500">Conf: {Math.round(row.aadharDocConfidence || 0)}%</p>
                  </td>
                  <td className="px-3 py-2">
                    <div className="font-mono text-xs uppercase">{row.panNumber || '-'}</div>
                    {row.panExtractedNumber && (
                      <p className="text-[11px] text-gray-500 mt-1 uppercase">OCR: {row.panExtractedNumber}</p>
                    )}
                    <p className="text-[11px] text-gray-500">Conf: {Math.round(row.panDocConfidence || 0)}%</p>
                  </td>
                  <td className="px-3 py-2 text-center">
                    <div className={`inline-flex px-2 py-1 rounded text-xs font-semibold ${getStatusBadge(row.aadharDocStatus).className}`}>
                      A: {getStatusBadge(row.aadharDocStatus).label}
                    </div>
                    <div className={`inline-flex px-2 py-1 rounded text-xs font-semibold mt-1 ${getStatusBadge(row.panDocStatus).className}`}>
                      P: {getStatusBadge(row.panDocStatus).label}
                    </div>
                    {(row.aadharDocReason || row.panDocReason) && (
                      <p className="text-[11px] text-red-700 mt-1 max-w-[180px] mx-auto">
                        {row.aadharDocReason || row.panDocReason}
                      </p>
                    )}
                  </td>
                  <td className="px-3 py-2 text-center">
                    {row.aadharImage ? (
                      <img src={row.aadharImage} alt="Aadhaar" className="h-14 w-20 object-cover rounded border mx-auto" />
                    ) : '—'}
                  </td>
                  <td className="px-3 py-2 text-center">
                    {row.panImage ? (
                      <img src={row.panImage} alt="PAN" className="h-14 w-20 object-cover rounded border mx-auto" />
                    ) : '—'}
                  </td>
                  <td className="px-3 py-2 text-center">
                    {row.selfieImage ? (
                      <img src={row.selfieImage} alt="Selfie" className="h-14 w-14 object-cover rounded-full border mx-auto" />
                    ) : '—'}
                  </td>
                  <td className="px-3 py-2 text-center">
                    <div className={`text-xs font-semibold ${row.agreementAccepted ? 'text-green-700' : 'text-red-700'}`}>
                      {row.agreementAccepted ? 'Accepted' : 'Pending'}
                    </div>
                    <div className="text-[11px] text-gray-500 mt-1">
                      {row.agreementSignedAt ? new Date(row.agreementSignedAt).toLocaleString('en-IN') : '-'}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-center">
                    <span className="inline-flex items-center justify-center px-2 py-1 rounded bg-blue-100 text-blue-800 font-semibold">
                      {row.completion.percentage}%
                    </span>
                    <div className="text-[11px] text-gray-500 mt-1">{row.completion.filled}/{row.completion.total}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 pb-20">
          {filteredRows.map((row) => (
            <div key={row.id} className="bg-white rounded-lg shadow-md border border-gray-200 p-4">
              <div className="flex items-start justify-between gap-3 mb-2">
                <div>
                  <button
                    type="button"
                    onClick={() => setSelectedTenant(row)}
                    className="text-base font-bold text-gray-900 hover:text-blue-700 underline-offset-2 hover:underline text-left"
                  >
                    {row.name}
                  </button>
                  <p className="text-xs text-gray-500">Rooms: {row.rooms.length ? row.rooms.join(', ') : '-'}</p>
                </div>
                <span className={`text-xs px-2 py-1 rounded ${row.isActive ? 'bg-green-100 text-green-800' : 'bg-gray-200 text-gray-700'}`}>
                  {row.isActive ? 'Active' : 'Inactive'}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <p><span className="text-gray-500">Phone:</span> {row.phoneNumber || '-'}</p>
                <p><span className="text-gray-500">Occupation:</span> {row.occupation || '-'}</p>
                <p><span className="text-gray-500">Aadhaar (OCR):</span> {row.aadharExtractedNumber || row.aadharNumber || '-'}</p>
                <p><span className="text-gray-500">PAN (OCR):</span> {row.panExtractedNumber || row.panNumber || '-'}</p>
                <p><span className="text-gray-500">Aadhaar Check:</span> {getStatusBadge(row.aadharDocStatus).label}</p>
                <p><span className="text-gray-500">PAN Check:</span> {getStatusBadge(row.panDocStatus).label}</p>
                <p><span className="text-gray-500">Agreement:</span> {row.agreementAccepted ? 'Accepted' : 'Pending'}</p>
                <p><span className="text-gray-500">Completion:</span> {row.completion.percentage}%</p>
              </div>

              {(row.aadharDocReason || row.panDocReason) && (
                <div className="mt-2 rounded border border-red-200 bg-red-50 p-2">
                  <p className="text-[11px] text-red-700">
                    {row.aadharDocReason || row.panDocReason}
                  </p>
                </div>
              )}

              <div className="mt-3 grid grid-cols-3 gap-2">
                <div className="border rounded p-1 bg-gray-50">
                  <p className="text-[10px] text-gray-600 text-center mb-1">Aadhaar</p>
                  {row.aadharImage ? (
                    <img src={row.aadharImage} alt="Aadhaar" className="h-14 w-full object-cover rounded" />
                  ) : (
                    <p className="text-[10px] text-gray-400 text-center py-4">Not uploaded</p>
                  )}
                </div>
                <div className="border rounded p-1 bg-gray-50">
                  <p className="text-[10px] text-gray-600 text-center mb-1">PAN</p>
                  {row.panImage ? (
                    <img src={row.panImage} alt="PAN" className="h-14 w-full object-cover rounded" />
                  ) : (
                    <p className="text-[10px] text-gray-400 text-center py-4">Not uploaded</p>
                  )}
                </div>
                <div className="border rounded p-1 bg-gray-50">
                  <p className="text-[10px] text-gray-600 text-center mb-1">Selfie</p>
                  {row.selfieImage ? (
                    <img src={row.selfieImage} alt="Selfie" className="h-14 w-full object-cover rounded" />
                  ) : (
                    <p className="text-[10px] text-gray-400 text-center py-4">Not uploaded</p>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {isMobileViewport && (
        <div className="md:hidden fixed bottom-4 left-1/2 -translate-x-1/2 z-40 bg-white/95 backdrop-blur border border-gray-200 shadow-lg rounded-full px-2 py-2">
          <div className="flex items-center gap-1">
            <button
              onClick={() => setFloorFilter('all')}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold ${floorFilter === 'all' ? 'bg-purple-500 text-white' : 'bg-gray-200 text-gray-700'}`}
            >
              All
            </button>
            <button
              onClick={() => setFloorFilter('floor1')}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold ${floorFilter === 'floor1' ? 'bg-blue-500 text-white' : 'bg-gray-200 text-gray-700'}`}
            >
              Floor 1
            </button>
            <button
              onClick={() => setFloorFilter('floor2')}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold ${floorFilter === 'floor2' ? 'bg-indigo-500 text-white' : 'bg-gray-200 text-gray-700'}`}
            >
              Floor 2
            </button>
          </div>
        </div>
      )}

      {selectedTenant && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-3">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[92vh] overflow-y-auto p-4 sm:p-6">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="text-xl font-bold text-gray-900">{selectedTenant.name} - KYC Details</h3>
                <p className="text-sm text-gray-600">Rooms: {selectedTenant.rooms.length ? selectedTenant.rooms.join(', ') : '-'}</p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedTenant(null)}
                className="text-gray-500 hover:text-gray-800 text-xl font-bold"
              >
                ✕
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4 text-sm">
              <p><span className="font-semibold text-gray-700">First Name:</span> {selectedTenant.firstName || '-'}</p>
              <p><span className="font-semibold text-gray-700">Last Name:</span> {selectedTenant.lastName || '-'}</p>
              <p><span className="font-semibold text-gray-700">Phone:</span> {selectedTenant.phoneNumber || '-'}</p>
              <p><span className="font-semibold text-gray-700">Occupation:</span> {selectedTenant.occupation || '-'}</p>
              <p><span className="font-semibold text-gray-700">Aadhaar Number:</span> {selectedTenant.aadharNumber || '-'}</p>
              <p><span className="font-semibold text-gray-700">PAN Number:</span> {selectedTenant.panNumber || '-'}</p>
              <p><span className="font-semibold text-gray-700">Aadhaar OCR:</span> {selectedTenant.aadharExtractedNumber || '-'}</p>
              <p><span className="font-semibold text-gray-700">PAN OCR:</span> {selectedTenant.panExtractedNumber || '-'}</p>
              <p><span className="font-semibold text-gray-700">Aadhaar Verification:</span> {getStatusBadge(selectedTenant.aadharDocStatus).label}</p>
              <p><span className="font-semibold text-gray-700">PAN Verification:</span> {getStatusBadge(selectedTenant.panDocStatus).label}</p>
              <p><span className="font-semibold text-gray-700">Agreement:</span> {selectedTenant.agreementAccepted ? 'Accepted' : 'Pending'}</p>
              <p><span className="font-semibold text-gray-700">Signed At:</span> {selectedTenant.agreementSignedAt ? new Date(selectedTenant.agreementSignedAt).toLocaleString('en-IN') : '-'}</p>
            </div>

            {(selectedTenant.aadharDocReason || selectedTenant.panDocReason) && (
              <div className="mb-4 bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-900">
                {selectedTenant.aadharDocReason && <p><span className="font-semibold">Aadhaar reason:</span> {selectedTenant.aadharDocReason}</p>}
                {selectedTenant.panDocReason && <p className="mt-1"><span className="font-semibold">PAN reason:</span> {selectedTenant.panDocReason}</p>}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="border rounded-lg p-2">
                <p className="text-xs font-semibold text-gray-700 mb-2">Aadhaar Upload</p>
                {selectedTenant.aadharImage ? <img src={selectedTenant.aadharImage} alt="Aadhaar" className="w-full h-40 object-cover rounded" /> : <p className="text-xs text-gray-500">Not uploaded</p>}
              </div>
              <div className="border rounded-lg p-2">
                <p className="text-xs font-semibold text-gray-700 mb-2">PAN Upload</p>
                {selectedTenant.panImage ? <img src={selectedTenant.panImage} alt="PAN" className="w-full h-40 object-cover rounded" /> : <p className="text-xs text-gray-500">Not uploaded</p>}
              </div>
              <div className="border rounded-lg p-2">
                <p className="text-xs font-semibold text-gray-700 mb-2">Selfie</p>
                {selectedTenant.selfieImage ? <img src={selectedTenant.selfieImage} alt="Selfie" className="w-full h-40 object-cover rounded" /> : <p className="text-xs text-gray-500">Not uploaded</p>}
              </div>
              <div className="border rounded-lg p-2">
                <p className="text-xs font-semibold text-gray-700 mb-2">Digital Signature</p>
                {selectedTenant.agreementSignature ? <img src={selectedTenant.agreementSignature} alt="Signature" className="w-full h-40 object-contain rounded bg-gray-50" /> : <p className="text-xs text-gray-500">Not uploaded</p>}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TenantsKYCDetails;
