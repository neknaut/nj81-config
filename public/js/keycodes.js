/* QMK / VIA 16-bit keycodes (QMK >= 0.19 numbering for the layer keys). Pure data and helpers, tested with `node --test`.
   Anything not listed is shown and edited as raw hex, so no keycode is ever unreachable. */

const range = (from, labels) => labels.map((label, index) => [from + index, label]);
const LETTERS = range(0x04, [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"]);
const NUMBERS = range(0x1e, [..."1234567890"]);
const PUNCT = [[0x2d, "-"], [0x2e, "="], [0x2f, "["], [0x30, "]"], [0x31, "\\"], [0x33, ";"], [0x34, "'"], [0x35, "`"], [0x36, ","], [0x37, "."], [0x38, "/"]];
const EDIT = [[0x28, "Enter"], [0x29, "Esc"], [0x2a, "Bksp"], [0x2b, "Tab"], [0x2c, "Space"], [0x39, "Caps"], [0x46, "PrtSc"], [0x47, "ScrLk"], [0x48, "Pause"],
  [0x49, "Ins"], [0x4a, "Home"], [0x4b, "PgUp"], [0x4c, "Del"], [0x4d, "End"], [0x4e, "PgDn"], [0x4f, "Right"], [0x50, "Left"], [0x51, "Down"], [0x52, "Up"],
  [0x65, "Menu"]];
const FUNCTION = [...range(0x3a, Array.from({ length: 12 }, (_, i) => `F${i + 1}`)), ...range(0x68, Array.from({ length: 12 }, (_, i) => `F${i + 13}`))];
const MODIFIERS = [[0xe0, "LCtrl"], [0xe1, "LShift"], [0xe2, "LAlt"], [0xe3, "LWin"], [0xe4, "RCtrl"], [0xe5, "RShift"], [0xe6, "RAlt"], [0xe7, "RWin"]];
const MEDIA = [[0xa8, "Mute"], [0xa9, "Vol+"], [0xaa, "Vol-"], [0xab, "Next"], [0xac, "Prev"], [0xad, "Stop"], [0xae, "Play/Pause"], [0xbd, "Bright+"], [0xbe, "Bright-"],
  [0xa5, "Sys Power"], [0xa6, "Sys Sleep"], [0xa7, "Sys Wake"]];
const KEYPAD = [[0x53, "NumLk"], [0x54, "KP /"], [0x55, "KP *"], [0x56, "KP -"], [0x57, "KP +"], [0x58, "KP Enter"], ...range(0x59, [..."1234567890"].map((d) => `KP ${d}`)), [0x63, "KP ."]];
const SPECIAL = [[0x0000, "None"], [0x0001, "Trans (▽)"]];

export const GROUPS = [
  ["special", SPECIAL], ["letters", LETTERS], ["numbers", NUMBERS], ["punct", PUNCT], ["edit", EDIT],
  ["function", FUNCTION], ["modifiers", MODIFIERS], ["media", MEDIA], ["keypad", KEYPAD],
].map(([id, items]) => ({ id, items: items.map(([code, label]) => ({ code, label })) }));

const BY_CODE = new Map(GROUPS.flatMap((group) => group.items).map((item) => [item.code, item.label]));

/* Layer keys. */
export const LAYER_KINDS = { TO: 0x5200, MO: 0x5220, DF: 0x5240, TG: 0x5260, OSL: 0x5280 };
export const LAYER_COUNT_MAX = 32;
export const layerKeycode = (kind, layer) => {
  if (!(kind in LAYER_KINDS)) { throw new Error(`Unknown layer key ${kind}`); }
  if (!Number.isInteger(layer) || layer < 0 || layer > 31) { throw new Error("Layer must be 0-31"); }
  return LAYER_KINDS[kind] + layer;
};
/* LT(layer, keycode): layer 0-15, keycode a basic keycode 0-255. */
export const layerTapKeycode = (layer, basic) => {
  if (!Number.isInteger(layer) || layer < 0 || layer > 15) { throw new Error("LT layer must be 0-15"); }
  if (!Number.isInteger(basic) || basic < 0 || basic > 0xff) { throw new Error("LT keycode must be a basic keycode"); }
  return 0x4000 | (layer << 8) | basic;
};

export const hexKeycode = (code) => "0x" + code.toString(16).toUpperCase().padStart(4, "0");

/* "0x1F", "1f", "0x0004" -> 4; throws when it is not a 16-bit hex value. */
export const parseKeycode = (text) => {
  const clean = String(text).trim().replace(/^0x/i, "");
  if (!/^[0-9a-f]{1,4}$/i.test(clean)) { throw new Error(`Not a 16-bit hex keycode: "${text}"`); }
  return parseInt(clean, 16);
};

export const MOD_BITS = [[0x0100, "C"], [0x0200, "S"], [0x0400, "A"], [0x0800, "G"]];

export const keycodeLabel = (code) => {
  if (BY_CODE.has(code)) { return BY_CODE.get(code); }
  for (const [kind, base] of Object.entries(LAYER_KINDS)) { if (code >= base && code < base + 0x20) { return `${kind}(${code - base})`; } }
  if (code >= 0x4000 && code < 0x5000) {
    const basic = code & 0xff;
    return `LT(${(code >> 8) & 0xf},${BY_CODE.get(basic) ?? hexKeycode(basic)})`;
  }
  if (code >= 0x0100 && code < 0x2000) {   // modifiers + a basic key
    const basic = code & 0xff;
    const mods = MOD_BITS.filter(([bit]) => code & bit).map(([, letter]) => letter).join("");
    const right = code & 0x1000 ? "R" : "";
    return `${right}${mods}+${BY_CODE.get(basic) ?? hexKeycode(basic)}`;
  }
  return hexKeycode(code);
};

/* Keymap file (backup): layers x rows x cols of keycodes. */
export const KEYMAP_FORMAT = 1;
