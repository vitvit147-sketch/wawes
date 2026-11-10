// Загрузка аудиофайлов в Firebase Cloud Storage для мгновенного стриминга слушателям без P2P/NAT
import { app } from './firebase';
import {
  getStorage,
  ref,
  uploadBytesResumable,
  getDownloadURL,
  deleteObject
} from 'firebase/storage';

export let storageInstance = null;

try {
  storageInstance = getStorage(app);
} catch (e) {
  console.warn('Firebase Storage init error:', e);
}

/**
 * Загружает аудиофайл в Cloud Storage с отслеживанием прогресса
 * @param {File|Blob} file 
 * @param {string} trackId 
 * @param {(pct: number) => void} onProgress 
 * @returns {Promise<string>} downloadURL
 */
export async function uploadAudioToCloud(file, trackId, onProgress = () => {}) {
  if (!storageInstance) {
    storageInstance = getStorage(app);
  }

  const safeFileName = (file.name || 'track.mp3').replace(/[^\w.-]/gi, '_');
  const path = `wavesync_audio/${trackId}/${safeFileName}`;
  const fileRef = ref(storageInstance, path);

  const metadata = {
    contentType: file.type || 'audio/mpeg',
    customMetadata: {
      trackId,
      uploadedAt: String(Date.now())
    }
  };

  const uploadTask = uploadBytesResumable(fileRef, file, metadata);

  return new Promise((resolve, reject) => {
    uploadTask.on(
      'state_changed',
      (snapshot) => {
        if (snapshot.totalBytes > 0) {
          const pct = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
          onProgress(Math.min(100, Math.max(0, pct)));
        }
      },
      (error) => {
        if (error.code === 'storage/unknown' || error.status_ === 404) {
          const err = new Error(
            'Firebase Storage ещё не активирован в консоли проекта campgame-156ac. Активируйте его в 2 клика: https://console.firebase.google.com/project/campgame-156ac/storage'
          );
          err.code = 'STORAGE_NOT_INITIALIZED';
          reject(err);
          return;
        }
        reject(error);
      },
      async () => {
        try {
          const downloadUrl = await getDownloadURL(uploadTask.snapshot.ref);
          onProgress(100);
          resolve(downloadUrl);
        } catch (e) {
          reject(e);
        }
      }
    );
  });
}

export async function deleteAudioFromCloud(trackId, fileName) {
  if (!storageInstance) return;
  try {
    const safeFileName = (fileName || 'track.mp3').replace(/[^\w.-]/gi, '_');
    const fileRef = ref(storageInstance, `wavesync_audio/${trackId}/${safeFileName}`);
    await deleteObject(fileRef);
  } catch {
    // ignore deletion errors
  }
}
