// Загрузчик аудиотреков в RAM (Blob) и дисковый кэш браузера (Cache Storage)
// с реальной шкалой прогресса и умным фоновым конвейером предзагрузки очереди
import { inferMimeType } from './audioMetadata';

const CACHE_NAME = 'wavesync-audio-v2';
const MAX_MEMORY_BLOBS = 4;

const memoryCache = new Map(); // resolvedUrl -> { blobUrl, sizeBytes, contentType, lastUsedAt }
const persistedUrls = new Set(); // resolvedUrl присутствующие в Cache Storage
const inFlightDownloads = new Map(); // resolvedUrl -> { promise, listeners, latestProgress, needBlobUrl }
const pinnedUrls = new Set();
const cacheWatchers = new Set();

let activeForegroundDownloads = 0;
let notifyTimer = null;

function notifyCacheWatchers(immediate = false) {
  if (immediate) {
    if (notifyTimer) {
      clearTimeout(notifyTimer);
      notifyTimer = null;
    }
    for (const cb of cacheWatchers) {
      try {
        cb();
      } catch {}
    }
    return;
  }

  if (notifyTimer) return;
  notifyTimer = setTimeout(() => {
    notifyTimer = null;
    for (const cb of cacheWatchers) {
      try {
        cb();
      } catch {}
    }
  }, 180);
}

// Первичное сканирование уже скачанных на устройство треков при запуске
if (typeof window !== 'undefined' && window.caches) {
  window.caches
    .open(CACHE_NAME)
    .then((cache) => cache.keys())
    .then((requests) => {
      for (const req of requests) {
        if (req.url) persistedUrls.add(req.url);
      }
      if (requests.length > 0) notifyCacheWatchers(true);
    })
    .catch(() => {});
}

export function subscribeTrackCache(cb) {
  cacheWatchers.add(cb);
  return () => cacheWatchers.delete(cb);
}

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

export function isTrackReadyInCache(rawUrl) {
  const url = resolvePlayableUrl(rawUrl);
  return Boolean(url && (memoryCache.has(url) || persistedUrls.has(url)));
}

export function getTrackCacheStatus(rawUrl) {
  const url = resolvePlayableUrl(rawUrl);
  if (!url) {
    return { inMemory: false, inDiskCache: false, isReady: false, isDownloading: false, progress: 0 };
  }
  const inMemory = memoryCache.has(url);
  const inDiskCache = persistedUrls.has(url);
  const flight = inFlightDownloads.get(url);
  const isDownloading = Boolean(flight && !inMemory);
  const progress = inMemory || inDiskCache ? 100 : flight?.latestProgress?.percent || 0;

  return {
    inMemory,
    inDiskCache,
    isReady: inMemory || inDiskCache,
    isDownloading,
    progress
  };
}

export function hasActiveForegroundDownload() {
  return activeForegroundDownloads > 0;
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
    persistedUrls.add(resolvedUrl);
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
    persistedUrls.add(resolvedUrl);
    notifyCacheWatchers(true);
  } catch {
    // Игнорируем нехватку квоты (например, приватный режим браузера)
  }
}

function storeMemoryBlob(resolvedUrl, blob, contentType) {
  const typedBlob = blob.type === contentType ? blob : new Blob([blob], { type: contentType });
  const blobUrl = URL.createObjectURL(typedBlob);
  memoryCache.set(resolvedUrl, {
    blobUrl,
    sizeBytes: typedBlob.size,
    contentType,
    lastUsedAt: Date.now()
  });
  evictOldBlobsIfNeeded();
  notifyCacheWatchers(true);
  return blobUrl;
}

/**
 * Загружает трек в память (Blob URL) и/или в дисковый кэш (Cache Storage) с прогресс-коллбэком.
 */
export async function loadTrackToBlobUrl(rawUrl, options = {}) {
  const {
    expectedSizeBytes = 0,
    onProgress,
    foreground = true,
    skipBlobUrl = false
  } = options;
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

  // 2. Если фоновый прелоад в диск и трек уже на диске — готово за 0 мс!
  if (skipBlobUrl && persistedUrls.has(resolvedUrl)) {
    onProgress?.({
      stage: 'ready',
      percent: 100,
      loadedBytes: expectedSizeBytes,
      totalBytes: expectedSizeBytes,
      speedBps: 0,
      fromCache: true
    });
    return {
      playableUrl: null,
      mode: 'disk-cache',
      sizeBytes: expectedSizeBytes,
      fromCache: true
    };
  }

  // 3. Если трек уже качается в фоне — переиспользуем тот же поток загрузки
  const existing = inFlightDownloads.get(resolvedUrl);
  if (existing) {
    if (!skipBlobUrl) existing.needBlobUrl = true;
    if (onProgress) {
      existing.listeners.add(onProgress);
      if (existing.latestProgress) {
        onProgress(existing.latestProgress);
      }
    }
    if (foreground) activeForegroundDownloads++;
    try {
      const res = await existing.promise;
      if (!skipBlobUrl && !res.playableUrl) {
        const disk = await tryReadFromCacheStorage(resolvedUrl);
        if (disk) {
          const blobUrl = storeMemoryBlob(resolvedUrl, disk.blob, disk.contentType);
          return { playableUrl: blobUrl, mode: 'memory', sizeBytes: disk.blob.size, fromCache: true };
        }
      }
      return res;
    } finally {
      if (foreground) activeForegroundDownloads = Math.max(0, activeForegroundDownloads - 1);
      if (onProgress) existing.listeners.delete(onProgress);
    }
  }

  const listeners = new Set();
  if (onProgress) listeners.add(onProgress);

  const entry = {
    listeners,
    needBlobUrl: !skipBlobUrl,
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
    notifyCacheWatchers(false);
  };

  inFlightDownloads.set(resolvedUrl, entry);
  if (foreground) activeForegroundDownloads++;

  entry.promise = (async () => {
    // 4. Проверяем Cache Storage
    const diskHit = await tryReadFromCacheStorage(resolvedUrl);
    if (diskHit) {
      let blobUrl = null;
      if (entry.needBlobUrl) {
        blobUrl = storeMemoryBlob(resolvedUrl, diskHit.blob, diskHit.contentType);
      }
      emitProgress({
        stage: 'ready',
        percent: 100,
        loadedBytes: diskHit.blob.size,
        totalBytes: diskHit.blob.size,
        speedBps: 0,
        fromCache: true
      });
      return {
        playableUrl: blobUrl,
        mode: entry.needBlobUrl ? 'memory' : 'disk-cache',
        sizeBytes: diskHit.blob.size,
        fromCache: true
      };
    }

    // 5. Потоковое скачивание по сети
    try {
      emitProgress(entry.latestProgress);
      const response = await fetch(resolvedUrl, { mode: 'cors', credentials: 'omit' });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const contentType = resolveMime(resolvedUrl, response.headers.get('content-type') || '');
      const headerLen = Number(response.headers.get('content-length')) || 0;
      const totalBytes = headerLen > 0 ? headerLen : Number(expectedSizeBytes) || 0;

      let blob;
      const startedAt = performance.now();

      if (!response.body || !response.body.getReader) {
        blob = await response.blob();
        if (!blob.type) blob = new Blob([blob], { type: contentType });
      } else {
        const reader = response.body.getReader();
        const chunks = [];
        let loadedBytes = 0;
        let lastEmitAt = 0;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value && value.byteLength > 0) {
            chunks.push(value);
            loadedBytes += value.byteLength;

            const now = performance.now();
            if (now - lastEmitAt >= 120) {
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
        blob = new Blob(chunks, { type: contentType });
      }

      await tryWriteToCacheStorage(resolvedUrl, blob, contentType);
      const blobUrl = entry.needBlobUrl ? storeMemoryBlob(resolvedUrl, blob, contentType) : null;

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
        mode: entry.needBlobUrl ? 'memory' : 'disk-cache',
        sizeBytes: blob.size,
        fromCache: false
      };
    } catch (err) {
      console.warn('Track preload CORS/network fallback to direct-stream:', resolvedUrl, err);
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
    if (foreground) activeForegroundDownloads = Math.max(0, activeForegroundDownloads - 1);
    notifyCacheWatchers(true);
  });

  return entry.promise;
}

/**
 * Быстрая предзагрузка одного трека в память (используется для следующего трека).
 */
export function prefetchTrack(rawUrl, expectedSizeBytes = 0) {
  const resolved = resolvePlayableUrl(rawUrl);
  if (!resolved) return Promise.resolve(null);
  return loadTrackToBlobUrl(resolved, {
    expectedSizeBytes,
    foreground: false,
    skipBlobUrl: false
  }).catch(() => null);
}

/**
 * Последовательно предзагружает всю очередь по приоритету (ближайшие — в RAM, остальные — на диск),
 * не мешая загрузке активного трека. Возвращает функцию отмены при перестроении очереди.
 */
export function startQueuePrefetchPipeline(tracks = []) {
  let cancelled = false;

  (async () => {
    for (let i = 0; i < tracks.length; i++) {
      if (cancelled) return;
      const track = tracks[i];
      if (!track?.url || track.source === 'soundcloud' || track.source === 'youtube') continue;

      // Если сейчас качается текущий активный трек — ждём завершения, чтобы не делить канал
      while (!cancelled && activeForegroundDownloads > 0) {
        await new Promise((r) => setTimeout(r, 150));
      }
      if (cancelled) return;

      // Первый ближайший трек держим в RAM (Blob URL = 0 мс старт), остальные — в Cache Storage
      const keepInRam = i === 0;
      const status = getTrackCacheStatus(track.url);
      if (keepInRam && status.inMemory) continue;
      if (!keepInRam && status.isReady) continue;

      await loadTrackToBlobUrl(track.url, {
        expectedSizeBytes: track.sizeBytes || 0,
        foreground: false,
        skipBlobUrl: !keepInRam
      }).catch(() => null);
    }
  })();

  return () => {
    cancelled = true;
  };
}
