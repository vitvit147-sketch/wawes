import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { WebSocketServer } from 'ws';

const PORT = Number(process.env.PORT) || 3080;
const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || './uploads');
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // 50 МБ на файл
const FILE_TTL_MS = 12 * 60 * 60 * 1000; // Автоочистка временных файлов через 12 часов

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
  for (let i = 0; i < 10; i++) {
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
    participants: Object.values(room.participantsMap)
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
      const room = {
        code,
        createdAt: now,
        hostId: pid,
        hostName: String(msg.name || 'Диджей').slice(0, 24),
        settings: { repeatMode: 'all', waitForListeners: true },
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
            name: String(msg.name || 'Диджей').slice(0, 24),
            avatar: msg.avatar || '🎧',
            isHost: true,
            isOnline: true,
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
      ws.send(JSON.stringify({ type: 'joined', participantId: pid, room: serializeRoom(room) }));
      return;
    }

    if (msg.type === 'join_room') {
      const code = String(msg.roomCode || '').trim();
      const room = rooms.get(code);
      if (!room) {
        ws.send(JSON.stringify({ type: 'error', message: `Комната №${code} не найдена` }));
        return;
      }
      const pid = String(msg.participantId || crypto.randomBytes(6).toString('hex'));
      const isHost = room.hostId === pid;
      room.participantsMap[pid] = {
        id: pid,
        name: String(msg.name || (isHost ? 'Диджей' : 'Слушатель')).slice(0, 24),
        avatar: msg.avatar || '🎧',
        isHost,
        isOnline: true,
        status: isHost ? 'ready' : 'connecting',
        readyTrackId: null,
        downloadProgress: 0
      };
      room.clients.add(ws);
      ws.roomCode = code;
      ws.participantId = pid;
      ws.send(JSON.stringify({ type: 'joined', participantId: pid, room: serializeRoom(room) }));
      broadcastRoom(room);
      return;
    }

    const room = ws.roomCode ? rooms.get(ws.roomCode) : null;
    if (!room) return;

    if (msg.type === 'update_queue' && ws.participantId === room.hostId && Array.isArray(msg.queue)) {
      room.queue = msg.queue;
      broadcastRoom(room);
    } else if (msg.type === 'update_playback' && ws.participantId === room.hostId && msg.playback) {
      room.playback = { ...room.playback, ...msg.playback };
      broadcastRoom(room);
    } else if (msg.type === 'update_settings' && ws.participantId === room.hostId && msg.settings) {
      room.settings = { ...room.settings, ...msg.settings };
      broadcastRoom(room);
    } else if (msg.type === 'update_participant' && ws.participantId && msg.patch) {
      const existing = room.participantsMap[ws.participantId];
      if (existing) {
        room.participantsMap[ws.participantId] = { ...existing, ...msg.patch };
        broadcastRoom(room);
      }
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
      rooms.delete(room.code);
    } else {
      broadcastRoom(room);
    }
  });
});

// Автоочистка временных аудиофайлов старше 12 часов
setInterval(() => {
  const cutoff = Date.now() - FILE_TTL_MS;
  for (const [id, meta] of uploadedFiles.entries()) {
    if (meta.createdAt < cutoff) {
      uploadedFiles.delete(id);
      fs.unlink(meta.filePath, () => {});
    }
  }
}, 30 * 60 * 1000).unref();

server.listen(PORT, () => {
  console.log(`WaveSync RU server listening on http://0.0.0.0:${PORT}`);
});
