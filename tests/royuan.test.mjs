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
      if (data[0] === OP.GET_PROFILE) { reply[1] = 1; }
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
const fast = { sleep: async () => {}, gapMs: 0 };

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
  assert.equal(modelFor(1493).family, "yc500");
});

test("writing lighting is read back", async () => {
  const { transport } = fakeNj81();
  const nj = new Royuan(transport, fast);
  const back = await nj.writeLight({ mode: 12, speed: 1, brightness: 4, option: 1, color: "#00ff00" });
  assert.deepEqual(back, { mode: 12, speed: 1, brightness: 4, option: 1, rainbow: false, color: "#00ff00" });
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
