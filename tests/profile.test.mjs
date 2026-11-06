import test from "node:test";
import assert from "node:assert/strict";
import { EFFECTS, defaultProfile, parseProfile, serializeProfile, validateProfile } from "../public/js/profile.js";
import { KEYS, LAYOUT_WIDTH } from "../public/js/layout.js";
import { keyColor } from "../public/js/lighting.js";
import { SimulationDriver, buildPlan, Nj81Driver, NotImplementedError } from "../public/js/drivers.js";
import { textKeys } from "../public/js/i18n.js";

test("the default profile is valid", () => {
  const result = validateProfile(defaultProfile());
  assert.equal(result.ok, true);
  assert.deepEqual(result.profile, defaultProfile());
});

test("out-of-range numbers are clamped, wrong effects and colours are errors", () => {
  const clamped = validateProfile({ lighting: { brightness: 500, speed: -3 }, screen: { width: 9999, height: 1 } });
  assert.equal(clamped.ok, true);
  assert.deepEqual([clamped.profile.lighting.brightness, clamped.profile.lighting.speed], [100, 0]);
  assert.deepEqual([clamped.profile.screen.width, clamped.profile.screen.height], [512, 8]);
  assert.equal(validateProfile({ lighting: { effect: "disco" } }).ok, false);
  assert.equal(validateProfile({ lighting: { color: "red" } }).ok, false);
  assert.equal(validateProfile({ lighting: { perKey: { k01: "nope" } } }).ok, false);
  assert.equal(validateProfile([]).ok, false);
  assert.equal(validateProfile({ schema: 99 }).ok, false);
});

test("a profile survives save and load", () => {
  const profile = defaultProfile();
  profile.name = "Night";
  profile.lighting.effect = "perkey";
  profile.lighting.perKey = { k01: "#112233" };
  const again = parseProfile(serializeProfile(profile));
  assert.equal(again.ok, true);
  assert.deepEqual(again.profile, profile);
  assert.equal(parseProfile("{broken").ok, false);
});

test("the preview layout has unique keys that fit its width", () => {
  assert.equal(new Set(KEYS.map((key) => key.id)).size, KEYS.length);
  assert.ok(KEYS.every((key) => key.x >= 0 && key.x + key.w <= LAYOUT_WIDTH + 1e-9));
});

test("every effect gives a valid colour for every key", () => {
  for (const effect of EFFECTS) {
    const profile = defaultProfile();
    profile.lighting.effect = effect;
    profile.lighting.perKey = { [KEYS[0].id]: "#ffffff" };
    for (const time of [0, 1234]) {
      for (const key of KEYS) {
        const color = keyColor(profile, key, time);
        assert.equal(color.length, 3, effect);
        assert.ok(color.every((value) => Number.isInteger(value) && value >= 0 && value <= 255), `${effect} ${key.id}`);
      }
    }
  }
  const off = defaultProfile();
  off.lighting.effect = "off";
  assert.deepEqual(keyColor(off, KEYS[0], 0), [0, 0, 0]);
});

test("the simulation driver sends nothing and reports each step", async () => {
  const lines = [];
  const result = await new SimulationDriver().apply(defaultProfile(), (line) => lines.push(line));
  assert.equal(result.sent, false);
  assert.equal(lines.length, buildPlan(defaultProfile()).length);
});

test("the real driver refuses to send while the protocol is unknown", async () => {
  await assert.rejects(() => new Nj81Driver(null).apply(defaultProfile()), NotImplementedError);
});

test("both languages have the same texts", () => {
  assert.deepEqual(textKeys("vi").sort(), textKeys("en").sort());
});
