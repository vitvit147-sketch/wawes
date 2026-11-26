// Клиентский транспорт для собственного RU WebSocket + HTTP-сервера (активируется через VITE_RU_SERVER_URL)

const env = typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env : {};
export const RU_SERVER_URL = String(env.VITE_RU_SERVER_URL || '').trim().replace(/\/+$/, '');
export const IS_RU_SERVER_ENABLED = Boolean(RU_SERVER_URL);

export function toRuWsUrl(httpUrl = RU_SERVER_URL) {
  const clean = String(httpUrl || '').trim().replace(/\/+$/, '');
  if (!clean) return '';
  if (clean.startsWith('https://')) return 'wss://' + clean.slice('https://'.length) + '/ws';
  if (clean.startsWith('http://')) return 'ws://' + clean.slice('http://'.length) + '/ws';
  return clean + '/ws';
}

export async function uploadFileToRuServer(file, mimeType, onProgress = () => {}) {
  if (!RU_SERVER_URL) throw new Error('RU сервер не настроен');

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${RU_SERVER_URL}/api/upload`);
    xhr.setRequestHeader('Content-Type', mimeType || file.type || 'audio/mpeg');
    xhr.setRequestHeader('X-File-Name', encodeURIComponent(file.name || 'track.mp3'));

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) {
        onProgress(Math.min(99, Math.round((e.loaded / e.total) * 100)));
      }
    };

    xhr.onload = () => {
      try {
        const data = JSON.parse(xhr.responseText || '{}');
        if (xhr.status >= 200 && xhr.status < 300 && data.url) {
          onProgress(100);
          resolve({
            url: `${RU_SERVER_URL}${data.url}`,
            sizeBytes: Number(data.sizeBytes) || file.size || 0
          });
        } else {
          reject(new Error(data.error || `Ошибка загрузки (${xhr.status})`));
        }
      } catch {
        reject(new Error(`Ошибка ответа сервера (${xhr.status})`));
      }
    };

    xhr.onerror = () => reject(new Error('Сетевая ошибка при отправке файла на сервер'));
    xhr.send(file);
  });
}

class RuServerClient {
  constructor() {
    this.ws = null;
    this.connectPromise = null;
    this.reconnectTimer = null;
    this.reconnectDelayMs = 800;
    this.connected = false;
    this.serverTimeOffsetMs = 0;
    this.clockRttMs = null;
    this.clockCalibrated = false;
    this.statusListeners = new Set();
    this.pendingAcks = new Map();
    this.pendingPings = [];
    this.roomSubscribers = new Map(); // roomCode -> Set<{ onUpdate, onDeleted }>
    this.lastRoomSnapshots = new Map(); // roomCode -> last raw room object
    this.activeSession = null; // { roomCode, participantId, connInstanceId }
    this.reqSeq = 1;

    if (IS_RU_SERVER_ENABLED && typeof window !== 'undefined') {
      this._ensureConnected().catch(() => {});
    }
  }

  _notifyStatus() {
    const payload = this.getClockStats();
    this.statusListeners.forEach((cb) => {
      try {
        cb(payload);
      } catch {}
    });
  }

  getServerNow() {
    return Date.now() + this.serverTimeOffsetMs;
  }

  getClockStats() {
    return {
      connected: this.connected,
      serverTimeOffsetMs: this.serverTimeOffsetMs,
      clockRttMs: this.clockRttMs,
      clockCalibrated: this.clockCalibrated
    };
  }

  subscribeStatus(cb) {
    this.statusListeners.add(cb);
    cb(this.getClockStats());
    return () => this.statusListeners.delete(cb);
  }

  _ensureConnected() {
    if (!IS_RU_SERVER_ENABLED) {
      return Promise.reject(new Error('RU server URL is not configured'));
    }
    if (this.ws && this.ws.readyState === 1) {
      return Promise.resolve(this.ws);
    }
    if (this.connectPromise) return this.connectPromise;

    this.connectPromise = new Promise((resolve, reject) => {
      const ws = new WebSocket(toRuWsUrl(RU_SERVER_URL));
      this.ws = ws;

      const timer = setTimeout(() => {
        if (ws.readyState !== 1) {
          try {
            ws.close();
          } catch {}
          reject(new Error('Таймаут подключения к RU-серверу'));
        }
      }, 10000);

      ws.onopen = () => {
        clearTimeout(timer);
        this.connected = true;
        this.reconnectDelayMs = 800;
        this.connectPromise = null;
        this._notifyStatus();
        this.calibrateClock({ force: !this.clockCalibrated }).catch(() => {});

        // Если это переподключение после обрыва 4G — возвращаем сокет в активную комнату
        if (this.activeSession?.roomCode && this.activeSession?.participantId) {
          this._sendRequest('reconnect_room', this.activeSession).catch(() => {});
        }
        resolve(ws);
      };

      ws.onmessage = (event) => {
        let msg;
        try {
          msg = JSON.parse(event.data);
        } catch {
          return;
        }

        if (msg.type === 'pong') {
          const resolver = this.pendingPings.shift();
          if (resolver) resolver(msg);
          return;
        }

        if (msg.type === 'ack' && msg.reqId) {
          const pending = this.pendingAcks.get(msg.reqId);
          if (pending) {
            clearTimeout(pending.timeout);
            this.pendingAcks.delete(msg.reqId);
            if (msg.ok === false) {
              pending.reject(new Error(msg.error || 'Ошибка запроса'));
            } else {
              pending.resolve(msg);
            }
          }
          return;
        }

        if (msg.type === 'room_state' && msg.room?.code) {
          const code = String(msg.room.code);
          this.lastRoomSnapshots.set(code, msg.room);
          const subs = this.roomSubscribers.get(code);
          if (subs) {
            subs.forEach(({ onUpdate }) => onUpdate(msg.room));
          }
          return;
        }

        if (msg.type === 'room_deleted' && msg.roomCode) {
          const code = String(msg.roomCode);
          this.lastRoomSnapshots.delete(code);
          const subs = this.roomSubscribers.get(code);
          if (subs) {
            subs.forEach(({ onDeleted }) => onDeleted?.());
          }
        }
      };

      ws.onclose = () => {
        clearTimeout(timer);
        this.connected = false;
        this.connectPromise = null;
        this._notifyStatus();

        // Отклоняем зависшие запросы
        for (const [id, pending] of this.pendingAcks.entries()) {
          clearTimeout(pending.timeout);
          this.pendingAcks.delete(id);
          pending.reject(new Error('Соединение разорвано'));
        }

        if (!this.reconnectTimer && IS_RU_SERVER_ENABLED) {
          this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this._ensureConnected().catch(() => {});
          }, this.reconnectDelayMs);
          this.reconnectDelayMs = Math.min(8000, Math.round(this.reconnectDelayMs * 1.5));
        }
      };

      ws.onerror = () => {
        // обработается в onclose
      };
    });

    return this.connectPromise;
  }

  async _sendRequest(type, payload = {}) {
    const ws = await this._ensureConnected();
    const reqId = `r_${this.reqSeq++}_${Date.now().toString(36)}`;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingAcks.delete(reqId);
        reject(new Error(`Таймаут ответа (${type})`));
      }, 10000);
      this.pendingAcks.set(reqId, { resolve, reject, timeout });
      ws.send(JSON.stringify({ type, reqId, ...payload }));
    });
  }

  async calibrateClock(options = {}) {
    const { force = false } = options || {};
    if (this.clockCalibrated && !force && this.clockRttMs !== null && this.clockRttMs <= 120) {
      return { offsetMs: this.serverTimeOffsetMs, rttMs: this.clockRttMs };
    }
    const ws = await this._ensureConnected();
    const samples = [];

    for (let i = 0; i < 5; i++) {
      try {
        const res = await new Promise((resolve, reject) => {
          const t0 = performance.now();
          const wallBefore = Date.now();
          const timer = setTimeout(() => reject(new Error('ping timeout')), 3000);
          this.pendingPings.push((pong) => {
            clearTimeout(timer);
            const rtt = Math.max(0, performance.now() - t0);
            const offset = Number(pong.serverTs) - (wallBefore + rtt / 2);
            resolve({ rtt, offset });
          });
          ws.send(JSON.stringify({ type: 'ping', clientTs: wallBefore }));
        });
        samples.push(res);
      } catch {}
    }

    if (samples.length > 0) {
      samples.sort((a, b) => a.rtt - b.rtt);
      const bestCount = samples.length >= 2 ? 2 : 1;
      const top = samples.slice(0, bestCount);
      this.serverTimeOffsetMs = Math.round(
        top.reduce((sum, s) => sum + s.offset, 0) / bestCount
      );
      this.clockRttMs = Math.round(top.reduce((sum, s) => sum + s.rtt, 0) / bestCount);
      this.clockCalibrated = true;
      this._notifyStatus();
      return { offsetMs: this.serverTimeOffsetMs, rttMs: this.clockRttMs };
    }
    return null;
  }

  async createRoom({ participantId, name, avatar, connInstanceId }) {
    const res = await this._sendRequest('create_room', {
      participantId,
      name,
      avatar,
      connInstanceId
    });
    if (res?.room?.code) {
      this.lastRoomSnapshots.set(String(res.room.code), res.room);
    }
    this.activeSession = { roomCode: res.roomCode, participantId, connInstanceId };
    return res;
  }

  async joinRoom({ roomCode, participantId, name, avatar, connInstanceId }) {
    const res = await this._sendRequest('join_room', {
      roomCode,
      participantId,
      name,
      avatar,
      connInstanceId
    });
    if (res?.room?.code) {
      this.lastRoomSnapshots.set(String(res.room.code), res.room);
    }
    this.activeSession = { roomCode: res.roomCode, participantId, connInstanceId };
    return res;
  }

  async reconnectRoom({ roomCode, participantId, connInstanceId }) {
    try {
      const res = await this._sendRequest('reconnect_room', {
        roomCode,
        participantId,
        connInstanceId
      });
      if (res?.room?.code) {
        this.lastRoomSnapshots.set(String(res.room.code), res.room);
      }
      if (res?.roomCode) {
        this.activeSession = { roomCode: res.roomCode, participantId, connInstanceId };
      }
      return res;
    } catch {
      return null;
    }
  }

  subscribeRoom(roomCode, onUpdate, onDeleted) {
    const code = String(roomCode || '').trim();
    if (!this.roomSubscribers.has(code)) {
      this.roomSubscribers.set(code, new Set());
    }
    const entry = { onUpdate, onDeleted };
    this.roomSubscribers.get(code).add(entry);
    const cached = this.lastRoomSnapshots.get(code);
    if (cached) {
      onUpdate(cached);
    }
    return () => {
      const set = this.roomSubscribers.get(code);
      if (set) {
        set.delete(entry);
        if (set.size === 0) this.roomSubscribers.delete(code);
      }
    };
  }

  async leaveRoom({ roomCode, participantId, isHost }) {
    this.activeSession = null;
    this.lastRoomSnapshots.delete(String(roomCode || '').trim());
    try {
      await this._sendRequest('leave_room', { roomCode, participantId, isHost });
    } catch {}
  }

  async updateQueue(roomCode, queue) {
    await this._sendRequest('update_queue', { roomCode, queue });
  }

  async appendTracksToQueue(roomCode, tracks) {
    await this._sendRequest('append_queue', { roomCode, tracks });
  }

  async updatePlayback(roomCode, playback) {
    await this._sendRequest('update_playback', { roomCode, playback });
  }

  async updateSettings(roomCode, settings) {
    await this._sendRequest('update_settings', { roomCode, settings });
  }

  async updateParticipantStatus(roomCode, patch) {
    await this._sendRequest('update_participant', { roomCode, patch }).catch(() => {});
  }
}

export const ruServerClient = new RuServerClient();
