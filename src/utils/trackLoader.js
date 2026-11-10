// Загрузчик аудиотреков в оперативную память (Blob + Cache Storage) с реальной шкалой прогресса и фоновой предзагрузкой
import { inferMimeType } from './audioMetadata';

const CACHE_NAME = 'wavesync-audio-v2';
const MAX_MEMORY_BLOBS = 6;

const memoryCache = new Map(); // resolvedUrl -> { blobUrl, sizeBytes, contentType, lastUsedAt }
const inFlightDownloads = new Map(); // resolvedUrl -> { promise, listeners: Set, latestProgress }
const pinnedUrls = new Set();

export function resolvePlayableUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  const trimmed = rawUrl.trim();
  if (/^(https?:|blob:|data:)/i.test(trimmed)) return trimmed;
  if (typeof window !== 'undefined' && window.location) {
    try {
      return new URL(trimmed, window.location.href).href;
    } catch {
      return trimmed;
    }
  }
  return trimmed;
}

export function isTrackCachedInMemory(rawUrl) {
  const url = resolvePlayableUrl(rawUrl);
  return Boolean(url && memoryCache.has(url));
}

function evictOldBlobsIfNeeded() {
  if (memoryCache.size <= MAX_MEMORY_BLOBS) return;
  const candidates = [];
  for (const [key, entry] of memoryCache.entries()) {
    if (!pinnedUrls.has(key)) {
      candidates.push([key, entry.lastUsedAt]);
    }
  }
  candidates.sort((a, b) => a[1] - b[1]);
  while (memoryCache.size > MAX_MEMORY_BLOBS && candidates.length > 0) {
    const [oldestKey] = candidates.shift();
    const removed = memoryCache.get(oldestKey);
    memoryCache.delete(oldestKey);
    if (removed?.blobUrl) {
      try {
        URL.revokeObjectURL(removed.blobUrl);
      } catch {}
    }
  }
}

export function setPinnedUrls(rawUrls = []) {
  pinnedUrls.clear();
  for (const u of rawUrls) {
    const resolved = resolvePlayableUrl(u);
    if (resolved) pinnedUrls.add(resolved);
  }
}

function resolveMime(url, headerType) {
  if (headerType && headerType.startsWith('audio/') && !headerType.includes('octet-stream')) {
    return headerType.split(';')[0].trim();
  }
  const cleanName = url.split('?')[0].split('/').pop() || '';
  return inferMimeType(cleanName, headerType || '');
}

async function tryReadFromCacheStorage(resolvedUrl) {
  if (typeof window === 'undefined' || !window.caches) return null;
  try {
    const cache = await window.caches.open(CACHE_NAME);
    const match = await cache.match(resolvedUrl);
    if (!match) return null;
    const blob = await match.blob();
    if (!blob || blob.size === 0) return null;
    return {
      blob,
      contentType: resolveMime(resolvedUrl, match.headers.get('content-type') || blob.type)
    };
  } catch {
    return null;
  }
}

async function tryWriteToCacheStorage(resolvedUrl, blob, contentType) {
  if (typeof window === 'undefined' || !window.caches || !blob || blob.size === 0) return;
  try {
    const cache = await window.caches.open(CACHE_NAME);
    const response = new Response(blob, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(blob.size)
      }
    });
    await cache.put(resolvedUrl, response);
  } catch {
    // Тихо игнорируем нехватку квоты (например, в приватном режиме Safari)
  }
}

/**
 * Скачивает трек целиком в оперативную память с отображением прогресса (% / байты / скорость).
 * Если трек уже есть в RAM или Cache Storage — отдаёт мгновенно (100%).
 * Если сторонний хост блокирует CORS — аккуратно переключается на direct-stream.
 */
export async function loadTrackToBlobUrl(rawUrl, options = {}) {
  const { expectedSizeBytes = 0, onProgress } = options;
  const resolvedUrl = resolvePlayableUrl(rawUrl);

  if (!resolvedUrl) {
    throw new Error('Пустой URL трека');
  }

  // 1. Быстрый хит в оперативной памяти
  const memEntry = memoryCache.get(resolvedUrl);
  if (memEntry) {
    memEntry.lastUsedAt = Date.now();
    onProgress?.({
      stage: 'ready',
      percent: 100,
      loadedBytes: memEntry.sizeBytes,
      totalBytes: memEntry.sizeBytes,
      speedBps: 0,
      fromCache: true
    });
    return {
      playableUrl: memEntry.blobUrl,
      mode: 'memory',
      sizeBytes: memEntry.sizeBytes,
      fromCache: true
    };
  }

  // 2. Если этот трек уже качается (например, фоновым preload) — подключаемся к нему же
  const existing = inFlightDownloads.get(resolvedUrl);
  if (existing) {
    if (onProgress) {
      existing.listeners.add(onProgress);
      if (existing.latestProgress) {
        onProgress(existing.latestProgress);
      }
    }
    try {
      return await existing.promise;
    } finally {
      if (onProgress) existing.listeners.delete(onProgress);
    }
  }

  const listeners = new Set();
  if (onProgress) listeners.add(onProgress);

  const entry = {
    listeners,
    latestProgress: {
      stage: 'downloading',
      percent: 0,
      loadedBytes: 0,
      totalBytes: expectedSizeBytes || 0,
      speedBps: 0,
      fromCache: false
    },
    promise: null
  };

  const emitProgress = (payload) => {
    entry.latestProgress = payload;
    for (const cb of listeners) {
      try {
        cb(payload);
      } catch {}
    }
  };

  inFlightDownloads.set(resolvedUrl, entry);

  entry.promise = (async () => {
    // 3. Проверяем Cache Storage браузера (мгновенное чтение с диска без сети)
    const diskHit = await tryReadFromCacheStorage(resolvedUrl);
    if (diskHit) {
      const typedBlob =
        diskHit.blob.type === diskHit.contentType
          ? diskHit.blob
          : new Blob([diskHit.blob], { type: diskHit.contentType });
      const blobUrl = URL.createObjectURL(typedBlob);
      memoryCache.set(resolvedUrl, {
        blobUrl,
        sizeBytes: typedBlob.size,
        contentType: diskHit.contentType,
        lastUsedAt: Date.now()
      });
      evictOldBlobsIfNeeded();
      emitProgress({
        stage: 'ready',
        percent: 100,
        loadedBytes: typedBlob.size,
        totalBytes: typedBlob.size,
        speedBps: 0,
        fromCache: true
      });
      return {
        playableUrl: blobUrl,
        mode: 'memory',
        sizeBytes: typedBlob.size,
        fromCache: true
      };
    }

    // 4. Потоковое скачивание по сети с подсчетом прогресса
    try {
      emitProgress(entry.latestProgress);
      const response = await fetch(resolvedUrl, { mode: 'cors', credentials: 'omit' });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const contentType = resolveMime(resolvedUrl, response.headers.get('content-type') || '');
      const headerLen = Number(response.headers.get('content-length')) || 0;
      const totalBytes = headerLen > 0 ? headerLen : Number(expectedSizeBytes) || 0;

      if (!response.body || !response.body.getReader) {
        const blob = await response.blob();
        const typedBlob = blob.type ? blob : new Blob([blob], { type: contentType });
        await tryWriteToCacheStorage(resolvedUrl, typedBlob, contentType);
        const blobUrl = URL.createObjectURL(typedBlob);
        memoryCache.set(resolvedUrl, {
          blobUrl,
          sizeBytes: typedBlob.size,
          contentType,
          lastUsedAt: Date.now()
        });
        evictOldBlobsIfNeeded();
        emitProgress({
          stage: 'ready',
          percent: 100,
          loadedBytes: typedBlob.size,
          totalBytes: typedBlob.size,
          speedBps: 0,
          fromCache: false
        });
        return {
          playableUrl: blobUrl,
          mode: 'memory',
          sizeBytes: typedBlob.size,
          fromCache: false
        };
      }

      const reader = response.body.getReader();
      const chunks = [];
      let loadedBytes = 0;
      const startedAt = performance.now();
      let lastEmitAt = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value && value.byteLength > 0) {
          chunks.push(value);
          loadedBytes += value.byteLength;

          const now = performance.now();
          if (now - lastEmitAt >= 100) {
            lastEmitAt = now;
            const elapsedSec = Math.max(0.05, (now - startedAt) / 1000);
            const speedBps = loadedBytes / elapsedSec;
            const denom = Math.max(totalBytes, loadedBytes);
            const percent =
              totalBytes > 0
                ? Math.min(99, Math.round((loadedBytes / denom) * 100))
                : Math.min(95, Math.round((loadedBytes / (2.2 * 1024 * 1024)) * 90));

            emitProgress({
              stage: 'downloading',
              percent,
              loadedBytes,
              totalBytes,
              speedBps,
              fromCache: false
            });
          }
        }
      }

      const blob = new Blob(chunks, { type: contentType });
      await tryWriteToCacheStorage(resolvedUrl, blob, contentType);
      const blobUrl = URL.createObjectURL(blob);

      memoryCache.set(resolvedUrl, {
        blobUrl,
        sizeBytes: blob.size,
        contentType,
        lastUsedAt: Date.now()
      });
      evictOldBlobsIfNeeded();

      const totalElapsedSec = Math.max(0.05, (performance.now() - startedAt) / 1000);
      emitProgress({
        stage: 'ready',
        percent: 100,
        loadedBytes: blob.size,
        totalBytes: blob.size,
        speedBps: blob.size / totalElapsedSec,
        fromCache: false
      });

      return {
        playableUrl: blobUrl,
        mode: 'memory',
        sizeBytes: blob.size,
        fromCache: false
      };
    } catch (err) {
      // Если сторонний хост блокирует CORS (например Яндекс Диск), играем потоком напрямую
      console.warn('Track blob preload failed, falling back to direct stream:', resolvedUrl, err);
      emitProgress({
        stage: 'direct-stream',
        percent: 100,
        loadedBytes: 0,
        totalBytes: expectedSizeBytes || 0,
        speedBps: 0,
        fromCache: false
      });
      return {
        playableUrl: resolvedUrl,
        mode: 'direct-stream',
        sizeBytes: 0,
        fromCache: false
      };
    }
  })().finally(() => {
    inFlightDownloads.delete(resolvedUrl);
  });

  return entry.promise;
}

/**
 * Тихая фоновая предзагрузка следующего трека, чтобы смена трека происходила за 0 мс.
 */
export function prefetchTrack(rawUrl, expectedSizeBytes = 0) {
  const resolved = resolvePlayableUrl(rawUrl);
  if (!resolved || memoryCache.has(resolved) || inFlightDownloads.has(resolved)) return;
  loadTrackToBlobUrl(resolved, { expectedSizeBytes }).catch(() => {});
}
