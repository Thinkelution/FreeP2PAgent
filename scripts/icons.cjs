// Code-generated app mark; no external asset or image-generation dependency.
const fs = require('node:fs');
const zlib = require('node:zlib');
function crc(buffer) {
  let c = 0xffffffff;
  for (const b of buffer) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ ((c & 1) ? 0xedb88320 : 0); }
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) { const name = Buffer.from(type); const head = Buffer.alloc(4), tail = Buffer.alloc(4); head.writeUInt32BE(data.length); tail.writeUInt32BE(crc(Buffer.concat([name, data]))); return Buffer.concat([head, name, data, tail]); }
function png(size, tray) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size;
    const arrow = (Math.abs(u + v - 1) < .055 && u > .28 && u < .73) || (u > .46 && u < .75 && v > .25 && v < .34) || (u > .66 && u < .75 && v > .25 && v < .55);
    const inside = Math.hypot(Math.max(Math.abs(u - .5) - .28, 0), Math.max(Math.abs(v - .5) - .28, 0)) < .18;
    const offset = y * (size * 4 + 1) + 1 + x * 4;
    const color = tray ? [220, 245, 231, arrow ? 255 : 0] : arrow ? [23, 66, 47, 255] : [177, 235, 206, inside ? 255 : 0];
    color.forEach((value, k) => raw[offset + k] = value);
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(size); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
fs.mkdirSync('assets', { recursive: true }); fs.writeFileSync('assets/icon.png', png(512, false)); fs.writeFileSync('assets/tray.png', png(32, true));
