import test from "node:test";
import assert from "node:assert/strict";
import { bytesToHex, clamp, hexToBytes, hexToRgb, hslToRgb, rgb565, rgbToHex, rgbaToRgb565Bytes, scaleRgb } from "../public/js/util.js";

test("hex bytes round trip", () => {
  assert.deepEqual([...hexToBytes("01 0a, 0xFF")], [1, 10, 255]);
  assert.equal(bytesToHex(Uint8Array.from([1, 10, 255])), "01 0a ff");
  assert.equal(hexToBytes("   ").length, 0);
});

test("hexToBytes rejects anything that is not a byte", () => {
  assert.throws(() => hexToBytes("01 zz"), /zz/);
  assert.throws(() => hexToBytes("123"), /123/);
});

test("colours", () => {
  assert.deepEqual(hexToRgb("#ff8000"), [255, 128, 0]);
  assert.equal(rgbToHex(255, 128, 0), "#ff8000");
  assert.equal(rgbToHex(300, -5, 0.4), "#ff0000");
  assert.throws(() => hexToRgb("ff8000"));
  assert.deepEqual(hslToRgb(0, 1, 0.5), [255, 0, 0]);
  assert.deepEqual(hslToRgb(120, 1, 0.5), [0, 255, 0]);
  assert.deepEqual(hslToRgb(-120, 1, 0.5), [0, 0, 255]);
  assert.deepEqual(scaleRgb([200, 100, 50], 0.5), [100, 50, 25]);
  assert.equal(clamp(5, 0, 3), 3);
});

test("RGB565", () => {
  assert.equal(rgb565(255, 255, 255), 0xffff);
  assert.equal(rgb565(255, 0, 0), 0xf800);
  assert.equal(rgb565(0, 255, 0), 0x07e0);
  assert.equal(rgb565(0, 0, 255), 0x001f);
  assert.deepEqual([...rgbaToRgb565Bytes(Uint8ClampedArray.from([255, 0, 0, 255]))], [0x00, 0xf8]);
  assert.deepEqual([...rgbaToRgb565Bytes(Uint8ClampedArray.from([255, 0, 0, 255]), false)], [0xf8, 0x00]);
});
