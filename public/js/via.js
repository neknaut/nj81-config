/* The VIA protocol (the open raw-HID protocol of QMK/VIA firmware): keymap, layers, macros and RGB.
   `transact(bytes32) -> Promise<Uint8Array>` is the only thing it needs, so it is tested against a fake keyboard.
   Deliberately NOT implemented: bootloader jump, EEPROM reset and macro reset (nothing that can wipe or brick the keyboard). */

export const VIA = {
  USAGE_PAGE: 0xff60, USAGE: 0x61, PACKET: 32, CHUNK: 28,
  GET_PROTOCOL_VERSION: 0x01, GET_KEYBOARD_VALUE: 0x02, SET_KEYBOARD_VALUE: 0x03, GET_KEYCODE: 0x04, SET_KEYCODE: 0x05,
  CUSTOM_SET: 0x07, CUSTOM_GET: 0x08, CUSTOM_SAVE: 0x09,
  MACRO_COUNT: 0x0c, MACRO_BUFFER_SIZE: 0x0d, MACRO_GET: 0x0e, MACRO_SET: 0x0f,
  LAYER_COUNT: 0x11, KEYMAP_GET: 0x12, KEYMAP_SET: 0x13, UNHANDLED: 0xff,
};

/* Custom-value channels and the RGB matrix value ids (VIA protocol 9+). */
export const CHANNEL = { BACKLIGHT: 1, RGBLIGHT: 2, RGB_MATRIX: 3, LED_MATRIX: 5 };
export const RGB_VALUE = { BRIGHTNESS: 1, EFFECT: 2, SPEED: 3, COLOR: 4 };

export class ViaError extends Error {}

const pad = (bytes) => {
  if (bytes.length > VIA.PACKET) { throw new ViaError(`Packet too long (${bytes.length})`); }
  const out = new Uint8Array(VIA.PACKET);
  out.set(bytes);
  return out;
};
const byte = (value, name) => {
  if (!Number.isInteger(value) || value < 0 || value > 255) { throw new ViaError(`${name} must be 0-255`); }
  return value;
};

export class Via {
  #queue = Promise.resolve();
  constructor(transact) { this.transact = transact; }

  /* One request, one response, never two at once (the keyboard answers in order on a single endpoint). */
  command(bytes) {
    const run = async () => {
      const request = pad(Uint8Array.from(bytes));
      const response = await this.transact(request);
      if (response[0] === VIA.UNHANDLED) { throw new ViaError(`Keyboard did not understand command 0x${request[0].toString(16)}`); }
      if (response[0] !== request[0]) { throw new ViaError(`Unexpected reply 0x${response[0].toString(16)} to 0x${request[0].toString(16)}`); }
      return response;
    };
    const result = this.#queue.then(run, run);
    this.#queue = result.catch(() => {});
    return result;
  }

  async protocolVersion() { const r = await this.command([VIA.GET_PROTOCOL_VERSION]); return (r[1] << 8) | r[2]; }
  async layerCount() { return (await this.command([VIA.LAYER_COUNT]))[1]; }

  async getKeycode(layer, row, col) {
    const r = await this.command([VIA.GET_KEYCODE, byte(layer, "layer"), byte(row, "row"), byte(col, "col")]);
    return (r[4] << 8) | r[5];
  }
  async setKeycode(layer, row, col, code) {
    if (!Number.isInteger(code) || code < 0 || code > 0xffff) { throw new ViaError("Keycode must be 0-0xFFFF"); }
    await this.command([VIA.SET_KEYCODE, byte(layer, "layer"), byte(row, "row"), byte(col, "col"), code >> 8, code & 0xff]);
  }

  /* The whole keymap as [layer][row][col]. */
  async readKeymap(layers, rows, cols) {
    const total = layers * rows * cols * 2;
    const raw = new Uint8Array(total);
    for (let offset = 0; offset < total; offset += VIA.CHUNK) {
      const size = Math.min(VIA.CHUNK, total - offset);
      const r = await this.command([VIA.KEYMAP_GET, offset >> 8, offset & 0xff, size]);
      raw.set(r.subarray(4, 4 + size), offset);
    }
    return Array.from({ length: layers }, (_, l) => Array.from({ length: rows }, (_, row) => Array.from({ length: cols }, (_, col) => {
      const at = ((l * rows + row) * cols + col) * 2;
      return (raw[at] << 8) | raw[at + 1];
    })));
  }
  async writeKeymap(keymap) {
    const flat = keymap.flat(2);
    const raw = new Uint8Array(flat.length * 2);
    flat.forEach((code, i) => { raw[i * 2] = code >> 8; raw[i * 2 + 1] = code & 0xff; });
    for (let offset = 0; offset < raw.length; offset += VIA.CHUNK) {
      const size = Math.min(VIA.CHUNK, raw.length - offset);
      await this.command([VIA.KEYMAP_SET, offset >> 8, offset & 0xff, size, ...raw.subarray(offset, offset + size)]);
    }
  }

  /* Macros: one zero-terminated byte string per macro, all packed in one buffer. */
  async macroInfo() {
    const count = (await this.command([VIA.MACRO_COUNT]))[1];
    const sizeReply = await this.command([VIA.MACRO_BUFFER_SIZE]);
    return { count, size: (sizeReply[1] << 8) | sizeReply[2] };
  }
  async readMacroBuffer(size) {
    const raw = new Uint8Array(size);
    for (let offset = 0; offset < size; offset += VIA.CHUNK) {
      const n = Math.min(VIA.CHUNK, size - offset);
      const r = await this.command([VIA.MACRO_GET, offset >> 8, offset & 0xff, n]);
      raw.set(r.subarray(4, 4 + n), offset);
    }
    return raw;
  }
  async writeMacroBuffer(buffer) {
    for (let offset = 0; offset < buffer.length; offset += VIA.CHUNK) {
      const n = Math.min(VIA.CHUNK, buffer.length - offset);
      await this.command([VIA.MACRO_SET, offset >> 8, offset & 0xff, n, ...buffer.subarray(offset, offset + n)]);
    }
  }

  /* RGB matrix through the custom-value channel (the firmware may not support it: it then answers "unhandled"). */
  async getRgb(channel = CHANNEL.RGB_MATRIX) {
    const get = async (id) => (await this.command([VIA.CUSTOM_GET, channel, id]));
    const [brightness, effect, speed, color] = await Promise.all([RGB_VALUE.BRIGHTNESS, RGB_VALUE.EFFECT, RGB_VALUE.SPEED, RGB_VALUE.COLOR].map(get));
    return { brightness: brightness[3], effect: effect[3], speed: speed[3], hue: color[3], saturation: color[4] };
  }
  async setRgb(values, channel = CHANNEL.RGB_MATRIX) {
    const set = (id, ...data) => this.command([VIA.CUSTOM_SET, channel, id, ...data.map((v, i) => byte(v, `value ${i}`))]);
    if (values.brightness !== undefined) { await set(RGB_VALUE.BRIGHTNESS, values.brightness); }
    if (values.effect !== undefined) { await set(RGB_VALUE.EFFECT, values.effect); }
    if (values.speed !== undefined) { await set(RGB_VALUE.SPEED, values.speed); }
    if (values.hue !== undefined && values.saturation !== undefined) { await set(RGB_VALUE.COLOR, values.hue, values.saturation); }
  }
  /* Writes the current RGB settings to the keyboard's memory so they survive unplugging. */
  async saveRgb(channel = CHANNEL.RGB_MATRIX) { await this.command([VIA.CUSTOM_SAVE, channel]); }
}

/* ---------- macros: text <-> bytes ---------- */
export const splitMacros = (buffer, count) => {
  const macros = [];
  let current = [];
  for (const value of buffer) {
    if (value === 0) { macros.push(Uint8Array.from(current)); current = []; if (macros.length === count) { break; } } else { current.push(value); }
  }
  while (macros.length < count) { macros.push(new Uint8Array(0)); }
  return macros;
};
export const joinMacros = (macros, size) => {
  const total = macros.reduce((sum, macro) => sum + macro.length + 1, 0);
  if (total > size) { throw new ViaError(`Macros need ${total} bytes but the keyboard has ${size}`); }
  const out = new Uint8Array(size);
  let at = 0;
  for (const macro of macros) { out.set(macro, at); at += macro.length + 1; }
  return out;
};
/* Plain text only (printable ASCII and newline as Enter-less text). Anything with action bytes (< 0x20 or > 0x7e) is "complex":
   shown as read-only and written back untouched. */
export const isPlainText = (macro) => macro.every((v) => v >= 0x20 && v <= 0x7e);
export const macroToText = (macro) => String.fromCharCode(...macro);
export const textToMacro = (text) => {
  const clean = String(text);
  if (![...clean].every((ch) => ch.charCodeAt(0) >= 0x20 && ch.charCodeAt(0) <= 0x7e)) { throw new ViaError("Macros here are plain ASCII text (no accents, no new lines)"); }
  return Uint8Array.from([...clean].map((ch) => ch.charCodeAt(0)));
};

/* ---------- VIA keyboard definition (JSON from the VIA keyboards list) -> key rectangles ---------- */
export const parseDefinition = (input) => {
  const def = typeof input === "string" ? JSON.parse(input) : input;
  const rows = def?.matrix?.rows;
  const cols = def?.matrix?.cols;
  if (!Number.isInteger(rows) || !Number.isInteger(cols) || rows < 1 || cols < 1 || rows > 32 || cols > 32) { throw new ViaError("Definition has no matrix.rows / matrix.cols"); }
  const keys = [];
  const seen = new Set();
  let y = 0;
  for (const line of def?.layouts?.keymap ?? []) {
    if (!Array.isArray(line)) { continue; }
    let x = 0;
    let w = 1;
    let h = 1;
    for (const item of line) {
      if (item && typeof item === "object") {
        x += item.x ?? 0; y += item.y ?? 0;
        if (item.w !== undefined) { w = item.w; }
        if (item.h !== undefined) { h = item.h; }
      } else if (typeof item === "string") {
        const match = /^(\d+),(\d+)/.exec(item);
        if (match) {
          const [row, col] = [Number(match[1]), Number(match[2])];
          const id = `${row},${col}`;
          if (row < rows && col < cols && !seen.has(id)) { seen.add(id); keys.push({ row, col, x, y, w, h }); }
        }
        x += w; w = 1; h = 1;
      }
    }
    y += 1;
  }
  return { name: String(def.name ?? "keyboard"), rows, cols, keys: keys.length ? keys : gridKeys(rows, cols) };
};

export const gridKeys = (rows, cols) =>
  Array.from({ length: rows * cols }, (_, i) => ({ row: Math.floor(i / cols), col: i % cols, x: i % cols, y: Math.floor(i / cols), w: 1, h: 1 }));
