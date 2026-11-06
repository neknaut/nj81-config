/* The vendor protocol Keydous NJ81 keyboards speak ("ROYUAN", gen2 and the older yc500 command set), the one the official driver uses.
   64-byte HID feature reports, report ID 0, on the vendor collection (usage page 0xFFFF). Facts from the public protocol notes of
   sharkfin (docs/PROTOCOL.md) and the NJ81 records of the vendor's device table; this file is an independent implementation.

   Only safe, documented commands are here: identify, read/write lighting, read the profile, the clock, and still pictures for the
   screen. Deliberately NOT implemented: reset (0x01), the yc500 display erase (0x2C), boot entry (0x7F / 0x30), firmware of
   any kind; packet() refuses them, and 0xAC too. One exception, copied from the official driver: its "Clear" on an NJ81-ED
   (USB capture, 2026-11-06) sends a bare 0xAC feature report and reads one reply, which removes every picture and GIF so
   only the status screen is left. Only Royuan.clearScreen() sends it, only on yc500 boards. 0x2C was tried once on an
   NJ81-ED and is not understood: never send it. */

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
  732: { name: "NJ81", family: "unknown" }, 819: { name: "NJ81S", family: "unknown" }, 873: { name: "NJ81-ED", family: "unknown", modes: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 15, 16, 17, 18, 19] },   // the official driver's list
  1475: { name: "NJ81-CP (older)", family: "unknown" }, 1493: { name: "NJ81", family: "unknown" },
};
export const modelFor = (deviceId) => MODELS[deviceId] ?? { name: `Unknown keyboard (id ${deviceId})`, family: "unknown" };
export const isWritable = (model) => model.family === "gen2";

/* The two command sets. Opcodes collide between them (yc500 0x06 is gen2 debounce...), so nothing family-specific is sent
   before the family is known. Lighting (0x07/0x87) and the clock (0x28) are the same in both. */
export const FAMILIES = {
  gen2: { profile: 0x84, speedTop: 4 },                                      // speed on the wire 4..0
  // backlight off is an options bit. writeGapMs: the NJ81-ED takes lighting writes closer than the
  // 1 s gen2 floor: 16 changes 250 ms apart on a real NJ81-ED (2026-11-07) all went through, none dropped; a write it drops
  // still shows up in the read-back and the page sends it again.
  // quietMs: how long the keyboard is left alone after a lighting write before it is read back (see #quietAfterWrite).
  // speed on the wire 4..0 too: the official driver writes MAXSPEED (4) - speed for its yc500 boards (NJ81-ED)
  yc500: { profile: 0x85, speedTop: 4, options: { get: 0x86, set: 0x06 }, writeGapMs: 250, quietMs: 700 },
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
/* The lighting table of the official Keydous driver for the NJ81-ED (its "rongyuan_k_rgb" keyboards, read from the
   installed driver v3.2.23: the NJ81-ED's light list, the mode numbers its encoder writes, its English and Vietnamese
   names). Static has no speed; Spectrum cycle has no colour. `OFF` (0) is the driver's "LightOff". */
export const MODES = [
  { mode: 1, name: "Always On", vi: "Luôn sáng", noSpeed: true },
  { mode: 2, name: "Dynamic breathing", vi: "Hơi thở năng động" },
  { mode: 3, name: "Spectrum cycle", vi: "Chu kỳ quang phổ", noColor: true },
  { mode: 4, name: "Drift", vi: "Trôi", options: ["Right", "Left", "Down", "Up"], viOptions: ["Phải", "Trái", "Xuống", "Lên"] },
  { mode: 5, name: "Waves ripple", vi: "Sóng gợn" },
  { mode: 6, name: "Stars twinkle", vi: "Những ngôi sao lấp lánh" },
  { mode: 7, name: "Steady stream", vi: "Dòng chảy đều đặn", options: ["Z", "Return"], viOptions: ["Chữ Z", "Quay lại"] },
  { mode: 8, name: "Shadowing", vi: "Bóng tối" },
  { mode: 9, name: "Peaks rising one after another", vi: "Các đỉnh tăng lên nối tiếp nhau" },
  { mode: 10, name: "Sine Wave", vi: "Sóng hình sin" },
  { mode: 11, name: "Caispring Surging", vi: "Caispring đang dâng trào", options: ["Out", "In"], viOptions: ["Ra ngoài", "Vào trong"] },
  { mode: 12, name: "Flowers Blooming", vi: "Hoa nở", options: ["Right", "Left"], viOptions: ["Phải", "Trái"] },
  { mode: 14, name: "Laser", vi: "Tia laze" },
  { mode: 15, name: "Peak Turn", vi: "Đỉnh điểm", options: ["Anti-clockwise", "Clockwise"], viOptions: ["Ngược chiều kim đồng hồ", "Theo chiều kim đồng hồ"] },
  { mode: 16, name: "Colorful vertical and horizontal", vi: "Đầy màu sắc dọc và ngang" },
  { mode: 17, name: "Snow", vi: "Tuyết" },
  { mode: 18, name: "Meteor", vi: "Sao băng" },
  { mode: 19, name: "Through the snow non-trace", vi: "Xuyên qua tuyết không dấu vết" },
];
export const modeInfo = (mode) => MODES.find((entry) => entry.mode === mode);
export const LEVELS = 4;   // speed is 0..4; brightness is 0..4 on most boards
export const BRIGHTNESS_MAX = 15;   // some boards take more brightness steps: the app learns the top from what the board reports
export const PRESET_COLOURS = ["#ffffff", "#ff0000", "#ff8000", "#ffff00", "#00ff00", "#55ffff", "#0000ff", "#ff00ff"];   // the driver's own
/* The colour a keyboard reports when it was set with its own keys (byte 4, low nibble below FIXED): the driver's
   COMMONCOLOR table. The NJ81-ED's starts with white (read from the official driver); gen2 boards keep the old table. */
const PRESETS = { gen2: ["#ff0000", "#ff8000", "#ffff00", "#00ff00", "#00ffff", "#0000ff", "#ff00ff"],
  yc500: ["#ffffff", "#ff0000", "#ff8000", "#ffff00", "#00ff00", "#55ffff", "#0000ff"] };
const FIXED = 7;
const RAINBOW = 8;

export class RoyuanError extends Error {}

/* [op, payload..., checksum]: checksum = 0xFF - (sum of the bytes before it), at byte 7 (or 8 for lighting writes). */
const build = (op, payload = [], bit8 = false) => {
  const data = new Uint8Array(ROYUAN.SIZE);
  data[0] = op;
  data.set(payload, 1);
  const at = bit8 ? 8 : 7;
  let sum = 0;
  for (let i = 0; i < at; i += 1) { sum += data[i]; }
  data[at] = 0xff - (sum & 0xff);
  return data;
};
/* The official driver's "Clear" (captured on an NJ81-ED): AC 00 00 00 00 00 00 53, nothing else. */
export const clearScreenPacket = () => build(0xac);
export const CLEAR_MS = 42000;
export const CHECK_MS = 2500;   // how long a lighting change is checked after it went out before it is reported unconfirmed   // how long an NJ81-ED took to clear (40.8 s and 42.8 s in the capture), for the progress bar
export const packet = (op, payload = [], bit8 = false) => {
  if (FORBIDDEN.has(op)) { throw new RoyuanError(`Opcode 0x${op.toString(16)} is not allowed in this app`); }
  return build(op, payload, bit8);
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

/* `mode` OFF (0) is effect 0: the lights off (used on yc500 boards, where it takes effect at once). */
export const encodeLight = ({ mode, speed, brightness, option = 0, rainbow = false, color }, family = "gen2") => {
  if (mode !== OFF && !modeInfo(mode)) { throw new RoyuanError(`Unknown lighting mode ${mode}`); }
  if (mode === OFF) { option = 0; }
  if (!Number.isInteger(option) || option < 0 || option > (modeInfo(mode)?.options?.length ?? 1) - 1) { throw new RoyuanError("Bad direction option"); }
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
    color: flags < PRESETS[family].length ? PRESETS[family][flags] : hex === "#fafafa" ? "#ffffff" : hex,
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

/* Announce: [A5, frame (the slot for a still), frame count, delay in 10 ms steps, len lo, len hi, ..., width, height]
   (sharkfin's notes; a still is frame = slot, count 1, delay 0, as the vendor sends it). The announce erases nothing. */
export const ANIMATION = { MAX_FRAMES: 30, DELAY_STEP_MS: 10 };
export const pictureAnnounce = (slot, length, width, height, { count = 1, delay = 0 } = {}) =>
  packet(OP.PICTURE_ANNOUNCE, [slot, count, delay, length & 0xff, length >> 8, 0, 0, 0, 0, width, height]);
export const frameDelay = (ms) => Math.max(1, Math.min(255, Math.round(ms / ANIMATION.DELAY_STEP_MS)));

export const picturePages = (slot, bytes, count = 1) => {
  const pages = [];
  for (let page = 0, start = 0; start < bytes.length; page += 1, start += ROYUAN.PAGE) {
    const chunk = bytes.subarray(start, start + ROYUAN.PAGE);
    const data = packet(OP.PICTURE_DATA, [slot, count, 0, page & 0xff, page >> 8, chunk.length]);
    data.set(chunk, 8);
    pages.push(data);
  }
  return pages;
};

/* ---------- NJ81-ED (yc500) screen, as the official Keydous driver sends it (read from the installed driver v3.2.23:
   drawFrameToKeyboardGIF, getTFTLCDDataRGBImg, setTFTLCDDataRGBImg) ----------
   One announce for the whole picture or GIF, then the pages of every frame:
   announce [A5, frame 0, frame count, delay ms, len b0, len b1, 0, ck, left, top, right, bottom, left>>8, top>>8, right>>8,
             bottom>>8, len b2, len b3, slot]   (slot 0-4 at byte 18; the keyboard answers byte 1 = 1 when ready)
   page     [25, frame, frame count, delay ms, page lo, page hi, length, ck, 56 bytes]
   The pixels are cut to the box holding every non-black pixel of all the frames, column by column, RGB565 high byte first.
   The delay is the average of the GIF's frame delays in ms, at most 255. */
export const TFT = { MAX_FRAMES: 50, MAX_DELAY_MS: 255, PAGE_GAP_MS: 3 };

/* The box (left, top inclusive; right, bottom exclusive) holding every non-black pixel of all the frames (rgba arrays).
   All black: the whole screen. */
export const screenBox = (frames, width, height) => {
  let left = width;
  let top = height;
  let right = 0;
  let bottom = 0;
  for (const rgba of frames) {
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const i = (y * width + x) * 4;
        if (rgba[i] || rgba[i + 1] || rgba[i + 2]) {
          if (x < left) { left = x; }
          if (y < top) { top = y; }
          if (x + 1 > right) { right = x + 1; }
          if (y + 1 > bottom) { bottom = y + 1; }
        }
      }
    }
  }
  return right === 0 ? { left: 0, top: 0, right: width, bottom: height } : { left, top, right, bottom };
};

/* The pixels inside the box, column by column, RGB565 big-endian (the driver's yfn). */
export const boxBytes = (rgba, width, box) => {
  const w = box.right - box.left;
  const h = box.bottom - box.top;
  const out = new Uint8Array(w * h * 2);
  let at = 0;
  for (let x = box.left; x < box.right; x += 1) {
    for (let y = box.top; y < box.bottom; y += 1) {
      const i = (y * width + x) * 4;
      const word = ((rgba[i] >> 3) << 11) | ((rgba[i + 1] >> 2) << 5) | (rgba[i + 2] >> 3);
      out[at] = word >> 8;
      out[at + 1] = word & 0xff;
      at += 2;
    }
  }
  return out;
};

export const tftAnnounce = ({ count, delay, length, box, slot }) => {
  const data = packet(OP.PICTURE_ANNOUNCE, [0, count, delay, length & 0xff, (length >> 8) & 0xff, 0, 0,
    box.left & 0xff, box.top & 0xff, box.right & 0xff, box.bottom & 0xff, box.left >> 8, box.top >> 8, box.right >> 8, box.bottom >> 8,
    (length >> 16) & 0xff, (length >> 24) & 0xff, slot]);
  return data;
};

export const tftPages = ({ frame, count, delay }, bytes) => {
  const pages = [];
  for (let page = 0, start = 0; start < bytes.length; page += 1, start += ROYUAN.PAGE) {
    const chunk = bytes.subarray(start, start + ROYUAN.PAGE);
    const data = packet(OP.PICTURE_DATA, [frame, count, delay, page & 0xff, page >> 8, chunk.length]);
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
  #writes = 0;   // flash writes so far (two writes can share a millisecond)
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
    const gapMs = Math.min(this.timing.writeGapMs, FAMILIES[this.family]?.writeGapMs ?? Infinity);
    const waitMs = this.#lastWrite + gapMs - this.now();
    if (waitMs > 0) { await this.sleep(waitMs); }
    await this.#send(typeof data === "function" ? data() : data);
    this.#lastWrite = this.now();
    this.#writes += 1;
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

  /* yc500: the options register as last read ({ reply, at }), so a lighting write soon after a read does not ask again:
     on the NJ81-ED that read costs 60-400 ms before the write can go out. Every lighting write reads it back, so it only goes
     stale when the lights are switched with the keyboard's own key in between; the read-back then sees that and the page
     sends again. */
  #options = null;
  static OPTIONS_FRESH_MS = 15000;

  async #readOptions({ fresh = false } = {}) {
    if (!fresh && this.#options && this.now() - this.#options.at < Royuan.OPTIONS_FRESH_MS) { return this.#options.reply; }
    const reply = await this.get(FAMILIES[this.family].options.get, [0]);
    this.#options = { reply, at: this.now() };
    return reply;
  }

  async readLight() {
    const light = decodeLight(await this.get(OP.GET_LIGHT), this.family);
    if (FAMILIES[this.family].options) { light.off = Boolean((await this.#readOptions({ fresh: true }))[2] & LED_OFF_BIT); }
    return light;
  }

  /* A quick GET for the read-back: the request is sent as usual, then the reply is read with single tries a few times;
     a refusal ends it at once (RoyuanError "busy") instead of the transport's retries, so the line is free again. */
  #quickGet(op, payload = []) {
    return this.#serial(async () => {
      await this.#send(packet(op, payload));
      const once = this.transport.getFeatureOnce ?? this.transport.getFeature;
      for (let attempt = 1; attempt <= 4; attempt += 1) {
        await this.sleep(this.timing.settleMs * attempt);
        let reply;
        try { reply = await once(); } catch (error) { throw Object.assign(new RoyuanError("busy"), { busy: true }); }
        if (reply[0] === op && !reply.every((v) => v === 0xff)) { return reply; }
      }
      throw Object.assign(new RoyuanError("busy"), { busy: true });
    });
  }

  async #quickReadLight() {
    const light = decodeLight(await this.#quickGet(OP.GET_LIGHT), this.family);
    const options = FAMILIES[this.family].options;
    if (options) {
      const reply = await this.#quickGet(options.get, [0]);
      this.#options = { reply, at: this.now() };
      light.off = Boolean(reply[2] & LED_OFF_BIT);
    }
    return light;
  }

  /* yc500: backlight on/off is a bit in the options register, written read-modify-write. */
  async #setLedOff(off) {
    const options = FAMILIES[this.family].options;
    // lights off asks the keyboard first: a remembered "already off" would skip the write while the lights are on
    const now = await this.#readOptions({ fresh: off });
    if (Boolean(now[2] & LED_OFF_BIT) === off) { return; }
    const flags = (now[2] & OPTION_BITS_KEPT & ~LED_OFF_BIT) | (off ? LED_OFF_BIT : 0);
    this.#options = null;   // changed: read it again next time
    await this.#serial(() => this.#write(packet(options.set, [0, flags, now[3], now[4]])));
    await this.sleep(150);
  }

  /* After a lighting write the keyboard is left alone for a moment before it is read back: a read while it is still storing
     the setting can hold up the change on its lights (yc500: 700 ms). Cut short when newer settings are waiting. */
  async #quietAfterWrite(superseded) {
    const quietMs = FAMILIES[this.family].quietMs ?? 150;
    for (let waited = 0; waited < quietMs && !superseded(); waited += 50) { await this.sleep(Math.min(50, quietMs - waited)); }
  }

  /* `settings.off`: gen2 turns the lights off as the effect at brightness 0, yc500 as effect 0.
     The keyboard can answer the first read after a write with its previous state, so the result is read up to three times
     before a difference is believed. `superseded()` (optional) says newer settings are waiting: the read-back then stops at
     once, so they are not held up checking settings that are already out of date.
     Returns { light, diffs, sentAt, superseded } (diffs empty: the keyboard took everything; sentAt: when the first write
     of this change went out, on the this.now() clock, or null if nothing had to be written). */
  async writeLight(settings, { superseded = () => false, onSent = () => {} } = {}) {
    const yc500 = Boolean(FAMILIES[this.family].options);
    const before = this.#writes;
    let sentAt = null;
    const wrote = () => { if (sentAt === null && this.#writes !== before) { sentAt = this.#lastWrite; onSent(); } };
    if (yc500 && settings.off) {
      // effect 0. The backlight-off bit is NOT written: on the NJ81-ED writing it changes only the stored value, the lights
      // stay on, and the keyboard's own off key then needs two presses (its first press only brings the bit back in step).
      // The page keeps the effect it had, to send again when the lights go back on.
      await this.#serial(() => this.#write(encodeLight({ ...settings, mode: OFF }, this.family)));
      wrote();
      await this.#quietAfterWrite(superseded);
    } else if (yc500 && (await this.#readOptions())[2] & LED_OFF_BIT) {
      // the lights are off: switch them on FIRST, so they light up at once (with the stored effect), then the new effect,
      // but only if it differs from the stored one (a needless write costs the one-second flash gap)
      await this.#setLedOff(false);
      wrote();
      let stored = null;
      try { stored = decodeLight(await this.get(OP.GET_LIGHT), this.family); } catch (error) { /* refused while busy: write the effect anyway */ }
      if (!stored || lightDifferences({ ...settings, off: false }, { ...stored, off: false }).length) {
        await this.#serial(() => this.#write(encodeLight(settings, this.family)));
        await this.#quietAfterWrite(superseded);
      }
    } else {
      await this.#serial(() => this.#write(encodeLight(yc500 || !settings.off ? settings : { ...settings, brightness: 0 }, this.family)));
      wrote();
      await this.#quietAfterWrite(superseded);
    }
    let light;
    let diffs = [];
    // The read-back. Right after a write the NJ81-ED refuses reads for about a second while the change has gone through,
    // so each check is a single quick try that gives the line back at once; between checks it waits in 50 ms steps and
    // stops as soon as newer settings are waiting (they go out next). Up to CHECK_MS after the write: then the change is
    // reported sent but unconfirmed, and the page's own watch reads the keyboard again a moment later.
    const started = this.now();
    const pause = async (ms) => { for (let waited = 0; waited < ms; waited += 50) { if (superseded()) { return true; } await this.sleep(Math.min(50, ms - waited)); } return superseded(); };
    let matched = 0;
    while (this.now() - started < CHECK_MS) {
      if (superseded()) { return { light, diffs, sentAt, superseded: true }; }
      try {
        light = await this.#quickReadLight();
      } catch (error) {
        if (!error.busy) { throw error; }
        if (await pause(200)) { return { light, diffs, sentAt, superseded: true }; }
        continue;
      }
      diffs = lightDifferences(settings, light);
      if (!diffs.length) { return { light, diffs, sentAt, superseded: false }; }
      matched += 1;   // it can still answer with its previous state for a moment
      if (matched >= 3) { break; }
      if (await pause(250)) { return { light, diffs, sentAt, superseded: true }; }
    }
    if (!light) {
      if (sentAt === null) { throw new RoyuanError("The keyboard did not answer (use the USB cable and close the official driver)"); }
      return { light: null, diffs: [], sentAt, superseded: false, unconfirmed: true };
    }
    return { light, diffs, sentAt, superseded: false };
  }

  /* ---------- keys, Fn layer and macros (yc500 / NJ81-ED; see keymap.js for the 4-byte actions) ----------
     As the official driver: the key matrix is read 16 keys a page ([0x89, profile, page] x 8, 128 keys), the Fn layer the
     same way with 0x90; one key is written with [0x13, profile, position, ..., action] (0x15 for the Fn layer); a macro is
     read with [0x88, index] + 4 replies and written in 56-byte pages [0x16, index, page, 56, last?] + data. Every write
     goes through the flash gap. Checked on a real NJ81-ED (a remap with 0x13, read back with 0x89). */
  #keysOnly() { if (this.family !== "yc500") { throw new RoyuanError("Key settings are only set up for the NJ81-ED (yc500)"); } }

  #pagedRead(op, first, pages) {
    return this.#serial(async () => {
      const out = new Uint8Array(pages * ROYUAN.SIZE);
      for (let page = 0; page < pages; page += 1) {
        await this.#send(packet(op, [first, page]));
        await this.sleep(this.timing.settleMs * 2);
        out.set((await this.transport.getFeature()).subarray(0, ROYUAN.SIZE), page * ROYUAN.SIZE);
      }
      return out;
    });
  }
  /* 128 actions of 4 bytes, by key position. */
  async readKeymap(profile) { this.#keysOnly(); const raw = await this.#pagedRead(0x89, profile, 8); return Array.from({ length: 128 }, (_, i) => [...raw.subarray(i * 4, i * 4 + 4)]); }
  async readFnLayer(layer = 0) { this.#keysOnly(); const raw = await this.#pagedRead(0x90, layer, 8); return Array.from({ length: 128 }, (_, i) => [...raw.subarray(i * 4, i * 4 + 4)]); }

  #keyPacket(op, first, position, action) {
    if (!Number.isInteger(position) || position < 0 || position > 127) { throw new RoyuanError("Bad key position"); }
    if (!Array.isArray(action) || action.length !== 4) { throw new RoyuanError("A key action is 4 bytes"); }
    const data = packet(op, [first, position]);
    data.set(action, 8);
    return data;
  }
  setKey(profile, position, action) { this.#keysOnly(); return this.#serial(() => this.#write(this.#keyPacket(0x13, profile, position, action))); }
  setFnKey(layer, position, action) { this.#keysOnly(); return this.#serial(() => this.#write(this.#keyPacket(0x15, layer, position, action))); }

  readMacro(index) {
    this.#keysOnly();
    return this.#serial(async () => {
      await this.#send(packet(0x88, [index]));
      const out = new Uint8Array(4 * ROYUAN.SIZE);
      for (let page = 0; page < 4; page += 1) {
        await this.sleep(this.timing.settleMs);
        out.set((await this.transport.getFeature()).subarray(0, ROYUAN.SIZE), page * ROYUAN.SIZE);
      }
      return out;
    });
  }
  /* bytes: the 256-byte macro from keymap.encodeMacro. Only the 56-byte pages that hold something are sent. */
  writeMacro(index, bytes) {
    this.#keysOnly();
    const pages = [];
    for (let page = 0; page * 56 < bytes.length && page < 5; page += 1) {
      const chunk = bytes.subarray(page * 56, page * 56 + 56);
      if (chunk.some((v) => v !== 0)) { pages.push(chunk); }
    }
    return this.#serial(async () => {
      for (let page = 0; page < pages.length; page += 1) {
        const data = packet(0x16, [index, page, 56, page === pages.length - 1 ? 1 : 0]);
        data.set(pages[page], 8);
        await this.#write(data);
      }
    });
  }

  /* `date` can be a function: it is then read at the moment the packet goes out, after any wait. */
  setClock(date = () => new Date()) {
    return this.#serial(() => this.#write(() => clockPacket(typeof date === "function" ? date() : date)));
  }

  /* Animations only on boards whose screen is on file (gen2 records). On yc500 boards (NJ81-ED) still pictures go out as
     before (they join the keyboard's screen rotation; the driver's Clear removes them), but the GIF layout guessed earlier
     did not play there: animations wait for a capture of the official driver. */
  #animationWritable() {
    if (this.family !== "gen2") { throw new RoyuanError("Animated GIFs for this keyboard wait for a capture of the official driver"); }
  }

  /* Removes every picture and GIF from the screen of a yc500 board (NJ81-ED), as the official driver's "Clear" does: the
     bare 0xAC command, then one read, then nothing is sent while the keyboard clears its picture memory. The keyboard
     says when it is done with an input report 05 2C 00 00 (41-43 s on an NJ81-ED; the status screen comes back then).
     `progress(fraction)` is called every half second, estimated from CLEAR_MS. When the done report does not reach the
     page (the browser does not always pass it on), the wait ends at `timeoutMs` (a little over the 43 s measured).
     Resolves with { ms, confirmed } (confirmed: the keyboard's done report arrived). */
  clearScreen({ timeoutMs = 46000, progress = () => {} } = {}) {
    if (this.family !== "yc500") { return Promise.reject(new RoyuanError("Clearing the screen is only set up for the NJ81-ED (yc500)")); }
    return this.#serial(async () => {
      let done = false;
      const stop = this.transport.onInput?.((bytes) => { if (bytes[0] === 0x05 && bytes[1] === 0x2c) { done = true; } }) ?? (() => {});
      const start = this.now();
      try {
        await this.#send(clearScreenPacket());
        this.#lastWrite = this.now();
        await this.sleep(this.timing.settleMs);
        try { await this.transport.getFeature(); } catch (error) { /* the driver ignores this reply too */ }
        while (!done && this.now() - start < timeoutMs) {
          progress(Math.min(0.99, (this.now() - start) / CLEAR_MS));
          await this.sleep(500);
        }
      } finally { stop(); }
      progress(1);
      this.#lastWrite = this.now();
      return { ms: this.now() - start, confirmed: done };
    });
  }

  /* NJ81-ED (yc500): a still picture (one frame) or a GIF into slot 0..slots-1, exactly as the official driver sends it
     (see TFT above). frames: rgba arrays of the whole screen; delayMs: the GIF's average frame delay. */
  async uploadScreen(frames, { width, height, slots }, { slot = 0, delayMs = 0, progress = () => {} } = {}) {
    if (this.family !== "yc500") { throw new RoyuanError("This upload is the NJ81-ED's (yc500)"); }
    if (!Number.isInteger(slot) || slot < 0 || slot >= slots) { throw new RoyuanError(`Picture slot must be 1-${slots}`); }
    if (!frames.length || frames.length > TFT.MAX_FRAMES) { throw new RoyuanError(`A GIF has 1-${TFT.MAX_FRAMES} frames`); }
    if (frames.some((rgba) => rgba.length !== width * height * 4)) { throw new RoyuanError("Picture size does not match the screen"); }
    const count = frames.length;
    const delay = count > 1 ? Math.max(1, Math.min(TFT.MAX_DELAY_MS, Math.floor(delayMs))) : 0;
    const box = screenBox(frames, width, height);
    const data = frames.map((rgba) => boxBytes(rgba, width, box));
    let ready = false;
    for (let attempt = 0; attempt < 10 && !ready; attempt += 1) {
      const reply = await this.get(OP.PICTURE_ANNOUNCE, [...tftAnnounce({ count, delay, length: data[0].length, box, slot }).subarray(1, 19)]);
      ready = reply[1] === 1;
      if (!ready) { await this.sleep(this.timing.readyGapMs); }
    }
    if (!ready) { throw new RoyuanError("The screen did not accept the picture"); }
    await this.sleep(this.timing.readyGapMs);   // the driver waits 100 ms after the keyboard says ready
    const pages = data.flatMap((bytes, frame) => tftPages({ frame, count, delay }, bytes));
    for (let i = 0; i < pages.length; i += 1) {
      await this.#serial(async () => { await this.#send(pages[i]); await this.sleep(Math.min(this.timing.pageGapMs, TFT.PAGE_GAP_MS)); });
      progress(i + 1, pages.length);
    }
    this.#lastWrite = this.now();
    return { count, delay, box };
  }

  /* Uploads a still picture into slot 0..slots-1. `progress(done, total)` is called after each page. */
  async uploadPicture(slot, bytes, { width, height, slots }, progress = () => {}) {
    if (!Number.isInteger(slot) || slot < 0 || slot >= slots) { throw new RoyuanError(`Picture slot must be 1-${slots}`); }
    if (bytes.length !== width * height * 2) { throw new RoyuanError("Picture size does not match the screen"); }
    await this.#sendFrame(slot, bytes, { width, height }, { count: 1, delay: 0 }, (done, total) => progress(done, total));
  }

  /* An animation (GIF), EXPERIMENTAL: the layout comes from sharkfin's notes on the yc500 handler and from watching an
     NJ81-ED, not from a capture of the vendor app. ONE announce for the whole animation (frame 0, frame count, delay in
     10 ms steps, the length of one frame): every announce resets the keyboard's counters, and the NJ81-ED's screen shows
     its progress over all the frames (one announce per frame made it climb to 1/n and start again). Then the pages of
     every frame, each page carrying its frame number, page numbers starting again at 0 for each frame.
     frames: [{ bytes, ms }], at most ANIMATION.MAX_FRAMES; one delay for all (the average). `progress(done, total)`
     counts pages over all frames. */
  async uploadAnimation(frames, { width, height }, progress = () => {}) {
    this.#animationWritable();
    if (!frames.length || frames.length > ANIMATION.MAX_FRAMES) { throw new RoyuanError(`An animation has 1-${ANIMATION.MAX_FRAMES} frames`); }
    if (frames.some((f) => f.bytes.length !== width * height * 2)) { throw new RoyuanError("Picture size does not match the screen"); }
    const count = frames.length;
    const delay = frameDelay(frames.reduce((sum, f) => sum + f.ms, 0) / count);
    await this.#announce(0, frames[0].bytes.length, { width, height }, { count, delay });
    const pages = frames.flatMap((f, i) => picturePages(i, f.bytes, count));
    await this.#sendPages(pages, progress);
  }

  async #announce(frame, length, { width, height }, { count, delay }) {
    let ready = false;
    for (let attempt = 0; attempt < 10 && !ready; attempt += 1) {
      const reply = await this.get(OP.PICTURE_ANNOUNCE, [...pictureAnnounce(frame, length, width, height, { count, delay }).subarray(1, 12)]);
      ready = reply[1] === 1;
      if (!ready) { await this.sleep(this.timing.readyGapMs); }
    }
    if (!ready) { throw new RoyuanError("The screen did not accept the picture"); }
  }

  async #sendPages(pages, progress) {
    for (let i = 0; i < pages.length; i += 1) {
      await this.#serial(async () => { await this.#send(pages[i]); await this.sleep(this.timing.pageGapMs); });
      progress(i + 1, pages.length);
    }
    this.#lastWrite = this.now();
  }

  async #sendFrame(frame, bytes, screen, { count, delay }, progress) {
    await this.#announce(frame, bytes.length, screen, { count, delay });
    await this.#sendPages(picturePages(frame, bytes, count), progress);
  }
}

/* "Off" is shown when the keyboard reports brightness 0 (or effect 0). */
/* Off: on yc500 boards the backlight-off bit alone (brightness 0 is their dimmest level, and Fn + Backspace on the keyboard
   flips only that bit); on gen2 boards, which have no such bit, brightness 0 or effect 0. */
export const isOff = (light) => (typeof light.off === "boolean" ? light.off || light.mode === OFF : light.brightness === 0 || light.mode === OFF);

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
