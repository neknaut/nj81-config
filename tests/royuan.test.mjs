import test from "node:test";
import assert from "node:assert/strict";
import { OP, Royuan, RoyuanError, decodeLight, encodeLight, modelFor, packet, pictureAnnounce, pictureBytes, picturePages } from "../public/js/royuan.js";

const checksumOk = (data, at) => data[at] === 0xff - ([...data.subarray(0, at)].reduce((a, b) => a + b, 0) & 0xff);

/* A fake NJ81-CP (device 2454): answers identify, profile and lighting, and records what it is sent. */
const fakeNj81 = ({ deviceId = 2454 } = {}) => {
  const state = { light: [1, 2, 3, 0x07, 0xff, 0x00, 0x00], sent: [], pending: null, announceReady: true };
  const transport = {
    async setFeature(data) {
      state.sent.push(Uint8Array.from(data));
      const reply = new Uint8Array(64);
      reply[0] = data[0];
      if (data[0] === OP.IDENTIFY) { reply.set([deviceId & 0xff, (deviceId >> 8) & 0xff, 0, 0], 1); reply[7] = 0x13; reply[8] = 0x04; }
      if (data[0] === 0x84) { reply[1] = 1; }
      if (data[0] === OP.SET_LIGHT) { state.light = [...data.subarray(1, 8)]; return; }
      if (data[0] === OP.GET_LIGHT) { reply.set(state.light, 1); }
      if (data[0] === OP.PICTURE_ANNOUNCE) { reply[1] = state.announceReady ? 1 : 0; }
      if (data[0] === OP.PICTURE_DATA || data[0] === OP.CLOCK) { return; }
      state.pending = reply;
    },
    async getFeature() { return state.pending ?? new Uint8Array(64).fill(0xff); },
  };
  return { transport, state };
};
const fast = { sleep: async () => {}, timing: { writeGapMs: 0, settleMs: 0, pageGapMs: 0, readyGapMs: 0 } };

test("packets carry the documented checksum", () => {
  assert.ok(checksumOk(packet(OP.IDENTIFY), 7));
  const light = encodeLight({ mode: 4, speed: 4, brightness: 3, option: 2, color: "#ff0000" });
  assert.deepEqual([...light.subarray(0, 8)], [0x07, 4, 0, 3, 0x27, 0xff, 0, 0]);
  assert.ok(checksumOk(light, 8));
  assert.deepEqual([...encodeLight({ mode: 1, speed: 0, brightness: 4, color: "#ffffff" }).subarray(5, 8)], [0xfa, 0xfa, 0xfa]);
  assert.equal(encodeLight({ mode: 2, speed: 2, brightness: 2, rainbow: true, color: "#00ff00" })[4], 0x08);
});

test("dangerous opcodes and bad values are refused", () => {
  for (const op of [0x01, 0xac, 0x2c, 0x7f, 0x30]) { assert.throws(() => packet(op), RoyuanError); }
  assert.throws(() => encodeLight({ mode: 13, speed: 0, brightness: 0, color: "#000000" }), RoyuanError);
  assert.throws(() => encodeLight({ mode: 1, speed: 5, brightness: 0, color: "#000000" }), RoyuanError);
  assert.throws(() => encodeLight({ mode: 1, speed: 0, brightness: 0, option: 1, color: "#000000" }), RoyuanError);
});

test("lighting replies decode, including preset colours", () => {
  assert.deepEqual(decodeLight(Uint8Array.from([0x87, 4, 1, 2, 0x17, 0, 0x80, 0xff])), { mode: 4, speed: 3, brightness: 2, option: 1, rainbow: false, color: "#0080ff" });
  assert.equal(decodeLight(Uint8Array.from([0x87, 1, 0, 4, 0x05, 0, 0, 0])).color, "#0000ff");
  assert.equal(decodeLight(Uint8Array.from([0x87, 3, 0, 4, 0x08, 1, 2, 3])).rainbow, true);
});

test("identifies a NJ81-CP and reads its lighting and profile", async () => {
  const { transport } = fakeNj81();
  const nj = new Royuan(transport, fast);
  const id = await nj.identify();
  assert.deepEqual([id.deviceId, id.firmware, id.model.name, id.model.screen.width], [2454, "0413", "NJ81-CP", 160]);
  assert.equal(await nj.profile(), 1);
  assert.deepEqual(await nj.readLight(), { mode: 1, speed: 2, brightness: 3, option: 0, rainbow: false, color: "#ff0000" });
  assert.equal(modelFor(873).family, "unknown");
});

test("writing lighting is read back", async () => {
  const { transport } = fakeNj81();
  const nj = new Royuan(transport, fast);
  const back = await nj.writeLight({ mode: 12, speed: 1, brightness: 4, option: 1, color: "#00ff00" });
  assert.deepEqual({ diffs: back.diffs, light: back.light }, { diffs: [], light: { mode: 12, speed: 1, brightness: 4, option: 1, rainbow: false, color: "#00ff00" } });
});

test("pictures are column-major big-endian RGB565, announced then sent in 56-byte pages", async () => {
  const rgba = new Uint8Array(2 * 2 * 4);
  rgba.set([255, 0, 0, 255], 4);   // pixel x=1, y=0 is red
  assert.deepEqual([...pictureBytes(rgba, 2, 2)], [0, 0, 0, 0, 0xf8, 0x00, 0, 0]);
  const announce = pictureAnnounce(2, 25600, 160, 80);
  assert.deepEqual([...announce.subarray(0, 7)], [0xa5, 2, 1, 0, 0x00, 0x64, 0]);
  assert.deepEqual([announce[10], announce[11]], [160, 80]);
  const pages = picturePages(2, new Uint8Array(25600).fill(7));
  assert.equal(pages.length, 458);
  assert.deepEqual([...pages[457].subarray(0, 7)], [0x25, 2, 1, 0, 457 & 0xff, 457 >> 8, 25600 - 457 * 56]);
  assert.ok(checksumOk(pages[0], 7));

  const { transport, state } = fakeNj81();
  let last = 0;
  await new Royuan(transport, fast).uploadPicture(2, new Uint8Array(25600), { width: 160, height: 80, slots: 5 }, (done) => { last = done; });
  assert.equal(last, 458);
  assert.equal(state.sent.filter((p) => p[0] === OP.PICTURE_DATA).length, 458);
  await assert.rejects(() => new Royuan(transport, fast).uploadPicture(5, new Uint8Array(25600), { width: 160, height: 80, slots: 5 }), RoyuanError);
  state.announceReady = false;
  await assert.rejects(() => new Royuan(transport, fast).uploadPicture(0, new Uint8Array(25600), { width: 160, height: 80, slots: 5 }), RoyuanError);
});

test("no answer gives a clear error", async () => {
  const nj = new Royuan({ setFeature: async () => {}, getFeature: async () => new Uint8Array(64).fill(0xff) }, fast);
  await assert.rejects(() => nj.identify(), RoyuanError);
});

test("the settings interface is picked among the keyboard's interfaces", async () => {
  const { pickInterface } = await import("../public/js/hid.js");
  const keyboard = { collections: [{ usagePage: 1, usage: 6, featureReports: [] }] };
  const vendor = { collections: [{ usagePage: 0xffff, usage: 2, featureReports: [{ reportId: 0 }] }] };
  const via = { collections: [{ usagePage: 0xff60, usage: 0x61, featureReports: [] }] };
  assert.equal(pickInterface([keyboard, vendor]), vendor);
  assert.equal(pickInterface([keyboard, via]), via);
  assert.equal(pickInterface([keyboard]), keyboard);
  assert.equal(pickInterface([]), null);
});

test("the NJ81 drawing has 80 keys, End under PgDn and the screen top right", async () => {
  const { KEYS, SCREEN_TILE, LAYOUT_WIDTH } = await import("../public/js/layout.js");
  assert.equal(KEYS.length, 80);
  const home = KEYS.find((key) => key.label === "End");
  assert.equal(home.x + home.w, LAYOUT_WIDTH);
  assert.ok(KEYS.filter((key) => key.y === 0).every((key) => key.x + key.w <= SCREEN_TILE.x));
  assert.equal(SCREEN_TILE.x + SCREEN_TILE.w, LAYOUT_WIDTH);
});

test("flash writes are spaced at least a second apart, reads are not", async () => {
  const { transport, state } = fakeNj81();
  let clock = 0;
  const waits = [];
  const nj = new Royuan(transport, { now: () => clock, sleep: async (ms) => { waits.push(ms); clock += ms; } });
  await nj.writeLight({ mode: 1, speed: 0, brightness: 4, color: "#ff0000" });
  const t0 = clock;
  await nj.setClock(new Date(2026, 10, 6, 15, 4, 5));
  assert.ok(clock - t0 >= 1000 - 200, "clock waited for the light write");
  const sentAt = state.sent.findIndex((p) => p[0] === OP.CLOCK);
  assert.deepEqual([...state.sent[sentAt].subarray(8, 15)], [7, 234, 11, 6, 15, 4, 5]);
  const before = clock;
  await nj.readLight();
  assert.ok(clock - before < 200, "reads only settle");
});

test("off: brightness 0 on gen2, the off switch alone on yc500; the menu follows the manufacturer's order", async () => {
  const { MODES, isOff } = await import("../public/js/royuan.js");
  assert.deepEqual(MODES.map((m) => m.mode), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 15, 16, 17, 18, 19], "the official driver's order");
  assert.equal(isOff({ mode: 4, brightness: 0 }), true);
  assert.equal(isOff({ mode: 4, brightness: 2 }), false);
  assert.equal(isOff({ mode: 4, brightness: 0, off: false }), false, "yc500: switched on with Fn + Backspace at brightness 0");
  assert.equal(isOff({ mode: 4, brightness: 3, off: true }), true);
});

/* A fake NJ81-ED (device 873, yc500 command set): keymap on 0x89, FF on 0x8A, backlight-off in the options register. */
const fakeNj81Ed = () => {
  const keymapPage = new Uint8Array(64);
  for (let i = 0; i < 16; i += 1) { keymapPage.set([0, 0, 4 + i, 0], i * 4); }
  const state = { light: [2, 5, 4, 0x07, 0, 0xff, 0], options: 0x10 | 0x02, sent: [], pending: new Uint8Array(64) };
  const transport = {
    async setFeature(data) {
      state.sent.push(Uint8Array.from(data));
      const r = new Uint8Array(64);
      r[0] = data[0];
      switch (data[0]) {
        case 0x8f: r.set([873 & 0xff, 873 >> 8, 0, 0], 1); r[7] = 0x70; break;
        case 0x89: state.pending = keymapPage; return;
        case 0x8a: state.pending = new Uint8Array(64).fill(0xff); return;
        case 0x91: case 0x92: break;
        case 0x85: r[1] = 0; break;
        case 0x86: r[2] = state.options; r[3] = 1; r[4] = 2; break;
        case 0x06: state.options = data[2]; return;
        case 0x87: r.set(state.light, 1); break;
        case 0x07: state.light = [...data.subarray(1, 8)]; return;
        case 0xad: r.set([8, 1], 1); break;
        default: return;
      }
      state.pending = r;
    },
    async getFeature() { return state.pending; },
  };
  return { transport, state };
};

test("an NJ81-ED is recognised as yc500 by reads only, and its lights can be switched off and on", async () => {
  const { transport, state } = fakeNj81Ed();
  const nj = new Royuan(transport, fast);
  assert.equal((await nj.identify()).model.name, "NJ81-ED");
  assert.equal(await nj.probeFamily(), "yc500");
  assert.ok(state.sent.every((p) => p[0] & 0x80), "probing sent only GETs");
  nj.family = "yc500";
  assert.equal(await nj.hasDisplay(), true);
  const light = await nj.readLight();
  assert.deepEqual([light.mode, light.speed, light.brightness, light.off], [2, 0, 4, true]);   // wire speed 4 or more = slowest
  assert.equal(await nj.profile(), 0);

  const on = await nj.writeLight({ mode: 4, speed: 4, brightness: 3, option: 1, color: "#0000ff", off: false });
  assert.deepEqual(on.diffs, []);
  assert.deepEqual(state.light.slice(0, 4), [4, 0, 3, 0x17]);   // speed 4 goes out as 0 (the driver's MAXSPEED 4 - speed)
  assert.equal(state.options, 0x00, "backlight-off bit cleared, Mac-mode bit not written back");
  const off = await nj.writeLight({ mode: 4, speed: 4, brightness: 3, option: 1, color: "#0000ff", off: true });
  assert.deepEqual(off.diffs, []);
  assert.equal(state.light[0], 0, "lights off is effect 0, which the NJ81-ED shows at once");
  assert.equal(state.options & 0x10, 0, "the backlight-off bit is left alone (writing it puts the keyboard's off key out of step)");
  assert.deepEqual(state.sent.filter((p) => p[0] === 0x06).map((p) => [...p.subarray(1, 5)]), [[0, 0x00, 1, 2]]);
  const back = await nj.writeLight({ mode: 4, speed: 4, brightness: 3, option: 1, color: "#0000ff", off: false });
  assert.deepEqual(back.diffs, []);
  assert.equal(state.light[0], 4, "back on: the effect is sent again");
});

test("a board that fits neither family stays unknown", async () => {
  const { detectFamily } = await import("../public/js/royuan.js");
  const zero = new Uint8Array(64);
  assert.equal(detectFamily({ r89: zero, r8a: zero, r91: zero, r92: zero }), null);
});

test("a stale first read after a write is not taken for a refusal", async () => {
  const { transport, state } = fakeNj81();
  let reads = 0;
  const stale = transport.getFeature;
  transport.getFeature = async () => { reads += 1; const r = await stale(); return reads === 1 && r[0] === 0x87 ? Uint8Array.from([0x87, 9, 0, 0, 7, 0, 0, 0, ...new Uint8Array(56)]) : r; };
  const nj = new Royuan(transport, fast);
  const { diffs } = await nj.writeLight({ mode: 2, speed: 1, brightness: 3, color: "#0000ff" });
  assert.deepEqual(diffs, []);
  assert.deepEqual(state.light.slice(0, 3), [2, 3, 3]);
});

test("differences name only the settings an effect has", async () => {
  const { lightDifferences } = await import("../public/js/royuan.js");
  const got = { mode: 1, speed: 0, brightness: 2, option: 0, rainbow: false, color: "#ff0000" };
  assert.deepEqual(lightDifferences({ mode: 1, speed: 4, brightness: 2, color: "#ff0000" }, got), []);   // Static has no speed
  assert.deepEqual(lightDifferences({ mode: 1, speed: 4, brightness: 4, color: "#00ff00" }, got).map((d) => d.field), ["brightness", "color"]);
  assert.deepEqual(lightDifferences({ off: true }, got).map((d) => d.field), ["off"]);
});

test("the drawing has a valid colour for every NJ81 effect, reactive ones dark until a key is pressed", async () => {
  const { nj81KeyColor, REACTIVE_DEFAULT } = await import("../public/js/lighting-nj81.js");
  const { MODES } = await import("../public/js/royuan.js");
  const { KEYS } = await import("../public/js/layout.js");
  for (const { mode, options } of MODES) {
    for (const option of [0, ...(options ? [options.length - 1] : [])]) {
      for (const rainbow of [false, true]) {
        const s = { mode, option, rainbow, color: [255, 0, 0], level: 1, speed: 0.5, off: false };
        for (const time of [0, 777, 4321]) {
          for (const key of KEYS) {
            const c = nj81KeyColor(s, key, time, [{ x: 5, y: 3, t: time - 100 }]);
            assert.ok(c.length === 3 && c.every((v) => Number.isInteger(v) && v >= 0 && v <= 255), `mode ${mode} ${key.label}`);
          }
        }
      }
    }
  }
  for (const mode of REACTIVE_DEFAULT) {
    const s = { mode, option: 0, rainbow: false, color: [255, 0, 0], level: 1, speed: 0.5, off: false };
    assert.ok(KEYS.every((key) => nj81KeyColor(s, key, 1000, []).every((v) => v === 0)), `mode ${mode} dark without presses`);
  }
  assert.deepEqual(nj81KeyColor({ mode: 1, off: true }, KEYS[0], 0), [0, 0, 0]);
});

test("radiant runs along the pressed key's row to both sides; key shadow lights only that key", async () => {
  const { nj81KeyColor } = await import("../public/js/lighting-nj81.js");
  const { KEYS } = await import("../public/js/layout.js");
  const g = KEYS.find((k) => k.label === "G");
  const press = [{ x: g.x + g.w / 2, y: g.y + 0.5, t: 0 }];
  const base = { option: 0, rainbow: false, color: [255, 255, 255], level: 1, speed: 0.5, off: false };
  const litAt = (mode, time) => KEYS.filter((k) => nj81KeyColor({ ...base, mode }, k, time, press).some((v) => v > 30));
  const radiant = litAt(14, 400);
  assert.ok(radiant.length >= 2 && radiant.every((k) => k.y === g.y), "radiant stays on the row");
  assert.ok(radiant.some((k) => k.x < g.x) && radiant.some((k) => k.x > g.x), "radiant goes both ways");
  assert.deepEqual(litAt(8, 100).map((k) => k.label), ["G"]);
});

test("the NJ81-ED lists only the effects seen on it", async () => {
  const { modelFor } = await import("../public/js/royuan.js");
  assert.deepEqual(modelFor(873).modes, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 15, 16, 17, 18, 19]);
});

test("an NJ81-ED that is off lights up with the first write, before the new effect is written", async () => {
  const { transport, state } = fakeNj81Ed();   // starts with the backlight-off bit set
  const nj = new Royuan(transport, fast);
  nj.family = "yc500";
  const { diffs } = await nj.writeLight({ mode: 4, speed: 2, brightness: 3, option: 0, color: "#00ff00", off: false });
  assert.deepEqual(diffs, []);
  const writes = state.sent.filter((p) => p[0] === 0x06 || p[0] === 0x07).map((p) => p[0]);
  assert.deepEqual(writes, [0x06, 0x07], "lights on first, then the effect");
});

test("a busy keyboard: HID transfers are retried before giving up", async () => {
  const { HidSession } = await import("../public/js/hid.js");
  const session = new HidSession();
  let sends = 0;
  let reads = 0;
  session.device = {
    async sendFeatureReport() { sends += 1; if (sends < 3) { throw new Error("Failed to write the feature report."); } },
    async receiveFeatureReport() { reads += 1; if (reads < 2) { throw new Error("Failed to receive the feature report."); } return new DataView(new Uint8Array(64).fill(7).buffer); },
  };
  const transport = session.featureTransport(64, [0, 1, 1, 1]);
  await transport.setFeature(new Uint8Array(64));
  assert.equal(sends, 3);
  assert.equal((await transport.getFeature())[0], 7);
  session.device.sendFeatureReport = async () => { throw new Error("Failed to write the feature report."); };
  await assert.rejects(() => transport.setFeature(new Uint8Array(64)), (error) => error.busy === true && error.attempts === 4);
});

test("lighting latency: no needless effect write when an NJ81-ED comes back on, sentAt is the first write, superseded stops the read-back", async () => {
  const { transport, state } = fakeNj81Ed();
  let clock = 0;
  const nj = new Royuan(transport, { now: () => clock, sleep: async (ms) => { clock += ms; } });
  nj.family = "yc500";
  const stored = { mode: 2, speed: 0, brightness: 4, option: 0, color: "#00ff00", off: false };   // the fake's stored effect
  const t0 = clock;
  const on = await nj.writeLight(stored);
  assert.deepEqual(on.diffs, []);
  assert.equal(state.sent.filter((p) => p[0] === OP.SET_LIGHT).length, 0, "same effect: only the backlight switch is written");
  assert.ok(clock - t0 < 500, "confirmed without waiting for a second flash gap");
  assert.equal(on.sentAt, nj.lastWriteAt);

  clock += 5000;
  await nj.writeLight({ ...stored, off: true });
  clock += 5000;
  const t1 = clock;
  const writesBefore = state.sent.filter((p) => p[0] === OP.SET_LIGHT || p[0] === 0x06).length;
  const changed = await nj.writeLight({ ...stored, mode: 4 });   // off from the page was effect 0: one effect write brings it back
  assert.ok(changed.sentAt - t1 < 200, "the lights come on at once");
  assert.equal(state.sent.filter((p) => p[0] === OP.SET_LIGHT || p[0] === 0x06).length - writesBefore, 1, "a single write, no flash gap");

  const fooled = { ...transport, async getFeature() { const r = await transport.getFeature(); return r[0] === 0x87 ? Uint8Array.from(r).fill(9, 1, 2) : r; } };
  const nj2 = new Royuan(fooled, { now: () => clock, sleep: async (ms) => { clock += ms; } });
  nj2.family = "yc500";
  const t2 = clock;
  const result = await nj2.writeLight({ ...stored, mode: 5 }, { superseded: () => true });
  assert.equal(result.superseded, true);
  assert.ok(clock - t2 < 1200 + 50, "no read-back pauses once newer settings wait");
});

test("a GIF goes as one announce (frame count, average delay in 10 ms steps), then the pages of every frame", async () => {
  const { frameDelay } = await import("../public/js/royuan.js");
  const { transport, state } = fakeNj81();
  const nj = new Royuan(transport, fast);
  const screen = { width: 4, height: 2, slots: 5 };
  const frame = () => new Uint8Array(4 * 2 * 2);
  let last = 0;
  await nj.uploadAnimation([{ bytes: frame(), ms: 100 }, { bytes: frame(), ms: 40 }, { bytes: frame(), ms: 5000 }], screen, (done, total) => { last = `${done}/${total}`; });
  const announces = state.sent.filter((p) => p[0] === OP.PICTURE_ANNOUNCE).map((p) => [...p.subarray(1, 4)]);
  assert.deepEqual(announces, [[0, 3, 171]], "one announce: frame 0, 3 frames, (100 + 40 + 5000) / 3 ms = 171 steps");
  assert.deepEqual(state.sent.filter((p) => p[0] === OP.PICTURE_DATA).map((p) => [p[1], p[2]]), [[0, 3], [1, 3], [2, 3]]);
  assert.equal(last, "3/3");
  assert.equal(frameDelay(3), 1);
  await assert.rejects(() => nj.uploadAnimation(Array.from({ length: 31 }, () => ({ bytes: frame(), ms: 100 })), screen), RoyuanError);
});


test("a yc500 board (NJ81-ED) takes still pictures; animations wait for a capture of the official driver", async () => {
  const { transport, state } = fakeNj81Ed();
  const nj = new Royuan(transport, fast);
  nj.family = "yc500";
  const screen = { width: 4, height: 2, slots: 1 };
  await assert.rejects(() => nj.uploadAnimation([{ bytes: new Uint8Array(16), ms: 100 }], screen), RoyuanError);
  assert.equal(state.sent.length, 0, "nothing sent for the animation");
});

test("Clear pictures and GIFs: the official driver's bare 0xAC (captured on an NJ81-ED), one read, only on yc500", async () => {
  const { clearScreenPacket } = await import("../public/js/royuan.js");
  assert.deepEqual([...clearScreenPacket().subarray(0, 8)], [0xac, 0, 0, 0, 0, 0, 0, 0x53], "as the driver sends it");
  assert.throws(() => packet(0xac), RoyuanError, "packet() still refuses it");
  const gen2 = fakeNj81();
  await assert.rejects(() => new Royuan(gen2.transport, fast).clearScreen({ waitMs: 0 }), RoyuanError);
  assert.equal(gen2.state.sent.length, 0);
  const ed = fakeNj81Ed();
  let clock = 0;
  const nj = new Royuan(ed.transport, { now: () => clock, sleep: async (ms) => { clock += ms; } });
  nj.family = "yc500";
  let listener = null;
  const withInput = { ...ed.transport, onInput: (fn) => { listener = fn; return () => { listener = null; }; } };
  const fractions = [];
  const nj2 = new Royuan(withInput, { now: () => clock, sleep: async (ms) => { clock += ms; if (clock >= 41000 && listener) { listener(Uint8Array.from([0x05, 0x2c, 0, 0])); } } });
  nj2.family = "yc500";
  clock = 0;
  const result = await nj2.clearScreen({ progress: (f) => fractions.push(f) });
  assert.deepEqual(ed.state.sent.map((p) => p[0]), [0xac], "nothing but the clear");
  assert.equal(result.confirmed, true, "the keyboard's 05 2C report ends the wait");
  assert.ok(result.ms >= 41000 && result.ms < 42000, `done when the keyboard says so (${result.ms} ms)`);
  assert.equal(fractions.at(-1), 1);
  assert.equal(listener, null, "stops listening");

  clock = 0;
  const quiet = await nj.clearScreen({ timeoutMs: 5000 });
  assert.equal(quiet.confirmed, false, "no done report: gives up after the timeout");
  assert.ok(quiet.ms >= 5000);
});

test("NJ81-ED screen: one announce (slot at byte 18, frame count, delay in ms, the box), then every frame's pages with the delay", async () => {
  const { screenBox, boxBytes, tftAnnounce } = await import("../public/js/royuan.js");
  const w = 4;
  const h = 2;
  const frame = (lit) => { const a = new Uint8ClampedArray(w * h * 4); for (const [x, y] of lit) { a.set([255, 0, 0, 255], (y * w + x) * 4); } return a; };
  const f1 = frame([[1, 0]]);
  const f2 = frame([[2, 1]]);
  assert.deepEqual(screenBox([f1, f2], w, h), { left: 1, top: 0, right: 3, bottom: 2 }, "the box around every lit pixel of all frames");
  assert.deepEqual(screenBox([frame([])], w, h), { left: 0, top: 0, right: w, bottom: h }, "all black: the whole screen");
  assert.deepEqual([...boxBytes(f1, w, { left: 1, top: 0, right: 3, bottom: 2 })], [0xf8, 0, 0, 0, 0, 0, 0, 0], "column by column, red at (1,0) first");
  const a = tftAnnounce({ count: 3, delay: 100, length: 25600, box: { left: 0, top: 0, right: 160, bottom: 80 }, slot: 2 });
  assert.deepEqual([...a.subarray(0, 7)], [0xa5, 0, 3, 100, 0x00, 0x64, 0]);
  assert.deepEqual([...a.subarray(8, 19)], [0, 0, 160, 80, 0, 0, 0, 0, 0, 0, 2]);

  const { transport, state } = fakeNj81Ed();
  const replies = transport.setFeature;
  transport.setFeature = async (data) => { await replies(data); if (data[0] === OP.PICTURE_ANNOUNCE) { const r = new Uint8Array(64); r[0] = 0xa5; r[1] = 1; state.pending = r; } };
  const nj = new Royuan(transport, fast);
  nj.family = "yc500";
  const result = await nj.uploadScreen([f1, f2, f1], { width: w, height: h, slots: 5 }, { slot: 4, delayMs: 83.4 });
  assert.deepEqual([result.count, result.delay], [3, 83], "the GIF's average delay in ms");
  const sent = state.sent.filter((p) => p[0] === OP.PICTURE_ANNOUNCE || p[0] === OP.PICTURE_DATA);
  assert.equal(sent.filter((p) => p[0] === OP.PICTURE_ANNOUNCE).length, 1, "one announce for the whole GIF");
  assert.equal(sent.find((p) => p[0] === OP.PICTURE_ANNOUNCE)[18], 4, "the slot at byte 18");
  assert.deepEqual(sent.filter((p) => p[0] === OP.PICTURE_DATA).map((p) => [...p.subarray(1, 7)]), [[0, 3, 83, 0, 0, 8], [1, 3, 83, 0, 0, 8], [2, 3, 83, 0, 0, 8]]);
  await assert.rejects(() => nj.uploadScreen([f1], { width: w, height: h, slots: 5 }, { slot: 5 }), RoyuanError);
});
