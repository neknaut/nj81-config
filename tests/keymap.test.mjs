import test from "node:test";
import assert from "node:assert/strict";
import {
  decodeAction, encodeAction, sameAction, encodeMacro, decodeMacro, macroFromRecording,
  hidForCode, MEDIA, MOUSE, MACRO_BYTES, NJ81ED_DEFAULT, NJ81ED_FN_POSITION,
} from "../public/js/keymap.js";

test("key actions round-trip through their 4 bytes", () => {
  const actions = [
    { type: "disabled" },
    { type: "key", modifier: 224, hid: 6, hid2: 0 },
    { type: "macro", mode: "times", index: 0 },
    { type: "macro", mode: "toggle", index: 3 },
    { type: "macro", mode: "hold", index: 1 },
    ...MEDIA.filter((m) => m.bytes[0] !== 0).map((m) => ({ type: "media", id: m.id })),
    ...MOUSE.map((m) => ({ type: "mouse", id: m.id })),
  ];
  for (const a of actions) { assert.ok(sameAction(decodeAction(encodeAction(a)), a), JSON.stringify(a)); }
});

test("macro action bytes match what the keyboard plays", () => {
  assert.deepEqual(encodeAction({ type: "macro", mode: "times", index: 0 }), [9, 0, 0, 0]);
  assert.deepEqual(encodeAction({ type: "macro", mode: "toggle", index: 0 }), [9, 1, 0, 0]);
  assert.deepEqual(encodeAction({ type: "macro", mode: "hold", index: 2 }), [9, 2, 2, 0]);
  assert.deepEqual(encodeAction({ type: "mouse", id: "left" }), [1, 0, 240, 0]);
  assert.equal(decodeAction([10, 1, 0, 0]).type, "media");
  assert.equal(decodeAction([7, 3, 0, 0]).type, "raw");
});

test("macros round-trip, with inline and long delays", () => {
  const h = hidForCode("KeyH"), i = hidForCode("KeyI");
  const events = [
    { type: "key", hid: h, down: true }, { type: "delay", ms: 61 },
    { type: "key", hid: h, down: false }, { type: "delay", ms: 300 },
    { type: "key", hid: i, down: true },
    { type: "key", hid: i, down: false },
  ];
  const bytes = encodeMacro(events, 3);
  assert.equal(bytes.length, MACRO_BYTES);
  assert.deepEqual([...bytes.subarray(0, 4)], [3, 0, h, 0x80 | 61]);
  assert.deepEqual(decodeMacro(bytes), { repeat: 3, events });
});

test("an over-long macro is refused", () => {
  const events = Array.from({ length: 200 }, (_, n) => ({ type: "key", hid: 4, down: n % 2 === 0 }));
  assert.throws(() => encodeMacro(events));
});

test("recordings become key events with the time between them", () => {
  const events = macroFromRecording([
    { code: "KeyA", down: true, t: 0 }, { code: "KeyA", down: false, t: 80.4 }, { code: "NoSuchKey", down: true, t: 90 },
  ]);
  assert.deepEqual(events, [
    { type: "key", hid: hidForCode("KeyA"), down: true }, { type: "delay", ms: 80 },
    { type: "key", hid: hidForCode("KeyA"), down: false }, { type: "delay", ms: 10 },
  ]);
});

test("NJ81-ED default matrix", () => {
  assert.equal(NJ81ED_DEFAULT.length, 128);
  assert.equal(NJ81ED_DEFAULT[78], 69);   // F12
  assert.equal(NJ81ED_DEFAULT[NJ81ED_FN_POSITION], 0);
});
