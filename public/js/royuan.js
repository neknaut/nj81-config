/* The vendor protocol the Keydous NJ81-CP / NJ81-MAX family speaks ("ROYUAN gen2"), the same one the official Keydous driver uses.
   64-byte HID feature reports, report ID 0, on the vendor collection (usage page 0xFFFF). Facts from the public protocol notes of
   sharkfin (docs/PROTOCOL.md) and the NJ81 records of the vendor's device table; this file is an independent implementation.

   Only safe, documented commands are here: identify, read/write lighting, read the profile, the clock, and still pictures for the
   screen. Deliberately NOT implemented: reset (0x01), flash erase (0xAC / 0x2C), boot entry (0x7F / 0x30), firmware of any kind. */

export const ROYUAN = { USAGE_PAGE: 0xffff, USAGES: [1, 2], VENDOR_IDS: [0x3151, 0x39ab], SIZE: 64, PAGE: 56 };
export const OP = { IDENTIFY: 0x8f, GET_PROFILE: 0x84, SET_LIGHT: 0x07, GET_LIGHT: 0x87, CLOCK: 0x28, PICTURE_ANNOUNCE: 0xa5, PICTURE_DATA: 0x25 };
const FORBIDDEN = new Set([0x01, 0x02, 0x2c, 0xac, 0x7f, 0x30, 0x31]);

/* Keydous NJ81 records (device id -> model). Only gen2 boards are writable; the older yc500 NJ81s are recognised but read-only. */
const SCREEN = { width: 160, height: 80, slots: 5 };
export const MODELS = {
  2454: { name: "NJ81-CP", family: "gen2", profiles: 3, screen: SCREEN },
  3459: { name: "NJ81-CP V3", family: "gen2", profiles: 3, screen: SCREEN },
  4140: { name: "NJ81-MAX", family: "gen2", profiles: 2, screen: SCREEN },
  4207: { name: "NJ81-MAX CP", family: "gen2", profiles: 4, screen: SCREEN },
  732: { name: "NJ81 (older firmware)", family: "yc500" }, 819: { name: "NJ81S", family: "yc500" }, 873: { name: "NJ81-ED", family: "yc500" },
  1475: { name: "NJ81-CP (older firmware)", family: "yc500" }, 1493: { name: "NJ81 (older firmware)", family: "yc500" },
};
export const modelFor = (deviceId) => MODELS[deviceId] ?? { name: `Unknown keyboard (id ${deviceId})`, family: "unknown" };
export const isWritable = (model) => model.family === "gen2";

/* The NJ81's lighting table ("v" in the vendor's driver), in the manufacturer's order, with its direction options.
   Static has no speed; Spectrum has no colour. `OFF` is the app's "lights off": the current effect at brightness 0. */
export const OFF = 0;
export const MODES = [
  { mode: 4, name: "Wave", options: ["Right", "Left", "Down", "Up"] }, { mode: 5, name: "Ripple" }, { mode: 6, name: "Star dots" },
  { mode: 7, name: "Flow", options: ["Zigzag", "Spiral"] }, { mode: 8, name: "Key shadow" }, { mode: 9, name: "Layers" },
  { mode: 10, name: "Sine wave" }, { mode: 11, name: "Spring", options: ["Outward", "Inward"] }, { mode: 19, name: "Silent snow" },
  { mode: 12, name: "Neon", options: ["Right", "Left"] }, { mode: 14, name: "Radiant" }, { mode: 15, name: "Loop", options: ["CCW", "CW"] },
  { mode: 16, name: "Colour grid" }, { mode: 17, name: "Snowfall" }, { mode: 18, name: "Meteor" },
  { mode: 1, name: "Static", noSpeed: true }, { mode: 2, name: "Breathing" }, { mode: 3, name: "Spectrum cycle", noColor: true },
];
export const modeInfo = (mode) => MODES.find((entry) => entry.mode === mode);
export const LEVELS = 4;   // brightness and speed are 0..4 on the keyboard
const PRESETS = ["#ff0000", "#ff8000", "#ffff00", "#00ff00", "#00ffff", "#0000ff", "#ff00ff"];
const FIXED = 7;
const RAINBOW = 8;

export class RoyuanError extends Error {}

/* [op, payload..., checksum]: checksum = 0xFF - (sum of the bytes before it), at byte 7 (or 8 for lighting writes). */
export const packet = (op, payload = [], bit8 = false) => {
  if (FORBIDDEN.has(op)) { throw new RoyuanError(`Opcode 0x${op.toString(16)} is not allowed in this app`); }
  const data = new Uint8Array(ROYUAN.SIZE);
  data[0] = op;
  data.set(payload, 1);
  const at = bit8 ? 8 : 7;
  let sum = 0;
  for (let i = 0; i < at; i += 1) { sum += data[i]; }
  data[at] = 0xff - (sum & 0xff);
  return data;
};

/* ---------- lighting ---------- */
const level = (value, name) => {
  if (!Number.isInteger(value) || value < 0 || value > LEVELS) { throw new RoyuanError(`${name} must be 0-${LEVELS}`); }
  return value;
};
const hexBytes = (hex) => {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) { throw new RoyuanError(`Not a #rrggbb colour: ${hex}`); }
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
};

export const encodeLight = ({ mode, speed, brightness, option = 0, rainbow = false, color }) => {
  if (!modeInfo(mode)) { throw new RoyuanError(`Unknown lighting mode ${mode}`); }
  if (!Number.isInteger(option) || option < 0 || option > (modeInfo(mode).options?.length ?? 1) - 1) { throw new RoyuanError("Bad direction option"); }
  let rgb = hexBytes(color);
  if (rgb.every((v) => v === 0xff)) { rgb = [0xfa, 0xfa, 0xfa]; }   // the firmware wants pure white sent as FA FA FA
  return packet(OP.SET_LIGHT, [mode, LEVELS - level(speed, "speed"), level(brightness, "brightness"), (option << 4) | (rainbow ? RAINBOW : FIXED), ...rgb], true);
};

export const decodeLight = (reply) => {
  if (reply[0] !== OP.GET_LIGHT) { throw new RoyuanError("Not a lighting reply"); }
  const flags = reply[4] & 0x0f;
  const hex = "#" + [...reply.subarray(5, 8)].map((v) => v.toString(16).padStart(2, "0")).join("");
  return {
    mode: reply[1],
    speed: LEVELS - Math.min(LEVELS, reply[2]),
    brightness: Math.min(LEVELS, reply[3]),
    option: reply[4] >> 4,
    rainbow: flags === RAINBOW,
    color: flags < PRESETS.length ? PRESETS[flags] : hex === "#fafafa" ? "#ffffff" : hex,
  };
};

/* ---------- screen: 160x80 RGB565, big-endian, column by column ---------- */
export const pictureBytes = (rgba, width, height) => {
  if (rgba.length !== width * height * 4) { throw new RoyuanError("Picture size does not match"); }
  const out = new Uint8Array(width * height * 2);
  let at = 0;
  for (let x = 0; x < width; x += 1) {
    for (let y = 0; y < height; y += 1) {
      const i = (y * width + x) * 4;
      const word = ((rgba[i] >> 3) << 11) | ((rgba[i + 1] >> 2) << 5) | (rgba[i + 2] >> 3);
      out[at] = word >> 8;
      out[at + 1] = word & 0xff;
      at += 2;
    }
  }
  return out;
};

export const pictureAnnounce = (slot, length, width, height) =>
  packet(OP.PICTURE_ANNOUNCE, [slot, 1, 0, length & 0xff, length >> 8, 0, 0, 0, 0, width, height]);

export const picturePages = (slot, bytes) => {
  const pages = [];
  for (let page = 0, start = 0; start < bytes.length; page += 1, start += ROYUAN.PAGE) {
    const chunk = bytes.subarray(start, start + ROYUAN.PAGE);
    const data = packet(OP.PICTURE_DATA, [slot, 1, 0, page & 0xff, page >> 8, chunk.length]);
    data.set(chunk, 8);
    pages.push(data);
  }
  return pages;
};

export const clockPacket = (date) => {
  const data = packet(OP.CLOCK);
  const year = date.getFullYear();
  data.set([year >> 8, year & 0xff, date.getMonth() + 1, date.getDate(), date.getHours(), date.getMinutes(), date.getSeconds()], 8);
  return data;
};

/* ---------- client over a transport { setFeature(bytes64), getFeature() -> Uint8Array(64) } ---------- */
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* Lighting and settings are stored in the keyboard's flash: writes closer than about a second are dropped or wedge it
   (sharkfin measured a 1 s floor). Reads need a short settle before the reply is there. */
export const TIMING = { writeGapMs: 1000, settleMs: 20, pageGapMs: 5, readyGapMs: 100 };

export class Royuan {
  #queue = Promise.resolve();
  #lastWrite = -Infinity;
  constructor(transport, { sleep = wait, now = () => Date.now(), timing = TIMING } = {}) {
    this.transport = transport; this.sleep = sleep; this.now = now; this.timing = timing;
  }

  #serial(task) {
    const result = this.#queue.then(task, task);
    this.#queue = result.catch(() => {});
    return result;
  }

  async #send(data) { await this.transport.setFeature(data); }

  /* A write that changes flash: waits for the gap since the previous one. */
  async #write(data) {
    const waitMs = this.#lastWrite + this.timing.writeGapMs - this.now();
    if (waitMs > 0) { await this.sleep(waitMs); }
    await this.#send(typeof data === "function" ? data() : data);
    this.#lastWrite = this.now();
  }

  /* A GET: send the bare opcode, read until the reply echoes it. */
  get(op, payload = []) {
    return this.#serial(async () => {
      await this.#send(packet(op, payload));
      for (let attempt = 1; attempt <= 5; attempt += 1) {
        await this.sleep(this.timing.settleMs * attempt);
        const reply = await this.transport.getFeature();
        if (reply[0] === op && !reply.every((v) => v === 0xff)) { return reply; }
      }
      throw new RoyuanError(`The keyboard did not answer 0x${op.toString(16)} (use the USB cable and close the official driver)`);
    });
  }

  async identify() {
    const reply = await this.get(OP.IDENTIFY);
    const deviceId = reply[1] | (reply[2] << 8) | (reply[3] << 16) | (reply[4] * 0x1000000);
    if (deviceId === 0) { throw new RoyuanError("Identify reply is not valid"); }
    return { deviceId, firmware: ((reply[8] << 8) | reply[7]).toString(16).padStart(4, "0"), model: modelFor(deviceId) };
  }

  async profile() { return (await this.get(OP.GET_PROFILE))[1]; }
  async readLight() { return decodeLight(await this.get(OP.GET_LIGHT)); }

  /* Writes the lighting and reads it back; `kept` says whether the keyboard reports exactly what was sent. */
  async writeLight(settings) {
    const data = encodeLight(settings);
    await this.#serial(() => this.#write(data));
    await this.sleep(150);
    const reply = await this.get(OP.GET_LIGHT);
    return { kept: data.subarray(1, 8).every((v, i) => v === reply[1 + i]), light: decodeLight(reply) };
  }

  /* `date` can be a function: it is then read at the moment the packet goes out, after any wait. */
  setClock(date = () => new Date()) {
    return this.#serial(() => this.#write(() => clockPacket(typeof date === "function" ? date() : date)));
  }

  /* Uploads a still picture into slot 0..slots-1. `progress(done, total)` is called after each page. */
  async uploadPicture(slot, bytes, { width, height, slots }, progress = () => {}) {
    if (!Number.isInteger(slot) || slot < 0 || slot >= slots) { throw new RoyuanError(`Picture slot must be 1-${slots}`); }
    if (bytes.length !== width * height * 2) { throw new RoyuanError("Picture size does not match the screen"); }
    let ready = false;
    for (let attempt = 0; attempt < 10 && !ready; attempt += 1) {
      const reply = await this.get(OP.PICTURE_ANNOUNCE, [...pictureAnnounce(slot, bytes.length, width, height).subarray(1, 12)]);
      ready = reply[1] === 1;
      if (!ready) { await this.sleep(this.timing.readyGapMs); }
    }
    if (!ready) { throw new RoyuanError("The screen did not accept the picture"); }
    const pages = picturePages(slot, bytes);
    for (let i = 0; i < pages.length; i += 1) {
      await this.#serial(async () => { await this.#send(pages[i]); await this.sleep(this.timing.pageGapMs); });
      progress(i + 1, pages.length);
    }
    this.#lastWrite = this.now();
  }
}

/* "Off" is shown when the keyboard reports brightness 0 (or effect 0). */
export const isOff = (light) => light.brightness === 0 || light.mode === OFF;
