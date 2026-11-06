import test from "node:test";
import assert from "node:assert/strict";
import { clamp, hexToRgb, hslToRgb, isHexColor, rgbToHex, scaleRgb } from "../public/js/util.js";

test("colours", () => {
  assert.deepEqual(hexToRgb("#ff8000"), [255, 128, 0]);
  assert.equal(rgbToHex(255, 128, 0), "#ff8000");
  assert.equal(rgbToHex(300, -5, 0.4), "#ff0000");
  assert.throws(() => hexToRgb("ff8000"));
  assert.equal(isHexColor("#a0b1c2"), true);
  assert.equal(isHexColor("red"), false);
  assert.deepEqual(hslToRgb(0, 1, 0.5), [255, 0, 0]);
  assert.deepEqual(hslToRgb(120, 1, 0.5), [0, 255, 0]);
  assert.deepEqual(hslToRgb(-120, 1, 0.5), [0, 0, 255]);
  assert.deepEqual(scaleRgb([200, 100, 50], 0.5), [100, 50, 25]);
  assert.equal(clamp(5, 0, 3), 3);
});
