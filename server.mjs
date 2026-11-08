#!/usr/bin/env node
// Zero-dependency HTTP static + real-time WebSocket multiplayer + TRELLIS.2 Forge
// proxy server for Monkemon 2.5D. Serves ES modules, PBR .glb 3D models,
// byte-range audio, and synchronizes Tamers across all 5 archipelago zones.

import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || '8731', 10);
const HOST = process.env.HOST || '0.0.0.0';
const FORGE_PORT = parseInt(process.env.FORGE_PORT || '8732', 10);

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_WS_FRAME = 64 * 1024;
const TICK_MS = 50; // 20 Hz archipelago state broadcast
const KEEPALIVE_MS = 15000;
const STALE_MS = 28000;

const DEFAULT_CALLSIGNS = [
  'KAI', 'MANGO', 'SOREN', 'LYRA',
  'BAMBOO', 'PIPA', 'ZEPHYR', 'COCO',
  'TARO', 'KIKO', 'SUNNY', 'JUNO',
];

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

/** @type {Map<string, Map<string, object>>} */
const rooms = new Map();
const startedAt = Date.now();

function sanitizeRoom(raw) {
  const clean = String(raw || 'archipelago').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
  return (clean || 'archipelago').slice(0, 24);
}

function sanitizeName(raw, fallbackSlot = 0) {
  const clean = String(raw || '')
    .toUpperCase()
    .replace(/[^A-Z0-9 _.-]/g, '')
    .trim()
    .slice(0, 12);
  return clean || DEFAULT_CALLSIGNS[fallbackSlot % DEFAULT_CALLSIGNS.length];
}

function defaultPeerState() {
  return {
    zoneId: 'sunpalm',
    x: 0,
    z: 6,
    yaw: 0,
    moving: false,
    inBattle: false,
    partnerId: 'chimpark',
    partnerLv: 5,
    badges: 0,
  };
}

function sanitizeState(s, prev = null) {
  if (!s || typeof s !== 'object') return prev || defaultPeerState();
  const num = (v, def) => (typeof v === 'number' && Number.isFinite(v) ? v : def);
  return {
    zoneId: typeof s.zoneId === 'string' ? s.zoneId.slice(0, 24) : 'sunpalm',
    x: Math.round(num(s.x, 0) * 100) / 100,
    z: Math.round(num(s.z, 6) * 100) / 100,
    yaw: Math.round(num(s.yaw, 0) * 100) / 100,
    moving: !!s.moving,
    inBattle: !!s.inBattle,
    partnerId: typeof s.partnerId === 'string' ? s.partnerId.slice(0, 28) : 'chimpark',
    partnerLv: Math.max(1, Math.min(99, num(s.partnerLv, 5) | 0)),
    badges: Math.max(0, Math.min(8, num(s.badges, 0) | 0)),
  };
}

function getOrCreateRoom(roomName) {
  let r = rooms.get(roomName);
  if (!r) {
    r = new Map();
    rooms.set(roomName, r);
  }
  return r;
}

function allocateSlot(roomMap) {
  const used = new Set();
  for (const p of roomMap.values()) used.add(p.slot);
  for (let i = 0; i < 64; i++) {
    if (!used.has(i)) return i;
  }
  return roomMap.size % 64;
}

function encodeWsText(str) {
  const payload = Buffer.from(str, 'utf8');
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x81;
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, payload]);
}

function encodeWsControl(opcode, payload = Buffer.alloc(0)) {
  const h = Buffer.alloc(2);
  h[0] = 0x80 | (opcode & 0x0f);
  h[1] = payload.length & 0x7f;
  return Buffer.concat([h, payload]);
}

function sendToPeer(peer, msgObj) {
  const json = typeof msgObj === 'string' ? msgObj : JSON.stringify(msgObj);
  if (peer.ws && !peer.ws.destroyed && peer.ws.writable && peer.ws.writableLength < 256 * 1024) {
    peer.ws.write(encodeWsText(json));
  }
}

function broadcastRoom(roomMap, msgObj, exceptId = null) {
  const frame = encodeWsText(JSON.stringify(msgObj));
  for (const p of roomMap.values()) {
    if (p.id === exceptId) continue;
    if (p.ws && !p.ws.destroyed && p.ws.writable && p.ws.writableLength < 256 * 1024) {
      p.ws.write(frame);
    }
  }
}

function proxyToForge(req, res) {
  const upstream = http.request(
    {
      hostname: '127.0.0.1',
      port: FORGE_PORT,
      path: req.url,
      method: req.method,
      headers: { ...req.headers, host: `127.0.0.1:${FORGE_PORT}` },
    },
    (upRes) => {
      res.writeHead(upRes.statusCode || 502, upRes.headers);
      upRes.pipe(res);
    },
  );
  res.on('close', () => {
    if (!res.writableEnded) upstream.destroy();
  });
  upstream.on('error', () => {
    if (!res.headersSent) {
      res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'TRELLIS.2 Sanctuary Forge service unavailable on local port ' + FORGE_PORT }));
    }
  });
  req.pipe(upstream);
}

function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? '/index.html' : pathname;
  let decoded;
  try {
    decoded = decodeURIComponent(rel);
  } catch {
    res.writeHead(400);
    res.end('Bad URI');
    return;
  }
  const safePath = path.normalize(path.join(__dirname, decoded));
  if (!safePath.startsWith(__dirname + path.sep) && safePath !== path.join(__dirname, 'index.html')) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.stat(safePath, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }

    const ext = path.extname(safePath).toLowerCase();
    const mime = MIME_TYPES[ext] || 'application/octet-stream';
    const range = req.headers.range;
    const baseHeaders = {
      'Content-Type': mime,
      'Accept-Ranges': 'bytes',
      'Cache-Control': ext === '.glb' || ext === '.mp3' ? 'public, max-age=300' : 'no-cache',
    };

    if (range) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (m) {
        const start = m[1] ? parseInt(m[1], 10) : 0;
        const end = m[2] ? Math.min(st.size - 1, parseInt(m[2], 10)) : st.size - 1;
        if (start <= end && start < st.size) {
          res.writeHead(206, {
            ...baseHeaders,
            'Content-Range': `bytes ${start}-${end}/${st.size}`,
            'Content-Length': end - start + 1,
          });
          if (req.method === 'HEAD') {
            res.end();
            return;
          }
          fs.createReadStream(safePath, { start, end }).pipe(res);
          return;
        }
      }
    }

    res.writeHead(200, { ...baseHeaders, 'Content-Length': st.size });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    fs.createReadStream(safePath).pipe(res);
  });
}

const server = http.createServer((req, res) => {
  const urlObj = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const pathname = urlObj.pathname;

  if (pathname === '/api/health') {
    let totalPeers = 0;
    for (const r of rooms.values()) totalPeers += r.size;
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      ok: true,
      game: 'monkemon',
      uptimeSec: Math.round((Date.now() - startedAt) / 1000),
      onlineTamers: totalPeers,
    }));
    return;
  }

  if (pathname === '/api/forged_species') {
    const forgedPath = path.join(__dirname, 'assets', 'forged_species.json');
    fs.readFile(forgedPath, 'utf8', (err, data) => {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(err ? '{"species":[]}' : data);
    });
    return;
  }

  if (pathname.startsWith('/api/forge/')) {
    proxyToForge(req, res);
    return;
  }

  serveStatic(req, res, pathname);
});

server.on('upgrade', (req, socket) => {
  const urlObj = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  if (urlObj.pathname !== '/ws') {
    socket.destroy();
    return;
  }
  const key = req.headers['sec-websocket-key'];
  if (!key) {
    socket.destroy();
    return;
  }
  const accept = crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
  );
  socket.setNoDelay(true);

  const roomName = sanitizeRoom(urlObj.searchParams.get('room'));
  const roomMap = getOrCreateRoom(roomName);
  const slot = allocateSlot(roomMap);
  const peer = {
    id: crypto.randomBytes(6).toString('hex'),
    slot,
    name: sanitizeName(urlObj.searchParams.get('name'), slot),
    room: roomName,
    ws: socket,
    lastSeen: Date.now(),
    state: defaultPeerState(),
  };
  roomMap.set(peer.id, peer);

  sendToPeer(peer, {
    t: 'welcome',
    id: peer.id,
    slot: peer.slot,
    name: peer.name,
    room: roomName,
    peers: Array.from(roomMap.values()).map((p) => ({
      id: p.id,
      slot: p.slot,
      name: p.name,
      s: p.state,
    })),
  });

  let buf = Buffer.alloc(0);
  socket.on('data', (chunk) => {
    peer.lastSeen = Date.now();
    buf = Buffer.concat([buf, chunk]);
    while (buf.length >= 2) {
      const b0 = buf[0];
      const b1 = buf[1];
      const opcode = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f;
      let offset = 2;
      if (len === 126) {
        if (buf.length < 4) return;
        len = buf.readUInt16BE(2);
        offset = 4;
      } else if (len === 127) {
        if (buf.length < 10) return;
        len = Number(buf.readBigUInt64BE(2));
        offset = 10;
      }
      if (len > MAX_WS_FRAME) {
        socket.destroy();
        return;
      }
      const maskLen = masked ? 4 : 0;
      if (buf.length < offset + maskLen + len) return;

      const payload = Buffer.from(buf.subarray(offset + maskLen, offset + maskLen + len));
      if (masked) {
        const mask = buf.subarray(offset, offset + 4);
        for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      }
      buf = buf.subarray(offset + maskLen + len);

      if (opcode === 0x8) {
        socket.end(encodeWsControl(0x8));
        return;
      }
      if (opcode === 0x9) {
        socket.write(encodeWsControl(0xA, payload.subarray(0, 125)));
        continue;
      }
      if (opcode === 0x1) {
        try {
          const msg = JSON.parse(payload.toString('utf8'));
          if (msg.t === 'state') {
            peer.state = sanitizeState(msg.s, peer.state);
          } else if (msg.t === 'name') {
            peer.name = sanitizeName(msg.name, peer.slot);
          } else if (msg.t === 'wave') {
            broadcastRoom(roomMap, { t: 'wave', id: peer.id, name: peer.name, zoneId: peer.state.zoneId });
          }
        } catch {
          // ignore malformed JSON frame
        }
      }
    }
  });

  const cleanup = () => {
    if (roomMap.delete(peer.id)) {
      broadcastRoom(roomMap, { t: 'leave', id: peer.id });
    }
  };
  socket.on('close', cleanup);
  socket.on('error', cleanup);
});

setInterval(() => {
  for (const roomMap of rooms.values()) {
    if (roomMap.size === 0) continue;
    const peers = Array.from(roomMap.values()).map((p) => ({
      id: p.id,
      slot: p.slot,
      name: p.name,
      s: p.state,
    }));
    broadcastRoom(roomMap, { t: 'snapshot', peers });
  }
}, TICK_MS);

setInterval(() => {
  const now = Date.now();
  const ping = encodeWsControl(0x9);
  for (const roomMap of rooms.values()) {
    for (const [id, p] of roomMap.entries()) {
      if (now - p.lastSeen > STALE_MS) {
        try { p.ws.destroy(); } catch {}
        roomMap.delete(id);
        broadcastRoom(roomMap, { t: 'leave', id });
      } else if (p.ws && !p.ws.destroyed && p.ws.writable) {
        p.ws.write(ping);
      }
    }
  }
}, KEEPALIVE_MS);

server.listen(PORT, HOST, () => {
  console.log(`Monkemon server listening on http://${HOST}:${PORT}`);
});
