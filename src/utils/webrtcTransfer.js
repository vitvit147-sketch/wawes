// WebRTC P2P DataChannel передача оригинальных аудиофайлов без потери качества (сигналинг через Firebase RTDB)
import { database } from './firebase';
import { ref, set, push, onValue, off } from 'firebase/database';
import { CHUNK_PAYLOAD_SIZE, encodeChunkFrame, decodeChunkFrame } from './chunkProtocol';

const DEFAULT_ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
  { urls: 'stun:openrelay.metered.ca:80' },
  {
    urls: [
      'turn:openrelay.metered.ca:80',
      'turn:openrelay.metered.ca:443',
      'turn:openrelay.metered.ca:443?transport=tcp'
    ],
    username: 'openrelayproject',
    credential: 'openrelayproject'
  }
];

export function sanitizeIceCandidate(candidate) {
  if (!candidate) return null;
  const raw = typeof candidate.toJSON === 'function' ? candidate.toJSON() : candidate;
  const res = {
    candidate: String(raw.candidate || '')
  };
  if (raw.sdpMid !== undefined && raw.sdpMid !== null) {
    res.sdpMid = String(raw.sdpMid);
  }
  if (raw.sdpMLineIndex !== undefined && raw.sdpMLineIndex !== null) {
    res.sdpMLineIndex = Number(raw.sdpMLineIndex);
  }
  if (raw.usernameFragment !== undefined && raw.usernameFragment !== null && raw.usernameFragment !== '') {
    res.usernameFragment = String(raw.usernameFragment);
  }
  return res;
}

const BUFFER_LOW_THRESHOLD = 128 * 1024;
const BUFFER_HIGH_LIMIT = 512 * 1024;

export function getCustomTurnConfig() {
  try {
    const raw = localStorage.getItem('wavesync_turn_config');
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.urls) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveCustomTurnConfig(config) {
  if (!config || !config.urls?.trim()) {
    localStorage.removeItem('wavesync_turn_config');
    return;
  }
  localStorage.setItem(
    'wavesync_turn_config',
    JSON.stringify({
      urls: config.urls.trim(),
      username: (config.username || '').trim(),
      credential: (config.credential || '').trim()
    })
  );
}

export function buildIceServers() {
  const servers = [...DEFAULT_ICE_SERVERS];
  const env = typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env : {};
  if (env.VITE_TURN_URL) {
    const entry = { urls: env.VITE_TURN_URL };
    if (env.VITE_TURN_USER) entry.username = env.VITE_TURN_USER;
    if (env.VITE_TURN_PASS) entry.credential = env.VITE_TURN_PASS;
    servers.push(entry);
  }
  const custom = getCustomTurnConfig();
  if (custom?.urls) {
    const entry = { urls: custom.urls };
    if (custom.username) entry.username = custom.username;
    if (custom.credential) entry.credential = custom.credential;
    servers.push(entry);
  }
  return servers;
}

function waitForDataChannelDrain(dc) {
  return new Promise((resolve) => {
    if (dc.readyState !== 'open' || dc.bufferedAmount <= BUFFER_LOW_THRESHOLD) {
      resolve();
      return;
    }
    const onLow = () => {
      cleanup();
      resolve();
    };
    const onClose = () => {
      cleanup();
      resolve();
    };
    const fallbackTimer = setTimeout(() => {
      cleanup();
      resolve();
    }, 300);

    const cleanup = () => {
      clearTimeout(fallbackTimer);
      dc.removeEventListener('bufferedamountlow', onLow);
      dc.removeEventListener('close', onClose);
    };

    dc.addEventListener('bufferedamountlow', onLow);
    dc.addEventListener('close', onClose);
  });
}

// ============================================================================
// ХОСТ: раздает оригинальные файлы всем подключенным слушателям
// ============================================================================
export class HostTransferManager {
  constructor({ roomCode, hostId, getFile, getTrackMeta, getPriorityTrackIds, onPeerStatus }) {
    this.roomCode = roomCode;
    this.hostId = hostId;
    this.getFile = getFile;
    this.getTrackMeta = getTrackMeta;
    this.getPriorityTrackIds = getPriorityTrackIds;
    this.onPeerStatus = onPeerStatus || (() => {});

    this.peers = new Map(); // listenerId -> PeerSession
    this.destroyed = false;
  }

  destroy() {
    this.destroyed = true;
    for (const listenerId of Array.from(this.peers.keys())) {
      this._closePeer(listenerId);
    }
    this.peers.clear();
  }

  syncParticipants(participants) {
    if (this.destroyed) return;

    const activeListeners = new Map();
    for (const p of participants) {
      if (!p.isHost && p.isOnline) {
        activeListeners.set(p.id, p);
      }
    }

    // Закрываем ушедших или вышедших в оффлайн
    for (const listenerId of Array.from(this.peers.keys())) {
      if (!activeListeners.has(listenerId)) {
        this._closePeer(listenerId);
      }
    }

    // Подключаем новых или переподключившихся (новый connInstanceId)
    for (const [listenerId, p] of activeListeners.entries()) {
      const existing = this.peers.get(listenerId);
      if (!existing || existing.connInstanceId !== p.connInstanceId) {
        if (existing) this._closePeer(listenerId);
        this._initPeer(listenerId, p.connInstanceId);
      }
    }
  }

  reprioritizeAllPeers() {
    if (this.destroyed) return;
    const priorityIds = this.getPriorityTrackIds();
    const primaryTrackId = priorityIds[0] || null;

    for (const peer of this.peers.values()) {
      if (!peer.dc || peer.dc.readyState !== 'open') continue;

      try {
        peer.dc.send(JSON.stringify({ type: 'MANIFEST', queueTrackIds: priorityIds }));
      } catch {
        // ignore send errors on closing channel
      }

      // Если сейчас передается второстепенный трек, а появился более приоритетный активный — прерываем и переключаемся
      if (
        peer.activeTransfer &&
        primaryTrackId &&
        peer.activeTransfer.trackId !== primaryTrackId &&
        !peer.delivered.has(primaryTrackId) &&
        this.getFile(primaryTrackId)
      ) {
        peer.activeTransfer.aborted = true;
      }

      this._pumpPeerQueue(peer);
    }
  }

  _emitStatus(peer, extra = {}) {
    this.onPeerStatus(peer.listenerId, {
      iceState: peer.pc?.iceConnectionState || 'new',
      dcState: peer.dc?.readyState || 'connecting',
      transferTrackId: peer.activeTransfer?.trackId || null,
      transferPercent: peer.transferPercent || 0,
      deliveredCount: peer.delivered.size,
      ...extra
    });
  }

  async _initPeer(listenerId, connInstanceId) {
    const nonce = 'n_' + Math.random().toString(36).slice(2, 10);
    const basePath = `music_rooms/${this.roomCode}/webrtc/${listenerId}`;

    const peer = {
      listenerId,
      connInstanceId,
      nonce,
      pc: null,
      dc: null,
      remoteSet: false,
      pendingCandidates: [],
      seenCandidateKeys: new Set(),
      delivered: new Set(),
      transferSeqCounter: 1,
      activeTransfer: null,
      pumping: false,
      transferPercent: 0,
      unsubs: []
    };
    this.peers.set(listenerId, peer);
    this._emitStatus(peer);

    try {
      // Очищаем старый сигналинг перед новым оффером
      await set(ref(database, basePath), null);
    } catch (e) {
      console.warn('Failed clearing old signaling node:', e);
    }

    if (this.destroyed || this.peers.get(listenerId) !== peer) return;

    const pc = new RTCPeerConnection({ iceServers: buildIceServers() });
    peer.pc = pc;

    const dc = pc.createDataChannel('audio-transfer', { ordered: true });
    dc.binaryType = 'arraybuffer';
    dc.bufferedAmountLowThreshold = BUFFER_LOW_THRESHOLD;
    peer.dc = dc;

    dc.onopen = () => {
      if (this.destroyed || this.peers.get(listenerId) !== peer) return;
      this._emitStatus(peer);
      const priorityIds = this.getPriorityTrackIds();
      try {
        dc.send(JSON.stringify({ type: 'MANIFEST', queueTrackIds: priorityIds }));
      } catch {}
      this._pumpPeerQueue(peer);
    };

    dc.onclose = () => {
      if (peer.activeTransfer) peer.activeTransfer.aborted = true;
      this._emitStatus(peer);
    };

    dc.onerror = () => {
      this._emitStatus(peer);
    };

    dc.onmessage = (ev) => {
      if (typeof ev.data !== 'string') return;
      try {
        const msg = JSON.parse(ev.data);
        this._handleListenerMessage(peer, msg);
      } catch (e) {
        console.warn('Host failed parsing listener msg:', e);
      }
    };

    pc.oniceconnectionstatechange = () => {
      this._emitStatus(peer);
    };

    pc.onicecandidate = (ev) => {
      if (!ev.candidate || this.destroyed || this.peers.get(listenerId) !== peer) return;
      const clean = sanitizeIceCandidate(ev.candidate);
      if (!clean || !clean.candidate) return;
      push(ref(database, `${basePath}/hostCandidates`), {
        nonce,
        candidate: clean
      }).catch((err) => {
        console.warn('Host error pushing ICE candidate to RTDB:', err);
      });
    };

    // Слушаем Answer слушателя
    const answerRef = ref(database, `${basePath}/answer`);
    const unsubAnswer = onValue(answerRef, async (snap) => {
      const val = snap.val();
      if (!val || val.nonce !== nonce || peer.remoteSet || this.destroyed) return;
      try {
        await pc.setRemoteDescription(new RTCSessionDescription({ type: val.type, sdp: val.sdp }));
        peer.remoteSet = true;
        for (const cand of peer.pendingCandidates) {
          const clean = sanitizeIceCandidate(cand);
          if (clean && clean.candidate) {
            await pc.addIceCandidate(new RTCIceCandidate(clean)).catch(() => {});
          }
        }
        peer.pendingCandidates = [];
      } catch (e) {
        console.error('Host setRemoteDescription error:', e);
      }
    });
    peer.unsubs.push(() => off(answerRef));
    peer.unsubs.push(unsubAnswer);

    // Слушаем ICE-кандидаты слушателя
    const candRef = ref(database, `${basePath}/listenerCandidates`);
    const unsubCands = onValue(candRef, async (snap) => {
      const val = snap.val();
      if (!val || this.destroyed) return;
      for (const [key, item] of Object.entries(val)) {
        if (peer.seenCandidateKeys.has(key)) continue;
        if (!item || item.nonce !== nonce || !item.candidate) continue;
        peer.seenCandidateKeys.add(key);

        const clean = sanitizeIceCandidate(item.candidate);
        if (!clean || !clean.candidate) continue;

        if (peer.remoteSet) {
          await pc.addIceCandidate(new RTCIceCandidate(clean)).catch(() => {});
        } else {
          peer.pendingCandidates.push(clean);
        }
      }
    });
    peer.unsubs.push(unsubCands);

    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      if (this.destroyed || this.peers.get(listenerId) !== peer) return;
      await set(ref(database, `${basePath}/offer`), {
        nonce,
        type: offer.type,
        sdp: offer.sdp
      });
    } catch (e) {
      console.error('Host createOffer error:', e);
    }
  }

  _handleListenerMessage(peer, msg) {
    if (msg.type === 'HELLO') {
      if (Array.isArray(msg.haveTrackIds)) {
        msg.haveTrackIds.forEach((id) => peer.delivered.add(id));
      }
      this._pumpPeerQueue(peer);
      return;
    }

    if (msg.type === 'REQUEST_TRACK' && msg.trackId) {
      peer.delivered.delete(msg.trackId);
      this._pumpPeerQueue(peer, msg.trackId);
      return;
    }

    if (msg.type === 'TRACK_READY' && msg.trackId) {
      peer.delivered.add(msg.trackId);
      this._emitStatus(peer, { transferPercent: 100 });
      this._pumpPeerQueue(peer);
    }
  }

  async _pumpPeerQueue(peer, forcedTrackId = null) {
    if (peer.pumping || this.destroyed) return;
    if (!peer.dc || peer.dc.readyState !== 'open') return;

    peer.pumping = true;
    try {
      while (!this.destroyed && peer.dc.readyState === 'open') {
        const priorityIds = this.getPriorityTrackIds();
        const orderedCandidates = forcedTrackId
          ? [forcedTrackId, ...priorityIds.filter((id) => id !== forcedTrackId)]
          : priorityIds;
        forcedTrackId = null;

        const nextTrackId = orderedCandidates.find(
          (id) => id && !peer.delivered.has(id) && this.getFile(id)
        );

        if (!nextTrackId) {
          peer.activeTransfer = null;
          this._emitStatus(peer, { transferTrackId: null });
          break;
        }

        const file = this.getFile(nextTrackId);
        const meta = this.getTrackMeta(nextTrackId);
        if (!file) {
          peer.delivered.add(nextTrackId);
          continue;
        }

        const completed = await this._sendFileToPeer(peer, nextTrackId, file, meta);
        if (completed) {
          peer.delivered.add(nextTrackId);
        }
      }
    } finally {
      peer.pumping = false;
    }
  }

  async _sendFileToPeer(peer, trackId, file, meta) {
    const transferSeq = peer.transferSeqCounter++;
    const transfer = { trackId, transferSeq, aborted: false };
    peer.activeTransfer = transfer;
    peer.transferPercent = 0;

    const dc = peer.dc;
    try {
      dc.send(
        JSON.stringify({
          type: 'FILE_START',
          transferSeq,
          trackId,
          name: meta?.fileName || file.name,
          mimeType: meta?.mimeType || file.type || 'audio/mpeg',
          size: file.size
        })
      );
    } catch {
      return false;
    }

    this._emitStatus(peer, { transferTrackId: trackId, transferPercent: 0 });

    let offset = 0;
    let lastEmitAt = 0;

    while (offset < file.size) {
      if (this.destroyed || dc.readyState !== 'open') return false;

      if (transfer.aborted) {
        try {
          dc.send(JSON.stringify({ type: 'FILE_ABORT', transferSeq, trackId }));
        } catch {}
        return false;
      }

      if (dc.bufferedAmount > BUFFER_HIGH_LIMIT) {
        await waitForDataChannelDrain(dc);
        if (this.destroyed || dc.readyState !== 'open') return false;
        if (transfer.aborted) {
          try {
            dc.send(JSON.stringify({ type: 'FILE_ABORT', transferSeq, trackId }));
          } catch {}
          return false;
        }
      }

      const end = Math.min(file.size, offset + CHUNK_PAYLOAD_SIZE);
      const sliceBuffer = await file.slice(offset, end).arrayBuffer();
      if (this.destroyed || dc.readyState !== 'open' || transfer.aborted) {
        if (transfer.aborted && dc.readyState === 'open') {
          try {
            dc.send(JSON.stringify({ type: 'FILE_ABORT', transferSeq, trackId }));
          } catch {}
        }
        return false;
      }

      const frame = encodeChunkFrame(transferSeq, sliceBuffer);
      try {
        dc.send(frame);
      } catch {
        return false;
      }

      offset = end;
      const now = Date.now();
      const pct = Math.min(100, Math.round((offset / Math.max(1, file.size)) * 100));
      if (now - lastEmitAt > 150 || offset >= file.size) {
        lastEmitAt = now;
        peer.transferPercent = pct;
        this._emitStatus(peer, { transferTrackId: trackId, transferPercent: pct });
      }
    }

    try {
      dc.send(
        JSON.stringify({
          type: 'FILE_END',
          transferSeq,
          trackId,
          size: file.size
        })
      );
      peer.activeTransfer = null;
      peer.transferPercent = 100;
      this._emitStatus(peer, { transferTrackId: null, transferPercent: 100 });
      return true;
    } catch {
      return false;
    }
  }

  _closePeer(listenerId) {
    const peer = this.peers.get(listenerId);
    if (!peer) return;
    if (peer.activeTransfer) peer.activeTransfer.aborted = true;
    peer.unsubs.forEach((u) => {
      try {
        u();
      } catch {}
    });
    try {
      peer.dc?.close();
    } catch {}
    try {
      peer.pc?.close();
    } catch {}
    this.peers.delete(listenerId);
  }
}

// ============================================================================
// СЛУШАТЕЛЬ: принимает оригинальные файлы в память (Blob URL) без потерь
// ============================================================================
export class ListenerTransferManager {
  constructor({ roomCode, listenerId, onTrackReady, onTransferProgress, onConnectionState }) {
    this.roomCode = roomCode;
    this.listenerId = listenerId;
    this.onTrackReady = onTrackReady || (() => {});
    this.onTransferProgress = onTransferProgress || (() => {});
    this.onConnectionState = onConnectionState || (() => {});

    this.cache = new Map(); // trackId -> { blobUrl, size, mimeType }
    this.pc = null;
    this.dc = null;
    this.currentNonce = null;
    this.incoming = null;
    this.seenCandKeys = new Set();
    this.pendingRemoteCands = [];
    this.remoteSet = false;
    this.unsubs = [];
    this.destroyed = false;

    this._listenToHostOffers();
  }

  getTrackBlobUrl(trackId) {
    return this.cache.get(trackId)?.blobUrl || null;
  }

  hasTrack(trackId) {
    return this.cache.has(trackId);
  }

  getCachedTrackIds() {
    return Array.from(this.cache.keys());
  }

  pruneRemovedTracks(activeTrackIds) {
    const keep = new Set(activeTrackIds);
    for (const [trackId, entry] of Array.from(this.cache.entries())) {
      if (!keep.has(trackId)) {
        try {
          URL.revokeObjectURL(entry.blobUrl);
        } catch {}
        this.cache.delete(trackId);
      }
    }
  }

  requestTrack(trackId) {
    if (!trackId || this.cache.has(trackId)) return;
    if (this.dc && this.dc.readyState === 'open') {
      try {
        this.dc.send(JSON.stringify({ type: 'REQUEST_TRACK', trackId }));
      } catch {}
    }
  }

  destroy() {
    this.destroyed = true;
    this._teardownPeer();
    this.unsubs.forEach((u) => {
      try {
        u();
      } catch {}
    });
    this.unsubs = [];
    for (const entry of this.cache.values()) {
      try {
        URL.revokeObjectURL(entry.blobUrl);
      } catch {}
    }
    this.cache.clear();
  }

  _listenToHostOffers() {
    const basePath = `music_rooms/${this.roomCode}/webrtc/${this.listenerId}`;
    const offerRef = ref(database, `${basePath}/offer`);

    const unsubOffer = onValue(offerRef, async (snap) => {
      const offer = snap.val();
      if (!offer || !offer.nonce || offer.nonce === this.currentNonce || this.destroyed) return;
      await this._acceptHostOffer(offer, basePath);
    });
    this.unsubs.push(unsubOffer);
  }

  _teardownPeer() {
    if (this._candUnsub) {
      try {
        this._candUnsub();
      } catch {}
      this._candUnsub = null;
    }
    try {
      this.dc?.close();
    } catch {}
    try {
      this.pc?.close();
    } catch {}
    this.dc = null;
    this.pc = null;
    this.incoming = null;
    this.remoteSet = false;
    this.pendingRemoteCands = [];
    this.seenCandKeys.clear();
  }

  async _acceptHostOffer(offer, basePath) {
    this._teardownPeer();
    this.currentNonce = offer.nonce;
    const nonce = offer.nonce;

    const pc = new RTCPeerConnection({ iceServers: buildIceServers() });
    this.pc = pc;
    this.onConnectionState({ iceState: 'checking', dcState: 'connecting' });

    pc.oniceconnectionstatechange = () => {
      this.onConnectionState({
        iceState: pc.iceConnectionState,
        dcState: this.dc?.readyState || 'connecting'
      });
    };

    pc.onicecandidate = (ev) => {
      if (!ev.candidate || this.destroyed || this.currentNonce !== nonce) return;
      const clean = sanitizeIceCandidate(ev.candidate);
      if (!clean || !clean.candidate) return;
      push(ref(database, `${basePath}/listenerCandidates`), {
        nonce,
        candidate: clean
      }).catch((err) => {
        console.warn('Listener error pushing ICE candidate to RTDB:', err);
      });
    };

    pc.ondatachannel = (ev) => {
      if (this.destroyed || this.currentNonce !== nonce) return;
      const dc = ev.channel;
      dc.binaryType = 'arraybuffer';
      this.dc = dc;

      dc.onopen = () => {
        this.onConnectionState({ iceState: pc.iceConnectionState, dcState: 'open' });
        try {
          dc.send(JSON.stringify({ type: 'HELLO', haveTrackIds: Array.from(this.cache.keys()) }));
        } catch {}
      };

      dc.onclose = () => {
        this.onConnectionState({ iceState: pc.iceConnectionState, dcState: 'closed' });
      };

      let blobChain = Promise.resolve();
      dc.onmessage = (msgEv) => {
        const data = msgEv.data;
        if (typeof data === 'string') {
          blobChain = blobChain.then(() => this._handleControlMessage(data));
          return;
        }
        if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
          blobChain = blobChain.then(() => this._handleBinaryFrame(data));
          return;
        }
        if (data instanceof Blob) {
          blobChain = blobChain.then(async () => {
            const buf = await data.arrayBuffer();
            this._handleBinaryFrame(buf);
          });
        }
      };
    };

    const candRef = ref(database, `${basePath}/hostCandidates`);
    this._candUnsub = onValue(candRef, async (snap) => {
      const val = snap.val();
      if (!val || this.destroyed || this.currentNonce !== nonce) return;
      for (const [key, item] of Object.entries(val)) {
        if (this.seenCandKeys.has(key)) continue;
        if (!item || item.nonce !== nonce || !item.candidate) continue;
        this.seenCandKeys.add(key);

        const clean = sanitizeIceCandidate(item.candidate);
        if (!clean || !clean.candidate) continue;

        if (this.remoteSet) {
          await pc.addIceCandidate(new RTCIceCandidate(clean)).catch(() => {});
        } else {
          this.pendingRemoteCands.push(clean);
        }
      }
    });

    try {
      await pc.setRemoteDescription(new RTCSessionDescription({ type: offer.type, sdp: offer.sdp }));
      this.remoteSet = true;

      for (const c of this.pendingRemoteCands) {
        const clean = sanitizeIceCandidate(c);
        if (clean && clean.candidate) {
          await pc.addIceCandidate(new RTCIceCandidate(clean)).catch(() => {});
        }
      }
      this.pendingRemoteCands = [];

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      if (this.destroyed || this.currentNonce !== nonce) return;

      await set(ref(database, `${basePath}/answer`), {
        nonce,
        type: answer.type,
        sdp: answer.sdp
      });
    } catch (e) {
      console.error('Listener accept offer error:', e);
      this.onConnectionState({ iceState: 'failed', dcState: 'closed' });
    }
  }

  _handleControlMessage(rawJson) {
    let msg;
    try {
      msg = JSON.parse(rawJson);
    } catch {
      return;
    }

    if (msg.type === 'MANIFEST') {
      try {
        this.dc?.send(JSON.stringify({ type: 'HELLO', haveTrackIds: Array.from(this.cache.keys()) }));
      } catch {}
      return;
    }

    if (msg.type === 'FILE_START') {
      this.incoming = {
        transferSeq: msg.transferSeq,
        trackId: msg.trackId,
        name: msg.name,
        mimeType: msg.mimeType || 'audio/mpeg',
        size: Number(msg.size) || 0,
        chunks: [],
        receivedBytes: 0,
        lastProgressAt: 0
      };
      this.onTransferProgress({
        trackId: msg.trackId,
        receivedBytes: 0,
        totalBytes: Number(msg.size) || 0,
        percent: 0,
        state: 'receiving'
      });
      return;
    }

    if (msg.type === 'FILE_ABORT') {
      if (this.incoming && this.incoming.transferSeq === msg.transferSeq) {
        const abortedId = this.incoming.trackId;
        this.incoming = null;
        this.onTransferProgress({
          trackId: abortedId,
          receivedBytes: 0,
          totalBytes: 0,
          percent: 0,
          state: 'aborted'
        });
      }
      return;
    }

    if (msg.type === 'FILE_END') {
      if (!this.incoming || this.incoming.transferSeq !== msg.transferSeq) return;
      const done = this.incoming;
      this.incoming = null;

      if (done.size > 0 && done.receivedBytes !== done.size) {
        console.warn(`File size mismatch for ${done.trackId}: got ${done.receivedBytes}, expected ${done.size}`);
        this.requestTrack(done.trackId);
        return;
      }

      const blob = new Blob(done.chunks, { type: done.mimeType });
      const blobUrl = URL.createObjectURL(blob);
      const prev = this.cache.get(done.trackId);
      if (prev) {
        try {
          URL.revokeObjectURL(prev.blobUrl);
        } catch {}
      }
      this.cache.set(done.trackId, {
        blobUrl,
        size: done.size,
        mimeType: done.mimeType
      });

      this.onTransferProgress({
        trackId: done.trackId,
        receivedBytes: done.size,
        totalBytes: done.size,
        percent: 100,
        state: 'ready'
      });

      try {
        this.dc?.send(JSON.stringify({ type: 'TRACK_READY', trackId: done.trackId }));
      } catch {}

      this.onTrackReady(done.trackId, blobUrl);
    }
  }

  _handleBinaryFrame(rawBuffer) {
    if (!this.incoming) return;
    let decoded;
    try {
      decoded = decodeChunkFrame(rawBuffer);
    } catch {
      return;
    }

    if (decoded.transferSeq !== this.incoming.transferSeq) return;
    this.incoming.chunks.push(decoded.payload);
    this.incoming.receivedBytes += decoded.payload.byteLength;

    const now = Date.now();
    if (now - this.incoming.lastProgressAt > 120 || this.incoming.receivedBytes >= this.incoming.size) {
      this.incoming.lastProgressAt = now;
      const percent = Math.min(
        100,
        Math.round((this.incoming.receivedBytes / Math.max(1, this.incoming.size)) * 100)
      );
      this.onTransferProgress({
        trackId: this.incoming.trackId,
        receivedBytes: this.incoming.receivedBytes,
        totalBytes: this.incoming.size,
        percent,
        state: 'receiving'
      });
    }
  }
}
