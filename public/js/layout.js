/* An approximate 75% layout, only used to draw the preview and to paint per-key colours.
   It is NOT read from the keyboard: the real key order has to come from the protocol (docs/protocol-notes.md). */

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

const ROWS = [
  row(0, [["Esc"], ...Array.from({ length: 12 }, (_, i) => [`F${i + 1}`]), ["Del"], ["Knob"]]),
  row(1, [["`"], ...letters("1234567890-="), ["Bksp", 2], ["Home"]]),
  row(2, [["Tab", 1.5], ...letters("QWERTYUIOP[]"), ["\\", 1.5], ["PgUp"]]),
  row(3, [["Caps", 1.75], ...letters("ASDFGHJKL;'"), ["Enter", 2.25], ["PgDn"]]),
  row(4, [["Shift", 2.25], ...letters("ZXCVBNM,./"), ["Shift", 1.75], ["Up"], ["End"]]),
  row(5, [["Ctrl", 1.25], ["Win", 1.25], ["Alt", 1.25], ["Space", 6.25], ["Alt"], ["Fn"], ["Ctrl"], ["Left"], ["Down"], ["Right"]]),
];

export const KEYS = ROWS.flat().map((key, index) => ({ ...key, id: `k${String(index).padStart(2, "0")}` }));
export const LAYOUT_WIDTH = Math.max(...KEYS.map((key) => key.x + key.w));
export const LAYOUT_HEIGHT = ROWS.length;
