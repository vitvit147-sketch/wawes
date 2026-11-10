// Клиент Supabase Storage для постоянной медиатеки и прямого стриминга музыки
import { createClient } from '@supabase/supabase-js';

const env = typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env : {};
const SUPABASE_URL = env.VITE_SUPABASE_URL || 'https://xieenpcxdxtfdbfapuse.supabase.co';
const SUPABASE_KEY = env.VITE_SUPABASE_ANON_KEY || '';

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const BUCKET_NAME = 'music';
const LIBRARY_FILE = 'library.json';

/**
 * Получить список всех сохраненных треков из облачной библиотеки Supabase
 */
export async function getCloudLibrary() {
  try {
    const { data: pubData } = supabase.storage.from(BUCKET_NAME).getPublicUrl(LIBRARY_FILE);
    const res = await fetch(`${pubData.publicUrl}?t=${Date.now()}`);
    if (!res.ok) return [];
    const list = await res.json();
    return Array.isArray(list) ? list : [];
  } catch (e) {
    console.warn('Failed fetching cloud library:', e);
    return [];
  }
}

/**
 * Загрузить трек в бакет Supabase и обновить библиотеку
 */
export async function uploadTrackToCloud({ file, metadata, onProgress = () => {} }) {
  const trackId = 'tr_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
  const ext = (file.name || 'mp3').split('.').pop() || 'mp3';
  const cleanName = (file.name || 'track.mp3').replace(/[^\w.-]/gi, '_');
  const storagePath = `tracks/${trackId}_${cleanName}`;

  onProgress(15);

  const { data, error } = await supabase.storage.from(BUCKET_NAME).upload(storagePath, file, {
    contentType: file.type || 'audio/mpeg',
    upsert: true
  });

  if (error) {
    throw new Error('Ошибка загрузки в Supabase: ' + error.message);
  }

  onProgress(75);

  const { data: pubData } = supabase.storage.from(BUCKET_NAME).getPublicUrl(storagePath);
  const audioUrl = pubData.publicUrl;

  const trackRecord = {
    id: trackId,
    title: metadata?.title || file.name.replace(/\.[^.]+$/, ''),
    artist: metadata?.artist || 'Неизвестный исполнитель',
    fileName: file.name,
    storagePath,
    size: file.size,
    duration: metadata?.duration || 0,
    format: metadata?.format || ext.toUpperCase(),
    bitrateKbps: metadata?.bitrateKbps || 320,
    mimeType: file.type || 'audio/mpeg',
    audioUrl,
    addedAt: Date.now()
  };

  onProgress(90);

  // Обновляем общий манифест библиотеки
  try {
    const currentLib = await getCloudLibrary();
    const nextLib = [...currentLib.filter((t) => t.id !== trackId), trackRecord];

    await supabase.storage.from(BUCKET_NAME).upload(LIBRARY_FILE, JSON.stringify(nextLib, null, 2), {
      contentType: 'application/json',
      upsert: true
    });
  } catch (err) {
    console.warn('Failed updating library.json:', err);
  }

  onProgress(100);
  return trackRecord;
}

/**
 * Удалить трек из Supabase
 */
export async function deleteTrackFromCloud(trackId) {
  try {
    const currentLib = await getCloudLibrary();
    const track = currentLib.find((t) => t.id === trackId);
    if (track?.storagePath) {
      await supabase.storage.from(BUCKET_NAME).remove([track.storagePath]);
    }
    const nextLib = currentLib.filter((t) => t.id !== trackId);
    await supabase.storage.from(BUCKET_NAME).upload(LIBRARY_FILE, JSON.stringify(nextLib, null, 2), {
      contentType: 'application/json',
      upsert: true
    });
    return nextLib;
  } catch (e) {
    console.warn('Error deleting track from Supabase:', e);
    return [];
  }
}
