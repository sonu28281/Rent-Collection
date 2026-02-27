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
        <p className="text-sm text-gray-700">
          Total tenants: <span className="font-semibold">{rows.length}</span>
        </p>
      </div>

      <div className="card overflow-hidden">
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
              {rows.map((row) => (
                <tr key={row.id} className="border-b hover:bg-gray-50 align-top">
                  <td className="px-3 py-2 font-semibold">{row.rooms.length ? row.rooms.join(', ') : '-'}</td>
                  <td className="px-3 py-2">
                    <div className="font-semibold text-gray-900">{row.name}</div>
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
    </div>
  );
};

export default TenantsKYCDetails;
