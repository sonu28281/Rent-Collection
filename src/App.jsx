import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './AuthContext';
import ProtectedRoute from './ProtectedRoute';
import Layout from './components/Layout';
import Login from './components/Login';
import Dashboard from './components/Dashboard';
import Rooms from './components/Rooms';
import Tenants from './components/Tenants';
import TenantPortal from './components/TenantPortal';
import Settings from './components/Settings';
import Electricity from './components/Electricity';
import Payments from './components/Payments';
import Maintenance from './components/Maintenance';
import ImportCSV from './components/ImportCSV';
import BankAccounts from './components/BankAccounts';
import BackupExport from './components/BackupExport';
import RentIncrease from './components/RentIncrease';
import HistoryManager from './components/HistoryManager';
import FinancialHistoryManager from './components/FinancialHistoryManager';
import ImportLogsPage from './components/ImportLogsPage';
import PaymentsReset from './components/PaymentsReset';
import DatabaseCleanup from './components/DatabaseCleanup';

function App() {
  return (
    <AuthProvider>
      <Router>
        <Routes>
          
          {/* Public Tenant Portal Route */}
          <Route path="/t/:token" element={<TenantPortal />} />
          
          <Route path="/login" element={<Login />} />
          <Route 
            path="/dashboard" 
            element={
              <ProtectedRoute>
                <Layout><Dashboard /></Layout>
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/rooms" 
            element={
              <ProtectedRoute>
                <Layout><Rooms /></Layout>
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/tenants" 
            element={
              <ProtectedRoute>
                <Layout><Tenants /></Layout>
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/electricity" 
            element={
              <ProtectedRoute>
                <Layout><Electricity /></Layout>
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/rent-increase" 
            element={
              <ProtectedRoute>
                <Layout><RentIncrease /></Layout>
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/payments" 
            element={
              <ProtectedRoute>
                <Layout><Payments /></Layout>
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/maintenance" 
            element={
              <ProtectedRoute>
                <Layout><Maintenance /></Layout>
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/import" 
            element={
              <ProtectedRoute>
                <Layout><ImportCSV /></Layout>
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/bank-accounts" 
            element={
              <ProtectedRoute>
                <Layout><BankAccounts /></Layout>
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/backup" 
            element={
              <ProtectedRoute>
                <Layout><BackupExport /></Layout>
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/history" 
            element={
              <ProtectedRoute>
                <Layout><HistoryManager /></Layout>
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/financial-history" 
            element={
              <ProtectedRoute>
                <Layout><FinancialHistoryManager /></Layout>
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/import-logs" 
            element={
              <ProtectedRoute>
                <Layout><ImportLogsPage /></Layout>
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/payments-reset" 
            element={
              <ProtectedRoute>
                <Layout><PaymentsReset /></Layout>
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/database-cleanup" 
            element={
              <ProtectedRoute>
                <Layout><DatabaseCleanup /></Layout>
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/settings" 
            element={
              <ProtectedRoute>
                <Layout><Settings /></Layout>
              </ProtectedRoute>
            } 
          />
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </Router>
    </AuthProvider>
  );
}

export default App;
