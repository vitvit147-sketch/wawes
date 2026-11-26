// Передача аудиофайлов с телефона/ПК через Firebase Realtime Database чанками (0 руб., работает без TURN/VPN)
import { database } from './firebase';
import { ref, set, get, onValue, onChildAdded, remove } from 'firebase/database';

const RTDB_CHUNK_SIZE = 128 * 1024; // 128 КБ на чанк — оптимально для мобильного 4G
const UPLOAD_CONCURRENCY = 2;

function bufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  const sliceLen = 8192;
  for (let i = 0; i < len; i += sliceLen) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + sliceLen, len)));
  }
  return btoa(binary);
}

function base64ToUint8Array(base64) {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function buildRtdbTrackUrl(roomCode, trackId) {
  return `rtdb-track://${encodeURIComponent(String(roomCode || ''))}/${encodeURIComponent(String(trackId || ''))}`;
}

export function parseRtdbTrackUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string' || !rawUrl.startsWith('rtdb-track://')) {
    return null;
  }
  const rest = rawUrl.slice('rtdb-track://'.length);
  const slashIdx = rest.indexOf('/');
  if (slashIdx <= 0) return null;
  const roomCode = decodeURIComponent(rest.slice(0, slashIdx));
  const trackId = decodeURIComponent(rest.slice(slashIdx + 1));
  if (!roomCode || !trackId) return null;
  return { roomCode, trackId };
}

/**
 * Хост: загружает локальный аудиофайл в RTDB чанками с контролем конкурентности.
 */
export async function sendTrackViaRtdb({
  roomCode,
  trackId,
  file,
  mimeType,
  onProgress = () => {}
}) {
  const basePath = `music_rooms/${roomCode}/rtdb_transfer/${trackId}`;
  const totalChunks = Math.max(1, Math.ceil(file.size / RTDB_CHUNK_SIZE));
  const cleanMime = mimeType || file.type || 'audio/mpeg';

  await set(ref(database, `${basePath}/meta`), {
    trackId,
    name: file.name || 'track.mp3',
    mimeType: cleanMime,
    size: file.size,
    totalChunks,
    createdAt: Date.now()
  });

  onProgress(5);

  let completed = 0;
  let nextIdx = 0;

  async function worker() {
    while (true) {
      const idx = nextIdx++;
      if (idx >= totalChunks) return;
      const start = idx * RTDB_CHUNK_SIZE;
      const end = Math.min(file.size, start + RTDB_CHUNK_SIZE);
      const sliceBuf = await file.slice(start, end).arrayBuffer();
      const b64 = bufferToBase64(sliceBuf);
      await set(ref(database, `${basePath}/chunks/${idx}`), b64);
      completed++;
      const pct = Math.min(100, Math.round(5 + (completed / totalChunks) * 95));
      onProgress(pct);
    }
  }

  const workers = [];
  for (let i = 0; i < Math.min(UPLOAD_CONCURRENCY, totalChunks); i++) {
    workers.push(worker());
  }
  await Promise.all(workers);
  return true;
}

/**
 * Слушатель: скачивает трек из RTDB через onChildAdded (каждый чанк загружается ровно 1 раз).
 */
export function receiveTrackViaRtdb({ roomCode, trackId, onProgress = () => {} }) {
  return new Promise((resolve, reject) => {
    const basePath = `music_rooms/${roomCode}/rtdb_transfer/${trackId}`;
    const metaRef = ref(database, `${basePath}/meta`);
    const chunksRef = ref(database, `${basePath}/chunks`);

    let settled = false;
    let unsubMeta = null;
    let unsubChild = null;
    let timeoutId = null;
    const receivedChunks = new Map();

    const cleanup = () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      if (unsubMeta) {
        unsubMeta();
        unsubMeta = null;
      }
      if (unsubChild) {
        unsubChild();
        unsubChild = null;
      }
    };

    const failWith = (err) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    };

    // Таймаут ожидания метаданных/чанков на случай обрыва со стороны хоста
    const resetStallTimer = () => {
      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        failWith(new Error('Таймаут загрузки файла от хоста'));
      }, 45000);
    };
    resetStallTimer();

    unsubMeta = onValue(
      metaRef,
      (snap) => {
        const meta = snap.val();
        if (!meta || !meta.totalChunks || unsubChild) return;

        resetStallTimer();

        const tryFinish = () => {
          if (settled || receivedChunks.size < meta.totalChunks) return;
          const ordered = [];
          let loadedBytes = 0;
          for (let i = 0; i < meta.totalChunks; i++) {
            const part = receivedChunks.get(i);
            if (!part) return;
            ordered.push(part);
            loadedBytes += part.byteLength;
          }
          settled = true;
          cleanup();
          const mime = meta.mimeType || 'audio/mpeg';
          const blob = new Blob(ordered, { type: mime });
          resolve({ blob, mimeType: mime, size: loadedBytes || meta.size });
        };

        // Подписываемся на добавление каждого чанка отдельно без повторной передачи всего узла chunks
        unsubChild = onChildAdded(
          chunksRef,
          (childSnap) => {
            if (settled) return;
            const idx = Number(childSnap.key);
            const b64 = childSnap.val();
            if (Number.isInteger(idx) && typeof b64 === 'string' && !receivedChunks.has(idx)) {
              receivedChunks.set(idx, base64ToUint8Array(b64));
              resetStallTimer();
              const count = receivedChunks.size;
              const pct = Math.min(99, Math.round((count / meta.totalChunks) * 100));
              onProgress({
                stage: 'downloading',
                percent: pct,
                loadedBytes: Math.round((count / meta.totalChunks) * (meta.size || 0)),
                totalBytes: meta.size || 0,
                speedBps: 0
              });
              tryFinish();
            }
          },
          (err) => failWith(err)
        );

        // На случай если чанки уже полностью лежат в RTDB на момент подписки
        get(chunksRef)
          .then((allSnap) => {
            if (settled) return;
            const val = allSnap.val();
            if (!val) return;
            for (const [k, b64] of Object.entries(val)) {
              const idx = Number(k);
              if (Number.isInteger(idx) && typeof b64 === 'string' && !receivedChunks.has(idx)) {
                receivedChunks.set(idx, base64ToUint8Array(b64));
              }
            }
            const pct = Math.min(99, Math.round((receivedChunks.size / meta.totalChunks) * 100));
            onProgress({
              stage: 'downloading',
              percent: pct,
              loadedBytes: Math.round((receivedChunks.size / meta.totalChunks) * (meta.size || 0)),
              totalBytes: meta.size || 0,
              speedBps: 0
            });
            tryFinish();
          })
          .catch(() => {});
      },
      (err) => failWith(err)
    );
  });
}

export async function cleanupRtdbTransfer(roomCode, trackId) {
  try {
    await remove(ref(database, `music_rooms/${roomCode}/rtdb_transfer/${trackId}`));
  } catch {}
}
