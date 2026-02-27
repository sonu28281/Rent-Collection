import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../AuthContext';

const Login = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [showResetPassword, setShowResetPassword] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [resetSuccess, setResetSuccess] = useState(false);
  const [installPromptEvent, setInstallPromptEvent] = useState(null);
  const [isAppInstalled, setIsAppInstalled] = useState(false);
  const [installHelpText, setInstallHelpText] = useState('');
  const { login, resetPassword, error, setError } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    const manifestLink = document.querySelector('link[rel="manifest"]');
    if (manifestLink && manifestLink.getAttribute('href') !== '/manifest.webmanifest') {
      manifestLink.setAttribute('href', '/manifest.webmanifest');
    }

    const appleTitleMeta = document.querySelector('meta[name="apple-mobile-web-app-title"]');
    if (appleTitleMeta) {
      appleTitleMeta.setAttribute('content', 'Callvia Rent');
    }

    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
    setIsAppInstalled(isStandalone);

    const onBeforeInstallPrompt = (event) => {
      event.preventDefault();
      setInstallPromptEvent(event);
      setInstallHelpText('');
    };

    const onAppInstalled = () => {
      setIsAppInstalled(true);
      setInstallPromptEvent(null);
      setInstallHelpText('');
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.addEventListener('appinstalled', onAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      window.removeEventListener('appinstalled', onAppInstalled);
    };
  }, []);

  const handleInstallApp = async () => {
    if (!installPromptEvent) {
      const isIOS = /iphone|ipad|ipod/i.test(window.navigator.userAgent || '');
      if (isIOS) {
        setInstallHelpText('iPhone Safari: Share → Add to Home Screen.');
      } else {
        setInstallHelpText('Browser menu (⋮) → Install app / Add to Home screen. Chrome/Edge recommended.');
      }
      return;
    }

    installPromptEvent.prompt();
    await installPromptEvent.userChoice;
    setInstallPromptEvent(null);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!email || !password) {
      setError('Please enter email and password');
      return;
    }

    setLoading(true);
    try {
      await login(email, password);
      navigate('/dashboard');
    } catch (err) {
      // Error is already set in AuthContext
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (e) => {
    e.preventDefault();
    
    if (!resetEmail) {
      setError('Please enter your email address');
      return;
    }

    setLoading(true);
    setResetSuccess(false);
    try {
      await resetPassword(resetEmail);
      setResetSuccess(true);
      setResetEmail('');
      setTimeout(() => {
        setShowResetPassword(false);
        setResetSuccess(false);
      }, 3000);
    } catch (err) {
      // Error is already set in AuthContext
    } finally {
      setLoading(false);
    }
  };

  const handleBackToLogin = () => {
    setShowResetPassword(false);
    setResetEmail('');
    setResetSuccess(false);
    setError(null);
  };

  const handleQuickResetRequest = async () => {
    const targetEmail = (email || '').trim();
    if (!targetEmail) {
      setError('Please enter your admin email first, then click Password Reset Request');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      await resetPassword(targetEmail);
      setResetSuccess(true);
      setTimeout(() => setResetSuccess(false), 3000);
    } catch (err) {
      // Error is already set in AuthContext
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-blue-100 px-4">
      <div className="max-w-md w-full">
        <div className="card">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-gray-800 mb-2">
              Callvia Rent
            </h1>
            <p className="text-gray-600">
              {showResetPassword ? 'Reset Your Password' : 'Admin Login Portal'}
            </p>
          </div>

          {!showResetPassword && !isAppInstalled && (
            <div className="mb-6 p-3 bg-blue-50 border border-blue-200 rounded-lg">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm text-blue-800 font-medium">Install app on home screen before login (optional)</p>
                <button
                  type="button"
                  onClick={handleInstallApp}
                  className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700"
                >
                  {installPromptEvent ? 'Install App' : 'Install Help'}
                </button>
              </div>
              <div className="mt-2 text-xs text-blue-700 space-y-1">
                <p>Best support: Chrome / Edge (Android/Desktop) for one-tap install.</p>
                {!installPromptEvent && (
                  <p>iPhone Safari: Share → Add to Home Screen.</p>
                )}
                {installHelpText && <p className="font-medium">{installHelpText}</p>}
              </div>
            </div>
          )}

          {!showResetPassword ? (
            <form onSubmit={handleSubmit} className="space-y-6">
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-2">
                  Email Address
                </label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    setError(null);
                  }}
                  className="input-field"
                  placeholder="admin@example.com"
                  disabled={loading}
                  autoComplete="email"
                />
              </div>

              <div>
                <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-2">
                  Password
                </label>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setError(null);
                  }}
                  className="input-field"
                  placeholder="••••••••"
                  disabled={loading}
                  autoComplete="current-password"
                />
              </div>

              {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="btn-primary w-full"
              >
                {loading ? 'Signing in...' : 'Sign In'}
              </button>

              <button
                type="button"
                onClick={handleQuickResetRequest}
                className="btn-secondary w-full"
                disabled={loading}
              >
                Password Reset Request
              </button>

              {resetSuccess && (
                <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg text-sm">
                  Password reset email sent successfully! Check your inbox.
                </div>
              )}

              <div className="text-center">
                <button
                  type="button"
                  onClick={() => {
                    setShowResetPassword(true);
                    setError(null);
                  }}
                  className="text-sm text-primary hover:text-secondary transition"
                  disabled={loading}
                >
                  Forgot your password?
                </button>
              </div>
            </form>
          ) : (
            <form onSubmit={handleResetPassword} className="space-y-6">
              <div>
                <label htmlFor="resetEmail" className="block text-sm font-medium text-gray-700 mb-2">
                  Email Address
                </label>
                <input
                  id="resetEmail"
                  type="email"
                  value={resetEmail}
                  onChange={(e) => {
                    setResetEmail(e.target.value);
                    setError(null);
                  }}
                  className="input-field"
                  placeholder="admin@example.com"
                  disabled={loading}
                  autoComplete="email"
                />
              </div>

              {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
                  {error}
                </div>
              )}

              {resetSuccess && (
                <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg text-sm">
                  Password reset email sent successfully! Check your inbox.
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="btn-primary w-full"
              >
                {loading ? 'Sending...' : 'Send Reset Link'}
              </button>

              <button
                type="button"
                onClick={handleBackToLogin}
                className="btn-secondary w-full"
                disabled={loading}
              >
                Back to Login
              </button>
            </form>
          )}

          <div className="mt-6 pt-6 border-t border-gray-200">
            <p className="text-xs text-gray-500 text-center">
              🔒 Secure Admin Access Only
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Login;
