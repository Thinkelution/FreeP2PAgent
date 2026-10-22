const { test } = require('node:test');
const assert = require('node:assert/strict');
const WebSocket = require('ws');
const { createCoordinator } = require('../coordinator/server.cjs');
const { createIdentity, sign, envelope } = require('../shared/identity.cjs');
function inbox(ws) {
  const messages = [], waiting = [];
  ws.on('message', data => { const m = JSON.parse(data); const index = waiting.findIndex(w => w.type === m.type); if (index >= 0) waiting.splice(index, 1)[0].resolve(m); else messages.push(m); });
  return type => new Promise((resolve, reject) => {
    const index = messages.findIndex(m => m.type === type);
    if (index >= 0) return resolve(messages.splice(index, 1)[0]);
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${type}`)), 3000);
    waiting.push({ type, resolve: m => { clearTimeout(timer); resolve(m); } });
  });
}
test('coordinator authenticates identities, routes signed signaling, rejects spoofing and excludes chat payloads', async () => {
  const server = createCoordinator(); const addr = await server.listen(); const sockets = [];
  async function client(identity) {
    const ws = new WebSocket(`ws://127.0.0.1:${addr.port}/ws`); sockets.push(ws); const next = inbox(ws);
    const challenge = await next('challenge');
    ws.send(JSON.stringify({ type: 'auth', publicKey: identity.publicKey, name: 'Tester', signature: sign(identity.privateKey, `freep2p-auth:${challenge.challenge}`) }));
    assert.equal((await next('ready')).id, identity.id); return { ws, next };
  }
  try {
    const alice = createIdentity(), bob = createIdentity(), mallory = createIdentity();
    const a = await client(alice), b = await client(bob);
    a.ws.send(JSON.stringify({ type: 'packet', packet: envelope(alice, bob.id, 'request', { name: 'Alice' }) }));
    assert.equal(JSON.parse((await b.next('packet')).packet.body).from, alice.id);
    a.ws.send(JSON.stringify({ type: 'packet', packet: envelope(mallory, bob.id, 'request', { name: 'Mallory' }) }));
    assert.match((await a.next('error')).message, /sender/);
    a.ws.send(JSON.stringify({ type: 'packet', packet: envelope(alice, bob.id, 'chat', { text: 'do not relay' }) }));
    assert.match((await a.next('error')).message, /type/);
    a.ws.send(JSON.stringify({ type: 'packet', packet: envelope(alice, bob.id, 'signal', { type: 'offer', sdp: 'invalid', session: 'x' }) }));
    assert.match((await a.next('error')).message, /description/);
    const health = await fetch(`http://127.0.0.1:${addr.port}/health`); assert.equal((await health.json()).ok, true);
  } finally { sockets.forEach(ws => ws.terminate()); await server.close(); }
});
