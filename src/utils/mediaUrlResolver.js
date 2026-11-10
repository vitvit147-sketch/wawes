// Распознавание ссылок SoundCloud, Яндекс Диска, прямых аудиопотоков (MP3/M4A/WAV)

const SC_REGEX = /soundcloud\.com\/[a-zA-Z0-9-_]+\/[a-zA-Z0-9-_]+/i;
const YANDEX_DISK_REGEX = /(?:disk\.yandex\.(?:ru|com)|yadi\.sk)\/d\/([a-zA-Z0-9_-]+)/i;
const AUDIO_FILE_REGEX = /\.(mp3|wav|m4a|aac|ogg|opus|flac)(?:\?.*)?$/i;
const YT_REGEX = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/|music\.youtube\.com\/watch\?v=)([^"&?\/\s]{11})/i;

export const DEMO_PRESETS = [
  {
    id: 'skz_thisthat',
    title: 'This & That',
    artist: 'Stray Kids',
    url: 'https://wavesync-red.vercel.app/music/stray-kids-this-that.mp3',
    source: 'audio',
    thumbnail: 'https://i.ytimg.com/vi/TQTlCHxyuu8/hqdefault.jpg'
  },
  {
    id: 'skz_chkchkboom',
    title: 'Chk Chk Boom',
    artist: 'Stray Kids',
    url: 'https://archive.org/download/stray-kids-chk-chk-boom/Stray%20Kids%20-%20Chk%20Chk%20Boom.mp3',
    source: 'audio',
    thumbnail: 'https://i.ytimg.com/vi/0P0aQrm2LSQ/hqdefault.jpg'
  },
  {
    id: 'skz_maniac',
    title: 'MANIAC',
    artist: 'Stray Kids',
    url: 'https://archive.org/download/venom_202605/MANIAC.mp3',
    source: 'audio',
    thumbnail: 'https://i.ytimg.com/vi/OvioeS1ZZ7o/hqdefault.jpg'
  },
  {
    id: 'skz_venom',
    title: 'VENOM (거미줄)',
    artist: 'Stray Kids',
    url: 'https://archive.org/download/venom_202605/%EA%B1%B0%EB%AF%B8%EC%A4%84%20VENOM.mp3',
    source: 'audio',
    thumbnail: 'https://i.ytimg.com/vi/m_nflXk774w/hqdefault.jpg'
  },
  {
    id: 'skz_circus',
    title: 'CIRCUS',
    artist: 'Stray Kids',
    url: 'https://archive.org/download/stray-kids-circus_202312/Stray%20Kids%20%E3%80%8ECIRCUS%E3%80%8F.mp3',
    source: 'audio',
    thumbnail: 'https://i.ytimg.com/vi/jW-bkbSWb4A/hqdefault.jpg'
  },
  {
    id: 'skz_freeze',
    title: 'FREEZE (땡)',
    artist: 'Stray Kids',
    url: 'https://archive.org/download/venom_202605/%EB%95%A1%20FREEZE.mp3',
    source: 'audio',
    thumbnail: null
  },
  {
    id: 'skz_charmer',
    title: 'Charmer',
    artist: 'Stray Kids',
    url: 'https://archive.org/download/venom_202605/Charmer.mp3',
    source: 'audio',
    thumbnail: null
  },
  {
    id: 'skz_lonely_st',
    title: 'Lonely St.',
    artist: 'Stray Kids',
    url: 'https://archive.org/download/venom_202605/Lonely%20St..mp3',
    source: 'audio',
    thumbnail: null
  },
  {
    id: 'skz_waiting_for_us',
    title: 'Waiting For Us',
    artist: 'Stray Kids',
    url: 'https://archive.org/download/venom_202605/Waiting%20For%20Us.mp3',
    source: 'audio',
    thumbnail: null
  },
  {
    id: 'skz_walkin_on_water',
    title: 'Walkin On Water',
    artist: 'Stray Kids',
    url: 'https://archive.org/download/SKZ-HOP/01.%20Walkin%20On%20Water.mp3',
    source: 'audio',
    thumbnail: null
  },
  {
    id: 'skz_bounce_back',
    title: 'Bounce Back',
    artist: 'Stray Kids',
    url: 'https://archive.org/download/SKZ-HOP/02.%20Bounce%20Back.mp3',
    source: 'audio',
    thumbnail: null
  },
  {
    id: 'skz_u_tablo',
    title: 'U (Feat. TABLO)',
    artist: 'Stray Kids',
    url: 'https://archive.org/download/SKZ-HOP/03.%20U%20%28Feat.%20TABLO%29.mp3',
    source: 'audio',
    thumbnail: null
  },
  {
    id: 'skz_walkin_hip',
    title: 'Walkin On Water (HIP Ver.)',
    artist: 'Stray Kids',
    url: 'https://archive.org/download/SKZ-HOP/04.%20Walkin%20On%20Water%20%28HIP%20Ver.%29.mp3',
    source: 'audio',
    thumbnail: null
  },
  {
    id: 'skz_railway',
    title: 'Railway (Bang Chan)',
    artist: 'Stray Kids',
    url: 'https://archive.org/download/SKZ-HOP/05.%20Railway%20%28Bang%20Chan%29.mp3',
    source: 'audio',
    thumbnail: null
  },
  {
    id: 'skz_unfair',
    title: 'Unfair (Felix)',
    artist: 'Stray Kids',
    url: 'https://archive.org/download/SKZ-HOP/06.%20Unfair%20%28Felix%29.mp3',
    source: 'audio',
    thumbnail: null
  },
  {
    id: 'skz_hallucination',
    title: 'HALLUCINATION (I.N)',
    artist: 'Stray Kids',
    url: 'https://archive.org/download/SKZ-HOP/07.%20HALLUCINATION%20%28I.N%29.mp3',
    source: 'audio',
    thumbnail: null
  },
  {
    id: 'skz_youth',
    title: 'Youth (Lee Know)',
    artist: 'Stray Kids',
    url: 'https://archive.org/download/SKZ-HOP/08.%20Youth%20%28Lee%20Know%29.mp3',
    source: 'audio',
    thumbnail: null
  },
  {
    id: 'skz_so_good',
    title: 'So Good (Hyunjin)',
    artist: 'Stray Kids',
    url: 'https://archive.org/download/SKZ-HOP/09.%20So%20Good%20%28Hyunjin%29.mp3',
    source: 'audio',
    thumbnail: null
  },
  {
    id: 'skz_ultra',
    title: 'ULTRA (Changbin)',
    artist: 'Stray Kids',
    url: 'https://archive.org/download/SKZ-HOP/10.%20ULTRA%20%28Changbin%29.mp3',
    source: 'audio',
    thumbnail: null
  },
  {
    id: 'skz_hold_my_hand',
    title: 'Hold my hand (HAN)',
    artist: 'Stray Kids',
    url: 'https://archive.org/download/SKZ-HOP/11.%20Hold%20my%20hand%20%28HAN%29.mp3',
    source: 'audio',
    thumbnail: null
  }
];

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
