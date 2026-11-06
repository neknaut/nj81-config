/* The vendor protocol Keydous NJ81 keyboards speak ("ROYUAN", gen2 and the older yc500 command set), the one the official driver uses.
   64-byte HID feature reports, report ID 0, on the vendor collection (usage page 0xFFFF). Facts from the public protocol notes of
   sharkfin (docs/PROTOCOL.md) and the NJ81 records of the vendor's device table; this file is an independent implementation.

   Only safe, documented commands are here: identify, read/write lighting, read the profile, the clock, and still pictures for the
   screen. Deliberately NOT implemented: reset (0x01), flash erase (0xAC / 0x2C), boot entry (0x7F / 0x30), firmware of any kind. */

export const ROYUAN = { USAGE_PAGE: 0xffff, USAGES: [1, 2], VENDOR_IDS: [0x3151, 0x39ab], SIZE: 64, PAGE: 56 };
export const OP = { IDENTIFY: 0x8f, SET_LIGHT: 0x07, GET_LIGHT: 0x87, CLOCK: 0x28, PICTURE_ANNOUNCE: 0xa5, PICTURE_DATA: 0x25 };
const FORBIDDEN = new Set([0x01, 0x02, 0x2c, 0xac, 0x7f, 0x30, 0x31]);

/* Keydous NJ81 records (device id -> model). Only gen2 boards are writable; the older yc500 NJ81s are recognised but read-only. */
const SCREEN = { width: 160, height: 80, slots: 5 };
export const MODELS = {
  2454: { name: "NJ81-CP", family: "gen2", profiles: 3, screen: SCREEN },
  3459: { name: "NJ81-CP V3", family: "gen2", profiles: 3, screen: SCREEN },
  4140: { name: "NJ81-MAX", family: "gen2", profiles: 2, screen: SCREEN },
  4207: { name: "NJ81-MAX CP", family: "gen2", profiles: 4, screen: SCREEN },
  // Older NJ81s: the vendor table does not say which command set they use, so the app asks the board (probeFamily).
  // Their firmware names say yc500; the NJ81-ED's ("v504_oledv504") has a display, size not on file.
  732: { name: "NJ81", family: "unknown" }, 819: { name: "NJ81S", family: "unknown" }, 873: { name: "NJ81-ED", family: "unknown", modes: [4, 5, 6, 8, 9, 10, 11, 19, 12, 14, 16, 17, 18, 2, 3] },   // as seen on a real NJ81-ED
  1475: { name: "NJ81-CP (older)", family: "unknown" }, 1493: { name: "NJ81", family: "unknown" },
};
export const modelFor = (deviceId) => MODELS[deviceId] ?? { name: `Unknown keyboard (id ${deviceId})`, family: "unknown" };
export const isWritable = (model) => model.family === "gen2";

/* The two command sets. Opcodes collide between them (yc500 0x06 is gen2 debounce...), so nothing family-specific is sent
   before the family is known. Lighting (0x07/0x87) and the clock (0x28) are the same in both. */
export const FAMILIES = {
  gen2: { profile: 0x84, speedTop: 4 },                                      // speed on the wire 4..0
  yc500: { profile: 0x85, speedTop: 5, options: { get: 0x86, set: 0x06 } },  // speed on the wire 5..1; backlight off is an options bit
};
const LED_OFF_BIT = 0x10;
const OPTION_BITS_KEPT = 0b1110_1001;   // win lock, WASD swap, side light off, high bits; the Mac-mode bits are not written back

/* Family from replies to harmless reads, as sharkfin does it: yc500 answers 0x89 with a keymap page and 0x8A with all FF;
   gen2 echoes 0x89 (its options) and answers 0x8A with the keymap. Sleep timers sit at different places and must not
   contradict. Anything else stays unknown (read only). */
const plainKeys = (page) => {
  let n = 0;
  for (let i = 0; i + 4 <= 64; i += 4) { if (page[i] === 0 && page[i + 1] === 0 && page[i + 2] >= 4 && page[i + 2] <= 0xe7 && page[i + 3] === 0) { n += 1; } }
  return n;
};
const isKeymap = (page) => page.length >= 64 && plainKeys(page) >= 8;
const allFF = (page) => page.length >= 64 && page.subarray(0, 64).every((v) => v === 0xff);
const sleepAt = (reply, at) => {
  for (let i = 0; i < 4; i += 1) {
    const v = reply[at + 2 * i] | (reply[at + 2 * i + 1] << 8);
    if (!(v >= 30 && v <= 36000)) { return false; }
  }
  return true;
};
export const detectFamily = ({ r89, r8a, r91, r92 }) => {
  const yc500 = isKeymap(r89) && allFF(r8a);
  const gen2 = isKeymap(r8a) && !isKeymap(r89) && r89[0] === 0x89;
  if (yc500 && !gen2 && !sleepAt(r91, 8)) { return "yc500"; }
  if (gen2 && !yc500 && !sleepAt(r92, 1)) { return "gen2"; }
  return null;
};

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
export const LEVELS = 4;   // speed is 0..4; brightness is 0..4 on most boards
export const BRIGHTNESS_MAX = 15;   // some boards take more brightness steps: the app learns the top from what the board reports
export const PRESET_COLOURS = ["#ff0000", "#ff8000", "#ffff00", "#00ff00", "#00ffff", "#0000ff", "#ff00ff", "#ffffff"];   // the firmware's own
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
const level = (value, name, max = LEVELS) => {
  if (!Number.isInteger(value) || value < 0 || value > max) { throw new RoyuanError(`${name} must be 0-${max}`); }
  return value;
};
const hexBytes = (hex) => {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) { throw new RoyuanError(`Not a #rrggbb colour: ${hex}`); }
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
};

export const encodeLight = ({ mode, speed, brightness, option = 0, rainbow = false, color }, family = "gen2") => {
  if (!modeInfo(mode)) { throw new RoyuanError(`Unknown lighting mode ${mode}`); }
  if (!Number.isInteger(option) || option < 0 || option > (modeInfo(mode).options?.length ?? 1) - 1) { throw new RoyuanError("Bad direction option"); }
  let rgb = hexBytes(color);
  if (rgb.every((v) => v === 0xff)) { rgb = [0xfa, 0xfa, 0xfa]; }   // the firmware wants pure white sent as FA FA FA
  const top = FAMILIES[family].speedTop;
  return packet(OP.SET_LIGHT, [mode, top - level(speed, "speed"), level(brightness, "brightness", BRIGHTNESS_MAX), (option << 4) | (rainbow ? RAINBOW : FIXED), ...rgb], true);
};

export const decodeLight = (reply, family = "gen2") => {
  if (reply[0] !== OP.GET_LIGHT) { throw new RoyuanError("Not a lighting reply"); }
  const flags = reply[4] & 0x0f;
  const hex = "#" + [...reply.subarray(5, 8)].map((v) => v.toString(16).padStart(2, "0")).join("");
  return {
    mode: reply[1],
    speed: Math.max(0, Math.min(LEVELS, FAMILIES[family].speedTop - reply[2])),
    brightness: Math.min(BRIGHTNESS_MAX, reply[3]),
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

  family = "gen2";

  /* When the last flash write went out (this.now() clock), for the page's timing in the log. */
  get lastWriteAt() { return this.#lastWrite; }

  /* A read whose reply may not echo the opcode (keymap pages): send, settle, take what comes. */
  rawRead(op, payload = []) {
    return this.#serial(async () => {
      await this.#send(packet(op, payload));
      await this.sleep(this.timing.settleMs * 2);
      return this.transport.getFeature();
    });
  }

  /* Asks the board which command set it speaks. Only reads. Returns "gen2", "yc500" or null. */
  async probeFamily() {
    const r89 = await this.rawRead(0x89, [0, 0]);
    const r8a = await this.rawRead(0x8a, [0, 0xff, 0, 0]);
    const r91 = await this.rawRead(0x91);
    const r92 = await this.rawRead(0x92);
    return detectFamily({ r89, r8a, r91, r92 });
  }

  /* A board with a display answers 0xAD (display firmware version); one without echoes the previous reply. */
  async hasDisplay() {
    const before = await this.rawRead(OP.GET_LIGHT);
    const reply = await this.rawRead(0xad);
    return reply[0] === 0xad && !reply.every((v, i) => v === before[i]);
  }

  async profile() { return (await this.get(FAMILIES[this.family].profile))[1]; }

  async readLight() {
    const light = decodeLight(await this.get(OP.GET_LIGHT), this.family);
    const options = FAMILIES[this.family].options;
    if (options) { light.off = Boolean((await this.get(options.get, [0]))[2] & LED_OFF_BIT); }
    return light;
  }

  /* yc500: backlight on/off is a bit in the options register, written read-modify-write. */
  async #setLedOff(off) {
    const options = FAMILIES[this.family].options;
    const now = await this.get(options.get, [0]);
    if (Boolean(now[2] & LED_OFF_BIT) === off) { return; }
    const flags = (now[2] & OPTION_BITS_KEPT & ~LED_OFF_BIT) | (off ? LED_OFF_BIT : 0);
    await this.#serial(() => this.#write(packet(options.set, [0, flags, now[3], now[4]])));
    await this.sleep(150);
  }

  /* `settings.off`: gen2 turns the lights off as the effect at brightness 0, yc500 with its options bit.
     The keyboard can answer the first read after a write with its previous state, so the result is read up to three times
     before a difference is believed. Returns { light, diffs } (diffs empty: the keyboard took everything). */
  async writeLight(settings) {
    const yc500 = Boolean(FAMILIES[this.family].options);
    if (yc500 && settings.off) {   // the backlight-off bit only: the effect and its brightness stay as they are for when it comes back
      await this.#setLedOff(true);
    } else if (yc500 && (await this.get(FAMILIES[this.family].options.get, [0]))[2] & LED_OFF_BIT) {
      // the lights are off: switch them on FIRST, so they light up at once (with the stored effect), then the new effect
      await this.#setLedOff(false);
      await this.#serial(() => this.#write(encodeLight(settings, this.family)));
      await this.sleep(150);
    } else {
      await this.#serial(() => this.#write(encodeLight(yc500 || !settings.off ? settings : { ...settings, brightness: 0 }, this.family)));
      await this.sleep(150);
    }
    let light;
    let diffs = [];
    for (let read = 0; read < 3; read += 1) {
      if (read) { await this.sleep(250); }
      light = await this.readLight();
      diffs = lightDifferences(settings, light);
      if (!diffs.length) { break; }
    }
    return { light, diffs };
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
/* Off: on yc500 boards the backlight-off bit alone (brightness 0 is their dimmest level, and Fn + Backspace on the keyboard
   flips only that bit); on gen2 boards, which have no such bit, brightness 0 or effect 0. */
export const isOff = (light) => (typeof light.off === "boolean" ? light.off : light.brightness === 0 || light.mode === OFF);

/* Which settings the keyboard did not keep: [{ field, sent, got }]. Fields an effect does not have are not compared. */
export const lightDifferences = (sent, got) => {
  const out = [];
  const add = (field, a, b) => { if (a !== b) { out.push({ field, sent: a, got: b }); } };
  add("off", Boolean(sent.off), isOff(got));
  if (sent.off || isOff(got)) { return out; }
  const info = modeInfo(sent.mode);
  add("mode", sent.mode, got.mode);
  add("brightness", sent.brightness, got.brightness);
  if (!info?.noSpeed) { add("speed", sent.speed, got.speed); }
  if (!info?.noColor) {
    add("rainbow", Boolean(sent.rainbow), Boolean(got.rainbow));
    if (!sent.rainbow && !got.rainbow) { add("color", sent.color.toLowerCase(), got.color.toLowerCase()); }
  }
  if (info?.options) { add("option", sent.option ?? 0, got.option); }
  return out;
};
