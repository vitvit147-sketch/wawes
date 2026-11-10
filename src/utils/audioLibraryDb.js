// Постоянная медиатека пользователя в браузере (IndexedDB)
// Позволяет сохранять до сотен аудиофайлов без необходимости выбирать их с диска каждый раз заново

const DB_NAME = 'WaveSyncLibrary';
const DB_VERSION = 1;
const STORE_NAME = 'tracks';

function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      resolve(null);
      return;
    }
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('addedAt', 'addedAt', { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveTrackToLibrary(track) {
  const db = await openDb();
  if (!db) return;

  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);

      const record = {
        id: track.id,
        title: track.title || 'Без названия',
        artist: track.artist || 'Неизвестный исполнитель',
        fileName: track.fileName || '',
        size: track.size || 0,
        duration: track.duration || 0,
        format: track.format || 'MP3',
        mimeType: track.mimeType || 'audio/mpeg',
        bitrateKbps: track.bitrateKbps || 320,
        audioUrl: track.audioUrl || null,
        fileBlob: track.fileBlob || null,
        addedAt: track.addedAt || Date.now()
      };

      store.put(record);

      tx.oncomplete = () => resolve(record);
      tx.onerror = () => reject(tx.error);
    } catch (e) {
      reject(e);
    }
  });
}

export async function getLibraryTracks() {
  const db = await openDb();
  if (!db) return [];

  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.getAll();

      request.onsuccess = () => {
        const res = (request.result || []).sort((a, b) => (a.addedAt || 0) - (b.addedAt || 0));
        resolve(res);
      };
      request.onerror = () => reject(request.error);
    } catch (e) {
      reject(e);
    }
  });
}

export async function updateLibraryTrackAudioUrl(trackId, audioUrl) {
  const db = await openDb();
  if (!db) return;

  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const getReq = store.get(trackId);

      getReq.onsuccess = () => {
        const item = getReq.result;
        if (!item) {
          resolve(null);
          return;
        }
        item.audioUrl = audioUrl;
        store.put(item);
      };

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    } catch (e) {
      reject(e);
    }
  });
}

export async function deleteTrackFromLibrary(trackId) {
  const db = await openDb();
  if (!db) return;

  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.delete(trackId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    } catch (e) {
      reject(e);
    }
  });
}

export async function clearLibrary() {
  const db = await openDb();
  if (!db) return;

  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    } catch (e) {
      reject(e);
    }
  });
}
