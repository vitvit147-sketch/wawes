// Распознавание ссылок SoundCloud, Яндекс Диска, прямых аудиопотоков (MP3/M4A/WAV)

const SC_REGEX = /soundcloud\.com\/[a-zA-Z0-9-_]+\/[a-zA-Z0-9-_]+/i;
const YANDEX_DISK_REGEX = /(?:disk\.yandex\.(?:ru|com)|yadi\.sk)\/d\/([a-zA-Z0-9_-]+)/i;
const AUDIO_FILE_REGEX = /\.(mp3|wav|m4a|aac|ogg|opus|flac)(?:\?.*)?$/i;
const YT_REGEX = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/|music\.youtube\.com\/watch\?v=)([^"&?\/\s]{11})/i;

export const DEMO_PRESETS = [
  // --- Главные хиты (Hits) ---
  {
    id: 'skz_chkchkboom',
    title: 'Chk Chk Boom',
    artist: 'Stray Kids',
    album: 'ATE',
    category: 'hits',
    url: './music/19-chk-chk-boom.m4a',
    source: 'audio',
    duration: 148,
    sizeBytes: 1840140,
    thumbnail: 'https://i.ytimg.com/vi/0P0aQrm2LSQ/hqdefault.jpg'
  },
  {
    id: 'skz_sclass',
    title: 'S-Class (특)',
    artist: 'Stray Kids',
    album: '5-STAR',
    category: 'hits',
    url: './music/s-class.m4a',
    source: 'audio',
    duration: 196,
    sizeBytes: 2427618,
    thumbnail: 'https://i.ytimg.com/vi/JsOOis4bBFg/hqdefault.jpg'
  },
  {
    id: 'skz_maniac',
    title: 'MANIAC',
    artist: 'Stray Kids',
    album: 'ODDINARY',
    category: 'hits',
    url: './music/09-maniac.m4a',
    source: 'audio',
    duration: 145,
    sizeBytes: 1809883,
    thumbnail: 'https://i.ytimg.com/vi/OvioeS1ZZ7o/hqdefault.jpg'
  },
  {
    id: 'skz_thunderous',
    title: 'Thunderous (소리꾼)',
    artist: 'Stray Kids',
    album: 'NOEASY',
    category: 'hits',
    url: './music/thunderous.m4a',
    source: 'audio',
    duration: 215,
    sizeBytes: 2651643,
    thumbnail: 'https://i.ytimg.com/vi/EaswWiwMVs8/hqdefault.jpg'
  },
  {
    id: 'skz_case143',
    title: 'CASE 143',
    artist: 'Stray Kids',
    album: 'MAXIDENT',
    category: 'hits',
    url: './music/case-143.m4a',
    source: 'audio',
    duration: 220,
    sizeBytes: 2599647,
    thumbnail: 'https://i.ytimg.com/vi/jYSlpC6Ud2A/hqdefault.jpg'
  },
  {
    id: 'skz_lalalala',
    title: 'LALALALA (락)',
    artist: 'Stray Kids',
    album: 'ROCK-STAR',
    category: 'hits',
    url: './music/lalalala.m4a',
    source: 'audio',
    duration: 200,
    sizeBytes: 2412878,
    thumbnail: 'https://i.ytimg.com/vi/DT_AP3vw8zU/hqdefault.jpg'
  },
  {
    id: 'skz_miroh',
    title: 'MIROH',
    artist: 'Stray Kids',
    album: 'Clé 1 : MIROH',
    category: 'hits',
    url: './music/miroh.m4a',
    source: 'audio',
    duration: 257,
    sizeBytes: 3098994,
    thumbnail: 'https://i.ytimg.com/vi/Dab4EENTW5I/hqdefault.jpg'
  },
  {
    id: 'skz_mypace',
    title: 'My Pace',
    artist: 'Stray Kids',
    album: 'I am WHO',
    category: 'hits',
    url: './music/my-pace.m4a',
    source: 'audio',
    duration: 227,
    sizeBytes: 2783657,
    thumbnail: 'https://i.ytimg.com/vi/pok5yDwM3uM/hqdefault.jpg'
  },
  {
    id: 'skz_hellevator',
    title: 'Hellevator',
    artist: 'Stray Kids',
    album: 'Mixtape',
    category: 'hits',
    url: './music/hellevator.m4a',
    source: 'audio',
    duration: 251,
    sizeBytes: 2965635,
    thumbnail: 'https://i.ytimg.com/vi/A4LcNAvVdOQ/hqdefault.jpg'
  },
  {
    id: 'skz_venom',
    title: 'VENOM (거미줄)',
    artist: 'Stray Kids',
    album: 'ODDINARY',
    category: 'hits',
    url: './music/10-venom.m4a',
    source: 'audio',
    duration: 153,
    sizeBytes: 1902156,
    thumbnail: 'https://i.ytimg.com/vi/m_nflXk774w/hqdefault.jpg'
  },
  {
    id: 'skz_circus',
    title: 'CIRCUS',
    artist: 'Stray Kids',
    album: 'CIRCUS',
    category: 'hits',
    url: './music/13-circus.m4a',
    source: 'audio',
    duration: 199,
    sizeBytes: 1643964,
    thumbnail: 'https://i.ytimg.com/vi/jW-bkbSWb4A/hqdefault.jpg'
  },
  {
    id: 'skz_thisthat',
    title: 'This & That',
    artist: 'Stray Kids',
    album: 'ATE',
    category: 'hits',
    url: './music/stray-kids-this-that.m4a',
    source: 'audio',
    duration: 185,
    sizeBytes: 2310651,
    thumbnail: 'https://i.ytimg.com/vi/TQTlCHxyuu8/hqdefault.jpg'
  },

  // --- Альбом: 合 (HOP) ---
  {
    id: 'skz_walkin_on_water',
    title: 'Walkin On Water',
    artist: 'Stray Kids',
    album: '合 (HOP)',
    category: 'albums',
    url: './music/01-walkin-on-water.m4a',
    source: 'audio',
    duration: 149,
    sizeBytes: 1847322,
    thumbnail: null
  },
  {
    id: 'skz_bounce_back',
    title: 'Bounce Back',
    artist: 'Stray Kids',
    album: '合 (HOP)',
    category: 'albums',
    url: './music/02-bounce-back.m4a',
    source: 'audio',
    duration: 184,
    sizeBytes: 2295115,
    thumbnail: null
  },
  {
    id: 'skz_u_tablo',
    title: 'U (Feat. TABLO)',
    artist: 'Stray Kids',
    album: '合 (HOP)',
    category: 'albums',
    url: './music/03-u-feat-tablo.m4a',
    source: 'audio',
    duration: 164,
    sizeBytes: 2065773,
    thumbnail: null
  },
  {
    id: 'skz_walkin_hip',
    title: 'Walkin On Water (HIP Ver.)',
    artist: 'Stray Kids',
    album: '合 (HOP)',
    category: 'albums',
    url: './music/04-walkin-on-water-hip.m4a',
    source: 'audio',
    duration: 176,
    sizeBytes: 2198338,
    thumbnail: null
  },

  // --- Альбом: ODDINARY ---
  {
    id: 'skz_freeze',
    title: 'FREEZE (땡)',
    artist: 'Stray Kids',
    album: 'ODDINARY',
    category: 'albums',
    url: './music/12-freeze.m4a',
    source: 'audio',
    duration: 178,
    sizeBytes: 2209623,
    thumbnail: null
  },
  {
    id: 'skz_charmer',
    title: 'Charmer',
    artist: 'Stray Kids',
    album: 'ODDINARY',
    category: 'albums',
    url: './music/11-charmer.m4a',
    source: 'audio',
    duration: 125,
    sizeBytes: 1563796,
    thumbnail: null
  },
  {
    id: 'skz_lonely_st',
    title: 'Lonely St.',
    artist: 'Stray Kids',
    album: 'ODDINARY',
    category: 'albums',
    url: './music/15-lonely-st.m4a',
    source: 'audio',
    duration: 165,
    sizeBytes: 2019966,
    thumbnail: null
  },

  // --- Соло & Юниты (Solo / Units) ---
  {
    id: 'skz_railway',
    title: 'Railway (Bang Chan)',
    artist: 'Stray Kids',
    album: '合 (HOP)',
    category: 'solo',
    url: './music/05-railway.m4a',
    source: 'audio',
    duration: 174,
    sizeBytes: 2145439,
    thumbnail: null
  },
  {
    id: 'skz_unfair',
    title: 'Unfair (Felix)',
    artist: 'Stray Kids',
    album: '合 (HOP)',
    category: 'solo',
    url: './music/06-unfair.m4a',
    source: 'audio',
    duration: 168,
    sizeBytes: 2082622,
    thumbnail: null
  },
  {
    id: 'skz_hallucination',
    title: 'HALLUCINATION (I.N)',
    artist: 'Stray Kids',
    album: '合 (HOP)',
    category: 'solo',
    url: './music/07-hallucination.m4a',
    source: 'audio',
    duration: 163,
    sizeBytes: 2040325,
    thumbnail: null
  },
  {
    id: 'skz_youth',
    title: 'Youth (Lee Know)',
    artist: 'Stray Kids',
    album: '合 (HOP)',
    category: 'solo',
    url: './music/08-youth.m4a',
    source: 'audio',
    duration: 160,
    sizeBytes: 1974174,
    thumbnail: null
  },
  {
    id: 'skz_so_good',
    title: 'So Good (Hyunjin)',
    artist: 'Stray Kids',
    album: '合 (HOP)',
    category: 'solo',
    url: './music/16-so-good.m4a',
    source: 'audio',
    duration: 169,
    sizeBytes: 2104582,
    thumbnail: null
  },
  {
    id: 'skz_ultra',
    title: 'ULTRA (Changbin)',
    artist: 'Stray Kids',
    album: '合 (HOP)',
    category: 'solo',
    url: './music/17-ultra.m4a',
    source: 'audio',
    duration: 147,
    sizeBytes: 1840918,
    thumbnail: null
  },
  {
    id: 'skz_hold_my_hand',
    title: 'Hold my hand (HAN)',
    artist: 'Stray Kids',
    album: '合 (HOP)',
    category: 'solo',
    url: './music/18-hold-my-hand.m4a',
    source: 'audio',
    duration: 179,
    sizeBytes: 2217733,
    thumbnail: null
  },
  {
    id: 'skz_waiting_for_us',
    title: 'Waiting For Us',
    artist: 'Stray Kids',
    album: 'ODDINARY',
    category: 'solo',
    url: './music/14-waiting-for-us.m4a',
    source: 'audio',
    duration: 154,
    sizeBytes: 1900179,
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
