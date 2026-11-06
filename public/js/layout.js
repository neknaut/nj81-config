/* The Keydous NJ81: 75%, 80 keys, the 160x80 screen at the top right (geometry of the NJ81-CP / NJ81-MAX family).
   Only used to draw the preview and to show key presses; the keyboard's own key order is not read from it. */

const row = (y, specs) => {
  let x = 0;
  return specs.map(([label, width = 1, gapBefore = 0]) => {
    x += gapBefore;
    const key = { label, x, y, w: width };
    x += width;
    return key;
  });
};

const letters = (text) => [...text].map((letter) => [letter]);
const fKeys = Array.from({ length: 12 }, (_, i) => [`F${i + 1}`, 1, i === 0 ? 0.75 : i % 4 === 0 ? 0.25 : 0]);
const GAP = 0.25;   // between the function row and the rest

const ROWS = [
  row(0, [["Esc"], ...fKeys]),
  row(1 + GAP, [["`"], ...letters("1234567890-="), ["Bksp", 2], ["Del"]]),
  row(2 + GAP, [["Tab", 1.5], ...letters("QWERTYUIOP[]"), ["\\", 1.5], ["PgUp"]]),
  row(3 + GAP, [["Caps", 1.75], ...letters("ASDFGHJKL;'"), ["Enter", 2.25], ["PgDn"]]),
  row(4 + GAP, [["Shift", 2.25], ...letters("ZXCVBNM,./"), ["Shift", 1.75], ["Up"], ["End"]]),
  row(5 + GAP, [["Ctrl", 1.25], ["Win", 1.25], ["Alt", 1.25], ["Space", 6.25], ["Fn", 1.25], ["Ctrl", 1.25], ["Left", 1, 0.5], ["Down"], ["Right"]]),
];

/* Where the screen sits, in key units (right of F12, as wide as the gap up to the right edge). */
export const SCREEN_TILE = { x: 14.5, y: 0, w: 1.5, h: 1 };

/* KeyboardEvent.code of each key, so presses on the real keyboard show on the drawing. Keys that exist twice are left/right. */
const SPECIAL_CODES = {
  Esc: "Escape", Del: "Delete", "`": "Backquote", "-": "Minus", "=": "Equal", Bksp: "Backspace", Home: "Home", Tab: "Tab",
  "[": "BracketLeft", "]": "BracketRight", "\\": "Backslash", PgUp: "PageUp", Caps: "CapsLock", ";": "Semicolon", "'": "Quote",
  Enter: "Enter", PgDn: "PageDown", ",": "Comma", ".": "Period", "/": "Slash", Up: "ArrowUp", End: "End", Win: "MetaLeft",
  Space: "Space", Left: "ArrowLeft", Down: "ArrowDown", Right: "ArrowRight",
};
const PAIRED = { Shift: ["ShiftLeft", "ShiftRight"], Ctrl: ["ControlLeft", "ControlRight"], Alt: ["AltLeft", "AltRight"] };
const codeFor = (label, seen) => {
  if (PAIRED[label]) { const n = seen[label] = (seen[label] ?? -1) + 1; return PAIRED[label][Math.min(n, 1)]; }
  if (/^F\d+$/.test(label)) { return label; }
  if (/^[A-Z]$/.test(label)) { return `Key${label}`; }
  if (/^[0-9]$/.test(label)) { return `Digit${label}`; }
  return SPECIAL_CODES[label] ?? null;   // Knob and Fn send nothing the browser can see
};

const seen = {};
export const KEYS = ROWS.flat().map((key, index) => ({ ...key, id: `k${String(index).padStart(2, "0")}`, code: codeFor(key.label, seen) }));
export const LAYOUT_WIDTH = Math.max(...KEYS.map((key) => key.x + key.w));
export const LAYOUT_HEIGHT = 6 + GAP;
