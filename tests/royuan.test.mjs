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
  assert.deepEqual(back, { diffs: [], light: { mode: 12, speed: 1, brightness: 4, option: 1, rainbow: false, color: "#00ff00" } });
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

test("off is brightness 0, and the menu follows the manufacturer's order", async () => {
  const { MODES, isOff } = await import("../public/js/royuan.js");
  assert.deepEqual(MODES.map((m) => m.mode), [4, 5, 6, 7, 8, 9, 10, 11, 19, 12, 14, 15, 16, 17, 18, 1, 2, 3]);
  assert.equal(isOff({ mode: 4, brightness: 0 }), true);
  assert.equal(isOff({ mode: 4, brightness: 2 }), false);
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
  assert.deepEqual([light.mode, light.speed, light.brightness, light.off], [2, 0, 4, true]);   // wire speed 5 = slowest
  assert.equal(await nj.profile(), 0);

  const on = await nj.writeLight({ mode: 4, speed: 4, brightness: 3, option: 1, color: "#0000ff", off: false });
  assert.deepEqual(on.diffs, []);
  assert.deepEqual(state.light.slice(0, 4), [4, 1, 3, 0x17]);   // speed 4 goes out as 1 on yc500
  assert.equal(state.options, 0x00, "backlight-off bit cleared, Mac-mode bit not written back");
  const off = await nj.writeLight({ mode: 4, speed: 4, brightness: 3, option: 1, color: "#0000ff", off: true });
  assert.deepEqual(off.diffs, []);
  assert.equal(state.options & 0x10, 0x10);
  assert.deepEqual(state.sent.filter((p) => p[0] === 0x06).map((p) => [...p.subarray(1, 5)]), [[0, 0x00, 1, 2], [0, 0x10, 1, 2]]);
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
