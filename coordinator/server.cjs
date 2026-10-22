const http = require('node:http');
const crypto = require('node:crypto');
const { WebSocketServer, WebSocket } = require('ws');
const { ID, idFor, verify, cleanName, unpack } = require('../shared/identity.cjs');

function createCoordinator(options = {}) {
  const peers = new Map();
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    if (req.url === '/health') res.end(JSON.stringify({ ok: true, service: 'FreeP2PAgent', version: '0.1.0' }));
    else { res.statusCode = 404; res.end('{"error":"Not found"}'); }
  });
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 65536, perMessageDeflate: false });
  function send(ws, data) {
    if (ws.readyState === WebSocket.OPEN && ws.bufferedAmount < 256000) ws.send(JSON.stringify(data));
    else if (ws.bufferedAmount >= 256000) ws.close(1008, 'Slow consumer');
  }
  function presence(ws) { send(ws, { type: 'presence', peers: [...ws.watch].filter(id => peers.has(id)) }); }
  function broadcast() { for (const ws of peers.values()) presence(ws); }
  function ice(id) {
    if (options.iceServers) return options.iceServers;
    const servers = [{ urls: options.stunUrl || process.env.STUN_URL || ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
    const secret = options.turnSecret || process.env.TURN_SECRET;
    const urls = options.turnUrls || process.env.TURN_URLS;
    if (secret && urls) {
      const username = `${Math.floor(Date.now() / 1000) + 3600}:${id.slice(0, 16)}`;
      servers.push({ urls: urls.split(','), username, credential: crypto.createHmac('sha1', secret).update(username).digest('base64') });
    }
    return servers;
  }
  wss.on('connection', (ws) => {
    if (wss.clients.size > 1000) return ws.close(1013, 'Capacity reached');
    ws.watch = new Set(); ws.seen = new Map(); ws.alive = true;
    const challenge = crypto.randomBytes(32).toString('base64url');
    const timeout = setTimeout(() => ws.close(1008, 'Authentication timeout'), 10000);
    send(ws, { type: 'challenge', challenge });
    let count = 0, windowStart = Date.now();
    ws.on('pong', () => { ws.alive = true; });
    ws.on('message', raw => {
      try {
        if (Date.now() - windowStart > 10000) { count = 0; windowStart = Date.now(); }
        if (++count > 100) return ws.close(1008, 'Rate limit');
        const msg = JSON.parse(raw.toString());
        if (!ws.peerId) {
          if (msg.type !== 'auth' || !verify(msg.publicKey, `freep2p-auth:${challenge}`, msg.signature)) throw new Error('Authentication failed');
          const peerId = idFor(msg.publicKey);
          const name = cleanName(msg.name);
          if (peers.has(peerId)) peers.get(peerId).close(4001, 'Identity connected elsewhere');
          ws.peerId = peerId; ws.name = name; peers.set(peerId, ws); clearTimeout(timeout);
          send(ws, { type: 'ready', id: peerId, iceServers: ice(peerId) }); broadcast();
          return;
        }
        if (msg.type === 'watch') {
          if (!Array.isArray(msg.ids) || msg.ids.length > 200 || msg.ids.some(id => !ID.test(id))) throw new Error('Invalid contacts');
          ws.watch = new Set(msg.ids); presence(ws);
        } else if (msg.type === 'packet') {
          const m = unpack(msg.packet, null, ws.seen);
          if (m.from !== ws.peerId || m.to === ws.peerId) throw new Error('Invalid sender');
          const target = peers.get(m.to);
          if (target) send(target, { type: 'packet', packet: msg.packet });
          else send(ws, { type: 'unavailable', id: m.to });
        } else if (msg.type === 'ice') send(ws, { type: 'ice', iceServers: ice(ws.peerId) });
        else throw new Error('Unsupported message');
      } catch (e) { send(ws, { type: 'error', message: e.message }); }
    });
    ws.on('error', () => {});
    ws.on('close', () => {
      clearTimeout(timeout);
      if (peers.get(ws.peerId) === ws) { peers.delete(ws.peerId); broadcast(); }
    });
  });
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) { if (!ws.alive) ws.terminate(); else { ws.alive = false; ws.ping(); } }
  }, 30000);
  heartbeat.unref();
  return {
    server, peers,
    listen: (port = 0, host = '127.0.0.1') => new Promise(resolve => server.listen(port, host, () => resolve(server.address()))),
    close: () => new Promise(resolve => { clearInterval(heartbeat); for (const ws of wss.clients) ws.terminate(); wss.close(() => server.close(resolve)); })
  };
}
if (require.main === module) {
  const coordinator = createCoordinator();
  coordinator.listen(Number(process.env.PORT || 4390), process.env.HOST || '127.0.0.1').then(a => console.log(`FreeP2PAgent coordinator listening on ${a.address}:${a.port}`));
  for (const event of ['SIGTERM', 'SIGINT']) process.on(event, () => coordinator.close().then(() => process.exit(0)));
}
module.exports = { createCoordinator };
