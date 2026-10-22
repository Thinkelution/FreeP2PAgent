// WebRTC carries chat and file payloads; the coordinator carries signed SDP only.
export class PeerTransport {
  constructor(api, callbacks) { this.api = api; this.callbacks = callbacks; this.peers = new Map(); this.transfers = new Map(); this.retries = new Map(); this.snapshot = null; }
  sync(state) {
    this.snapshot = state;
    for (const [id] of this.peers) if (!state.contacts.some(c => c.id === id && c.status === 'accepted')) this.close(id);
    for (const c of state.contacts) {
      if (c.status === 'accepted' && c.online && state.id < c.id && !this.peers.has(c.id)) this.connect(c.id).catch(e => this.fail(c.id, e));
    }
  }
  async connect(id) {
    const p = this.create(id, crypto.randomUUID());
    this.channel(id, p, p.pc.createDataChannel('freep2p-v1', { ordered: true }));
    await p.pc.setLocalDescription(await p.pc.createOffer());
    await this.gather(p.pc);
    await this.api.signal({ id, data: { type: 'offer', sdp: p.pc.localDescription.sdp, session: p.session } });
  }
  create(id, session) {
    clearTimeout(this.retries.get(id)); this.retries.delete(id);
    const pc = new RTCPeerConnection({ iceServers: this.snapshot.iceServers, iceTransportPolicy: 'all' });
    const p = { pc, session, chain: Promise.resolve(), queued: 0, status: 'Connecting', timer: setTimeout(() => this.fail(id, new Error('Connection timed out. Check network or relay configuration.')), 35000) };
    this.peers.set(id, p);
    pc.ondatachannel = event => { if (p.dc) event.channel.close(); else this.channel(id, p, event.channel); };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') this.fail(id, new Error('Peer connection failed. Try reconnecting.'));
      if (pc.connectionState === 'disconnected') {
        this.status(id, 'Reconnecting');
        clearTimeout(p.disconnectTimer);
        p.disconnectTimer = setTimeout(() => this.fail(id, new Error('Peer disconnected')), 15000);
      }
      if (pc.connectionState === 'connected') clearTimeout(p.disconnectTimer);
    };
    this.status(id, 'Connecting');
    return p;
  }
  async gather(pc) {
    if (pc.iceGatheringState === 'complete') return;
    await new Promise((resolve, reject) => {
      const done = () => { clearTimeout(timer); pc.removeEventListener('icegatheringstatechange', change); resolve(); };
      const change = () => { if (pc.iceGatheringState === 'complete') done(); };
      const timer = setTimeout(() => {
        if (pc.localDescription?.sdp.includes('a=candidate:')) done();
        else { pc.removeEventListener('icegatheringstatechange', change); reject(new Error('No network candidates available')); }
      }, 10000);
      pc.addEventListener('icegatheringstatechange', change);
    });
  }
  async signal({ from, data }) {
    if (!this.snapshot?.contacts.some(c => c.id === from && c.status === 'accepted')) return;
    let p = this.peers.get(from);
    if (data.type === 'offer') {
      // The lower identity initiates, eliminating simultaneous-offer glare.
      if (from > this.snapshot.id) return;
      if (p?.session === data.session) return;
      this.close(from, false); p = this.create(from, data.session);
      await p.pc.setRemoteDescription({ type: 'offer', sdp: data.sdp });
      await p.pc.setLocalDescription(await p.pc.createAnswer());
      await this.gather(p.pc);
      await this.api.signal({ id: from, data: { type: 'answer', sdp: p.pc.localDescription.sdp, session: p.session } });
    } else if (data.type === 'answer' && p?.session === data.session && p.pc.signalingState === 'have-local-offer') await p.pc.setRemoteDescription({ type: 'answer', sdp: data.sdp });
  }
  channel(id, p, dc) {
    p.dc = dc;
    dc.onopen = async () => {
      clearTimeout(p.timer);
      this.status(id, 'Connected · encrypted');
      const refreshRoute = async () => {
        if (this.peers.get(id) !== p) return;
        const pair = p.pc.sctp?.transport?.iceTransport?.getSelectedCandidatePair?.();
        if (pair) {
          this.status(id, [pair.local.type, pair.remote.type].includes('relay') ? 'Relayed · encrypted' : 'Direct · encrypted');
          return;
        }
        const stats = await p.pc.getStats();
        let selected;
        stats.forEach(s => { if (s.type === 'transport' && s.selectedCandidatePairId) selected = stats.get(s.selectedCandidatePairId); });
        if (!selected) stats.forEach(s => { if (s.type === 'candidate-pair' && s.state === 'succeeded' && s.nominated) selected = s; });
        if (selected) this.status(id, [stats.get(selected.localCandidateId)?.candidateType, stats.get(selected.remoteCandidateId)?.candidateType].includes('relay') ? 'Relayed · encrypted' : 'Direct · encrypted');
      };
      p.routeTimer = setInterval(() => refreshRoute().catch(() => {}), 2000);
      await refreshRoute();
    };
    dc.onclose = () => { if (this.peers.get(id) === p) this.close(id); };
    dc.onerror = () => this.fail(id, new Error('Data channel error'));
    dc.onmessage = event => {
      if (typeof event.data !== 'string' || event.data.length > 60000) return this.fail(id, new Error('Invalid peer message'));
      if (++p.queued > 32) return this.fail(id, new Error('Peer sent data too quickly'));
      p.chain = p.chain.then(() => this.receive(id, JSON.parse(event.data))).catch(e => this.fail(id, e)).finally(() => p.queued--);
    };
  }
  status(id, status) { const p = this.peers.get(id); if (p) p.status = status; this.callbacks.status(id, status); }
  ready(id) { return this.peers.get(id)?.dc?.readyState === 'open'; }
  send(id, data) {
    const dc = this.peers.get(id)?.dc;
    if (dc?.readyState !== 'open') throw new Error('Friend is not connected yet');
    dc.send(JSON.stringify(data));
  }
  async chat(id, text) {
    if (!text.trim() || text.length > 8000) throw new Error('Message must be 1–8,000 characters');
    if (!this.ready(id)) throw new Error('Connect to your friend before sending');
    const messageId = crypto.randomUUID();
    await this.api.saveChat({ id, entry: { id: messageId, text, direction: 'out' } });
    this.send(id, { type: 'chat', id: messageId, text });
  }
  key(id, transfer) { return `${id}:${transfer}`; }
  async offer(id) {
    if (!this.ready(id)) throw new Error('Connect to your friend before sending a file');
    if ([...this.transfers.values()].some(t => t.peer === id && !t.finished)) throw new Error('Finish or cancel this friend’s current transfer first');
    const file = await this.api.pickFile(); if (!file) return;
    const t = { ...file, peer: id, direction: 'out', status: 'Waiting for acceptance', progress: 0 };
    this.transfers.set(this.key(id, file.id), t); this.changed(t);
    try { this.send(id, { type: 'file-offer', ...file }); } catch (e) { await this.cancel(t); throw e; }
  }
  changed(t) {
    for (const [key, entry] of this.transfers) if (this.transfers.size > 100 && entry.finished && entry !== t) this.transfers.delete(key);
    this.callbacks.transfer({ ...t });
  }
  async accept(t) {
    if (t.finished || t.direction !== 'in' || t.localId || t.accepting) return;
    t.accepting = true;
    try {
      const localId = await this.api.receiveFile({ name: t.name, size: t.size });
      if (t.finished) { if (localId) await this.api.cancelFile(localId); return; }
      if (!localId) return;
      t.localId = localId; t.status = 'Receiving'; this.changed(t);
      this.send(t.peer, { type: 'file-accept', id: t.id });
    } finally { t.accepting = false; }
  }
  async cancel(t, tell = true, reason = 'Cancelled') {
    if (t.finished) return;
    t.finished = true; t.status = reason;
    t.ackWait?.reject(new Error(reason));
    await this.api.cancelFile(t.direction === 'out' ? t.id : t.localId);
    if (tell && this.ready(t.peer)) this.send(t.peer, { type: 'file-cancel', id: t.id });
    this.changed(t);
  }
  async pump(t) {
    if (t.sending || t.finished) return;
    t.sending = true; t.status = 'Sending'; this.changed(t);
    try {
      while (!t.finished) {
        const dc = this.peers.get(t.peer)?.dc;
        if (dc?.readyState !== 'open') throw new Error('Connection lost');
        if (dc.bufferedAmount > 262144) { await new Promise(r => setTimeout(r, 20)); continue; }
        const chunk = await this.api.readFile(t.id);
        if (t.finished) break;
        if (chunk.data) {
          // Receiver ACKs after disk write: bounds memory even on slow disks.
          const ack = new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('Recipient stopped acknowledging chunks')), 30000);
            t.ackWait = { resolve: () => { clearTimeout(timer); resolve(); }, reject: e => { clearTimeout(timer); reject(e); } };
          });
          this.send(t.peer, { type: 'file-chunk', id: t.id, data: chunk.data });
          await ack; t.ackWait = null;
        }
        t.progress = chunk.offset; this.changed(t);
        if (chunk.done) { this.send(t.peer, { type: 'file-end', id: t.id, sha256: chunk.sha256 }); t.status = 'Verifying at recipient'; this.changed(t); break; }
      }
    } catch (e) { await this.cancel(t, true, `Failed: ${e.message}`); }
  }
  async receive(id, m) {
    if (!m || typeof m.type !== 'string' || typeof m.id !== 'string' || !/^[a-f0-9-]{36}$/.test(m.id)) throw new Error('Invalid peer message');
    if (m.type === 'chat') {
      if (typeof m.text !== 'string' || !m.text.trim() || m.text.length > 8000) throw new Error('Invalid chat');
      await this.api.saveChat({ id, entry: { id: m.id, text: m.text, direction: 'in' } });
      this.send(id, { type: 'chat-ack', id: m.id }); await this.api.notify('New message from a friend'); return;
    }
    if (m.type === 'chat-ack') { await this.api.ackChat({ id, messageId: m.id }); return; }
    const key = this.key(id, m.id);
    let t = this.transfers.get(key);
    if (m.type === 'file-offer') {
      if (t || [...this.transfers.values()].some(v => v.peer === id && !v.finished) || !Number.isSafeInteger(m.size) || m.size < 0 || m.size > 10 * 1024 ** 3 || typeof m.name !== 'string' || !m.name || m.name.length > 255) {
        this.send(id, { type: 'file-cancel', id: m.id }); return;
      }
      t = { id: m.id, peer: id, name: m.name, size: m.size, direction: 'in', status: 'Accept to receive', progress: 0 };
      this.transfers.set(key, t); this.changed(t); await this.api.notify('A friend wants to send you a file'); return;
    }
    if (!t || t.finished) return;
    if (m.type === 'file-accept' && t.direction === 'out') { void this.pump(t); }
    else if (m.type === 'file-chunk' && t.direction === 'in' && t.localId) { t.progress = await this.api.writeFile({ id: t.localId, data: m.data }); this.changed(t); this.send(id, { type: 'file-chunk-ack', id: t.id }); }
    else if (m.type === 'file-chunk-ack' && t.direction === 'out') t.ackWait?.resolve();
    else if (m.type === 'file-end' && t.direction === 'in' && t.localId) {
      await this.api.finishFile({ id: t.localId, sha256: m.sha256 });
      t.finished = true; t.status = 'Complete · verified'; this.changed(t); this.send(id, { type: 'file-complete', id: t.id });
    } else if (m.type === 'file-complete' && t.direction === 'out' && t.status === 'Verifying at recipient') { t.finished = true; t.status = 'Complete · verified'; this.changed(t); }
    else if (m.type === 'file-cancel') await this.cancel(t, false, 'Cancelled by friend');
  }
  close(id, retry = true) {
    const p = this.peers.get(id); if (!p) return;
    this.peers.delete(id); clearTimeout(p.timer); clearTimeout(p.disconnectTimer); clearInterval(p.routeTimer); p.pc.close();
    for (const t of this.transfers.values()) if (t.peer === id && !t.finished) void this.cancel(t, false, 'Interrupted — send again');
    this.callbacks.status(id, 'Disconnected');
    if (retry) {
      clearTimeout(this.retries.get(id));
      this.retries.set(id, setTimeout(() => {
        this.retries.delete(id);
        const c = this.snapshot?.contacts.find(c => c.id === id);
        if (!this.peers.has(id) && this.snapshot.online && c?.status === 'accepted' && c.online && this.snapshot.id < id) this.connect(id).catch(e => this.fail(id, e));
      }, 1500));
    }
  }
  fail(id, error) { this.close(id); this.callbacks.error(error.message); }
}
