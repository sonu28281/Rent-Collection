import { useState, useEffect } from 'react';
import { collection, query, where, getDocs, doc, updateDoc, addDoc, deleteDoc, orderBy } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../AuthContext';

const VerifyPayments = () => {
  const { currentUser } = useAuth();
  const [submissions, setSubmissions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('pending'); // pending, verified, rejected, all
  const [editingSubmission, setEditingSubmission] = useState(null);
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    fetchSubmissions();
  }, [filter]);

  const fetchSubmissions = async () => {
    try {
      setLoading(true);
      const submissionsRef = collection(db, 'paymentSubmissions');
      
      let submissionsQuery;
      if (filter === 'all') {
        submissionsQuery = query(submissionsRef, orderBy('submittedAt', 'desc'));
      } else {
        submissionsQuery = query(
          submissionsRef,
          where('status', '==', filter),
          orderBy('submittedAt', 'desc')
        );
      }
      
      const snapshot = await getDocs(submissionsQuery);
      const data = [];
      snapshot.forEach((doc) => {
        data.push({ id: doc.id, ...doc.data() });
      });
      
      setSubmissions(data);
    } catch (error) {
      console.error('Error fetching submissions:', error);
      alert('Failed to load submissions');
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async (submission) => {
    if (!window.confirm(`Approve payment from ${submission.tenantName} (Room ${submission.roomNumber})?\n\nAmount: ₹${submission.paidAmount}`)) {
      return;
    }

    try {
      setProcessing(true);

      // Create payment record
      await addDoc(collection(db, 'payments'), {
        tenantId: submission.tenantId,
        tenantNameSnapshot: submission.tenantName,
        roomNumber: submission.roomNumber,
        year: submission.year,
        month: submission.month,
        rent: submission.rentAmount,
        electricity: submission.electricityAmount,
        paidAmount: submission.paidAmount,
        paidDate: submission.paidDate,
        paymentMethod: 'UPI',
        utr: submission.utr,
        notes: submission.notes,
        status: 'paid',
        createdAt: new Date().toISOString(),
        verifiedBy: currentUser?.email || 'admin',
        verifiedAt: new Date().toISOString()
      });

      // Update room meter reading if provided
      if (submission.meterReading && submission.meterReading > 0) {
        const roomRef = doc(db, 'rooms', submission.roomNumber);
        await updateDoc(roomRef, {
          currentReading: submission.meterReading,
          lastUpdated: new Date().toISOString()
        });
      }

      // Update submission status
      await updateDoc(doc(db, 'paymentSubmissions', submission.id), {
        status: 'verified',
        verifiedBy: currentUser?.email || 'admin',
        verifiedAt: new Date().toISOString()
      });

      alert('✅ Payment approved and recorded successfully!');
      fetchSubmissions();
    } catch (error) {
      console.error('Error approving payment:', error);
      alert('Failed to approve payment. Please try again.');
    } finally {
      setProcessing(false);
    }
  };

  const handleReject = async (submission) => {
    const reason = prompt(`Reject payment from ${submission.tenantName}?\n\nEnter reason for rejection:`);
    if (!reason) return;

    try {
      setProcessing(true);

      await updateDoc(doc(db, 'paymentSubmissions', submission.id), {
        status: 'rejected',
        rejectionReason: reason,
        verifiedBy: currentUser?.email || 'admin',
        verifiedAt: new Date().toISOString()
      });

      alert('❌ Payment submission rejected.');
      fetchSubmissions();
    } catch (error) {
      console.error('Error rejecting payment:', error);
      alert('Failed to reject payment. Please try again.');
    } finally {
      setProcessing(false);
    }
  };

  const handleEdit = (submission) => {
    setEditingSubmission({ ...submission });
  };

  const handleSaveEdit = async () => {
    if (!editingSubmission) return;

    try {
      setProcessing(true);

      await updateDoc(doc(db, 'paymentSubmissions', editingSubmission.id), {
        paidAmount: parseFloat(editingSubmission.paidAmount),
        rentAmount: parseFloat(editingSubmission.rentAmount),
        electricityAmount: parseFloat(editingSubmission.electricityAmount),
        meterReading: parseFloat(editingSubmission.meterReading),
        paidDate: editingSubmission.paidDate,
        utr: editingSubmission.utr,
        notes: editingSubmission.notes,
        updatedAt: new Date().toISOString()
      });

      alert('✅ Submission updated successfully!');
      setEditingSubmission(null);
      fetchSubmissions();
    } catch (error) {
      console.error('Error updating submission:', error);
      alert('Failed to update submission. Please try again.');
    } finally {
      setProcessing(false);
    }
  };

  const handleDelete = async (submission) => {
    if (!window.confirm(`Delete this submission from ${submission.tenantName}?\n\nThis action cannot be undone.`)) {
      return;
    }

    try {
      setProcessing(true);
      await deleteDoc(doc(db, 'paymentSubmissions', submission.id));
      alert('🗑️ Submission deleted.');
      fetchSubmissions();
    } catch (error) {
      console.error('Error deleting submission:', error);
      alert('Failed to delete submission. Please try again.');
    } finally {
      setProcessing(false);
    }
  };

  const getStatusBadge = (status) => {
    const badges = {
      pending: { text: 'Pending', class: 'bg-yellow-100 text-yellow-800' },
      verified: { text: 'Verified', class: 'bg-green-100 text-green-800' },
      rejected: { text: 'Rejected', class: 'bg-red-100 text-red-800' }
    };
    const badge = badges[status] || { text: status, class: 'bg-gray-100 text-gray-800' };
    return <span className={`px-3 py-1 rounded-full text-xs font-semibold ${badge.class}`}>{badge.text}</span>;
  };

  if (loading) {
    return (
      <div className="p-4 lg:p-8">
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
            <p className="text-gray-600">Loading submissions...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-8">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-800 mb-2">🔍 Verify Payments</h1>
        <p className="text-gray-600">Review and approve tenant payment submissions</p>
      </div>

      {/* Filter Tabs */}
      <div className="flex gap-2 mb-6 overflow-x-auto">
        {['pending', 'verified', 'rejected', 'all'].map((filterType) => (
          <button
            key={filterType}
            onClick={() => setFilter(filterType)}
            className={`px-4 py-2 rounded-lg font-semibold text-sm whitespace-nowrap transition ${
              filter === filterType
                ? 'bg-blue-600 text-white'
                : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
            }`}
          >
            {filterType.charAt(0).toUpperCase() + filterType.slice(1)}
            {filterType !== 'all' && (
              <span className="ml-2 bg-white bg-opacity-30 px-2 py-0.5 rounded-full text-xs">
                {submissions.filter(s => s.status === filterType).length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <div className="text-2xl font-bold text-yellow-800">
            {submissions.filter(s => s.status === 'pending').length}
          </div>
          <div className="text-sm text-yellow-700">Pending Review</div>
        </div>
        <div className="bg-green-50 border border-green-200 rounded-lg p-4">
          <div className="text-2xl font-bold text-green-800">
            {submissions.filter(s => s.status === 'verified').length}
          </div>
          <div className="text-sm text-green-700">Verified</div>
        </div>
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <div className="text-2xl font-bold text-red-800">
            {submissions.filter(s => s.status === 'rejected').length}
          </div>
          <div className="text-sm text-red-700">Rejected</div>
        </div>
      </div>

      {/* Submissions List */}
      {submissions.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-8 text-center">
          <div className="text-6xl mb-4">📭</div>
          <h3 className="text-xl font-semibold text-gray-700 mb-2">No submissions found</h3>
          <p className="text-gray-500">
            {filter === 'pending' ? 'All caught up! No pending payments to review.' : `No ${filter} submissions.`}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {submissions.map((submission) => (
            <div key={submission.id} className="bg-white rounded-lg shadow-md border-2 border-gray-200 overflow-hidden">
              {/* Header */}
              <div className="bg-gradient-to-r from-blue-500 to-indigo-600 text-white px-6 py-3 flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-bold">{submission.tenantName}</h3>
                  <p className="text-sm text-white text-opacity-90">Room {submission.roomNumber}</p>
                </div>
                <div className="text-right">
                  {getStatusBadge(submission.status)}
                  <p className="text-xs text-white text-opacity-90 mt-1">
                    {new Date(submission.submittedAt).toLocaleString()}
                  </p>
                </div>
              </div>

              {/* Body */}
              <div className="p-6">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
                  <div>
                    <label className="text-xs text-gray-500 font-semibold">Payment Date</label>
                    <p className="text-sm font-bold">{submission.paidDate}</p>
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 font-semibold">Month/Year</label>
                    <p className="text-sm font-bold">{submission.month}/{submission.year}</p>
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 font-semibold">UTR Number</label>
                    <p className="text-sm font-mono font-bold">{submission.utr}</p>
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 font-semibold">Rent Amount</label>
                    <p className="text-sm font-bold">₹{submission.rentAmount?.toLocaleString('en-IN')}</p>
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 font-semibold">Electricity</label>
                    <p className="text-sm font-bold">₹{submission.electricityAmount?.toFixed(2)}</p>
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 font-semibold">Total Paid</label>
                    <p className="text-lg font-bold text-green-600">₹{submission.paidAmount?.toLocaleString('en-IN')}</p>
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 font-semibold">Meter Reading</label>
                    <p className="text-sm font-bold">{submission.previousReading} → {submission.meterReading} ({submission.unitsConsumed} units)</p>
                  </div>
                </div>

                {submission.notes && (
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4">
                    <label className="text-xs text-blue-700 font-semibold">Notes</label>
                    <p className="text-sm text-blue-900">{submission.notes}</p>
                  </div>
                )}

                {submission.screenshot && (
                  <div className="mb-4">
                    <label className="text-xs text-gray-500 font-semibold block mb-2">Screenshot</label>
                    <a 
                      href={submission.screenshot} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:underline text-sm"
                    >
                      📸 View Screenshot
                    </a>
                  </div>
                )}

                {submission.status === 'rejected' && submission.rejectionReason && (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4">
                    <label className="text-xs text-red-700 font-semibold">Rejection Reason</label>
                    <p className="text-sm text-red-900">{submission.rejectionReason}</p>
                  </div>
                )}

                {/* Actions */}
                {submission.status === 'pending' && (
                  <div className="flex gap-2 flex-wrap">
                    <button
                      onClick={() => handleApprove(submission)}
                      disabled={processing}
                      className="bg-green-500 hover:bg-green-600 text-white font-semibold px-4 py-2 rounded-lg transition disabled:opacity-50"
                    >
                      ✅ Approve & Record
                    </button>
                    <button
                      onClick={() => handleEdit(submission)}
                      disabled={processing}
                      className="bg-blue-500 hover:bg-blue-600 text-white font-semibold px-4 py-2 rounded-lg transition disabled:opacity-50"
                    >
                      ✏️ Edit
                    </button>
                    <button
                      onClick={() => handleReject(submission)}
                      disabled={processing}
                      className="bg-red-500 hover:bg-red-600 text-white font-semibold px-4 py-2 rounded-lg transition disabled:opacity-50"
                    >
                      ❌ Reject
                    </button>
                  </div>
                )}

                {submission.status !== 'pending' && (
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleDelete(submission)}
                      disabled={processing}
                      className="bg-gray-500 hover:bg-gray-600 text-white font-semibold px-4 py-2 rounded-lg transition text-sm disabled:opacity-50"
                    >
                      🗑️ Delete
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Edit Modal */}
      {editingSubmission && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="bg-blue-600 text-white px-6 py-4 rounded-t-lg">
              <h3 className="text-xl font-bold">✏️ Edit Submission</h3>
              <p className="text-sm text-white text-opacity-90">Room {editingSubmission.roomNumber} - {editingSubmission.tenantName}</p>
            </div>

            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Payment Date</label>
                  <input
                    type="date"
                    value={editingSubmission.paidDate}
                    onChange={(e) => setEditingSubmission({ ...editingSubmission, paidDate: e.target.value })}
                    className="w-full px-3 py-2 border-2 border-gray-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Meter Reading</label>
                  <input
                    type="number"
                    value={editingSubmission.meterReading}
                    onChange={(e) => setEditingSubmission({ ...editingSubmission, meterReading: e.target.value })}
                    className="w-full px-3 py-2 border-2 border-gray-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Rent Amount</label>
                  <input
                    type="number"
                    value={editingSubmission.rentAmount}
                    onChange={(e) => setEditingSubmission({ ...editingSubmission, rentAmount: e.target.value })}
                    className="w-full px-3 py-2 border-2 border-gray-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Electricity Amount</label>
                  <input
                    type="number"
                    value={editingSubmission.electricityAmount}
                    onChange={(e) => setEditingSubmission({ ...editingSubmission, electricityAmount: e.target.value })}
                    className="w-full px-3 py-2 border-2 border-gray-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Total Paid</label>
                  <input
                    type="number"
                    value={editingSubmission.paidAmount}
                    onChange={(e) => setEditingSubmission({ ...editingSubmission, paidAmount: e.target.value })}
                    className="w-full px-3 py-2 border-2 border-green-300 rounded-lg font-bold"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">UTR Number</label>
                  <input
                    type="text"
                    value={editingSubmission.utr}
                    onChange={(e) => setEditingSubmission({ ...editingSubmission, utr: e.target.value })}
                    className="w-full px-3 py-2 border-2 border-gray-300 rounded-lg font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Notes</label>
                <textarea
                  value={editingSubmission.notes}
                  onChange={(e) => setEditingSubmission({ ...editingSubmission, notes: e.target.value })}
                  className="w-full px-3 py-2 border-2 border-gray-300 rounded-lg resize-none"
                  rows="3"
                />
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  onClick={() => setEditingSubmission(null)}
                  className="flex-1 px-4 py-2 border-2 border-gray-300 text-gray-700 font-semibold rounded-lg hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveEdit}
                  disabled={processing}
                  className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg disabled:opacity-50"
                >
                  {processing ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default VerifyPayments;
