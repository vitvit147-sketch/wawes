import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { WebSocketServer } from 'ws';

const PORT = Number(process.env.PORT) || 3080;
const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || './uploads');
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // 50 МБ на файл
const FILE_TTL_MS = 12 * 60 * 60 * 1000; // Автоочистка временных файлов через 12 часов
const EMPTY_ROOM_TTL_MS = 10 * 60 * 1000; // Сохраняем комнату 10 мин после выхода всех (на случай реконнекта)

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

/** @type {Map<string, object>} */
const rooms = new Map();
/** @type {Map<string, { filePath: string, mimeType: string, size: number, createdAt: number }>} */
const uploadedFiles = new Map();

function corsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-File-Name, Range');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');
}

function generateRoomCode() {
  for (let i = 0; i < 12; i++) {
    const code = String(Math.floor(1000 + Math.random() * 9000));
    if (!rooms.has(code)) return code;
  }
  return String(Math.floor(10000 + Math.random() * 90000));
}

function serializeRoom(room) {
  return {
    code: room.code,
    createdAt: room.createdAt,
    hostId: room.hostId,
    hostName: room.hostName,
    settings: room.settings,
    queue: room.queue,
    playback: room.playback,
    participants: room.participantsMap
  };
}

function broadcastRoom(room) {
  const msg = JSON.stringify({ type: 'room_state', room: serializeRoom(room) });
  for (const ws of room.clients) {
    if (ws.readyState === 1) {
      ws.send(msg);
    }
  }
}

function sendAck(ws, reqId, payload) {
  if (ws.readyState === 1 && reqId) {
    ws.send(JSON.stringify({ type: 'ack', reqId, ...payload }));
  }
}

function sanitizeQueueItem(t, idx = 0) {
  return {
    id: String(t.id || `t_${idx}_${Date.now().toString(36)}`),
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

const server = http.createServer((req, res) => {
  corsHeaders(res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const reqUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  if (req.method === 'GET' && reqUrl.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(
      JSON.stringify({
        ok: true,
        rooms: rooms.size,
        files: uploadedFiles.size,
        serverNow: Date.now()
      })
    );
    return;
  }

  // Загрузка аудиофайла с телефона (raw binary stream -> минимальное потребление RAM)
  if (req.method === 'POST' && reqUrl.pathname === '/api/upload') {
    const contentLen = Number(req.headers['content-length']) || 0;
    if (contentLen > MAX_UPLOAD_BYTES) {
      res.writeHead(413, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Файл превышает лимит 50 МБ' }));
      return;
    }

    const fileId = crypto.randomBytes(10).toString('hex');
    const mimeType = String(req.headers['content-type'] || 'audio/mpeg').split(';')[0];
    const filePath = path.join(UPLOAD_DIR, `${fileId}.bin`);
    const writeStream = fs.createWriteStream(filePath);
    let receivedBytes = 0;
    let aborted = false;

    req.on('data', (chunk) => {
      receivedBytes += chunk.length;
      if (receivedBytes > MAX_UPLOAD_BYTES && !aborted) {
        aborted = true;
        writeStream.destroy();
        fs.unlink(filePath, () => {});
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Превышен лимит 50 МБ' }));
        req.destroy();
      }
    });

    req.pipe(writeStream);

    writeStream.on('finish', () => {
      if (aborted) return;
      uploadedFiles.set(fileId, {
        filePath,
        mimeType,
        size: receivedBytes,
        createdAt: Date.now()
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          fileId,
          url: `/api/files/${fileId}`,
          sizeBytes: receivedBytes
        })
      );
    });

    writeStream.on('error', () => {
      if (aborted) return;
      aborted = true;
      fs.unlink(filePath, () => {});
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Ошибка сохранения файла' }));
    });
    return;
  }

  // Стриминг и скачивание загруженного аудио с поддержкой Range (206 Partial Content)
  if (req.method === 'GET' && reqUrl.pathname.startsWith('/api/files/')) {
    const fileId = reqUrl.pathname.slice('/api/files/'.length).replace(/[^\w-]/g, '');
    const meta = uploadedFiles.get(fileId);
    if (!meta || !fs.existsSync(meta.filePath)) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Файл не найден или устарел' }));
      return;
    }

    const total = meta.size;
    const range = req.headers.range;
    if (range) {
      const [startStr, endStr] = range.replace(/bytes=/, '').split('-');
      const start = Math.max(0, Number(startStr) || 0);
      const end = endStr ? Math.min(total - 1, Number(endStr)) : total - 1;
      const chunkLen = end - start + 1;
      res.writeHead(206, {
        'Content-Type': meta.mimeType,
        'Content-Length': chunkLen,
        'Content-Range': `bytes ${start}-${end}/${total}`,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'public, max-age=43200'
      });
      fs.createReadStream(meta.filePath, { start, end }).pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Type': meta.mimeType,
        'Content-Length': total,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'public, max-age=43200'
      });
      fs.createReadStream(meta.filePath).pipe(res);
    }
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws) => {
  ws.roomCode = null;
  ws.participantId = null;

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString('utf8'));
    } catch {
      return;
    }

    if (msg.type === 'ping') {
      ws.send(JSON.stringify({ type: 'pong', clientTs: msg.clientTs || 0, serverTs: Date.now() }));
      return;
    }

    if (msg.type === 'create_room') {
      const code = generateRoomCode();
      const pid = String(msg.participantId || crypto.randomBytes(6).toString('hex'));
      const now = Date.now();
      const cleanName = String(msg.name || 'Диджей').trim().slice(0, 24) || 'Диджей';
      const room = {
        code,
        createdAt: now,
        emptySince: null,
        hostId: pid,
        hostName: cleanName,
        settings: { repeatMode: 'all', waitForListeners: true, allowGuestQueue: false },
        queue: [],
        playback: {
          trackId: null,
          phase: 'idle',
          isPlaying: false,
          anchorPos: 0,
          anchorServerTime: now,
          playbackRate: 1.0,
          actionNonce: 1
        },
        participantsMap: {
          [pid]: {
            id: pid,
            name: cleanName,
            avatar: msg.avatar || '🎧',
            isHost: true,
            isOnline: true,
            connInstanceId: msg.connInstanceId || '',
            joinedAt: now,
            status: 'ready',
            readyTrackId: null,
            downloadProgress: 100
          }
        },
        clients: new Set([ws])
      };
      rooms.set(code, room);
      ws.roomCode = code;
      ws.participantId = pid;
      sendAck(ws, msg.reqId, { ok: true, roomCode: code, participantId: pid, room: serializeRoom(room) });
      return;
    }

    if (msg.type === 'join_room') {
      const code = String(msg.roomCode || '').trim();
      const room = rooms.get(code);
      if (!room) {
        sendAck(ws, msg.reqId, { ok: false, error: `Комната №${code} не найдена или уже закрыта` });
        return;
      }
      const pid = String(msg.participantId || crypto.randomBytes(6).toString('hex'));
      const isHost = room.hostId === pid;
      const cleanName =
        String(msg.name || '').trim().slice(0, 24) || (isHost ? 'Диджей' : 'Слушатель');
      room.emptySince = null;
      room.participantsMap[pid] = {
        id: pid,
        name: cleanName,
        avatar: msg.avatar || '🎧',
        isHost,
        isOnline: true,
        connInstanceId: msg.connInstanceId || '',
        joinedAt: room.participantsMap[pid]?.joinedAt || Date.now(),
        status: isHost ? 'ready' : 'connecting',
        readyTrackId: null,
        downloadProgress: 0
      };
      room.clients.add(ws);
      ws.roomCode = code;
      ws.participantId = pid;
      sendAck(ws, msg.reqId, {
        ok: true,
        roomCode: code,
        participantId: pid,
        isHost,
        room: serializeRoom(room)
      });
      broadcastRoom(room);
      return;
    }

    if (msg.type === 'reconnect_room') {
      const code = String(msg.roomCode || '').trim();
      const pid = String(msg.participantId || '');
      const room = rooms.get(code);
      const existing = room?.participantsMap?.[pid];
      if (!room || !existing) {
        sendAck(ws, msg.reqId, { ok: false });
        return;
      }
      room.emptySince = null;
      room.participantsMap[pid] = {
        ...existing,
        isOnline: true,
        connInstanceId: msg.connInstanceId || existing.connInstanceId || '',
        status: existing.isHost ? 'ready' : 'connecting'
      };
      room.clients.add(ws);
      ws.roomCode = code;
      ws.participantId = pid;
      sendAck(ws, msg.reqId, {
        ok: true,
        roomCode: code,
        participantId: pid,
        isHost: room.hostId === pid,
        room: serializeRoom(room)
      });
      broadcastRoom(room);
      return;
    }

    if (msg.type === 'leave_room') {
      const code = String(msg.roomCode || ws.roomCode || '').trim();
      const pid = String(msg.participantId || ws.participantId || '');
      const room = rooms.get(code);
      if (room) {
        room.clients.delete(ws);
        if (msg.isHost && pid === room.hostId) {
          const deletedMsg = JSON.stringify({ type: 'room_deleted', roomCode: code });
          for (const client of room.clients) {
            if (client.readyState === 1) client.send(deletedMsg);
          }
          rooms.delete(code);
        } else if (pid && room.participantsMap[pid]) {
          delete room.participantsMap[pid];
          if (room.clients.size === 0) room.emptySince = Date.now();
          broadcastRoom(room);
        }
      }
      ws.roomCode = null;
      sendAck(ws, msg.reqId, { ok: true });
      return;
    }

    const roomCode = String(msg.roomCode || ws.roomCode || '').trim();
    const room = roomCode ? rooms.get(roomCode) : null;
    if (!room) {
      sendAck(ws, msg.reqId, { ok: false, error: 'Комната не найдена' });
      return;
    }

    if (msg.type === 'update_queue' && ws.participantId === room.hostId && Array.isArray(msg.queue)) {
      room.queue = msg.queue.map((t, idx) => sanitizeQueueItem(t, idx));
      broadcastRoom(room);
      sendAck(ws, msg.reqId, { ok: true });
    } else if (
      msg.type === 'append_queue' &&
      Array.isArray(msg.tracks) &&
      (ws.participantId === room.hostId || room.settings?.allowGuestQueue)
    ) {
      const existingUrls = new Set(room.queue.map((t) => t.url));
      const added = [];
      for (let i = 0; i < msg.tracks.length; i++) {
        const clean = sanitizeQueueItem(msg.tracks[i], room.queue.length + i);
        if (!clean.url || existingUrls.has(clean.url)) continue;
        existingUrls.add(clean.url);
        added.push(clean);
      }
      if (added.length > 0) {
        room.queue = [...room.queue, ...added];
        broadcastRoom(room);
      }
      sendAck(ws, msg.reqId, { ok: true, addedCount: added.length });
    } else if (msg.type === 'update_playback' && ws.participantId === room.hostId && msg.playback) {
      room.playback = { ...room.playback, ...msg.playback };
      broadcastRoom(room);
      sendAck(ws, msg.reqId, { ok: true });
    } else if (msg.type === 'update_settings' && ws.participantId === room.hostId && msg.settings) {
      room.settings = { ...room.settings, ...msg.settings };
      broadcastRoom(room);
      sendAck(ws, msg.reqId, { ok: true });
    } else if (msg.type === 'update_participant' && ws.participantId && msg.patch) {
      const existing = room.participantsMap[ws.participantId];
      if (existing) {
        room.participantsMap[ws.participantId] = { ...existing, ...msg.patch };
        broadcastRoom(room);
      }
      sendAck(ws, msg.reqId, { ok: true });
    }
  });

  ws.on('close', () => {
    const room = ws.roomCode ? rooms.get(ws.roomCode) : null;
    if (!room) return;
    room.clients.delete(ws);
    if (ws.participantId && room.participantsMap[ws.participantId]) {
      room.participantsMap[ws.participantId].isOnline = false;
      room.participantsMap[ws.participantId].status = 'offline';
    }
    if (room.clients.size === 0) {
      room.emptySince = Date.now();
    } else {
      broadcastRoom(room);
    }
  });
});

// Автоочистка временных аудиофайлов (12 ч) и пустых комнат (10 мин)
setInterval(() => {
  const fileCutoff = Date.now() - FILE_TTL_MS;
  for (const [id, meta] of uploadedFiles.entries()) {
    if (meta.createdAt < fileCutoff) {
      uploadedFiles.delete(id);
      fs.unlink(meta.filePath, () => {});
    }
  }
  const roomCutoff = Date.now() - EMPTY_ROOM_TTL_MS;
  for (const [code, room] of rooms.entries()) {
    if (room.emptySince && room.emptySince < roomCutoff) {
      rooms.delete(code);
    }
  }
}, 5 * 60 * 1000).unref();

server.listen(PORT, () => {
  console.log(`WaveSync RU server listening on http://0.0.0.0:${PORT}`);
});
