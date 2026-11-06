/* Built-in pictures for the 160x80 screen, drawn in code (no image files, nothing to license). Each draws into a 2D context. */

const fill = (ctx, w, h, stops, vertical = false) => {
  const g = vertical ? ctx.createLinearGradient(0, 0, 0, h) : ctx.createLinearGradient(0, 0, w, 0);
  stops.forEach((color, i) => g.addColorStop(i / (stops.length - 1), color));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
};
const text = (ctx, value, x, y, size, color, weight = 800) => {
  ctx.fillStyle = color;
  ctx.font = `${weight} ${size}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(value, x, y);
};
/* A tiny seeded random so the starry pictures look the same every time. */
const seeded = (seed) => () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

const pixels = (ctx, rows, palette, size, ox, oy) => {
  rows.forEach((row, y) => [...row].forEach((ch, x) => {
    if (palette[ch]) { ctx.fillStyle = palette[ch]; ctx.fillRect(ox + x * size, oy + y * size, size, size); }
  }));
};
const HEART = ["0110110", "1111111", "1111111", "0111110", "0011100", "0001000"];
const CAT = ["1000001", "1100011", "1111111", "1212121", "1111111", "1131311", "0111110"];

export const GALLERY = [
  { id: "logo", name: "NJ81", draw: (ctx, w, h) => { ctx.fillStyle = "#000"; ctx.fillRect(0, 0, w, h); text(ctx, "NJ81", w / 2, h / 2, h * 0.42, "#8fd3ff"); } },
  { id: "sunset", name: "Hoàng hôn · Sunset", draw: (ctx, w, h) => {
    fill(ctx, w, h, ["#2b1055", "#d53369", "#ffb347"], true);
    ctx.fillStyle = "#ffe29a"; ctx.beginPath(); ctx.arc(w / 2, h * 0.78, h * 0.28, Math.PI, 0); ctx.fill();
    ctx.fillStyle = "#1b0b33"; ctx.fillRect(0, h * 0.78, w, h * 0.22);
  } },
  { id: "rainbow", name: "Cầu vồng · Rainbow", draw: (ctx, w, h) => fill(ctx, w, h, ["#ff0000", "#ff8000", "#ffff00", "#00ff00", "#00ffff", "#0000ff", "#ff00ff"]) },
  { id: "stars", name: "Bầu trời sao · Night sky", draw: (ctx, w, h) => {
    fill(ctx, w, h, ["#020111", "#191970"], true);
    const r = seeded(81);
    for (let i = 0; i < 70; i += 1) { ctx.fillStyle = `rgba(255,255,255,${0.4 + r() * 0.6})`; ctx.fillRect(Math.floor(r() * w), Math.floor(r() * h), r() > 0.85 ? 2 : 1, r() > 0.85 ? 2 : 1); }
    ctx.fillStyle = "#f6f1d5"; ctx.beginPath(); ctx.arc(w * 0.8, h * 0.3, h * 0.16, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#13114a"; ctx.beginPath(); ctx.arc(w * 0.84, h * 0.26, h * 0.14, 0, Math.PI * 2); ctx.fill();
  } },
  { id: "heart", name: "Trái tim · Heart", draw: (ctx, w, h) => {
    ctx.fillStyle = "#14000a"; ctx.fillRect(0, 0, w, h);
    const size = Math.floor(h / 9);
    pixels(ctx, HEART, { 1: "#ff2d6f" }, size, Math.round((w - 7 * size) / 2), Math.round((h - 6 * size) / 2));
  } },
  { id: "cat", name: "Mèo pixel · Pixel cat", draw: (ctx, w, h) => {
    fill(ctx, w, h, ["#0f2027", "#2c5364"], true);
    const size = Math.floor(h / 10);
    pixels(ctx, CAT, { 1: "#f4b860", 2: "#1b1b1b", 3: "#ff8fa3" }, size, Math.round((w - 7 * size) / 2), Math.round((h - 7 * size) / 2));
  } },
  { id: "grid", name: "Retro", draw: (ctx, w, h) => {
    fill(ctx, w, h, ["#090018", "#3a0057"], true);
    ctx.strokeStyle = "#ff3cac"; ctx.lineWidth = 1;
    const horizon = h * 0.55;
    for (let i = 0; i <= 8; i += 1) { const y = horizon + ((h - horizon) * (i / 8) ** 2); ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
    for (let i = -8; i <= 8; i += 1) { ctx.beginPath(); ctx.moveTo(w / 2 + i * 6, horizon); ctx.lineTo(w / 2 + i * 40, h); ctx.stroke(); }
    ctx.fillStyle = "#ffd319"; ctx.beginPath(); ctx.arc(w / 2, horizon, h * 0.3, Math.PI, 0); ctx.fill();
  } },
  { id: "hello", name: "Xin chào", draw: (ctx, w, h) => { fill(ctx, w, h, ["#11998e", "#38ef7d"]); text(ctx, "Xin chào!", w / 2, h / 2, h * 0.3, "#ffffff"); } },
  { id: "flag", name: "Việt Nam", draw: (ctx, w, h) => {
    ctx.fillStyle = "#da251d"; ctx.fillRect(0, 0, w, h);
    const cx = w / 2; const cy = h / 2; const R = h * 0.3; const r = R * 0.382;
    ctx.fillStyle = "#ffff00"; ctx.beginPath();
    for (let i = 0; i < 10; i += 1) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5; const len = i % 2 ? r : R;
      ctx.lineTo(cx + Math.cos(a) * len, cy + Math.sin(a) * len);
    }
    ctx.closePath(); ctx.fill();
  } },
];

/* Where to find pictures and GIFs for a 160x80 screen, grouped (they open in a new tab; download one, then choose it here).
   Search pages are suggestions: check each picture's licence before using it. */
export const LINKS = [
  { group: "gifSearch", items: [
    { name: "GIPHY · pixel art", url: "https://giphy.com/search/pixel-art" },
    { name: "GIPHY · 8-bit", url: "https://giphy.com/search/8-bit" },
    { name: "GIPHY · pixel cat", url: "https://giphy.com/search/pixel-cat" },
    { name: "GIPHY · lofi pixel", url: "https://giphy.com/search/lofi-pixel" },
    { name: "Tenor · pixel art", url: "https://tenor.com/search/pixel-art-gifs" },
    { name: "Tenor · retro game", url: "https://tenor.com/search/retro-game-gifs" },
    { name: "Pixabay · pixel GIFs", url: "https://pixabay.com/gifs/search/pixel/" },
  ] },
  { group: "pixelArt", items: [
    { name: "Lospec gallery", url: "https://lospec.com/gallery" },
    { name: "Pixilart gallery", url: "https://www.pixilart.com/gallery" },
    { name: "itch.io · free pixel-art assets", url: "https://itch.io/game-assets/free/tag-pixel-art" },
    { name: "OpenGameArt", url: "https://opengameart.org/" },
  ] },
  { group: "gifTools", items: [
    { name: "ezgif · crop a GIF", url: "https://ezgif.com/crop" },
    { name: "ezgif · resize a GIF", url: "https://ezgif.com/resize" },
    { name: "Keydous: tải về / downloads", url: "https://keydous.store/pages/downloads" },
  ] },
];
