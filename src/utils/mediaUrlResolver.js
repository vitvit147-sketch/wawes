// Распознавание ссылок SoundCloud, Яндекс Диска, прямых аудиопотоков (MP3/M4A/WAV)
import { STRAY_KIDS_CATALOG } from '../data/strayKidsCatalog.js';

const SC_REGEX = /soundcloud\.com\/[a-zA-Z0-9-_]+\/[a-zA-Z0-9-_]+/i;
const YANDEX_DISK_REGEX = /(?:disk\.yandex\.(?:ru|com)|yadi\.sk)\/d\/([a-zA-Z0-9_-]+)/i;
const AUDIO_FILE_REGEX = /\.(mp3|wav|m4a|aac|ogg|opus|flac)(?:\?.*)?$/i;
const YT_REGEX = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/|music\.youtube\.com\/watch\?v=)([^"&?\/\s]{11})/i;

export const DEMO_PRESETS = STRAY_KIDS_CATALOG;

export function detectMediaType(url) {
  if (!url || typeof url !== 'string') return null;
  const clean = url.trim();
  if (YANDEX_DISK_REGEX.test(clean)) return 'yandex';
  if (SC_REGEX.test(clean)) return 'soundcloud';
  if (AUDIO_FILE_REGEX.test(clean)) return 'audio';
  if (clean.includes('/music/') || clean.startsWith('music/')) return 'audio';
  if (YT_REGEX.test(clean)) return 'youtube';
  if (/^https?:\/\//i.test(clean)) return 'audio';
  return 'unknown';
}

export function extractYouTubeId(url) {
  const match = url?.match(YT_REGEX);
  return match ? match[1] : null;
}

function parseYandexAudioFilename(rawName = '') {
  const clean = rawName.replace(/\.[^.]+$/, '').trim();
  const parts = clean.split(' - ');
  if (parts.length >= 2) {
    return {
      artist: parts[0].trim(),
      title: parts.slice(1).join(' - ').trim()
    };
  }
  return {
    artist: 'Яндекс Диск',
    title: clean || 'Аудио из Яндекс Диска'
  };
}

function isAudioResourceItem(item) {
  if (!item || item.type !== 'file') return false;
  if (item.media_type === 'audio') return true;
  if (item.mime_type && String(item.mime_type).startsWith('audio/')) return true;
  return AUDIO_FILE_REGEX.test(item.name || '');
}

/**
 * Получить массив треков по ссылке (Яндекс Диск файл ИЛИ целая папка, SoundCloud, direct audio, YouTube)
 */
export async function resolveTracksFromInput(url) {
  const cleanUrl = String(url || '').trim();
  if (!cleanUrl) return [];
  const type = detectMediaType(cleanUrl);

  // 1. Локальные или встроенные треки
  if (cleanUrl.includes('/music/') || cleanUrl.startsWith('music/')) {
    const fileName = cleanUrl.split('/').pop().replace(/\.[^.]+$/, '');
    return [
      {
        id: 'audio_' + Date.now().toString(36),
        url: cleanUrl,
        title: decodeURIComponent(fileName),
        artist: 'Встроенный трек',
        thumbnail: null,
        source: 'audio',
        duration: 0
      }
    ];
  }

  // 2. Яндекс Диск (одиночный файл ИЛИ целая папка!)
  if (type === 'yandex') {
    try {
      const metaRes = await fetch(
        `https://cloud-api.yandex.net/v1/disk/public/resources?public_key=${encodeURIComponent(cleanUrl)}&limit=100`
      );

      if (metaRes.ok) {
        const meta = await metaRes.json();

        // Целая папка с музыкой на Яндекс Диске
        if (meta.type === 'dir' && Array.isArray(meta._embedded?.items)) {
          const audioItems = meta._embedded.items.filter(isAudioResourceItem);
          if (audioItems.length === 0) {
            throw new Error('В выбранной папке Яндекс Диска не найдено аудиофайлов');
          }

          const tracks = [];
          const batchSize = 5;
          for (let i = 0; i < audioItems.length; i += batchSize) {
            const slice = audioItems.slice(i, i + batchSize);
            const resolvedSlice = await Promise.all(
              slice.map(async (item, sIdx) => {
                let downloadUrl = item.file || '';
                if (!downloadUrl && item.path) {
                  try {
                    const dlRes = await fetch(
                      `https://cloud-api.yandex.net/v1/disk/public/resources/download?public_key=${encodeURIComponent(cleanUrl)}&path=${encodeURIComponent(item.path)}`
                    );
                    if (dlRes.ok) {
                      const dlData = await dlRes.json();
                      if (dlData?.href) downloadUrl = dlData.href;
                    }
                  } catch {}
                }
                if (!downloadUrl) return null;
                const parsed = parseYandexAudioFilename(item.name);
                return {
                  id: `yd_${Date.now().toString(36)}_${i + sIdx}`,
                  url: downloadUrl,
                  originalUrl: cleanUrl,
                  title: parsed.title,
                  artist: parsed.artist,
                  album: meta.name || null,
                  thumbnail: null,
                  source: 'audio',
                  duration: 0,
                  sizeBytes: Number(item.size) || 0
                };
              })
            );
            for (const t of resolvedSlice) {
              if (t) tracks.push(t);
            }
          }

          if (tracks.length > 0) return tracks;
        }

        // Одиночный файл Яндекс Диска
        const parsed = parseYandexAudioFilename(meta.name);
        const downRes = await fetch(
          `https://cloud-api.yandex.net/v1/disk/public/resources/download?public_key=${encodeURIComponent(cleanUrl)}`
        );
        if (downRes.ok) {
          const downData = await downRes.json();
          if (downData.href) {
            return [
              {
                id: 'yd_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
                url: downData.href,
                originalUrl: cleanUrl,
                title: parsed.title,
                artist: parsed.artist,
                thumbnail: null,
                source: 'audio',
                duration: 0,
                sizeBytes: Number(meta.size) || 0
              }
            ];
          }
        }
      }
    } catch (e) {
      if (/не найдено аудиофайлов/i.test(e.message || '')) throw e;
      console.warn('Yandex Disk API error:', e);
    }
  }

  // 3. SoundCloud
  if (type === 'soundcloud') {
    const cleanScUrl = cleanUrl.split('?')[0];
    try {
      const res = await fetch(
        `https://soundcloud.com/oembed?url=${encodeURIComponent(cleanScUrl)}&format=json`
      );
      if (res.ok) {
        const data = await res.json();
        return [
          {
            id: 'sc_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
            url: cleanScUrl,
            title: data.title || 'SoundCloud Track',
            artist: data.author_name || 'SoundCloud',
            thumbnail:
              data.thumbnail_url || 'https://assets.soundcloud.com/assets/images/header/cloud-e56551e.png',
            source: 'soundcloud',
            duration: 0
          }
        ];
      }
    } catch {}

    return [
      {
        id: 'sc_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        url: cleanScUrl,
        title: 'SoundCloud Track',
        artist: 'SoundCloud',
        thumbnail: 'https://assets.soundcloud.com/assets/images/header/cloud-e56551e.png',
        source: 'soundcloud',
        duration: 0
      }
    ];
  }

  // 4. YouTube
  if (type === 'youtube') {
    const videoId = extractYouTubeId(cleanUrl);
    const standardUrl = `https://www.youtube.com/watch?v=${videoId}`;
    try {
      const res = await fetch(
        `https://www.youtube.com/oembed?url=${encodeURIComponent(standardUrl)}&format=json`
      );
      if (res.ok) {
        const data = await res.json();
        return [
          {
            id: 'yt_' + videoId,
            url: standardUrl,
            title: data.title || 'YouTube Audio',
            artist: data.author_name || 'YouTube',
            thumbnail: data.thumbnail_url || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
            source: 'youtube',
            duration: 0
          }
        ];
      }
    } catch {}

    return [
      {
        id: 'yt_' + videoId,
        url: standardUrl,
        title: 'YouTube Audio',
        artist: 'YouTube',
        thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
        source: 'youtube',
        duration: 0
      }
    ];
  }

  // 5. Прямой аудиофайл (.mp3, .m4a, .wav, .ogg, .flac)
  const fileName = cleanUrl.split('/').pop().split('?')[0] || 'Audio Stream';
  const cleanTitle = decodeURIComponent(fileName).replace(/\.[^.]+$/, '');
  return [
    {
      id: 'audio_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      url: cleanUrl,
      title: cleanTitle || 'Аудиодорожка',
      artist: 'Аудиопоток',
      thumbnail: null,
      source: 'audio',
      duration: 0
    }
  ];
}

/**
 * Получить метаданные одного трека по ссылке (обратная совместимость).
 */
export async function resolveTrackMetadata(url) {
  const list = await resolveTracksFromInput(url);
  return list[0] || null;
}
