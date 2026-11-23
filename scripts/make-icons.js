// Generates assets/tray.png: a vermilion disc with the character 日, drawn
// pixel by pixel and encoded as a PNG with Node's zlib (no image libraries).
//
//   node scripts/make-icons.js
//
// The output is committed. Stage 8 reuses drawIcon() for the installer icon.

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

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

if (require.main === module) {
  const dir = path.join(__dirname, '..', 'assets');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'tray.png'), encodePng(32, drawIcon(32)));
  console.log('wrote assets/tray.png');
}

module.exports = { drawIcon, encodePng };
