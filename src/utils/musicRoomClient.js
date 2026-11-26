// Управление комнатами, очередью, участниками и состоянием воспроизведения
// (прозрачно работает через Firebase RTDB или через собственный RU WebSocket-сервер при VITE_RU_SERVER_URL)
import { database, getServerNow } from './firebase';
import { ref, set, get, update, onValue, remove, onDisconnect } from 'firebase/database';
import { IS_RU_SERVER_ENABLED, ruServerClient } from './ruServerClient';

const AVATARS = ['🎧', '🎵', '💿', '🎙️', '🦊', '🚀', '⚡', '🌙', '🔥', '🎹', '🎷', '👾'];

export function getRandomAvatar() {
  return AVATARS[Math.floor(Math.random() * AVATARS.length)];
}

export function getOrCreateParticipantId() {
  let id = sessionStorage.getItem('wavesync_participant_id');
  if (!id) {
    id = 'u_' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36);
    sessionStorage.setItem('wavesync_participant_id', id);
  }
  return id;
}

export function getSavedProfile() {
  return {
    name: localStorage.getItem('wavesync_name') || '',
    avatar: localStorage.getItem('wavesync_avatar') || '🎧'
  };
}

export function saveProfile({ name, avatar }) {
  if (name !== undefined) localStorage.setItem('wavesync_name', name.trim());
  if (avatar !== undefined) localStorage.setItem('wavesync_avatar', avatar);
}

export function generateConnInstanceId() {
  return 'c_' + Math.random().toString(36).slice(2, 10);
}

function generateRoomCode() {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

function sanitizeQueueItem(t, idx = 0) {
  return {
    id: String(t.id || 't_' + idx + '_' + Date.now().toString(36)),
    title: String(t.title || 'Трек'),
    artist: String(t.artist || 'Исполнитель'),
    album: t.album ? String(t.album) : null,
    url: String(t.url || ''),
    source: String(t.source || 'audio'),
    thumbnail: t.thumbnail ? String(t.thumbnail) : null,
    duration: Number(t.duration) || 0,
    sizeBytes: Number(t.sizeBytes) || 0
  };
}

export function normalizeRoomSnapshot(raw) {
  if (!raw) return null;

  const participantsObj = raw.participants || {};
  const participants = Object.values(participantsObj).sort((a, b) => {
    if (a.isHost !== b.isHost) return a.isHost ? -1 : 1;
    return (a.joinedAt || 0) - (b.joinedAt || 0);
  });

  let queue = [];
  if (Array.isArray(raw.queue)) {
    queue = raw.queue.filter(Boolean);
  } else if (raw.queue && typeof raw.queue === 'object') {
    queue = Object.values(raw.queue).filter(Boolean);
  }

  return {
    code: String(raw.code || ''),
    createdAt: raw.createdAt || 0,
    hostId: raw.hostId || '',
    hostName: raw.hostName || 'Ведущий',
    settings: {
      repeatMode: 'all', // 'all' | 'one' | 'off'
      waitForListeners: true,
      allowGuestQueue: false,
      ...(raw.settings || {})
    },
    participants,
    participantsMap: participantsObj,
    queue,
    playback: {
      trackId: null,
      phase: 'idle',
      isPlaying: false,
      anchorPos: 0,
      anchorServerTime: getServerNow(),
      playbackRate: 1.0,
      actionNonce: 0,
      ...(raw.playback || {})
    }
  };
}

function createStabilizedEmitter(onUpdate) {
  let prevQueueSig = '';
  let prevQueueRef = null;
  let prevPlaybackSig = '';
  let prevPlaybackRef = null;
  let prevSettingsSig = '';
  let prevSettingsRef = null;

  return (raw) => {
    const next = normalizeRoomSnapshot(raw);
    if (!next) return;

    // Стабилизируем ссылки неизменённых частей комнаты для сохранения эффективности React.memo
    const qSig = JSON.stringify(next.queue);
    if (prevQueueRef && qSig === prevQueueSig) {
      next.queue = prevQueueRef;
    } else {
      prevQueueSig = qSig;
      prevQueueRef = next.queue;
    }

    const pSig = JSON.stringify(next.playback);
    if (prevPlaybackRef && pSig === prevPlaybackSig) {
      next.playback = prevPlaybackRef;
    } else {
      prevPlaybackSig = pSig;
      prevPlaybackRef = next.playback;
    }

    const sSig = JSON.stringify(next.settings);
    if (prevSettingsRef && sSig === prevSettingsSig) {
      next.settings = prevSettingsRef;
    } else {
      prevSettingsSig = sSig;
      prevSettingsRef = next.settings;
    }

    onUpdate(next);
  };
}

class MusicRoomClient {
  async createRoom({ name, avatar, connInstanceId }) {
    const participantId = getOrCreateParticipantId();
    const cleanName = (name || '').trim() || 'Диджей';
    const cleanAvatar = avatar || getRandomAvatar();

    if (IS_RU_SERVER_ENABLED) {
      const res = await ruServerClient.createRoom({
        participantId,
        name: cleanName,
        avatar: cleanAvatar,
        connInstanceId
      });
      return {
        roomCode: res.roomCode,
        participantId,
        initialRoom: normalizeRoomSnapshot(res.room)
      };
    }

    let code = generateRoomCode();
    for (let i = 0; i < 6; i++) {
      const existing = await get(ref(database, `music_rooms/${code}/code`));
      if (!existing.exists()) break;
      code = generateRoomCode();
    }

    const now = getServerNow();
    const initialRoom = {
      code,
      createdAt: now,
      hostId: participantId,
      hostName: cleanName,
      settings: {
        repeatMode: 'all',
        waitForListeners: true,
        allowGuestQueue: false
      },
      participants: {
        [participantId]: {
          id: participantId,
          name: cleanName,
          avatar: cleanAvatar,
          isHost: true,
          isOnline: true,
          connInstanceId,
          joinedAt: now,
          status: 'ready',
          readyTrackId: null,
          downloadProgress: 100
        }
      },
      queue: [],
      playback: {
        trackId: null,
        phase: 'idle',
        isPlaying: false,
        anchorPos: 0,
        anchorServerTime: now,
        playbackRate: 1.0,
        actionNonce: 1
      }
    };

    await set(ref(database, `music_rooms/${code}`), initialRoom);
    this._bindDisconnect(code, participantId);

    return { roomCode: code, participantId, initialRoom: normalizeRoomSnapshot(initialRoom) };
  }

  async joinRoom({ roomCode, name, avatar, connInstanceId }) {
    const code = String(roomCode || '').trim();
    if (!code) throw new Error('Введите 4-значный код комнаты');
    const participantId = getOrCreateParticipantId();

    if (IS_RU_SERVER_ENABLED) {
      const res = await ruServerClient.joinRoom({
        roomCode: code,
        participantId,
        name: (name || '').trim() || 'Слушатель',
        avatar: avatar || getRandomAvatar(),
        connInstanceId
      });
      return {
        roomCode: res.roomCode,
        participantId,
        isHost: Boolean(res.isHost)
      };
    }

    const roomSnap = await get(ref(database, `music_rooms/${code}`));
    if (!roomSnap.exists()) {
      throw new Error(`Комната №${code} не найдена или уже закрыта`);
    }

    const roomVal = roomSnap.val();
    const isHost = roomVal.hostId === participantId;
    const cleanName = (name || '').trim() || (isHost ? 'Диджей' : 'Слушатель');
    const cleanAvatar = avatar || getRandomAvatar();
    const now = getServerNow();

    const participantData = {
      id: participantId,
      name: cleanName,
      avatar: cleanAvatar,
      isHost,
      isOnline: true,
      connInstanceId,
      joinedAt: roomVal.participants?.[participantId]?.joinedAt || now,
      status: isHost ? 'ready' : 'connecting',
      readyTrackId: null,
      downloadProgress: 0
    };

    await set(ref(database, `music_rooms/${code}/participants/${participantId}`), participantData);
    this._bindDisconnect(code, participantId);

    return { roomCode: code, participantId, isHost };
  }

  async reconnectRoom({ roomCode, connInstanceId }) {
    const code = String(roomCode || '').trim();
    if (!code) return null;
    const participantId = getOrCreateParticipantId();

    if (IS_RU_SERVER_ENABLED) {
      const res = await ruServerClient.reconnectRoom({
        roomCode: code,
        participantId,
        connInstanceId
      });
      if (!res?.roomCode) return null;
      return {
        roomCode: res.roomCode,
        participantId,
        isHost: Boolean(res.isHost)
      };
    }

    const snap = await get(ref(database, `music_rooms/${code}`));
    if (!snap.exists()) return null;

    const roomVal = snap.val();
    const existing = roomVal.participants?.[participantId];
    if (!existing) return null;

    await update(ref(database, `music_rooms/${code}/participants/${participantId}`), {
      isOnline: true,
      connInstanceId,
      status: existing.isHost ? 'ready' : 'connecting'
    });
    this._bindDisconnect(code, participantId);

    return {
      roomCode: code,
      participantId,
      isHost: roomVal.hostId === participantId
    };
  }

  _bindDisconnect(roomCode, participantId) {
    try {
      const pRef = ref(database, `music_rooms/${roomCode}/participants/${participantId}`);
      onDisconnect(pRef).update({ isOnline: false, status: 'offline' });
    } catch (e) {
      console.warn('onDisconnect setup failed:', e);
    }
  }

  subscribeRoom(roomCode, onUpdate, onDeleted) {
    const code = String(roomCode || '').trim();
    const emit = createStabilizedEmitter(onUpdate);

    if (IS_RU_SERVER_ENABLED) {
      return ruServerClient.subscribeRoom(code, emit, onDeleted);
    }

    const roomRef = ref(database, `music_rooms/${code}`);
    let hadData = false;

    const unsub = onValue(roomRef, (snap) => {
      const val = snap.val();
      if (!val) {
        if (hadData && onDeleted) {
          onDeleted();
        }
        return;
      }
      hadData = true;
      emit(val);
    });

    return () => unsub();
  }

  async leaveRoom({ roomCode, isHost }) {
    const code = String(roomCode || '').trim();
    const participantId = getOrCreateParticipantId();
    if (!code) return;

    if (IS_RU_SERVER_ENABLED) {
      await ruServerClient.leaveRoom({ roomCode: code, participantId, isHost });
      return;
    }

    try {
      const pRef = ref(database, `music_rooms/${code}/participants/${participantId}`);
      await onDisconnect(pRef).cancel().catch(() => {});

      if (isHost) {
        await remove(ref(database, `music_rooms/${code}`));
      } else {
        await remove(pRef);
        await remove(ref(database, `music_rooms/${code}/webrtc/${participantId}`));
      }
    } catch (e) {
      console.error('Error leaving room:', e);
    }
  }

  async updateQueue(roomCode, queue) {
    const cleanQueue = (queue || []).map((t, idx) => sanitizeQueueItem(t, idx));
    if (IS_RU_SERVER_ENABLED) {
      await ruServerClient.updateQueue(roomCode, cleanQueue);
      return;
    }
    await set(ref(database, `music_rooms/${roomCode}/queue`), cleanQueue);
  }

  /**
   * Безопасное добавление треков в конец очереди (используется и хостом, и гостями при allowGuestQueue)
   */
  async appendTracksToQueue(roomCode, newTracks, currentQueueFallback = []) {
    const cleanItems = (newTracks || []).map((t, idx) => sanitizeQueueItem(t, idx));
    if (cleanItems.length === 0) return;

    if (IS_RU_SERVER_ENABLED) {
      await ruServerClient.appendTracksToQueue(roomCode, cleanItems);
      return;
    }

    const qRef = ref(database, `music_rooms/${roomCode}/queue`);
    const snap = await get(qRef);
    const existingRaw = snap.exists() ? snap.val() : currentQueueFallback;
    const existingList = Array.isArray(existingRaw)
      ? existingRaw.filter(Boolean)
      : existingRaw && typeof existingRaw === 'object'
      ? Object.values(existingRaw).filter(Boolean)
      : [];

    const existingUrls = new Set(existingList.map((t) => t.url));
    const filtered = cleanItems.filter((item) => item.url && !existingUrls.has(item.url));
    if (filtered.length > 0) {
      await set(qRef, [...existingList, ...filtered]);
    }
  }

  async updatePlayback(roomCode, playbackPatch) {
    const clean = {};
    for (const [k, v] of Object.entries(playbackPatch || {})) {
      if (v !== undefined) {
        clean[k] = v;
      }
    }
    if (Object.keys(clean).length > 0) {
      if (IS_RU_SERVER_ENABLED) {
        await ruServerClient.updatePlayback(roomCode, clean);
        return;
      }
      await update(ref(database, `music_rooms/${roomCode}/playback`), clean);
    }
  }

  async updateSettings(roomCode, settingsPatch) {
    if (IS_RU_SERVER_ENABLED) {
      await ruServerClient.updateSettings(roomCode, settingsPatch);
      return;
    }
    await update(ref(database, `music_rooms/${roomCode}/settings`), settingsPatch);
  }

  async updateParticipantStatus(roomCode, participantId, patch) {
    if (IS_RU_SERVER_ENABLED) {
      await ruServerClient.updateParticipantStatus(roomCode, patch);
      return;
    }
    await update(ref(database, `music_rooms/${roomCode}/participants/${participantId}`), patch);
  }

  async bumpConnInstanceId(roomCode, participantId, connInstanceId) {
    await this.updateParticipantStatus(roomCode, participantId, {
      connInstanceId,
      isOnline: true,
      status: 'connecting'
    });
  }
}

export const musicRoomClient = new MusicRoomClient();
