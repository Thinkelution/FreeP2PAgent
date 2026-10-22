const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { createIdentity, invite, parseInvite, envelope, unpack, sign } = require('../shared/identity.cjs');
const { FileVault } = require('../desktop/files.cjs');
const { Agent } = require('../desktop/agent.cjs');
test('friend restart invalidates a stale peer session without waiting for ICE timeout', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'freep2p-session-'));
  const storage = { encryptString: s => Buffer.from(s), decryptString: b => b.toString() };
  const agent = new Agent(dir, storage);
  try {
    const friend = createIdentity(); agent.add(invite(friend, 'Friend'));
    const disconnected = []; agent.on('disconnect-peer', id => disconnected.push(id));
    agent.receive({ type: 'presence', peers: [friend.id], sessions: { [friend.id]: 'first' } });
    agent.receive({ type: 'presence', peers: [], sessions: {} });
    agent.receive({ type: 'presence', peers: [friend.id], sessions: { [friend.id]: 'second' } });
    assert.deepEqual(disconnected, [friend.id]);
    agent.receive({ type: 'presence', peers: [friend.id], sessions: { [friend.id]: 'second' } });
    assert.equal(disconnected.length, 1);
  } finally { agent.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
});
test('invites bind names to keys; packets reject modification, replay, wrong recipient and stale time', () => {
  const alice = createIdentity(), bob = createIdentity();
  assert.equal(parseInvite(invite(alice, 'Alice')).id, alice.id);
  assert.throws(() => parseInvite('not an invite'));
  const packet = envelope(alice, bob.id, 'request', { name: 'Alice' });
  const seen = new Map(); assert.equal(unpack(packet, bob.id, seen).from, alice.id);
  assert.throws(() => unpack(packet, bob.id, seen));
  assert.throws(() => unpack({ ...packet, body: packet.body.replace('Alice', 'Mallory') }, bob.id));
  assert.throws(() => unpack(packet, alice.id));
  const staleBody = JSON.stringify({ ...JSON.parse(packet.body), time: Date.now() - 180000 });
  assert.throws(() => unpack({ ...packet, body: staleBody, signature: sign(alice.privateKey, staleBody) }, bob.id));
});
test('file transfers stream, verify contents, reject oversize writes, and clean incomplete files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'freep2p-files-')); const vault = new FileVault();
  try {
    const content = crypto.randomBytes(1024 * 1024 + 57); fs.writeFileSync(path.join(dir, 'source'), content);
    const offer = vault.offer(path.join(dir, 'source')); const incoming = vault.receive(path.join(dir, 'target'), offer.size);
    let chunk;
    do { chunk = vault.read(offer.id); vault.write(incoming, chunk.data); } while (!chunk.done);
    vault.finish(incoming, chunk.sha256); assert.deepEqual(fs.readFileSync(path.join(dir, 'target')), content);
    const corrupt = vault.receive(path.join(dir, 'corrupt'), 3); vault.write(corrupt, 'YWJj');
    assert.throws(() => vault.finish(corrupt, 'wrong')); assert.equal(fs.existsSync(path.join(dir, 'corrupt')), false);
    const short = vault.receive(path.join(dir, 'short'), 1); assert.throws(() => vault.write(short, 'YWJj')); vault.cancel(short);
    const empty = vault.receive(path.join(dir, 'empty'), 0); vault.finish(empty, crypto.createHash('sha256').digest('hex'));
    assert.equal(fs.statSync(path.join(dir, 'empty')).size, 0);
    assert.equal(fs.readdirSync(dir).some(name => name.endsWith('.freep2p-part')), false);
  } finally { vault.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
