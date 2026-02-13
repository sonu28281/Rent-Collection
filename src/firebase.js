import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyD5Nv3uIlCQuOQkj7crx1kcg-ENIH9cXT4",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "rent-collection-5e1d2.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "rent-collection-5e1d2",
  storageBucket: "rent-collection-5e1d2.firebasestorage.app",
  messagingSenderId: "605839501523",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:605839501523:web:153e006f8ada52f9804c26",
  measurementId: "G-ZK8D32M76Y"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Firebase services
export const auth = getAuth(app);
export const db = getFirestore(app);

export default app;
