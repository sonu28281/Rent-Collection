import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './AuthContext';
import ProtectedRoute from './ProtectedRoute';
import Layout from './components/Layout';
import Login from './components/Login';
import Dashboard from './components/Dashboard';
import Rooms from './components/Rooms';
import Tenants from './components/Tenants';
import TenantsKYCDetails from './components/TenantsKYCDetails';
import TenantPortal from './components/TenantPortal';
import Settings from './components/Settings';
import Electricity from './components/Electricity';
import Payments from './components/Payments';
import VerifyPayments from './components/VerifyPayments';
import Maintenance from './components/Maintenance';
import ImportCSV from './components/ImportCSV';
import BankAccounts from './components/BankAccounts';
import BackupExport from './components/BackupExport';
import RentIncrease from './components/RentIncrease';
import HistoryManager from './components/HistoryManager';
import TenantHistory from './components/TenantHistory';
import ImportLogsPage from './components/ImportLogsPage';
import PaymentsReset from './components/PaymentsReset';
import DatabaseCleanup from './components/DatabaseCleanup';
import VacancyReport from './components/VacancyReport';
import DialogProvider from './components/ui/DialogProvider';

function App() {
  const hostname = window.location.hostname.toLowerCase();
  const isTenantPortalDomain = hostname === 'tenants.callvia.in';
  const isAdminPortalDomain = hostname === 'admin.callvia.in';
  const defaultRedirectPath = isTenantPortalDomain ? '/tenant-portal' : (isAdminPortalDomain ? '/login' : '/dashboard');

  const tenantPortalRedirect = <Navigate to="/tenant-portal" replace />;
  const adminRouteElement = (component) => (
    isTenantPortalDomain
      ? tenantPortalRedirect
      : (
        <ProtectedRoute>
          <Layout>{component}</Layout>
        </ProtectedRoute>
      )
  );

  return (
    <AuthProvider>
      <DialogProvider>
        <Router>
          <Routes>
          
          {/* Public Tenant Portal Routes */}
          <Route path="/tenant-portal" element={<TenantPortal />} />
          <Route path="/kyc/callback" element={<TenantPortal />} />
          <Route path="/t/:token" element={<TenantPortal />} />
          
          <Route path="/login" element={isTenantPortalDomain ? tenantPortalRedirect : <Login />} />
          <Route 
            path="/dashboard" 
            element={adminRouteElement(<Dashboard />)} 
          />
          <Route 
            path="/rooms" 
            element={adminRouteElement(<Rooms />)} 
          />
          <Route 
            path="/tenants" 
            element={adminRouteElement(<Tenants />)} 
          />
          <Route 
            path="/tenants-kyc" 
            element={adminRouteElement(<TenantsKYCDetails />)} 
          />
          <Route 
            path="/electricity" 
            element={adminRouteElement(<Electricity />)} 
          />
          <Route 
            path="/rent-increase" 
            element={adminRouteElement(<RentIncrease />)} 
          />
          <Route 
            path="/payments" 
            element={adminRouteElement(<Payments />)} 
          />
          <Route 
            path="/verify-payments" 
            element={adminRouteElement(<VerifyPayments />)} 
          />
          <Route 
            path="/maintenance" 
            element={adminRouteElement(<Maintenance />)} 
          />
          <Route 
            path="/import" 
            element={adminRouteElement(<ImportCSV />)} 
          />
          <Route 
            path="/bank-accounts" 
            element={adminRouteElement(<BankAccounts />)} 
          />
          <Route 
            path="/backup" 
            element={adminRouteElement(<BackupExport />)} 
          />
          <Route 
            path="/history" 
            element={adminRouteElement(<HistoryManager />)} 
          />
          <Route 
            path="/vacancy-report" 
            element={adminRouteElement(<VacancyReport />)} 
          />
          <Route 
            path="/tenant-history" 
            element={adminRouteElement(<TenantHistory />)} 
          />
          <Route 
            path="/import-logs" 
            element={adminRouteElement(<ImportLogsPage />)} 
          />
          <Route 
            path="/payments-reset" 
            element={adminRouteElement(<PaymentsReset />)} 
          />
          <Route 
            path="/database-cleanup" 
            element={adminRouteElement(<DatabaseCleanup />)} 
          />
          <Route 
            path="/settings" 
            element={adminRouteElement(<Settings />)} 
          />
          <Route path="/" element={<Navigate to={defaultRedirectPath} replace />} />
          <Route path="*" element={<Navigate to={defaultRedirectPath} replace />} />
          </Routes>
        </Router>
      </DialogProvider>
    </AuthProvider>
  );
}

export default App;
