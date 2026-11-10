// Резервная передача аудиофайлов через бесплатный Realtime Database WebSocket,
// если прямой WebRTC P2P заблокирован оператором связи / симметричным NAT.
// Работает на бесплатном тарифе Spark (0 рублей, без привязки карт).
import { database } from './firebase';
import { ref, set, get, onValue, off, remove } from 'firebase/database';

const RTDB_CHUNK_SIZE = 256 * 1024; // 256 КБ на чанк

/**
 * Преобразует ArrayBuffer в строку base64
 */
function bufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  const chunkSize = 8192;
  for (let i = 0; i < len; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + chunkSize, len)));
  }
  return btoa(binary);
}

/**
 * Преобразует строку base64 в Uint8Array
 */
function base64ToUint8Array(base64) {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Хост: загружает трек в RTDB чанками для слушателей
 */
export async function sendTrackViaRtdb({ roomCode, trackId, file, onProgress = () => {} }) {
  const basePath = `music_rooms/${roomCode}/rtdb_transfer/${trackId}`;
  const totalChunks = Math.ceil(file.size / RTDB_CHUNK_SIZE);

  // Сначала пишем метаданные
  await set(ref(database, `${basePath}/meta`), {
    trackId,
    name: file.name,
    mimeType: file.type || 'audio/mpeg',
    size: file.size,
    totalChunks,
    createdAt: Date.now()
  });

  onProgress(5);

  let offset = 0;
  let chunkIdx = 0;

  while (offset < file.size) {
    const end = Math.min(file.size, offset + RTDB_CHUNK_SIZE);
    const sliceBuf = await file.slice(offset, end).arrayBuffer();
    const b64 = bufferToBase64(sliceBuf);

    await set(ref(database, `${basePath}/chunks/${chunkIdx}`), b64);

    offset = end;
    chunkIdx++;

    const pct = Math.min(100, Math.round(5 + (offset / file.size) * 95));
    onProgress(pct);
  }

  return true;
}

/**
 * Слушатель: скачивает трек из RTDB чанками
 */
export function receiveTrackViaRtdb({ roomCode, trackId, onProgress = () => {} }) {
  return new Promise((resolve, reject) => {
    const basePath = `music_rooms/${roomCode}/rtdb_transfer/${trackId}`;
    const metaRef = ref(database, `${basePath}/meta`);

    let meta = null;
    const receivedChunks = new Map();
    let unsubChunks = null;
    let unsubMeta = null;

    const cleanup = () => {
      if (unsubMeta) unsubMeta();
      if (unsubChunks) unsubChunks();
    };

    unsubMeta = onValue(
      metaRef,
      async (snap) => {
        meta = snap.val();
        if (!meta || !meta.totalChunks) return;

        // Метаданные получены, слушаем чанки
        const chunksRef = ref(database, `${basePath}/chunks`);
        unsubChunks = onValue(
          chunksRef,
          (chunkSnap) => {
            const val = chunkSnap.val();
            if (!val) return;

            for (const [idxStr, b64] of Object.entries(val)) {
              const idx = Number(idxStr);
              if (!receivedChunks.has(idx) && typeof b64 === 'string') {
                receivedChunks.set(idx, base64ToUint8Array(b64));
              }
            }

            const count = receivedChunks.size;
            const pct = Math.min(100, Math.round((count / meta.totalChunks) * 100));
            onProgress(pct);

            if (count >= meta.totalChunks) {
              cleanup();

              // Собираем все чанки по порядку
              const ordered = [];
              for (let i = 0; i < meta.totalChunks; i++) {
                ordered.push(receivedChunks.get(i));
              }

              const blob = new Blob(ordered, { type: meta.mimeType || 'audio/mpeg' });
              const blobUrl = URL.createObjectURL(blob);
              resolve({ blobUrl, blob, size: meta.size });
            }
          },
          (err) => {
            cleanup();
            reject(err);
          }
        );
      },
      (err) => {
        cleanup();
        reject(err);
      }
    );
  });
}

/**
 * Очищает чанки после завершения передачи
 */
export async function cleanupRtdbTransfer(roomCode, trackId) {
  try {
    await remove(ref(database, `music_rooms/${roomCode}/rtdb_transfer/${trackId}`));
  } catch {}
}
