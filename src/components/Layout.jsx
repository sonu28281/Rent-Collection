import Sidebar from './Sidebar';
import TopBar from './TopBar';

const Layout = ({ children }) => {
  return (
    <div className="min-h-screen bg-gray-50">
      <Sidebar />

      {/* Main Content Area with padding for sidebar */}
      <div className="lg:ml-64 pt-16 lg:pt-0">
        <TopBar />
        <main className="min-h-screen">
          {children}
        </main>
      </div>
    </div>
  );
};

export default Layout;
