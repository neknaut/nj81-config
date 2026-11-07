/* Key remapping, Fn-layer shortcuts and macros for the NJ81-ED, as the official Keydous driver codes them (read from the
   installed driver v3.2.23, checked on a real NJ81-ED: a key remapped with 0x13 and read back with 0x89).
   Pure functions; the commands that use them are in royuan.js.

   A key's action is 4 bytes:
     [0, modifier, key, key2]   a key (HID usage), with Ctrl / Shift / Alt / Win (224 / 225 / 226 / 227) or 0
     [0, 0, 0, 0]               disabled
     [3, 0, lo, hi]             a media / system key (HID consumer usage, 16 bit)
     [9, mode, macro, 0]        play a macro: mode 0 = repeat N times, 1 = on / off, 2 = repeat while held
     anything else              kept as it is (the keyboard's own functions: Fn, lighting keys, profiles...) */

/* HID keyboard usages with their KeyboardEvent.code and a short label. */
const KEYS = [
  [4, "KeyA", "A"], [5, "KeyB", "B"], [6, "KeyC", "C"], [7, "KeyD", "D"], [8, "KeyE", "E"], [9, "KeyF", "F"], [10, "KeyG", "G"],
  [11, "KeyH", "H"], [12, "KeyI", "I"], [13, "KeyJ", "J"], [14, "KeyK", "K"], [15, "KeyL", "L"], [16, "KeyM", "M"], [17, "KeyN", "N"],
  [18, "KeyO", "O"], [19, "KeyP", "P"], [20, "KeyQ", "Q"], [21, "KeyR", "R"], [22, "KeyS", "S"], [23, "KeyT", "T"], [24, "KeyU", "U"],
  [25, "KeyV", "V"], [26, "KeyW", "W"], [27, "KeyX", "X"], [28, "KeyY", "Y"], [29, "KeyZ", "Z"],
  [30, "Digit1", "1"], [31, "Digit2", "2"], [32, "Digit3", "3"], [33, "Digit4", "4"], [34, "Digit5", "5"], [35, "Digit6", "6"],
  [36, "Digit7", "7"], [37, "Digit8", "8"], [38, "Digit9", "9"], [39, "Digit0", "0"],
  [40, "Enter", "Enter"], [41, "Escape", "Esc"], [42, "Backspace", "Backspace"], [43, "Tab", "Tab"], [44, "Space", "Space"],
  [45, "Minus", "-"], [46, "Equal", "="], [47, "BracketLeft", "["], [48, "BracketRight", "]"], [49, "Backslash", "\\"],
  [51, "Semicolon", ";"], [52, "Quote", "'"], [53, "Backquote", "`"], [54, "Comma", ","], [55, "Period", "."], [56, "Slash", "/"],
  [57, "CapsLock", "Caps"], [58, "F1", "F1"], [59, "F2", "F2"], [60, "F3", "F3"], [61, "F4", "F4"], [62, "F5", "F5"], [63, "F6", "F6"],
  [64, "F7", "F7"], [65, "F8", "F8"], [66, "F9", "F9"], [67, "F10", "F10"], [68, "F11", "F11"], [69, "F12", "F12"],
  [70, "PrintScreen", "PrtSc"], [71, "ScrollLock", "ScrLk"], [72, "Pause", "Pause"], [73, "Insert", "Ins"], [74, "Home", "Home"],
  [75, "PageUp", "PgUp"], [76, "Delete", "Del"], [77, "End", "End"], [78, "PageDown", "PgDn"], [79, "ArrowRight", "Right"],
  [80, "ArrowLeft", "Left"], [81, "ArrowDown", "Down"], [82, "ArrowUp", "Up"], [83, "NumLock", "NumLk"],
  [84, "NumpadDivide", "Num /"], [85, "NumpadMultiply", "Num *"], [86, "NumpadSubtract", "Num -"], [87, "NumpadAdd", "Num +"],
  [88, "NumpadEnter", "Num Enter"], [89, "Numpad1", "Num 1"], [90, "Numpad2", "Num 2"], [91, "Numpad3", "Num 3"], [92, "Numpad4", "Num 4"],
  [93, "Numpad5", "Num 5"], [94, "Numpad6", "Num 6"], [95, "Numpad7", "Num 7"], [96, "Numpad8", "Num 8"], [97, "Numpad9", "Num 9"],
  [98, "Numpad0", "Num 0"], [99, "NumpadDecimal", "Num ."], [100, "IntlBackslash", "Intl \\"], [101, "ContextMenu", "Menu"],
  [224, "ControlLeft", "Ctrl"], [225, "ShiftLeft", "Shift"], [226, "AltLeft", "Alt"], [227, "MetaLeft", "Win"],
  [228, "ControlRight", "Right Ctrl"], [229, "ShiftRight", "Right Shift"], [230, "AltRight", "Right Alt"], [231, "MetaRight", "Right Win"],
];
export const HID_KEYS = KEYS.map(([hid, code, label]) => ({ hid, code, label }));
const BY_HID = new Map(HID_KEYS.map((k) => [k.hid, k]));
const BY_CODE = new Map(HID_KEYS.map((k) => [k.code, k]));
export const hidForCode = (code) => BY_CODE.get(code)?.hid;
export const keyLabel = (hid) => BY_HID.get(hid)?.label ?? `0x${hid.toString(16)}`;

/* The driver's modifiers (its CF table): the second byte of a key action. */
const MODIFIER_NAME = { 224: "Ctrl", 225: "Shift", 226: "Alt", 227: "Win" };

/* Media / system keys and mouse buttons, exactly as the driver's tables (MC, CC, MF) code them. */
export const MEDIA = [
  { id: "fn", bytes: [10, 1, 0, 0] }, { id: "player", bytes: [3, 0, 131, 1] }, { id: "playPause", bytes: [3, 0, 205, 0] },
  { id: "stop", bytes: [3, 0, 183, 0] }, { id: "previous", bytes: [3, 0, 182, 0] }, { id: "next", bytes: [3, 0, 181, 0] },
  { id: "volDown", bytes: [3, 0, 234, 0] }, { id: "volUp", bytes: [3, 0, 233, 0] }, { id: "mute", bytes: [3, 0, 226, 0] },
  { id: "calculator", bytes: [3, 0, 146, 1] }, { id: "mail", bytes: [3, 0, 138, 1] }, { id: "computer", bytes: [3, 0, 148, 1] },
  { id: "search", bytes: [3, 0, 33, 2] }, { id: "homepage", bytes: [3, 0, 35, 2] }, { id: "brightUp", bytes: [3, 0, 111, 0] },
  { id: "brightDown", bytes: [3, 0, 112, 0] }, { id: "refresh", bytes: [3, 0, 39, 2] }, { id: "zoomOut", bytes: [0, 0, 227, 45] },
  { id: "zoomIn", bytes: [0, 0, 227, 46] }, { id: "mic", bytes: [6, 128, 0, 0] },
];
export const MOUSE = [
  { id: "left", bytes: [1, 0, 240, 0] }, { id: "right", bytes: [1, 0, 241, 0] }, { id: "middle", bytes: [1, 0, 242, 0] },
  { id: "forward", bytes: [1, 0, 244, 0] }, { id: "back", bytes: [1, 0, 243, 0] }, { id: "wheelUp", bytes: [1, 0, 247, 0] },
  { id: "wheelDown", bytes: [1, 0, 248, 0] },
];
const byBytes = (list, b) => list.find((e) => e.bytes.join() === b.join());

export const MACRO_MODES = ["times", "toggle", "hold"];   // 0 repeat N times, 1 on / off, 2 repeat while held

export const decodeAction = (b) => {
  const [a, m, k, k2] = b;
  if (a === 0 && m === 0 && k === 0 && k2 === 0) { return { type: "disabled" }; }
  const media = byBytes(MEDIA, b);
  if (media) { return { type: "media", id: media.id }; }
  const mouse = byBytes(MOUSE, b);
  if (mouse) { return { type: "mouse", id: mouse.id }; }
  if (a === 0) { return { type: "key", modifier: MODIFIER_NAME[m] ? m : 0, hid: k, hid2: k2 }; }
  if (a === 9) { return { type: "macro", mode: MACRO_MODES[m] ?? "times", index: k }; }
  return { type: "raw", bytes: [a, m, k, k2] };   // the keyboard's own functions
};

export const encodeAction = (action) => {
  switch (action.type) {
    case "disabled": return [0, 0, 0, 0];
    case "key": return [0, action.modifier ?? 0, action.hid & 0xff, action.hid2 ?? 0];
    case "media": return [...MEDIA.find((e) => e.id === action.id).bytes];
    case "mouse": return [...MOUSE.find((e) => e.id === action.id).bytes];
    case "macro": return [9, Math.max(0, MACRO_MODES.indexOf(action.mode)), action.index, 0];
    case "raw": return [...action.bytes];
    default: throw new Error(`Unknown key action ${action.type}`);
  }
};

/* Names in the page's language, set by the page (setActionLabels). */
const labels = {};
export const setActionLabels = (value) => Object.assign(labels, value);
export const describeAction = (action) => {
  switch (action.type) {
    case "disabled": return "—";
    case "key": return [MODIFIER_NAME[action.modifier], action.hid && keyLabel(action.hid), action.hid2 && keyLabel(action.hid2)].filter(Boolean).join(" + ");   // as the driver: Ctrl + Shift + A
    case "media": return labels.media?.(action.id) ?? action.id;
    case "mouse": return labels.mouse?.(action.id) ?? action.id;
    case "macro": return `${labels.macro ?? "Macro"} ${action.index + 1}`;
    default: return labels.special ?? "Fn";
  }
};
export const sameAction = (a, b) => encodeAction(a).join() === encodeAction(b).join();

/* ---------- macros: the driver's setMacro / buffToMacroEvents ----------
   256 bytes: repeat count (u16 LE), then for each key event [key, flags]: flags bit 7 = down, and when the delay that
   follows is 1..127 ms it sits in the low 7 bits; otherwise a u16 LE delay follows. Ends at four zero bytes.
   events: [{ type: "key", hid, down }, { type: "delay", ms }]. */
export const MACRO_BYTES = 256;
export const MACRO_LIMIT = 248;   // the driver refuses a macro whose encoding reaches 248 bytes

export const encodeMacro = (events, repeat = 1) => {
  const out = new Uint8Array(MACRO_BYTES);
  const view = new DataView(out.buffer);
  let at = 0;
  const u16 = (v) => { view.setUint16(at, v & 0xffff, true); at += 2; };
  u16(repeat);
  let open = false;   // a key byte pair was written without an inline delay: a u16 delay must come before the next key
  for (let i = 0; i < events.length; i += 1) {
    const e = events[i];
    if (e.type !== "delay" && open) { u16(0); open = false; }
    if (e.type === "delay") {
      if (open) { u16(e.ms); } else { u16(0); u16(e.ms); }
      open = false;
      continue;
    }
    out[at] = e.hid; at += 1;
    const next = events[i + 1];
    const inline = next?.type === "delay" && next.ms > 0 && next.ms <= 127 ? next.ms : 0;
    out[at] = (inline & 0x7f) | (e.down ? 0x80 : 0); at += 1;
    open = true;
    if (inline > 0) { open = false; i += 1; }
    if (at > MACRO_LIMIT) { throw new Error("The macro is too long"); }
  }
  if (open) { u16(0); }
  if (at > MACRO_LIMIT) { throw new Error("The macro is too long"); }
  return out;
};

export const decodeMacro = (bytes) => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const repeat = view.getUint16(0, true);
  const events = [];
  let at = 2;
  while (at + 4 <= bytes.length) {
    const rec = bytes.subarray(at, at + 4);
    if (rec[0] === 0 && rec[1] === 0 && rec[2] === 0 && rec[3] === 0) { break; }
    at += 4;
    if (rec[0] >= 4 && rec[0] <= 239) {
      events.push({ type: "key", hid: rec[0], down: Boolean(rec[1] & 0x80) });
      const inline = rec[1] & 0x7f;
      if (inline) { events.push({ type: "delay", ms: inline }); at -= 2; } else { const ms = rec[2] | (rec[3] << 8); if (ms) { events.push({ type: "delay", ms }); } }
    }
  }
  return { repeat, events };
};

/* Recorded browser key events -> macro events: down / up with the time between them. */
export const macroFromRecording = (records) => {
  const events = [];
  records.forEach((r, i) => {
    const hid = hidForCode(r.code);
    if (hid === undefined) { return; }
    events.push({ type: "key", hid, down: r.down });
    const next = records[i + 1];
    if (next) { const ms = Math.max(0, Math.min(65535, Math.round(next.t - r.t))); if (ms) { events.push({ type: "delay", ms }); } }
  });
  return events;
};
export const describeMacro = (events) => events.map((e) => (e.type === "delay" ? `${e.ms} ms` : `${keyLabel(e.hid)} ${e.down ? "↓" : "↑"}`)).join(" · ");

/* The NJ81-ED's factory key matrix (the driver's defaultMatrix for yc500_nj81_ed): the HID key at each of the 128 positions,
   0 where there is no key. Used to put keys back and to place each position on the drawing. */
export const NJ81ED_DEFAULT = [41, 53, 43, 57, 225, 224, 0, 30, 20, 4, 100, 0, 58, 31, 26, 22, 29, 227, 59, 32, 8, 7, 27, 226, 60, 33, 21, 9, 6, 0, 61, 34, 23, 10, 25, 0, 62, 35, 28, 11, 5, 44, 63, 36, 24, 13, 17, 0, 64, 37, 12, 14, 16, 0, 65, 38, 18, 15, 54, 0, 66, 39, 19, 51, 55, 0, 67, 45, 47, 52, 56, 228, 68, 46, 48, 50, 229, 80, 69, 42, 49, 40, 82, 81, 0, 76, 75, 78, 77, 79, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
export const NJ81ED_FN_POSITION = 65;   // the Fn key: its action is the keyboard's own [10, 1, 0, 0]; never remapped here


