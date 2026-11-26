// Безопасный Service Worker для PWA WaveSync:
// - Сеть приоритетна для index.html, чтобы обновления выходили сразу
// - Статика ./assets/* кэшируется для быстрого старта приложения
// - Аудио и Firebase запросы не перехватываются, ими управляет trackLoader (wavesync-audio-v2)

const SHELL_CACHE = 'wavesync-shell-v1';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith('wavesync-shell-') && k !== SHELL_CACHE)
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Не вмешиваемся в аудио-потоки /music/* (их кэширует trackLoader в wavesync-audio-v2)
  if (url.pathname.includes('/music/') || /\.(m4a|mp3|wav|ogg|flac)$/i.test(url.pathname)) {
    return;
  }

  // Для HTML-навигации: Network-First (свежая сборка всегда видна)
  if (req.mode === 'navigate' || url.pathname.endsWith('.html')) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const clone = res.clone();
          caches.open(SHELL_CACHE).then((c) => c.put(req, clone)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  // Для хэшированных ассетов сборки (JS/CSS/иконки): Cache-First
  if (
    url.pathname.includes('/assets/') ||
    url.pathname.endsWith('.png') ||
    url.pathname.endsWith('.webmanifest')
  ) {
    event.respondWith(
      caches.match(req).then(
        (cached) =>
          cached ||
          fetch(req).then((res) => {
            if (res && res.status === 200) {
              const clone = res.clone();
              caches.open(SHELL_CACHE).then((c) => c.put(req, clone)).catch(() => {});
            }
            return res;
          })
      )
    );
  }
});
