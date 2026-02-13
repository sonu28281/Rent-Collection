import { useState, useEffect } from 'react';
import { collection, getDocs, doc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';

const BankAccounts = () => {
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [editingAccount, setEditingAccount] = useState(null);

  useEffect(() => {
    fetchAccounts();
  }, []);

  const fetchAccounts = async () => {
    try {
      setLoading(true);
      setError(null);

      const accountsRef = collection(db, 'bankAccounts');
      const accountsSnapshot = await getDocs(accountsRef);
      
      const accountsData = [];
      accountsSnapshot.forEach((doc) => {
        accountsData.push({id: doc.id, ...doc.data() });
      });

      setAccounts(accountsData);
      setLoading(false);
    } catch (err) {
      console.error('Error fetching bank accounts:', err);
      setError('Failed to load bank accounts. Please try again.');
      setLoading(false);
    }
  };

  const handleToggleActive = async (accountId, currentStatus) => {
    try {
      // If activating this account, deactivate all others first
      if (!currentStatus) {
        const updates = accounts.map(async (account) => {
          if (account.isActive) {
            await updateDoc(doc(db, 'bankAccounts', account.id), {
              isActive: false,
              changedBy: 'admin',
              changedAt: new Date().toISOString()
            });
          }
        });
        await Promise.all(updates);
      }

      // Toggle the selected account
      await updateDoc(doc(db, 'bankAccounts', accountId), {
        isActive: !currentStatus,
        changedBy: 'admin',
        changedAt: new Date().toISOString()
      });

      fetchAccounts();
      alert(`✅ Account ${!currentStatus ? 'activated' : 'deactivated'} successfully!`);
    } catch (err) {
      console.error('Error toggling account:', err);
      alert('Failed to update account status. Please try again.');
    }
  };

  const handleAddAccount = () => {
    setEditingAccount(null);
    setShowForm(true);
  };

  const handleFormClose = () => {
    setShowForm(false);
    setEditingAccount(null);
  };

  const handleFormSuccess = () => {
    setShowForm(false);
    setEditingAccount(null);
    fetchAccounts();
  };

  if (loading) {
    return (
      <div className="p-4 lg:p-8">
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
            <p className="text-gray-600">Loading bank accounts...</p>
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
          <button onClick={fetchAccounts} className="btn-primary mt-4">
            Retry
          </button>
        </div>
      </div>
    );
  }

  const activeAccount = accounts.find(a => a.isActive);

  return (
    <div className="p-4 lg:p-8">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold text-gray-900 mb-2">🏦 Bank Accounts & UPI</h2>
          <p className="text-gray-600">Manage payment accounts</p>
        </div>
        <button onClick={handleAddAccount} className="btn-primary">
          ➕ Add Account
        </button>
      </div>

      {/* Active Account Banner */}
      {activeAccount && (
        <div className="card mb-6 bg-gradient-to-br from-green-500 to-green-600 text-white">
          <div className="flex items-center gap-3 mb-3">
            <div className="text-4xl">✅</div>
            <div>
              <p className="text-green-100 text-sm">Currently Active</p>
              <p className="text-2xl font-bold">{activeAccount.upiId}</p>
              {activeAccount.nickname && (
                <p className="text-green-100 text-sm">{activeAccount.nickname}</p>
              )}
            </div>
          </div>
          <p className="text-green-100 text-xs">
            💡 This account is shown to tenants in their portal
          </p>
        </div>
      )}

      {/* Accounts List */}
      {accounts.length === 0 ? (
        <div className="card text-center py-12">
          <div className="text-6xl mb-4">🏦</div>
          <h3 className="text-xl font-semibold text-gray-800 mb-2">No Accounts Yet</h3>
          <p className="text-gray-600 mb-4">Add your first UPI account or bank details</p>
          <button onClick={handleAddAccount} className="btn-primary">
            ➕ Add First Account
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {accounts.map(account => (
            <div
              key={account.id}
              className={`card border-2 transition-all ${
                account.isActive
                  ? 'border-green-300 bg-green-50'
                  : 'border-gray-300 bg-white'
              }`}
            >
              <div className="flex items-start justify-between mb-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <h3 className="text-lg font-bold text-gray-800">{account.upiId}</h3>
                    {account.isActive && (
                      <span className="px-2 py-1 rounded-full text-xs font-semibold bg-green-500 text-white">
                        ✅ Active
                      </span>
                    )}
                  </div>
                  {account.nickname && (
                    <p className="text-sm text-gray-600">{account.nickname}</p>
                  )}
                  {account.qrImageUrl && (
                    <img
                      src={account.qrImageUrl}
                      alt="QR Code"
                      className="w-32 h-32 mt-3 rounded-lg border border-gray-200"
                    />
                  )}
                </div>
              </div>

              <div className="text-xs text-gray-500 mb-3">
                <p>Added: {new Date(account.createdAt).toLocaleDateString('en-IN')}</p>
                {account.changedAt && (
                  <p>Last changed: {new Date(account.changedAt).toLocaleDateString('en-IN')}</p>
                )}
              </div>

              <button
                onClick={() => handleToggleActive(account.id, account.isActive)}
                className={`w-full ${
                  account.isActive ? 'btn-secondary' : 'btn-primary'
                }`}
              >
                {account.isActive ? '⏸️ Deactivate' : '✅ Set as Active'}
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Account Form Modal */}
      {showForm && (
        <BankAccountForm
          account={editingAccount}
          onClose={handleFormClose}
          onSuccess={handleFormSuccess}
        />
      )}
    </div>
  );
};

const BankAccountForm = ({ account, onClose, onSuccess }) => {
  const [formData, setFormData] = useState({
    upiId: account?.upiId || '',
    nickname: account?.nickname || '',
    qrImageUrl: account?.qrImageUrl || ''
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!formData.upiId.trim()) {
      setError('Please enter UPI ID');
      return;
    }

    try {
      setSaving(true);
      setError('');

      const accountData = {
        upiId: formData.upiId.trim(),
        nickname: formData.nickname.trim() || null,
        qrImageUrl: formData.qrImageUrl.trim() || null,
        isActive: false,
        changedBy: 'admin',
        changedAt: new Date().toISOString()
      };

      if (!account) {
        // New account
        accountData.createdAt = new Date().toISOString();
        const accountId = `account_${Date.now()}`;
        await setDoc(doc(db, 'bankAccounts', accountId), accountData);
        alert('✅ Bank account added successfully!');
      } else {
        // Update existing
        await updateDoc(doc(db, 'bankAccounts', account.id), accountData);
        alert('✅ Bank account updated successfully!');
      }

      onSuccess();
    } catch (err) {
      console.error('Error saving bank account:', err);
      setError('Failed to save account. Please try again.');
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
        <div className="border-b border-gray-200 px-6 py-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xl font-bold text-gray-800">
              {account ? '✏️ Edit Account' : '➕ Add New Account'}
            </h3>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl">
              ×
            </button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="p-6">
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4">
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          {/* UPI ID */}
          <div className="mb-4">
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              UPI ID *
            </label>
            <input
              type="text"
              name="upiId"
              value={formData.upiId}
              onChange={handleChange}
              className="input-field"
              placeholder="yourname@paytm"
              required
            />
          </div>

          {/* Nickname */}
          <div className="mb-4">
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Nickname (Optional)
            </label>
            <input
              type="text"
              name="nickname"
              value={formData.nickname}
              onChange={handleChange}
              className="input-field"
              placeholder="e.g., Paytm Business"
            />
          </div>

          {/* QR Image URL */}
          <div className="mb-4">
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              QR Code Image URL (Optional)
            </label>
            <input
              type="url"
              name="qrImageUrl"
              value={formData.qrImageUrl}
              onChange={handleChange}
              className="input-field"
              placeholder="https://example.com/qr.png"
            />
            <p className="text-xs text-gray-500 mt-1">
              💡 Upload QR code to an image hosting service and paste the URL here
            </p>
          </div>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="btn-secondary flex-1"
              disabled={saving}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn-primary flex-1"
              disabled={saving}
            >
              {saving ? 'Saving...' : '💾 Save Account'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// Import setDoc
import { setDoc } from 'firebase/firestore';

export default BankAccounts;
