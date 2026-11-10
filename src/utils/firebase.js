// Инициализация Firebase Realtime Database и синхронизация серверного времени
import { initializeApp } from 'firebase/app';
import { getDatabase, ref, onValue } from 'firebase/database';

const env = typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env : {};

export const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY || 'AIzaSyC2-xJe67RT2_hlpu82l1apkCyLtNUgxDM',
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || 'campgame-156ac.firebaseapp.com',
  databaseURL: env.VITE_FIREBASE_DATABASE_URL || 'https://campgame-156ac-default-rtdb.europe-west1.firebasedatabase.app',
  projectId: env.VITE_FIREBASE_PROJECT_ID || 'campgame-156ac',
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET || 'campgame-156ac.firebasestorage.app',
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID || '287989185216',
  appId: env.VITE_FIREBASE_APP_ID || '1:287989185216:web:7c684d36d22f4d0346cb25'
};

export const app = initializeApp(firebaseConfig);
export const database = getDatabase(app);

let serverTimeOffsetMs = 0;
let firebaseConnected = false;
const statusListeners = new Set();

function notifyStatus() {
  statusListeners.forEach((cb) => {
    try {
      cb({ connected: firebaseConnected, serverTimeOffsetMs });
    } catch (e) {
      console.error('Firebase status listener error:', e);
    }
  });
}

try {
  onValue(ref(database, '.info/connected'), (snap) => {
    firebaseConnected = Boolean(snap.val());
    notifyStatus();
  });

  onValue(ref(database, '.info/serverTimeOffset'), (snap) => {
    const val = snap.val();
    if (typeof val === 'number' && Number.isFinite(val)) {
      serverTimeOffsetMs = val;
      notifyStatus();
    }
  });
} catch (e) {
  console.warn('Firebase time sync init error:', e);
}

export function getServerNow() {
  return Date.now() + serverTimeOffsetMs;
}

export function getServerTimeOffset() {
  return serverTimeOffsetMs;
}

export function isFirebaseConnected() {
  return firebaseConnected;
}

export function subscribeFirebaseStatus(cb) {
  statusListeners.add(cb);
  cb({ connected: firebaseConnected, serverTimeOffsetMs });
  return () => statusListeners.delete(cb);
}
