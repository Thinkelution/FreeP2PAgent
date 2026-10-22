const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const CHUNK = 32768;
const MAX_SIZE = 10 * 1024 ** 3;
class FileVault {
  constructor() { this.items = new Map(); }
  offer(filePath) {
    if (this.items.size >= 16) throw new Error('Too many active transfers');
    const fd = fs.openSync(filePath, 'r');
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > MAX_SIZE) { fs.closeSync(fd); throw new Error('Choose a file up to 10 GB'); }
    const id = crypto.randomUUID();
    this.items.set(id, { fd, mode: 'read', size: stat.size, offset: 0, hash: crypto.createHash('sha256') });
    return { id, name: path.basename(filePath), size: stat.size };
  }
  read(id) {
    const item = this.items.get(id);
    if (!item || item.mode !== 'read') throw new Error('Unknown outgoing file');
    const data = Buffer.alloc(Math.min(CHUNK, item.size - item.offset));
    const bytes = fs.readSync(item.fd, data, 0, data.length, item.offset);
    if (bytes !== data.length) throw new Error('File changed during transfer');
    item.hash.update(data); item.offset += bytes;
    const result = { data: data.toString('base64'), offset: item.offset, done: item.offset === item.size };
    if (result.done) { result.sha256 = item.hash.digest('hex'); fs.closeSync(item.fd); this.items.delete(id); }
    return result;
  }
  receive(destination, size) {
    if (!Number.isSafeInteger(size) || size < 0 || size > MAX_SIZE || this.items.size >= 16) throw new Error('Invalid transfer size or too many transfers');
    const id = crypto.randomUUID();
    const temporary = `${destination}.${id}.freep2p-part`;
    const fd = fs.openSync(temporary, 'wx', 0o600);
    this.items.set(id, { fd, mode: 'write', size, offset: 0, destination, temporary, hash: crypto.createHash('sha256') });
    return id;
  }
  write(id, data) {
    const item = this.items.get(id);
    if (!item || item.mode !== 'write' || typeof data !== 'string' || data.length > Math.ceil(CHUNK / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) throw new Error('Invalid file chunk');
    const buffer = Buffer.from(data, 'base64');
    if (item.offset + buffer.length > item.size) throw new Error('Transfer exceeded declared size');
    fs.writeSync(item.fd, buffer); item.hash.update(buffer); item.offset += buffer.length;
    return item.offset;
  }
  finish(id, digest) {
    const item = this.items.get(id);
    if (!item || item.mode !== 'write') throw new Error('Unknown incoming file');
    if (item.offset !== item.size || item.hash.digest('hex') !== digest) { this.cancel(id); throw new Error('File integrity check failed'); }
    fs.fsyncSync(item.fd); fs.closeSync(item.fd); item.fd = null;
    try { fs.renameSync(item.temporary, item.destination); } catch (e) { this.cancel(id); throw e; }
    this.items.delete(id);
    return { name: path.basename(item.destination), size: item.size };
  }
  cancel(id) {
    const item = this.items.get(id);
    if (!item) return;
    if (item.fd !== null) fs.closeSync(item.fd);
    if (item.temporary) fs.rmSync(item.temporary, { force: true });
    this.items.delete(id);
  }
  close() { for (const id of this.items.keys()) this.cancel(id); }
}
module.exports = { FileVault, CHUNK, MAX_SIZE };
