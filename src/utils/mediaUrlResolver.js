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

/**
 * Получить метаданные трека по ссылке (Яндекс Диск, SoundCloud, direct audio, YouTube)
 */
export async function resolveTrackMetadata(url) {
  const cleanUrl = url.trim();
  const type = detectMediaType(cleanUrl);

  // 1. Локальные или встроенные треки
  if (cleanUrl.includes('/music/') || cleanUrl.startsWith('music/')) {
    const fileName = cleanUrl.split('/').pop().replace(/\.[^.]+$/, '');
    return {
      id: 'audio_' + Date.now().toString(36),
      url: cleanUrl,
      title: decodeURIComponent(fileName),
      artist: 'Встроенный трек',
      thumbnail: null,
      source: 'audio',
      duration: 0
    };
  }

  // 2. Яндекс Диск
  if (type === 'yandex') {
    try {
      const metaRes = await fetch(`https://cloud-api.yandex.net/v1/disk/public/resources?public_key=${encodeURIComponent(cleanUrl)}`);
      let title = 'Аудио из Яндекс Диска';
      let artist = 'Яндекс Диск';

      if (metaRes.ok) {
        const meta = await metaRes.json();
        if (meta.name) {
          title = meta.name.replace(/\.[^.]+$/, '');
          const parts = title.split(' - ');
          if (parts.length >= 2) {
            artist = parts[0].trim();
            title = parts.slice(1).join(' - ').trim();
          }
        }
      }

      const downRes = await fetch(`https://cloud-api.yandex.net/v1/disk/public/resources/download?public_key=${encodeURIComponent(cleanUrl)}`);
      if (downRes.ok) {
        const downData = await downRes.json();
        if (downData.href) {
          return {
            id: 'yd_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
            url: downData.href,
            originalUrl: cleanUrl,
            title,
            artist,
            thumbnail: null,
            source: 'audio',
            duration: 0
          };
        }
      }
    } catch (e) {
      console.warn('Yandex Disk API error:', e);
    }
  }

  // 3. SoundCloud
  if (type === 'soundcloud') {
    const cleanScUrl = cleanUrl.split('?')[0];
    try {
      const res = await fetch(`https://soundcloud.com/oembed?url=${encodeURIComponent(cleanScUrl)}&format=json`);
      if (res.ok) {
        const data = await res.json();
        return {
          id: 'sc_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
          url: cleanScUrl,
          title: data.title || 'SoundCloud Track',
          artist: data.author_name || 'SoundCloud',
          thumbnail: data.thumbnail_url || 'https://assets.soundcloud.com/assets/images/header/cloud-e56551e.png',
          source: 'soundcloud',
          duration: 0
        };
      }
    } catch {}

    return {
      id: 'sc_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      url: cleanScUrl,
      title: 'SoundCloud Track',
      artist: 'SoundCloud',
      thumbnail: 'https://assets.soundcloud.com/assets/images/header/cloud-e56551e.png',
      source: 'soundcloud',
      duration: 0
    };
  }

  // 4. YouTube
  if (type === 'youtube') {
    const videoId = extractYouTubeId(cleanUrl);
    const standardUrl = `https://www.youtube.com/watch?v=${videoId}`;
    try {
      const res = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(standardUrl)}&format=json`);
      if (res.ok) {
        const data = await res.json();
        return {
          id: 'yt_' + videoId,
          url: standardUrl,
          title: data.title || 'YouTube Audio',
          artist: data.author_name || 'YouTube',
          thumbnail: data.thumbnail_url || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
          source: 'youtube',
          duration: 0
        };
      }
    } catch {}

    return {
      id: 'yt_' + videoId,
      url: standardUrl,
      title: 'YouTube Audio',
      artist: 'YouTube',
      thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      source: 'youtube',
      duration: 0
    };
  }

  // 5. Прямой аудиофайл (.mp3, .m4a, .wav, .ogg, .flac)
  const fileName = cleanUrl.split('/').pop().split('?')[0] || 'Audio Stream';
  const cleanTitle = decodeURIComponent(fileName).replace(/\.[^.]+$/, '');
  return {
    id: 'audio_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    url: cleanUrl,
    title: cleanTitle || 'Аудиодорожка',
    artist: 'Аудиопоток',
    thumbnail: null,
    source: 'audio',
    duration: 0
  };
}
