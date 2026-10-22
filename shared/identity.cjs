const crypto = require('node:crypto');
const ID = /^[a-f0-9]{64}$/;
function keyObject(publicKey) {
  if (typeof publicKey !== 'string' || publicKey.length > 100) throw new Error('Invalid public key');
  const key = crypto.createPublicKey({ key: Buffer.from(publicKey, 'base64'), format: 'der', type: 'spki' });
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('Expected Ed25519 key');
  return key;
}
function idFor(publicKey) {
  keyObject(publicKey);
  return crypto.createHash('sha256').update(Buffer.from(publicKey, 'base64')).digest('hex');
}
function createIdentity() {
  const pair = crypto.generateKeyPairSync('ed25519');
  const publicKey = pair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  return { id: idFor(publicKey), publicKey, privateKey: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }) };
}
function sign(privateKey, text) { return crypto.sign(null, Buffer.from(text), privateKey).toString('base64'); }
function verify(publicKey, text, signature) {
  try { return typeof signature === 'string' && signature.length < 200 && crypto.verify(null, Buffer.from(text), keyObject(publicKey), Buffer.from(signature, 'base64')); } catch { return false; }
}
function cleanName(value) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 60 || /[\x00-\x1f\x7f]/.test(value)) throw new Error('Name must be 1–60 characters');
  return value.trim();
}
function invite(identity, name) {
  return 'freep2p:' + Buffer.from(JSON.stringify({ v: 1, publicKey: identity.publicKey, name: cleanName(name) })).toString('base64url');
}
function parseInvite(value) {
  if (typeof value !== 'string' || value.length > 1500 || !value.trim().startsWith('freep2p:')) throw new Error('Paste a FreeP2PAgent invite');
  const data = JSON.parse(Buffer.from(value.trim().slice(8), 'base64url').toString());
  if (data.v !== 1) throw new Error('Unsupported invite version');
  return { id: idFor(data.publicKey), publicKey: data.publicKey, name: cleanName(data.name) };
}
function envelope(identity, to, kind, payload) {
  const body = JSON.stringify({ v: 1, from: identity.id, to, kind, payload, time: Date.now(), nonce: crypto.randomUUID() });
  return { body, publicKey: identity.publicKey, signature: sign(identity.privateKey, body) };
}
function unpack(packet, to, seen = new Map()) {
  if (!packet || typeof packet.body !== 'string' || packet.body.length > 60000 || !verify(packet.publicKey, packet.body, packet.signature)) throw new Error('Invalid signed packet');
  const m = JSON.parse(packet.body);
  if (m.v !== 1 || m.from !== idFor(packet.publicKey) || !ID.test(m.to) || (to && m.to !== to) || !Number.isFinite(m.time) || Math.abs(Date.now() - m.time) > 120000 || typeof m.nonce !== 'string' || m.nonce.length > 64 || seen.has(m.nonce)) throw new Error('Expired or invalid packet');
  if (!['request', 'accept', 'remove', 'signal'].includes(m.kind)) throw new Error('Invalid packet type');
  if (m.kind === 'signal') {
    const p = m.payload;
    if (!p || !['offer', 'answer'].includes(p.type) || typeof p.sdp !== 'string' || p.sdp.length > 55000 || !p.sdp.includes('a=fingerprint:sha-256 ') || !/^[a-f0-9-]{36}$/.test(p.session)) throw new Error('Invalid session description');
  } else if (m.kind !== 'remove') cleanName(m.payload?.name);
  for (const [nonce, at] of seen) if (Date.now() - at > 120000) seen.delete(nonce);
  if (seen.size >= 5000) throw new Error('Too many packets');
  seen.set(m.nonce, Date.now());
  return m;
}
module.exports = { ID, createIdentity, idFor, sign, verify, cleanName, invite, parseInvite, envelope, unpack };
