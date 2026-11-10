// Инициализация Firebase Realtime Database и высокоточная NTP-синхронизация серверного времени
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
let clockRttMs = null;
let clockCalibrated = false;
let firebaseConnected = false;
let calibrationPromise = null;
const statusListeners = new Set();

function notifyStatus() {
  const payload = {
    connected: firebaseConnected,
    serverTimeOffsetMs,
    clockRttMs,
    clockCalibrated
  };
  statusListeners.forEach((cb) => {
    try {
      cb(payload);
    } catch (e) {
      console.error('Firebase status listener error:', e);
    }
  });
}

try {
  onValue(ref(database, '.info/connected'), (snap) => {
    firebaseConnected = Boolean(snap.val());
    notifyStatus();
    if (firebaseConnected && !clockCalibrated) {
      calibrateServerClock().catch(() => {});
    }
  });

  onValue(ref(database, '.info/serverTimeOffset'), (snap) => {
    const val = snap.val();
    if (typeof val === 'number' && Number.isFinite(val)) {
      // Используем базовый оффсет от WebSocket только пока не прошла точная NTP-калибровка по мин. RTT
      if (!clockCalibrated) {
        serverTimeOffsetMs = val;
        notifyStatus();
      }
    }
  });
} catch (e) {
  console.warn('Firebase time sync init error:', e);
}

/**
 * Серия из 5 быстрых NTP-замеров через RTDB REST API с выбором образца с минимальным RTT.
 * Убирает рассинхрон часов до ±15–25 мс между разными устройствами (ноутбук/планшет/телефон).
 */
export async function calibrateServerClock(clientKey = '') {
  if (typeof fetch !== 'function' || typeof performance === 'undefined') return null;
  if (calibrationPromise) return calibrationPromise;

  calibrationPromise = (async () => {
    const id =
      clientKey ||
      (typeof sessionStorage !== 'undefined' && sessionStorage.getItem('wavesync_participant_id')) ||
      'anon_' + Math.random().toString(36).slice(2, 8);
    const pingUrl = `${firebaseConfig.databaseURL}/music_rooms/_ping/${encodeURIComponent(id)}.json`;

    const samples = [];
    for (let i = 0; i < 5; i++) {
      try {
        const wallBefore = Date.now();
        const perfBefore = performance.now();
        const res = await fetch(pingUrl, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ts: { '.sv': 'timestamp' } }),
          cache: 'no-store'
        });
        const perfAfter = performance.now();
        if (!res.ok) continue;
        const data = await res.json();
        const serverTs = Number(data?.ts);
        if (!Number.isFinite(serverTs) || serverTs <= 0) continue;

        const rtt = Math.max(0, perfAfter - perfBefore);
        const wallMid = wallBefore + rtt / 2;
        const offset = serverTs - wallMid;
        samples.push({ index: i, rtt, offset });
      } catch {
        // Игнорируем единичный сбой пинга
      }
    }

    // Удаляем временный узел пинга в фоне
    fetch(pingUrl, { method: 'DELETE' }).catch(() => {});

    if (samples.length > 0) {
      // Пропускаем первый запрос (в нем сидит TCP/TLS handshake), если есть более свежие замеры
      const warmSamples = samples.length > 1 ? samples.slice(1) : samples;
      warmSamples.sort((a, b) => a.rtt - b.rtt);
      const best = warmSamples[0];

      serverTimeOffsetMs = Math.round(best.offset);
      clockRttMs = Math.round(best.rtt);
      clockCalibrated = true;
      notifyStatus();
      return { offsetMs: serverTimeOffsetMs, rttMs: clockRttMs };
    }
    return null;
  })().finally(() => {
    calibrationPromise = null;
  });

  return calibrationPromise;
}

// Периодическая рекалибровка при возврате вкладки из сна/фона
if (typeof document !== 'undefined' && typeof window !== 'undefined') {
  let lastCalibratedAt = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - lastCalibratedAt > 30000) {
      lastCalibratedAt = Date.now();
      calibrateServerClock().catch(() => {});
    }
  });
}

export function getServerNow() {
  return Date.now() + serverTimeOffsetMs;
}

export function getServerTimeOffset() {
  return serverTimeOffsetMs;
}

export function getClockStats() {
  return {
    connected: firebaseConnected,
    serverTimeOffsetMs,
    clockRttMs,
    clockCalibrated
  };
}

export function isFirebaseConnected() {
  return firebaseConnected;
}

export function subscribeFirebaseStatus(cb) {
  statusListeners.add(cb);
  cb(getClockStats());
  return () => statusListeners.delete(cb);
}
