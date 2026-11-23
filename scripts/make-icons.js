// Generates the app icons: a vermilion disc with the character 日, drawn pixel
// by pixel and encoded with Node's zlib (no image libraries).
//
//   node scripts/make-icons.js
//
// Writes assets/tray.png (32x32, the tray icon) and build/icon.ico (16 to 256,
// the exe and installer icon). The outputs are committed.

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

// Sizes Windows picks from: small UI, taskbar, Explorer views, and the 256 that
// electron-builder requires.
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

const RED = [184, 58, 38];
const WHITE = [255, 255, 255];

// Returns RGBA pixels (size * size * 4). The 日 is drawn on a 32-grid and scaled.
function drawIcon(size) {
  const px = Buffer.alloc(size * size * 4);
  const scale = size / 32;
  const c = (size - 1) / 2;
  const radius = size / 2 - 1;

  // 日 on the 32x32 grid: an outline box with a bar through the middle.
  const inGlyph = (gx, gy) => {
    const inBox = gx >= 10 && gx < 22 && gy >= 7 && gy < 25;
    const inner = gx >= 12 && gx < 20 && gy >= 9 && gy < 23;
    const bar = gx >= 10 && gx < 22 && gy >= 15 && gy < 17;
    return (inBox && !inner) || bar;
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dist = Math.hypot(x - c, y - c);
      const coverage = Math.max(0, Math.min(1, radius - dist + 0.5)); // soft edge
      const white = inGlyph(Math.floor(x / scale), Math.floor(y / scale));
      const color = white ? WHITE : RED;
      const i = (y * size + x) * 4;
      px[i] = color[0];
      px[i + 1] = color[1];
      px[i + 2] = color[2];
      px[i + 3] = Math.round(coverage * 255);
    }
  }
  return px;
}

function encodePng(size, rgba) {
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(zlib.crc32(body), body.length + 4);
    return out;
  };

  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA

  const rows = Buffer.alloc((size * 4 + 1) * size); // each row starts with filter byte 0
  for (let y = 0; y < size; y++) {
    rgba.copy(rows, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ICO container with PNG-compressed images (supported since Windows Vista).
// images: [{ size, png }]
function encodeIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);

  const entries = Buffer.alloc(16 * images.length);
  let offset = 6 + entries.length;
  images.forEach(({ size, png }, i) => {
    const at = i * 16;
    entries[at] = size >= 256 ? 0 : size; // 0 means 256
    entries[at + 1] = size >= 256 ? 0 : size;
    entries.writeUInt16LE(1, at + 4); // colour planes
    entries.writeUInt16LE(32, at + 6); // bits per pixel
    entries.writeUInt32LE(png.length, at + 8);
    entries.writeUInt32LE(offset, at + 12);
    offset += png.length;
  });

  return Buffer.concat([header, entries, ...images.map((i) => i.png)]);
}

if (require.main === module) {
  const root = path.join(__dirname, '..');
  fs.mkdirSync(path.join(root, 'assets'), { recursive: true });
  fs.mkdirSync(path.join(root, 'build'), { recursive: true });

  fs.writeFileSync(path.join(root, 'assets', 'tray.png'), encodePng(32, drawIcon(32)));
  console.log('wrote assets/tray.png');

  const images = ICO_SIZES.map((size) => ({ size, png: encodePng(size, drawIcon(size)) }));
  fs.writeFileSync(path.join(root, 'build', 'icon.ico'), encodeIco(images));
  console.log(`wrote build/icon.ico (${ICO_SIZES.join(', ')})`);
}

module.exports = { drawIcon, encodePng, encodeIco, ICO_SIZES };
