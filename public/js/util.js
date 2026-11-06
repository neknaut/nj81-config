/* Small pure helpers: numbers, colours, hex bytes, RGB565. No DOM, so they can be tested with `node --test`. */

export const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

export const bytesToHex = (bytes) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(" ");

/* "01 0a, 0xFF" -> Uint8Array [1, 10, 255]. Throws on anything that is not a one- or two-digit hex byte. */
export const hexToBytes = (text) => {
  const tokens = String(text).split(/[\s,]+/).filter(Boolean);
  const bytes = tokens.map((token) => {
    if (!/^(0x)?[0-9a-f]{1,2}$/i.test(token)) { throw new Error(`Not a hex byte: "${token}"`); }
    return parseInt(token.replace(/^0x/i, ""), 16);
  });
  return Uint8Array.from(bytes);
};

export const isHexColor = (value) => typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);

export const hexToRgb = (hex) => {
  if (!isHexColor(hex)) { throw new Error(`Not a #rrggbb colour: "${hex}"`); }
  return [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16));
};

export const rgbToHex = (red, green, blue) =>
  "#" + [red, green, blue].map((value) => clamp(Math.round(value), 0, 255).toString(16).padStart(2, "0")).join("");

/* HSL (h 0-360, s and l 0-1) -> [r, g, b] 0-255. */
export const hslToRgb = (hue, saturation, lightness) => {
  const h = ((hue % 360) + 360) % 360;
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const x = chroma * (1 - Math.abs(((h / 60) % 2) - 1));
  const base = lightness - chroma / 2;
  const [r, g, b] = [[chroma, x, 0], [x, chroma, 0], [0, chroma, x], [0, x, chroma], [x, 0, chroma], [chroma, 0, x]][Math.floor(h / 60) % 6];
  return [r, g, b].map((value) => Math.round((value + base) * 255));
};

export const scaleRgb = ([red, green, blue], factor) => [red, green, blue].map((value) => Math.round(clamp(value * factor, 0, 255)));

/* One pixel as RGB565 (5 bits red, 6 green, 5 blue). */
export const rgb565 = (red, green, blue) => ((red & 0xf8) << 8) | ((green & 0xfc) << 3) | (blue >> 3);

/* Canvas RGBA pixels -> RGB565 bytes (little-endian by default). */
export const rgbaToRgb565Bytes = (rgba, littleEndian = true) => {
  const out = new Uint8Array((rgba.length / 4) * 2);
  for (let pixel = 0, at = 0; pixel < rgba.length; pixel += 4, at += 2) {
    const value = rgb565(rgba[pixel], rgba[pixel + 1], rgba[pixel + 2]);
    out[at] = littleEndian ? value & 0xff : value >> 8;
    out[at + 1] = littleEndian ? value >> 8 : value & 0xff;
  }
  return out;
};
