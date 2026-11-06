import test from "node:test";
import assert from "node:assert/strict";
import { CHANNEL, RGB_EFFECTS, Via, ViaError, joinMacros, parseDefinition, previewEffectFor, splitMacros, textToMacro } from "../public/js/via.js";
import { ViaDriver, profileToViaRgb } from "../public/js/drivers.js";
import { defaultProfile, validateProfile } from "../public/js/profile.js";
import { hexToHueSat, hueSatToHex } from "../public/js/util.js";
import { keycodeLabel, layerKeycode, layerTapKeycode, parseKeycode } from "../public/js/keycodes.js";

/* A fake VIA keyboard: 2 layers of 2x3 keys, a macro buffer and an RGB matrix channel. */
const fakeKeyboard = () => {
  const keymap = new Uint8Array(2 * 2 * 3 * 2);
  const macros = new Uint8Array(40);
  const rgb = { 1: [128], 2: [5], 3: [64], 4: [10, 200] };
  const sent = [];
  const transact = async (request) => {
    sent.push(Uint8Array.from(request));
    const r = Uint8Array.from(request);
    switch (request[0]) {
      case 0x01: r[1] = 0; r[2] = 9; break;
      case 0x11: r[1] = 2; break;
      case 0x04: { const at = ((request[1] * 2 + request[2]) * 3 + request[3]) * 2; r[4] = keymap[at]; r[5] = keymap[at + 1]; break; }
      case 0x05: { const at = ((request[1] * 2 + request[2]) * 3 + request[3]) * 2; keymap[at] = request[4]; keymap[at + 1] = request[5]; break; }
      case 0x12: { const o = (request[1] << 8) | request[2]; r.set(keymap.subarray(o, o + request[3]), 4); break; }
      case 0x13: { const o = (request[1] << 8) | request[2]; keymap.set(request.subarray(4, 4 + request[3]), o); break; }
      case 0x0c: r[1] = 2; break;
      case 0x0d: r[1] = 0; r[2] = macros.length; break;
      case 0x0e: { const o = (request[1] << 8) | request[2]; r.set(macros.subarray(o, o + request[3]), 4); break; }
      case 0x0f: { const o = (request[1] << 8) | request[2]; macros.set(request.subarray(4, 4 + request[3]), o); break; }
      case 0x08: { if (request[1] !== CHANNEL.RGB_MATRIX) { r[0] = 0xff; break; } r.set(rgb[request[2]], 3); break; }
      case 0x07: { if (request[1] !== CHANNEL.RGB_MATRIX) { r[0] = 0xff; break; } rgb[request[2]] = request[2] === 4 ? [request[3], request[4]] : [request[3]]; break; }
      case 0x09: break;
      default: r[0] = 0xff;
    }
    return r;
  };
  return { transact, keymap, macros, rgb, sent };
};

test("reads the protocol version, layers and the current RGB settings", async () => {
  const via = new Via(fakeKeyboard().transact);
  assert.equal(await via.protocolVersion(), 9);
  assert.equal(await via.layerCount(), 2);
  assert.deepEqual(await via.getRgb(), { brightness: 128, effect: 5, speed: 64, hue: 10, saturation: 200 });
});

test("a keyboard without that RGB channel gives a clear error", async () => {
  const via = new Via(fakeKeyboard().transact);
  await assert.rejects(() => via.getRgb(CHANNEL.RGBLIGHT), ViaError);
});

test("keycodes and the whole keymap round trip", async () => {
  const kb = fakeKeyboard();
  const via = new Via(kb.transact);
  await via.setKeycode(1, 1, 2, 0x5221);
  assert.equal(await via.getKeycode(1, 1, 2), 0x5221);
  const map = await via.readKeymap(2, 2, 3);
  assert.equal(map[1][1][2], 0x5221);
  map[0][0][0] = 0x0004;
  await via.writeKeymap(map);
  assert.deepEqual(await via.readKeymap(2, 2, 3), map);
  await assert.rejects(() => via.setKeycode(0, 0, 0, 0x10000), ViaError);
});

test("macros round trip and complex ones are kept as they are", async () => {
  const kb = fakeKeyboard();
  const via = new Via(kb.transact);
  const { count, size } = await via.macroInfo();
  assert.deepEqual([count, size], [2, 40]);
  const complex = Uint8Array.from([1, 1, 4]);
  await via.writeMacroBuffer(joinMacros([textToMacro("hello"), complex], size));
  const back = splitMacros(await via.readMacroBuffer(size), count);
  assert.deepEqual([...back[0]], [...textToMacro("hello")]);
  assert.deepEqual([...back[1]], [...complex]);
  assert.throws(() => textToMacro("xin chào"), ViaError);
  assert.throws(() => joinMacros([new Uint8Array(50)], 40), ViaError);
});

test("the VIA driver sends the profile as brightness, speed, hue, saturation and effect", async () => {
  const kb = fakeKeyboard();
  const profile = validateProfile({ lighting: { color: "#ff0000", brightness: 100, speed: 50, viaEffect: 12 } }).profile;
  assert.deepEqual(profileToViaRgb(profile), { brightness: 255, speed: 128, hue: 0, saturation: 255, effect: 12 });
  const result = await new ViaDriver(new Via(kb.transact), CHANNEL.RGB_MATRIX, true).apply(profile, () => {});
  assert.equal(result.sent, true);
  assert.deepEqual([kb.rgb[1], kb.rgb[2], kb.rgb[3], kb.rgb[4]], [[255], [12], [128], [0, 255]]);
  assert.ok(kb.sent.some((packet) => packet[0] === 0x09), "saved to memory");
});

test("hue / saturation conversion round trips and viaEffect is validated", () => {
  for (const hex of ["#ff0000", "#00ff00", "#0000ff", "#ffffff", "#ff7a66"]) {
    const { hue, saturation } = hexToHueSat(hex);
    const back = hexToHueSat(hueSatToHex(hue, saturation));
    assert.ok(Math.abs(back.hue - hue) <= 2 || Math.abs(back.hue - hue) >= 254, hex);
    assert.ok(Math.abs(back.saturation - saturation) <= 2, hex);
  }
  assert.equal(validateProfile({ lighting: { viaEffect: 999 } }).profile.lighting.viaEffect, undefined);
  assert.equal("viaEffect" in defaultProfile().lighting, false);
  assert.equal(RGB_EFFECTS[1].label, "1 · Solid Color");
  assert.equal(previewEffectFor(0), "off");
});

test("VIA definitions become key rectangles", () => {
  const def = parseDefinition({ name: "T", matrix: { rows: 2, cols: 3 }, layouts: { keymap: [["0,0", { x: 0.5, w: 2 }, "0,1"], ["1,0", "1,1", "1,2"]] } });
  assert.equal(def.keys.length, 5);
  assert.deepEqual(def.keys[1], { row: 0, col: 1, x: 1.5, y: 0, w: 2, h: 1 });
  assert.equal(parseDefinition({ matrix: { rows: 2, cols: 2 } }).keys.length, 4);
  assert.throws(() => parseDefinition({}), ViaError);
});

test("keycode names", () => {
  assert.equal(keycodeLabel(0x04), "A");
  assert.equal(keycodeLabel(layerKeycode("MO", 1)), "MO(1)");
  assert.equal(keycodeLabel(layerTapKeycode(2, 0x2c)), "LT(2,Space)");
  assert.equal(keycodeLabel(0x0204), "S+A");
  assert.equal(keycodeLabel(0x7e00), "0x7E00");
  assert.equal(parseKeycode("0x1f"), 31);
  assert.throws(() => parseKeycode("zz"), Error);
});
