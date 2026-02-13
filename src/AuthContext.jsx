import { createContext, useContext, useState, useEffect } from 'react';
import { 
  signInWithEmailAndPassword, 
  signOut, 
  onAuthStateChanged,
  sendPasswordResetEmail
} from 'firebase/auth';
import { auth } from './firebase';

const AuthContext = createContext();

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
};

export const AuthProvider = ({ children }) => {
  const [currentUser, setCurrentUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Allowed admin email - only this email can login
  const ALLOWED_ADMIN_EMAIL = 'sonu28281@gmail.com';

  const login = async (email, password) => {
    try {
      setError(null);
      
      // Security check: Only allow specific admin email
      if (email.toLowerCase() !== ALLOWED_ADMIN_EMAIL.toLowerCase()) {
        throw new Error('Unauthorized: Access denied. Only admin can login.');
      }

      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      return userCredential.user;
    } catch (err) {
      console.error('Login error:', err);
      let errorMessage = 'Login failed. Please try again.';
      
      if (err.code === 'auth/user-not-found') {
        errorMessage = 'No user found with this email.';
      } else if (err.code === 'auth/wrong-password') {
        errorMessage = 'Incorrect password.';
      } else if (err.code === 'auth/invalid-email') {
        errorMessage = 'Invalid email address.';
      } else if (err.code === 'auth/too-many-requests') {
        errorMessage = 'Too many failed attempts. Please try again later.';
      } else if (err.message.includes('Unauthorized')) {
        errorMessage = err.message;
      }
      
      setError(errorMessage);
      throw new Error(errorMessage);
    }
  };

  const logout = async () => {
    try {
      await signOut(auth);
    } catch (err) {
      console.error('Logout error:', err);
      setError('Failed to logout');
    }
  };

  const resetPassword = async (email) => {
    try {
      setError(null);
      
      // Security check: Only allow password reset for admin email
      if (email.toLowerCase() !== ALLOWED_ADMIN_EMAIL.toLowerCase()) {
        throw new Error('Unauthorized: Password reset not allowed for this email.');
      }

      await sendPasswordResetEmail(auth, email);
      return true;
    } catch (err) {
      console.error('Password reset error:', err);
      let errorMessage = 'Failed to send password reset email.';
      
      if (err.code === 'auth/user-not-found') {
        errorMessage = 'No user found with this email.';
      } else if (err.code === 'auth/invalid-email') {
        errorMessage = 'Invalid email address.';
      } else if (err.message.includes('Unauthorized')) {
        errorMessage = err.message;
      }
      
      setError(errorMessage);
      throw new Error(errorMessage);
    }
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      // Additional security: Verify user email matches admin email
      if (user && user.email.toLowerCase() === ALLOWED_ADMIN_EMAIL.toLowerCase()) {
        setCurrentUser(user);
      } else if (user) {
        // If authenticated but not admin email, sign out
        signOut(auth);
        setCurrentUser(null);
      } else {
        setCurrentUser(null);
      }
      setLoading(false);
    });

    return unsubscribe;
  }, []);

  const value = {
    currentUser,
    login,
    logout,
    resetPassword,
    error,
    setError,
    isAdmin: currentUser && currentUser.email.toLowerCase() === ALLOWED_ADMIN_EMAIL.toLowerCase()
  };

  return (
    <AuthContext.Provider value={value}>
      {!loading && children}
    </AuthContext.Provider>
  );
};
