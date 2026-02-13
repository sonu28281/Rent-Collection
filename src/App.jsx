import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './AuthContext';
import ProtectedRoute from './ProtectedRoute';
import Layout from './components/Layout';
import Login from './components/Login';
import Dashboard from './components/Dashboard';
import Rooms from './components/Rooms';

// Placeholder components for future phases
const ComingSoon = ({ title, phase }) => (
  <div className="p-8">
    <div className="max-w-2xl mx-auto">
      <div className="card text-center py-12">
        <div className="text-6xl mb-4">🚧</div>
        <h2 className="text-2xl font-bold text-gray-800 mb-2">{title}</h2>
        <p className="text-gray-600 mb-4">Coming in {phase}</p>
        <p className="text-sm text-gray-500">
          This feature is under development and will be available soon.
        </p>
      </div>
    </div>
  </div>
);

function App() {
  return (
    <AuthProvider>
      <Router>
        <Routes>
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
                <Layout><ComingSoon title="Tenants Management" phase="Phase 3" /></Layout>
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/electricity" 
            element={
              <ProtectedRoute>
                <Layout><ComingSoon title="Electricity Readings" phase="Phase 5" /></Layout>
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/payments" 
            element={
              <ProtectedRoute>
                <Layout><ComingSoon title="Payments Management" phase="Phase 6" /></Layout>
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/maintenance" 
            element={
              <ProtectedRoute>
                <Layout><ComingSoon title="Maintenance Records" phase="Phase 11" /></Layout>
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/import" 
            element={
              <ProtectedRoute>
                <Layout><ComingSoon title="CSV Import" phase="Phase 10" /></Layout>
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/bank-accounts" 
            element={
              <ProtectedRoute>
                <Layout><ComingSoon title="Bank Accounts" phase="Phase 9" /></Layout>
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/settings" 
            element={
              <ProtectedRoute>
                <Layout><ComingSoon title="Settings" phase="Phase 8" /></Layout>
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
