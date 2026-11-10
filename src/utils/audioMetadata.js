// Извлечение метаданных аудиофайлов без внешних тяжелых зависимостей и без потери качества

const EXT_TO_FORMAT = {
  flac: 'FLAC',
  wav: 'WAV',
  mp3: 'MP3',
  m4a: 'M4A',
  aac: 'AAC',
  ogg: 'OGG',
  opus: 'OPUS',
  webm: 'WEBM',
  aiff: 'AIFF'
};

export function detectFormatLabel(fileName = '', mimeType = '') {
  const extMatch = fileName.toLowerCase().match(/\.([a-z0-9]+)$/);
  if (extMatch && EXT_TO_FORMAT[extMatch[1]]) {
    return EXT_TO_FORMAT[extMatch[1]];
  }
  const lowerMime = (mimeType || '').toLowerCase();
  if (lowerMime.includes('flac')) return 'FLAC';
  if (lowerMime.includes('wav')) return 'WAV';
  if (lowerMime.includes('mpeg') || lowerMime.includes('mp3')) return 'MP3';
  if (lowerMime.includes('mp4') || lowerMime.includes('m4a')) return 'M4A';
  if (lowerMime.includes('opus')) return 'OPUS';
  if (lowerMime.includes('ogg')) return 'OGG';
  if (lowerMime.includes('aac')) return 'AAC';
  return 'AUDIO';
}

export function inferMimeType(fileName = '', originalMime = '') {
  if (originalMime && originalMime.startsWith('audio/')) return originalMime;
  const ext = (fileName.toLowerCase().match(/\.([a-z0-9]+)$/) || [])[1];
  switch (ext) {
    case 'flac': return 'audio/flac';
    case 'wav': return 'audio/wav';
    case 'mp3': return 'audio/mpeg';
    case 'm4a': return 'audio/mp4';
    case 'aac': return 'audio/aac';
    case 'ogg': return 'audio/ogg';
    case 'opus': return 'audio/opus';
    case 'webm': return 'audio/webm';
    default: return originalMime || 'audio/mpeg';
  }
}

export function parseTrackFilename(fileName = '') {
  const withoutExt = fileName.replace(/\.[^/.]+$/, '').replace(/_/g, ' ').trim();
  const separators = [' - ', ' — ', ' – '];
  for (const sep of separators) {
    const idx = withoutExt.indexOf(sep);
    if (idx > 0 && idx < withoutExt.length - sep.length) {
      return {
        artist: withoutExt.slice(0, idx).trim(),
        title: withoutExt.slice(idx + sep.length).trim()
      };
    }
  }
  return {
    artist: 'Локальный файл',
    title: withoutExt || 'Без названия'
  };
}

export function formatBytes(bytes = 0) {
  if (!bytes || bytes <= 0) return '0 Б';
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}

export function formatDuration(seconds = 0) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = s.toString().padStart(2, '0');
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${ss}`;
  }
  return `${m}:${ss}`;
}

export function estimateBitrateKbps(sizeBytes = 0, durationSeconds = 0) {
  if (!sizeBytes || !durationSeconds || durationSeconds <= 0) return null;
  return Math.round((sizeBytes * 8) / durationSeconds / 1000);
}

function decodeId3Text(bytes) {
  if (!bytes || bytes.length < 2) return '';
  const encoding = bytes[0];
  const content = bytes.subarray(1);
  try {
    if (encoding === 0) {
      return new TextDecoder('iso-8859-1').decode(content).replace(/\0/g, '').trim();
    }
    if (encoding === 1) {
      return new TextDecoder('utf-16').decode(content).replace(/\0/g, '').trim();
    }
    if (encoding === 2) {
      return new TextDecoder('utf-16be').decode(content).replace(/\0/g, '').trim();
    }
    return new TextDecoder('utf-8').decode(content).replace(/\0/g, '').trim();
  } catch {
    return '';
  }
}

function parseId3v2Tags(bytes) {
  if (bytes.length < 10 || bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) {
    return null;
  }
  const majorVersion = bytes[3];
  const tagSize =
    ((bytes[6] & 0x7f) << 21) |
    ((bytes[7] & 0x7f) << 14) |
    ((bytes[8] & 0x7f) << 7) |
    (bytes[9] & 0x7f);

  const end = Math.min(bytes.length, 10 + tagSize);
  let offset = 10;
  if ((bytes[5] & 0x40) !== 0 && offset + 4 <= end) {
    const extSize =
      ((bytes[offset] & 0x7f) << 21) |
      ((bytes[offset + 1] & 0x7f) << 14) |
      ((bytes[offset + 2] & 0x7f) << 7) |
      (bytes[offset + 3] & 0x7f);
    offset += extSize;
  }

  const result = {};
  const decoderAscii = new TextDecoder('ascii');

  while (offset + 10 <= end) {
    const frameId = decoderAscii.decode(bytes.subarray(offset, offset + 4));
    if (!/^[A-Z0-9]{4}$/.test(frameId)) break;

    let frameSize;
    if (majorVersion >= 4) {
      frameSize =
        ((bytes[offset + 4] & 0x7f) << 21) |
        ((bytes[offset + 5] & 0x7f) << 14) |
        ((bytes[offset + 6] & 0x7f) << 7) |
        (bytes[offset + 7] & 0x7f);
    } else {
      frameSize =
        (bytes[offset + 4] << 24) |
        (bytes[offset + 5] << 16) |
        (bytes[offset + 6] << 8) |
        bytes[offset + 7];
    }

    offset += 10;
    if (frameSize <= 0 || offset + frameSize > bytes.length) break;

    if (frameId === 'TIT2') {
      result.title = decodeId3Text(bytes.subarray(offset, offset + frameSize));
    } else if (frameId === 'TPE1') {
      result.artist = decodeId3Text(bytes.subarray(offset, offset + frameSize));
    }
    if (result.title && result.artist) break;
    offset += frameSize;
  }

  return (result.title || result.artist) ? result : null;
}

function parseFlacVorbisTags(bytes) {
  if (bytes.length < 8 || bytes[0] !== 0x66 || bytes[1] !== 0x4c || bytes[2] !== 0x61 || bytes[3] !== 0x43) {
    return null;
  }
  let offset = 4;
  const utf8 = new TextDecoder('utf-8');

  while (offset + 4 <= bytes.length) {
    const header = bytes[offset];
    const isLast = (header & 0x80) !== 0;
    const blockType = header & 0x7f;
    const blockLen = (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3];
    offset += 4;
    if (offset + blockLen > bytes.length) break;

    if (blockType === 4) {
      // VORBIS_COMMENT
      const view = new DataView(bytes.buffer, bytes.byteOffset + offset, blockLen);
      let pos = 0;
      if (pos + 4 > blockLen) break;
      const vendorLen = view.getUint32(pos, true);
      pos += 4 + vendorLen;
      if (pos + 4 > blockLen) break;
      const count = view.getUint32(pos, true);
      pos += 4;

      const result = {};
      for (let i = 0; i < count && pos + 4 <= blockLen; i++) {
        const len = view.getUint32(pos, true);
        pos += 4;
        if (pos + len > blockLen) break;
        const comment = utf8.decode(bytes.subarray(offset + pos, offset + pos + len));
        pos += len;
        const eqIdx = comment.indexOf('=');
        if (eqIdx > 0) {
          const key = comment.slice(0, eqIdx).toUpperCase();
          const val = comment.slice(eqIdx + 1).trim();
          if (key === 'TITLE' && val) result.title = val;
          if (key === 'ARTIST' && val) result.artist = val;
        }
      }
      return (result.title || result.artist) ? result : null;
    }

    offset += blockLen;
    if (isLast) break;
  }
  return null;
}

function readAudioDuration(objectUrl) {
  return new Promise((resolve) => {
    const audio = new Audio();
    let settled = false;
    const finish = (val) => {
      if (settled) return;
      settled = true;
      audio.src = '';
      resolve(val);
    };
    const timer = setTimeout(() => finish(0), 8000);
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => {
      clearTimeout(timer);
      finish(Number.isFinite(audio.duration) ? audio.duration : 0);
    };
    audio.onerror = () => {
      clearTimeout(timer);
      finish(0);
    };
    audio.src = objectUrl;
  });
}

/**
 * Читает длительность, формат, битрейт и базовые теги (ID3v2 / FLAC) прямо в браузере.
 * Возвращает также objectUrl, чтобы хост мог сразу проигрывать файл без повторного чтения.
 */
export async function extractAudioFileMetadata(file) {
  const objectUrl = URL.createObjectURL(file);
  const fallback = parseTrackFilename(file.name);
  let tags = null;

  try {
    const headBuffer = await file.slice(0, 262144).arrayBuffer();
    const headBytes = new Uint8Array(headBuffer);
    tags = parseId3v2Tags(headBytes) || parseFlacVorbisTags(headBytes);
  } catch {
    tags = null;
  }

  const duration = await readAudioDuration(objectUrl);
  const mimeType = inferMimeType(file.name, file.type);
  const format = detectFormatLabel(file.name, mimeType);
  const bitrateKbps = estimateBitrateKbps(file.size, duration);

  return {
    title: tags?.title || fallback.title,
    artist: tags?.artist || fallback.artist,
    fileName: file.name,
    size: file.size,
    duration,
    mimeType,
    format,
    bitrateKbps,
    objectUrl
  };
}
