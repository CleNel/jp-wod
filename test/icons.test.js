const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { drawIcon, encodePng, encodeIco, ICO_SIZES } = require('../scripts/make-icons');

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

// Reads an ICO file into its directory entries and PNG payloads.
function readIco(buf) {
  assert.equal(buf.readUInt16LE(0), 0, 'reserved must be 0');
  assert.equal(buf.readUInt16LE(2), 1, 'type must be 1 (icon)');
  const count = buf.readUInt16LE(4);
  const entries = [];
  for (let i = 0; i < count; i++) {
    const at = 6 + i * 16;
    const size = buf.readUInt32LE(at + 8);
    const offset = buf.readUInt32LE(at + 12);
    entries.push({
      width: buf[at] || 256, // 0 means 256
      height: buf[at + 1] || 256,
      planes: buf.readUInt16LE(at + 4),
      bits: buf.readUInt16LE(at + 6),
      data: buf.subarray(offset, offset + size),
    });
  }
  return entries;
}

test('ICO_SIZES covers the sizes Windows asks for, up to 256', () => {
  for (const s of [16, 24, 32, 48, 64, 128, 256]) assert.ok(ICO_SIZES.includes(s), String(s));
  assert.equal(Math.max(...ICO_SIZES), 256);
});

test('encodeIco builds one directory entry per image, each holding a PNG', () => {
  const images = [16, 32, 256].map((size) => ({ size, png: encodePng(size, drawIcon(size)) }));
  const entries = readIco(encodeIco(images));
  assert.deepEqual(entries.map((e) => e.width), [16, 32, 256]);
  assert.deepEqual(entries.map((e) => e.height), [16, 32, 256]);
  for (const e of entries) {
    assert.deepEqual([...e.data.subarray(0, 8)], PNG_SIGNATURE);
    assert.equal(e.planes, 1);
    assert.equal(e.bits, 32);
  }
});

test('drawIcon: a transparent corner, an opaque red-or-white centre, at every size', () => {
  for (const size of ICO_SIZES) {
    const px = drawIcon(size);
    assert.equal(px.length, size * size * 4);
    assert.equal(px[3], 0, `corner is transparent at ${size}`);
    const mid = (Math.floor(size / 2) * size + Math.floor(size / 2)) * 4;
    assert.equal(px[mid + 3], 255, `centre is opaque at ${size}`);
  }
});

test('build/icon.ico is committed and holds every size, including 256', () => {
  const entries = readIco(fs.readFileSync(path.join(__dirname, '..', 'build', 'icon.ico')));
  assert.deepEqual(entries.map((e) => e.width).sort((a, b) => a - b), [...ICO_SIZES].sort((a, b) => a - b));
  for (const e of entries) {
    assert.deepEqual([...e.data.subarray(0, 8)], PNG_SIGNATURE);
    assert.equal(e.data.readUInt32BE(16), e.width); // PNG IHDR width matches the directory
  }
});

test('assets/tray.png is still a valid 32x32 PNG', () => {
  const buf = fs.readFileSync(path.join(__dirname, '..', 'assets', 'tray.png'));
  assert.deepEqual([...buf.subarray(0, 8)], PNG_SIGNATURE);
  assert.equal(buf.readUInt32BE(16), 32);
});
