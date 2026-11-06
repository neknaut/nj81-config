import test from "node:test";
import assert from "node:assert/strict";
import { defaultProfile, parseProfile, serializeProfile, validateProfile } from "../public/js/profile.js";
import { KEYS, LAYOUT_WIDTH } from "../public/js/layout.js";
import { textKeys } from "../public/js/i18n.js";

test("the default profile is valid", () => {
  const result = validateProfile(defaultProfile());
  assert.equal(result.ok, true);
  assert.deepEqual(result.profile, defaultProfile());
});

test("out-of-range numbers are clamped, wrong colours are errors, old keys are dropped", () => {
  const clamped = validateProfile({ lighting: { brightness: 500, speed: -3 }, screen: { width: 9999, height: 1 } });
  assert.equal(clamped.ok, true);
  assert.deepEqual([clamped.profile.lighting.brightness, clamped.profile.lighting.speed], [100, 0]);
  assert.deepEqual([clamped.profile.screen.width, clamped.profile.screen.height], [512, 8]);
  assert.equal(validateProfile({ lighting: { color: "red" } }).ok, false);
  assert.equal(validateProfile([]).ok, false);
  assert.equal(validateProfile({ schema: 99 }).ok, false);
  const old = validateProfile({ lighting: { effect: "perkey", perKey: { k01: "#112233" }, viaEffect: 3 } });
  assert.equal(old.ok, true);
  assert.deepEqual(Object.keys(old.profile.lighting).sort(), ["brightness", "color", "speed"]);
  assert.equal(validateProfile({ lighting: { nj81: { mode: 99 } } }).profile.lighting.nj81, undefined);
});

test("a profile with the NJ81's own effect survives save and load", () => {
  const profile = defaultProfile();
  profile.name = "Night";
  profile.lighting.nj81 = { mode: 12, option: 1, rainbow: false, off: false };
  const again = parseProfile(serializeProfile(profile));
  assert.equal(again.ok, true);
  assert.deepEqual(again.profile, profile);
  assert.equal(parseProfile("{broken").ok, false);
});

test("the preview layout has unique keys that fit its width", () => {
  assert.equal(new Set(KEYS.map((key) => key.id)).size, KEYS.length);
  assert.ok(KEYS.every((key) => key.x >= 0 && key.x + key.w <= LAYOUT_WIDTH + 1e-9));
});

test("both languages have the same texts", () => {
  assert.deepEqual(textKeys("vi").sort(), textKeys("en").sort());
});
