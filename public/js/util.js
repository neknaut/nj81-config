/* Small pure helpers: numbers and colours. No DOM, so they can be tested with `node --test`. */

export const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

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
