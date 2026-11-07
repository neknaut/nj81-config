/* Draws public/og.png (1200×630), the picture shown when a link to the page is shared (Facebook, Zalo, Discord, X…).
   No dependencies: pixel art in a 5×7 font, written as a PNG with node:zlib. Run: node scripts/og-image.mjs */
import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const W = 1200;
const H = 630;
const px = new Uint8Array(W * H * 3);
const hex = (c) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
const rect = (x, y, w, h, color) => {
  const [r, g, b] = hex(color);
  for (let j = Math.max(0, y); j < Math.min(H, y + h); j += 1) {
    for (let i = Math.max(0, x); i < Math.min(W, x + w); i += 1) { const o = (j * W + i) * 3; px[o] = r; px[o + 1] = g; px[o + 2] = b; }
  }
};

/* 5×7 letters, one string of 5 bits per row */
const FONT = {
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"], B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  C: ["01110", "10001", "10000", "10000", "10000", "10001", "01110"], D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"], F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  G: ["01110", "10001", "10000", "10111", "10001", "10001", "01111"], H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  I: ["01110", "00100", "00100", "00100", "00100", "00100", "01110"], J: ["00111", "00010", "00010", "00010", "00010", "10010", "01100"],
  K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"], L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"], N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"], P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"], S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"], U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  W: ["10001", "10001", "10001", "10101", "10101", "10101", "01010"], Y: ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
  X: ["10001", "10001", "01010", "00100", "01010", "10001", "10001"], V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"], 1: ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  6: ["00110", "01000", "10000", "11110", "10001", "10001", "01110"], 8: ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  0: ["01110", "10001", "10011", "10101", "11001", "10001", "01110"], "·": ["00000", "00000", "00000", "00100", "00000", "00000", "00000"],
  "/": ["00001", "00010", "00010", "00100", "01000", "01000", "10000"], "-": ["00000", "00000", "00000", "11111", "00000", "00000", "00000"],
  " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
};
const textWidth = (text, size) => text.length * 6 * size - size;
const text = (s, x, y, size, color) => {
  [...s].forEach((ch, n) => {
    const rows = FONT[ch];
    if (!rows) { throw new Error(`no glyph for ${ch}`); }
    rows.forEach((row, j) => { [...row].forEach((bit, i) => { if (bit === "1") { rect(x + (n * 6 + i) * size, y + j * size, size, size, color); } }); });
  });
};

// background and a soft frame
rect(0, 0, W, H, "#0f1115");
rect(0, 0, W, 8, "#8fb0ff");

// a keyboard drawn in blocks, its keys in rainbow colours, with the 160×80 screen in the corner
const kx = 90;
const ky = 300;
const unit = 46;
rect(kx - 18, ky - 18, 15 * unit + 36, 5 * unit + 36, "#23262e");
const rainbow = ["#ff4d4d", "#ff9f40", "#ffd84d", "#5ee05e", "#4dd9ff", "#5a7dff", "#c25aff"];
for (let row = 0; row < 5; row += 1) {
  for (let col = 0; col < 15; col += 1) {
    if (row === 0 && col === 14) { continue; }
    const color = rainbow[(col + row) % rainbow.length];
    rect(kx + col * unit, ky + row * unit, unit - 6, unit - 6, color);
    rect(kx + col * unit + 4, ky + row * unit + 4, unit - 14, unit - 14, "#f2f2f2");
  }
}
rect(kx + 14 * unit - 6, ky - 4, unit + 10, unit - 2, "#000000");   // the screen
text("NJ81", kx + 14 * unit - 2, ky + 10, 2, "#8fb0ff");

// title and lines
text("NJ81 CONFIG", 90, 70, 12, "#ffffff");
text("KEYDOUS NJ81 WEB CONFIGURATOR", 92, 175, 4, "#8fb0ff");
text("LIGHTING · KEYS · MACROS · SCREEN GIF", 92, 222, 3, "#aeb6c0");
const tag = "NO DRIVER · CHROME / EDGE";
text(tag, W - 90 - textWidth(tag, 3), H - 60, 3, "#6f7884");

// PNG: RGB, 8 bits, no filter
const rows = Buffer.alloc((W * 3 + 1) * H);
for (let y = 0; y < H; y += 1) { rows[y * (W * 3 + 1)] = 0; Buffer.from(px.buffer, y * W * 3, W * 3).copy(rows, y * (W * 3 + 1) + 1); }
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k += 1) { c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; } return c >>> 0; });
const crc = (buf) => { let c = 0xffffffff; for (const b of buf) { c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); } return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
};
const header = Buffer.alloc(13);
header.writeUInt32BE(W, 0);
header.writeUInt32BE(H, 4);
header[8] = 8;
header[9] = 2;
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", deflateSync(rows, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
writeFileSync(new URL("../public/og.png", import.meta.url), png);
console.log(`public/og.png ${W}×${H}, ${png.length} bytes`);
