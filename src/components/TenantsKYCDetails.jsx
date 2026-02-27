import { useEffect, useMemo, useState } from 'react';
import { collection, getDocs, query, orderBy } from 'firebase/firestore';
import { db } from '../firebase';

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
  const checks = [
    !!profile.firstName,
    !!profile.lastName,
    !!profile.phoneNumber,
    !!profile.occupation,
    !!profile.aadharNumber,
    !!profile.panNumber,
    !!profile.aadharImage,
    !!profile.panImage,
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
          aadharNumber: profile.aadharNumber || '',
          panNumber: profile.panNumber || '',
          aadharImage: profile.aadharImage || '',
          panImage: profile.panImage || '',
          selfieImage: profile.selfieImage || '',
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
          <div className="flex flex-wrap gap-2">
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
      </div>

      {!isMobileViewport ? (
      <div className="card overflow-hidden hidden md:block">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-100">
              <tr>
                <th className="px-3 py-2 text-left">Room(s)</th>
                <th className="px-3 py-2 text-left">Tenant</th>
                <th className="px-3 py-2 text-left">Phone</th>
                <th className="px-3 py-2 text-left">Occupation</th>
                <th className="px-3 py-2 text-left">Aadhaar</th>
                <th className="px-3 py-2 text-left">PAN</th>
                <th className="px-3 py-2 text-center">Aadhaar Img</th>
                <th className="px-3 py-2 text-center">PAN Img</th>
                <th className="px-3 py-2 text-center">Selfie</th>
                <th className="px-3 py-2 text-center">Agreement</th>
                <th className="px-3 py-2 text-center">Completion</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row) => (
                <tr key={row.id} className="border-b hover:bg-gray-50 align-top">
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
                  <td className="px-3 py-2 font-mono">{row.aadharNumber || '-'}</td>
                  <td className="px-3 py-2 font-mono uppercase">{row.panNumber || '-'}</td>
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
        <div className="space-y-3 md:hidden">
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
                <p><span className="text-gray-500">Aadhaar:</span> {row.aadharNumber || '-'}</p>
                <p><span className="text-gray-500">PAN:</span> {row.panNumber || '-'}</p>
                <p><span className="text-gray-500">Agreement:</span> {row.agreementAccepted ? 'Accepted' : 'Pending'}</p>
                <p><span className="text-gray-500">Completion:</span> {row.completion.percentage}%</p>
              </div>
            </div>
          ))}
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
              <p><span className="font-semibold text-gray-700">Agreement:</span> {selectedTenant.agreementAccepted ? 'Accepted' : 'Pending'}</p>
              <p><span className="font-semibold text-gray-700">Signed At:</span> {selectedTenant.agreementSignedAt ? new Date(selectedTenant.agreementSignedAt).toLocaleString('en-IN') : '-'}</p>
            </div>

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
