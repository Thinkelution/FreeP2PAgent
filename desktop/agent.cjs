const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const WebSocket = require('ws');
const { createIdentity, sign, cleanName, invite, parseInvite, envelope, unpack } = require('../shared/identity.cjs');
const DEFAULT_URL = 'wss://freep2pagent.thinkelution.com/ws';
class Agent extends EventEmitter {
  constructor(directory, secureStorage, overrides = {}) {
    super(); this.directory = directory; this.storage = secureStorage; this.overrides = overrides;
    this.online = false; this.present = new Set(); this.sessions = new Map(); this.seen = new Map(); this.delay = 1000; this.stopped = true;
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.file = path.join(directory, 'profile.json');
    if (fs.existsSync(this.file)) {
      this.data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.identity = { ...this.data.identity, privateKey: this.storage.decryptString(Buffer.from(this.data.secret, 'base64')) };
    } else {
      this.identity = createIdentity();
      this.data = { name: 'My device', coordinator: DEFAULT_URL, identity: { id: this.identity.id, publicKey: this.identity.publicKey }, secret: this.storage.encryptString(this.identity.privateKey).toString('base64'), contacts: {}, blocked: [], history: {} };
      this.save();
    }
    this.iceServers = [];
  }
  save() {
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), { mode: 0o600 }); fs.renameSync(tmp, this.file);
  }
  snapshot() {
    return { id: this.identity.id, name: this.data.name, coordinator: this.overrides.url || this.data.coordinator,
      online: this.online, error: this.error, invite: invite(this.identity, this.data.name), iceServers: this.iceServers,
      contacts: Object.values(this.data.contacts).map(c => ({ ...c, online: this.present.has(c.id) })), history: this.data.history };
  }
  update() { this.emit('state', this.snapshot()); }
  send(data) { if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(data)); }
  packet(id, kind, payload) { if (this.online) this.send({ type: 'packet', packet: envelope(this.identity, id, kind, payload) }); }
  watch() { this.send({ type: 'watch', ids: Object.keys(this.data.contacts) }); }
  start() { this.stop(); this.stopped = false; this.open(); }
  stop() {
    this.stopped = true; clearTimeout(this.retry); clearInterval(this.refresh);
    if (this.ws) { this.ws.removeAllListeners(); this.ws.on('error', () => {}); this.ws.close(); this.ws = null; }
    this.online = false; this.present.clear();
  }
  open() {
    const url = this.overrides.url || this.data.coordinator;
    this.error = null;
    const ws = this.ws = new WebSocket(url, { maxPayload: 65536, handshakeTimeout: 10000 });
    ws.on('message', raw => { try { this.receive(JSON.parse(raw.toString())); } catch (e) { this.error = e.message; this.update(); } });
    ws.on('error', e => { this.error = e.message; this.update(); });
    ws.on('close', code => {
      this.online = false; this.present.clear(); clearInterval(this.refresh); this.update();
      if (code === 4001) { this.stopped = true; this.error = 'This identity is connected on another instance. Restart to reconnect.'; this.update(); }
      if (!this.stopped) { this.retry = setTimeout(() => this.open(), this.delay); this.delay = Math.min(this.delay * 2, 30000); }
    });
  }
  receive(msg) {
    if (msg.type === 'challenge') {
      if (typeof msg.challenge !== 'string' || msg.challenge.length > 100) throw new Error('Invalid coordinator challenge');
      this.send({ type: 'auth', publicKey: this.identity.publicKey, name: this.data.name, signature: sign(this.identity.privateKey, `freep2p-auth:${msg.challenge}`) });
    } else if (msg.type === 'ready') {
      this.online = true; this.delay = 1000; this.iceServers = msg.iceServers; this.watch(); this.update();
      clearInterval(this.refresh); this.refresh = setInterval(() => this.send({ type: 'ice' }), 25 * 60000);
    } else if (msg.type === 'ice') { this.iceServers = msg.iceServers; this.update(); }
    else if (msg.type === 'presence') {
      const previous = this.present; this.present = new Set(msg.peers);
      for (const id of this.present) {
        const instance = msg.sessions?.[id];
        if (instance && this.sessions.has(id) && this.sessions.get(id) !== instance) this.emit('disconnect-peer', id);
        if (instance) this.sessions.set(id, instance);
        const c = this.data.contacts[id];
        if (c && !previous.has(id) && c.status !== 'incoming') this.packet(id, c.status === 'accepted' ? 'accept' : 'request', { name: this.data.name });
      }
      this.update();
    } else if (msg.type === 'packet') {
      const m = unpack(msg.packet, this.identity.id, this.seen);
      if (this.data.blocked.includes(m.from)) return;
      let contact = this.data.contacts[m.from];
      if (contact && contact.publicKey !== msg.packet.publicKey) throw new Error('Friend identity changed');
      if (m.kind === 'request') {
        if (!contact) {
          if (Object.keys(this.data.contacts).length >= 200) return;
          this.data.contacts[m.from] = { id: m.from, publicKey: msg.packet.publicKey, name: cleanName(m.payload.name), status: 'incoming' };
          this.save(); this.watch(); this.update(); this.emit('notice', 'New friend request');
        } else if (contact.status === 'accepted') this.packet(m.from, 'accept', { name: this.data.name });
        else if (contact.status === 'outgoing') { contact.status = 'accepted'; this.save(); this.packet(m.from, 'accept', { name: this.data.name }); this.update(); }
      } else if (m.kind === 'accept' && contact) {
        if (contact.status === 'outgoing') { contact.status = 'accepted'; this.save(); }
        this.update();
      } else if (m.kind === 'remove' && contact) { contact.status = 'outgoing'; this.save(); this.update(); this.emit('disconnect-peer', m.from); }
      else if (m.kind === 'signal' && contact?.status === 'accepted') this.emit('signal', { from: m.from, data: m.payload });
    } else if (msg.type === 'error') { this.error = msg.message; this.update(); }
  }
  add(value) {
    const contact = parseInvite(value);
    if (contact.id === this.identity.id) throw new Error('That is your own invite');
    if (!this.data.contacts[contact.id] && Object.keys(this.data.contacts).length >= 200) throw new Error('MVP supports up to 200 contacts');
    this.data.blocked = this.data.blocked.filter(id => id !== contact.id);
    if (!this.data.contacts[contact.id]) this.data.contacts[contact.id] = { ...contact, status: 'outgoing' };
    this.save(); this.watch(); this.packet(contact.id, 'request', { name: this.data.name }); this.update();
    return contact.id;
  }
  accept(id) {
    const c = this.data.contacts[id];
    if (!c || c.status !== 'incoming') throw new Error('No pending request');
    c.status = 'accepted'; this.save(); this.packet(id, 'accept', { name: this.data.name }); this.watch(); this.update();
  }
  remove(id) {
    this.packet(id, 'remove', {}); delete this.data.contacts[id]; delete this.data.history[id];
    if (!this.data.blocked.includes(id)) this.data.blocked.push(id);
    this.save(); this.watch(); this.update(); this.emit('disconnect-peer', id);
  }
  settings({ name, coordinator }) {
    const url = new URL(coordinator);
    if (url.protocol !== 'wss:' && !(url.protocol === 'ws:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))) throw new Error('Use wss://, or ws://localhost for development');
    if (url.username || url.password || url.hash) throw new Error('Invalid coordinator URL');
    this.data.name = cleanName(name); this.data.coordinator = url.href; this.save(); this.start(); this.update();
  }
  signal(id, data) {
    if (this.data.contacts[id]?.status !== 'accepted') throw new Error('Friend must accept first');
    if (!this.online) throw new Error('Coordinator is offline');
    this.packet(id, 'signal', data);
  }
  message(id, entry) {
    if (this.data.contacts[id]?.status !== 'accepted' || typeof entry.text !== 'string' || entry.text.length > 8000 || !['in', 'out'].includes(entry.direction) || typeof entry.id !== 'string' || entry.id.length > 64) throw new Error('Invalid chat message');
    const history = this.data.history[id] ||= [];
    if (!history.some(m => m.id === entry.id)) history.push({ id: entry.id, text: entry.text, direction: entry.direction, at: Date.now(), delivered: false });
    this.data.history[id] = history.slice(-500); this.save(); this.update();
  }
  delivered(id, messageId) {
    const m = this.data.history[id]?.find(m => m.id === messageId && m.direction === 'out');
    if (m && !m.delivered) { m.delivered = true; this.save(); this.update(); }
  }
}
module.exports = { Agent, DEFAULT_URL };
