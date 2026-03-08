import { useState, useEffect } from 'react';
import { collection, getDocs, query, where, doc, getDoc, setDoc, writeBatch, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { useDialog } from './ui/DialogProvider';

const AdminCheckoutPanel = () => {
  const { showConfirm, showAlert } = useDialog();
  const [checkoutRequests, setCheckoutRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(null);

  useEffect(() => {
    fetchCheckoutRequests();
  }, []);

  const fetchCheckoutRequests = async () => {
    try {
      setLoading(true);
      const requestsRef = collection(db, 'checkoutRequests');
      const requestsQuery = query(requestsRef, where('status', '==', 'pending'));
      const requestsSnapshot = await getDocs(requestsQuery);

      const requestsData = [];
      for (const docSnap of requestsSnapshot.docs) {
        const request = { id: docSnap.id, ...docSnap.data() };
        if (request.tenantId) {
          const tenantDoc = await getDoc(doc(db, 'tenants', request.tenantId));
          if (tenantDoc.exists()) {
            request.tenant = { id: tenantDoc.id, ...tenantDoc.data() };
          }
        }
        requestsData.push(request);
      }

      requestsData.sort((a, b) => {
        const aTime = a.requestedAt?.toMillis?.() || a.requestedAt?.seconds * 1000 || 0;
        const bTime = b.requestedAt?.toMillis?.() || b.requestedAt?.seconds * 1000 || 0;
        return bTime - aTime;
      });

      setCheckoutRequests(requestsData);
    } catch (error) {
      console.error('Error fetching checkout requests:', error);
      showAlert('Failed to load checkout requests', { intent: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const handleReject = async (request) => {
    const confirmed = await showConfirm(
      `${request.tenantName} (Room ${request.roomNumber}) ki checkout request reject karni hai?`,
      { title: 'Reject Checkout Request', intent: 'warning' }
    );
    if (!confirmed) return;

    try {
      setProcessing(request.id);
      await setDoc(doc(db, 'checkoutRequests', request.id), {
        status: 'rejected',
        rejectedAt: serverTimestamp(),
        rejectedBy: 'admin'
      }, { merge: true });

      if (request.tenantId) {
        await setDoc(doc(db, 'tenants', request.tenantId), {
          status: 'active',
          checkoutRequestId: null,
          proposedCheckoutDate: null,
          updatedAt: serverTimestamp()
        }, { merge: true });
      }

      await showAlert('Checkout request rejected', { intent: 'success' });
      fetchCheckoutRequests();
    } catch (error) {
      console.error('Error rejecting checkout request:', error);
      showAlert(`Failed to reject: ${error.message}`, { intent: 'error' });
    } finally {
      setProcessing(null);
    }
  };

  const handleApprove = async (request) => {
    const tenant = request.tenant;
    if (!tenant) {
      showAlert('Tenant data not found', { intent: 'error' });
      return;
    }

    const confirmed = await showConfirm(
      `${request.tenantName} (Room ${request.roomNumber}) ka checkout approve karna hai?\n\nYe hoga:\n• Tenant past tenant ho jayega\n• Room vacant ho jayega\n\nKya sab pending payments clear ho gayi hain?`,
      { title: 'Approve Checkout', confirmLabel: 'Approve Checkout', intent: 'warning' }
    );
    if (!confirmed) return;

    try {
      setProcessing(request.id);
      const batch = writeBatch(db);

      // 1. Tenant inactive
      const tenantRef = doc(db, 'tenants', tenant.id);
      batch.set(tenantRef, {
        status: 'inactive',
        isActive: false,
        checkOutDate: request.proposedCheckoutDate,
        updatedAt: serverTimestamp()
      }, { merge: true });

      // 2. Room vacant
      const roomsSnapshot = await getDocs(query(collection(db, 'rooms'), where('roomNumber', '==', request.roomNumber)));
      if (!roomsSnapshot.empty) {
        const roomRef = doc(db, 'rooms', roomsSnapshot.docs[0].id);
        batch.set(roomRef, {
          status: 'vacant',
          currentTenantId: null,
          lastStatusUpdatedAt: serverTimestamp()
        }, { merge: true });
      }

      // 3. Checkout request completed
      const requestRef = doc(db, 'checkoutRequests', request.id);
      batch.set(requestRef, {
        status: 'completed',
        completedAt: serverTimestamp(),
        completedBy: 'admin'
      }, { merge: true });

      await batch.commit();

      await showAlert(`✅ ${request.tenantName} (Room ${request.roomNumber}) checkout complete!\nTenant inactive, Room vacant.`, { intent: 'success' });
      fetchCheckoutRequests();
    } catch (error) {
      console.error('Error approving checkout:', error);
      showAlert('Failed to approve checkout. Please try again.', { intent: 'error' });
    } finally {
      setProcessing(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-orange-500 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading checkout requests...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900 mb-1">🚪 Checkout Requests</h2>
        <p className="text-gray-600 text-sm">Pending checkout requests check karein, approve ya reject karein</p>
      </div>

      {checkoutRequests.length === 0 ? (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center">
          <div className="text-5xl mb-4">✅</div>
          <h3 className="text-lg font-medium text-gray-900 mb-2">No Pending Requests</h3>
          <p className="text-gray-600">Koi checkout request pending nahi hai</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {checkoutRequests.map((request) => (
            <div key={request.id} className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-3">
                    <h3 className="text-lg font-semibold text-gray-900">{request.tenantName}</h3>
                    <span className="px-2 py-1 bg-orange-100 text-orange-700 text-xs font-medium rounded">
                      Room {request.roomNumber}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                    <div>
                      <span className="text-gray-500">Proposed Checkout:</span>
                      <p className="font-medium text-gray-900">
                        {new Date(request.proposedCheckoutDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </p>
                    </div>
                    <div>
                      <span className="text-gray-500">Requested On:</span>
                      <p className="font-medium text-gray-900">
                        {request.requestedAt?.toDate ? new Date(request.requestedAt.toDate()).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '-'}
                      </p>
                    </div>
                    {request.tenant?.checkInDate && (
                      <div>
                        <span className="text-gray-500">Check-in Date:</span>
                        <p className="font-medium text-gray-900">
                          {new Date(request.tenant.checkInDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                        </p>
                      </div>
                    )}
                    {request.tenant?.currentRent > 0 && (
                      <div>
                        <span className="text-gray-500">Current Rent:</span>
                        <p className="font-medium text-gray-900">₹{request.tenant.currentRent.toLocaleString('en-IN')}</p>
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex sm:flex-col gap-2">
                  <button
                    onClick={() => handleApprove(request)}
                    disabled={processing === request.id}
                    className="flex-1 sm:flex-none px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50 text-sm font-medium whitespace-nowrap"
                  >
                    {processing === request.id ? 'Processing...' : '✅ Approve'}
                  </button>
                  <button
                    onClick={() => handleReject(request)}
                    disabled={processing === request.id}
                    className="flex-1 sm:flex-none px-4 py-2 border border-red-300 text-red-700 rounded-lg hover:bg-red-50 transition-colors disabled:opacity-50 text-sm font-medium whitespace-nowrap"
                  >
                    ❌ Reject
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default AdminCheckoutPanel;
