import { useState } from 'react';
import { collection, getDocs, doc, setDoc, writeBatch } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { useDialog } from './ui/DialogProvider';

const PaymentsReset = () => {
  const { showConfirm } = useDialog();
  const [processing, setProcessing] = useState(false);
  const [log, setLog] = useState([]);
  const [completed, setCompleted] = useState(false);
  const [stats, setStats] = useState(null);

  const ADMIN_EMAIL = 'sonu28281@gmail.com';

  const addLog = (message, type = 'info') => {
    const timestamp = new Date().toLocaleTimeString();
    setLog(prev => [...prev, { timestamp, message, type }]);
  };

  const executeBackupAndReset = async () => {
    // Check admin
    if (auth.currentUser?.email !== ADMIN_EMAIL) {
      addLog('❌ Admin access required', 'error');
      return;
    }

    const firstConfirm = await showConfirm(
      '⚠️ CRITICAL OPERATION\n\nThis will:\n1. Backup ALL payment records\n2. DELETE ALL payment records\n\nThis cannot be undone easily. Are you absolutely sure?',
      { title: 'Critical Operation', confirmLabel: 'Yes, Continue', intent: 'warning' }
    );
    if (!firstConfirm) {
      return;
    }

    const secondConfirm = await showConfirm('Final confirmation: Proceed with backup and reset?', {
      title: 'Final Confirmation',
      confirmLabel: 'Proceed',
      intent: 'warning'
    });
    if (!secondConfirm) {
      return;
    }

    setProcessing(true);
    setLog([]);
    setCompleted(false);
    
    try {
      const timestamp = Date.now();
      const backupCollectionName = `payments_full_backup_${timestamp}`;
      
      addLog('🚀 Starting Backup and Reset Process...', 'info');
      
      // STEP 1: Count original documents
      addLog('📊 Step 1: Counting original documents...', 'info');
      const paymentsRef = collection(db, 'payments');
      const paymentsSnapshot = await getDocs(paymentsRef);
      const originalCount = paymentsSnapshot.size;
      addLog(`✅ Found ${originalCount} documents in 'payments' collection`, 'success');
      
      if (originalCount === 0) {
        addLog('⚠️ No documents to backup. Collection is already empty.', 'warning');
        addLog('✅ System is ready for fresh import.', 'success');
        setCompleted(true);
        setProcessing(false);
        return;
      }
      
      // STEP 2: Create backup collection
      addLog(`💾 Step 2: Creating backup collection '${backupCollectionName}'...`, 'info');
      const backupRef = collection(db, backupCollectionName);
      let backedUpCount = 0;
      
      for (const docSnapshot of paymentsSnapshot.docs) {
        const backupDocRef = doc(backupRef, docSnapshot.id);
        await setDoc(backupDocRef, {
          ...docSnapshot.data(),
          backupTimestamp: new Date().toISOString(),
          originalDocId: docSnapshot.id
        });
        backedUpCount++;
        
        if (backedUpCount % 50 === 0) {
          addLog(`   ... backed up ${backedUpCount}/${originalCount} documents`, 'info');
        }
      }
      
      addLog(`✅ Backed up ${backedUpCount} documents to '${backupCollectionName}'`, 'success');
      
      // STEP 3: Verify backup
      addLog('🔍 Step 3: Verifying backup...', 'info');
      const backupSnapshot = await getDocs(backupRef);
      const backupCount = backupSnapshot.size;
      addLog(`📊 Backup collection contains ${backupCount} documents`, 'info');
      
      if (backupCount !== originalCount) {
        throw new Error(`Backup verification failed! Original: ${originalCount}, Backup: ${backupCount}`);
      }
      addLog('✅ Backup verification successful!', 'success');
      
      // STEP 4: Delete original documents
      addLog('🗑️ Step 4: Deleting documents from original collection...', 'info');
      let deleteCount = 0;
      const batchSize = 500;
      let currentBatch = writeBatch(db);
      let batchOperations = 0;
      
      for (const docSnapshot of paymentsSnapshot.docs) {
        currentBatch.delete(docSnapshot.ref);
        batchOperations++;
        deleteCount++;
        
        if (batchOperations >= batchSize) {
          await currentBatch.commit();
          currentBatch = writeBatch(db);
          batchOperations = 0;
          addLog(`   ... deleted ${deleteCount}/${originalCount} documents`, 'info');
        }
      }
      
      if (batchOperations > 0) {
        await currentBatch.commit();
      }
      
      addLog(`✅ Deleted ${deleteCount} documents from 'payments' collection`, 'success');
      
      // STEP 5: Final verification
      addLog('🔍 Step 5: Final verification...', 'info');
      const finalSnapshot = await getDocs(paymentsRef);
      addLog(`📊 'payments' collection now contains ${finalSnapshot.size} documents`, 'info');
      
      if (finalSnapshot.size !== 0) {
        throw new Error(`Deletion verification failed! Expected 0, found ${finalSnapshot.size}`);
      }
      
      // STEP 5: Log to importLogs collection
      addLog('📝 Step 5: Creating import log...', 'info');
      const logRef = collection(db, 'importLogs');
      const logDoc = doc(logRef, `backup_reset_${timestamp}`);
      await setDoc(logDoc, {
        type: 'backup_and_reset',
        timestamp: new Date().toISOString(),
        backupCollectionName: backupCollectionName,
        originalCount: originalCount,
        backedUpCount: backedUpCount,
        deletedCount: deleteCount,
        finalCount: finalSnapshot.size,
        verificationPassed: true,
        status: 'success'
      });
      addLog('✅ Import log created', 'success');
      
      // SUCCESS
      addLog('', 'info');
      addLog('═══════════════════════════════════════════════════', 'success');
      addLog('✅ BACKUP AND RESET COMPLETED SUCCESSFULLY', 'success');
      addLog('═══════════════════════════════════════════════════', 'success');
      addLog(`📦 Backup Collection: ${backupCollectionName}`, 'success');
      addLog(`📊 Documents Backed Up: ${backedUpCount}`, 'success');
      addLog(`🗑️ Documents Deleted: ${deleteCount}`, 'success');
      addLog('✅ Verification: PASSED', 'success');
      addLog('', 'info');
      addLog('🎯 SYSTEM STATUS:', 'success');
      addLog('   ✅ Ready for historical import (2017-2025)', 'success');
      addLog('   ✅ Meter-based calculation active', 'success');
      addLog('   ✅ Floor auto-detection enabled', 'success');
      addLog('   ✅ Update-on-duplicate configured', 'success');
      addLog('   ✅ Tenant validation disabled (snapshot mode)', 'success');
      
      setStats({
        backupCollection: backupCollectionName,
        backedUp: backedUpCount,
        deleted: deleteCount
      });
      
      setCompleted(true);
      
    } catch (error) {
      console.error('Backup and reset error:', error);
      addLog('', 'error');
      addLog('═══════════════════════════════════════════════════', 'error');
      addLog('❌ ERROR DURING BACKUP AND RESET', 'error');
      addLog('═══════════════════════════════════════════════════', 'error');
      addLog(error.message, 'error');
      addLog('⚠️ Process aborted. Check error details above.', 'error');
    } finally {
      setProcessing(false);
    }
  };

  const isAdmin = auth.currentUser?.email === ADMIN_EMAIL;

  if (!isAdmin) {
    return (
      <div className="p-4 lg:p-8">
        <div className="card bg-red-50 border border-red-200 text-center">
          <div className="text-5xl mb-4">🔒</div>
          <h2 className="text-2xl font-bold text-red-800 mb-2">Access Denied</h2>
          <p className="text-red-700">Admin access required for this operation.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-8 pb-24">
      {/* Header */}
      <div className="mb-6">
        <h2 className="text-3xl font-bold text-gray-900 mb-2">🔧 Critical Payment Reset</h2>
        <p className="text-gray-600">Backup and reset payments collection for historical rebuild (2017-2025)</p>
      </div>

      {/* Warning */}
      <div className="card mb-6 bg-red-50 border-2 border-red-300">
        <div className="flex items-start gap-4">
          <div className="text-4xl">⚠️</div>
          <div>
            <h3 className="text-xl font-bold text-red-900 mb-2">CRITICAL OPERATION WARNING</h3>
            <p className="text-red-800 mb-3">
              This operation will:
            </p>
            <ul className="text-red-800 space-y-1 mb-3">
              <li>• Create a timestamped backup of ALL payment records</li>
              <li>• DELETE ALL documents from the payments collection</li>
              <li>• Prepare system for complete historical data import</li>
            </ul>
            <p className="text-red-900 font-semibold">
              This operation is IRREVERSIBLE through the UI. Only proceed if you're ready for full historical rebuild.
            </p>
          </div>
        </div>
      </div>

      {/* System Status */}
      <div className="card mb-6 bg-blue-50 border border-blue-200">
        <h3 className="text-lg font-bold text-blue-900 mb-3">📋 Pre-Reset Checklist</h3>
        <ul className="text-blue-800 space-y-2">
          <li className="flex items-start gap-2">
            <span className="text-green-600 font-bold">✅</span>
            <span>Meter-based schema ready (oldReading, currentReading, units, ratePerUnit)</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-green-600 font-bold">✅</span>
            <span>Auto-calculations configured (units, electricity, total, status)</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-green-600 font-bold">✅</span>
            <span>Floor auto-detection enabled (roomNumber {'<'} 200 = Floor 1)</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-green-600 font-bold">✅</span>
            <span>Update-on-duplicate active (roomNumber + year + month)</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-green-600 font-bold">✅</span>
            <span>Tenant validation disabled (snapshot mode)</span>
          </li>
        </ul>
      </div>

      {/* Action Button */}
      {!processing && !completed && (
        <div className="card mb-6 text-center bg-gradient-to-r from-red-50 to-orange-50 border-2 border-red-300">
          <button
            onClick={executeBackupAndReset}
            className="btn-primary bg-red-600 hover:bg-red-700 text-lg py-4 px-8"
          >
            🚨 Execute Backup and Reset
          </button>
          <p className="text-sm text-red-600 mt-3">
            You will be asked to confirm this action twice
          </p>
        </div>
      )}

      {/* Processing */}
      {processing && (
        <div className="card mb-6 bg-yellow-50 border border-yellow-300">
          <div className="flex items-center gap-4 mb-4">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-yellow-600"></div>
            <span className="font-bold text-yellow-900">Processing... Do not close this page!</span>
          </div>
        </div>
      )}

      {/* Log Output */}
      {log.length > 0 && (
        <div className="card mb-6">
          <h3 className="text-lg font-bold text-gray-800 mb-3">📋 Operation Log</h3>
          <div className="bg-gray-900 text-gray-100 rounded-lg p-4 max-h-96 overflow-y-auto font-mono text-sm">
            {log.map((entry, idx) => (
              <div 
                key={idx}
                className={`mb-1 ${
                  entry.type === 'error' ? 'text-red-400' :
                  entry.type === 'success' ? 'text-green-400' :
                  entry.type === 'warning' ? 'text-yellow-400' :
                  'text-gray-300'
                }`}
              >
                {entry.timestamp && `[${entry.timestamp}] `}{entry.message}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Completion Summary */}
      {completed && stats && (
        <div className="card bg-green-50 border-2 border-green-300">
          <div className="flex items-start gap-4">
            <div className="text-5xl">✅</div>
            <div className="flex-1">
              <h3 className="text-2xl font-bold text-green-900 mb-4">Reset Completed Successfully!</h3>
              
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                <div className="bg-white rounded-lg p-4 border border-green-200">
                  <p className="text-sm text-green-600 mb-1">Backup Collection</p>
                  <p className="text-xs font-mono text-green-800 break-all">{stats.backupCollection}</p>
                </div>
                <div className="bg-white rounded-lg p-4 border border-green-200">
                  <p className="text-sm text-green-600 mb-1">Documents Backed Up</p>
                  <p className="text-2xl font-bold text-green-800">{stats.backedUp}</p>
                </div>
                <div className="bg-white rounded-lg p-4 border border-green-200">
                  <p className="text-sm text-green-600 mb-1">Documents Deleted</p>
                  <p className="text-2xl font-bold text-green-800">{stats.deleted}</p>
                </div>
              </div>

              <div className="bg-green-100 border border-green-300 rounded-lg p-4">
                <h4 className="font-bold text-green-900 mb-2">✅ System Ready for Historical Import</h4>
                <p className="text-sm text-green-800 mb-2">You can now proceed to:</p>
                <ol className="text-sm text-green-800 space-y-1 ml-4">
                  <li>1. Go to <strong>Import CSV</strong> page</li>
                  <li>2. Upload your historical data CSV (2017-2025)</li>
                  <li>3. Verify the import completes successfully</li>
                  <li>4. Check <strong>History Manager</strong> to confirm data</li>
                </ol>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Restore Info */}
      {completed && stats && (
        <div className="card mt-6 bg-blue-50 border border-blue-200">
          <h3 className="text-lg font-bold text-blue-900 mb-2">💡 Backup Information</h3>
          <p className="text-sm text-blue-800 mb-2">
            Your original payment data is safely stored in the backup collection:
          </p>
          <p className="text-xs font-mono bg-blue-100 p-2 rounded border border-blue-300 text-blue-900 break-all mb-2">
            {stats.backupCollection}
          </p>
          <p className="text-sm text-blue-800">
            To restore from backup, go to Firebase Console → Firestore → find the backup collection → export and re-import.
          </p>
        </div>
      )}
    </div>
  );
};

export default PaymentsReset;
