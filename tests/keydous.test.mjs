import { test } from "node:test";
import assert from "node:assert/strict";
import { PER_VISITOR, fetchFile, rateLimit } from "../keydous.mjs";

test("rateLimit counts each visitor and each kind on its own", () => {
  const allowed = rateLimit();
  for (let i = 0; i < PER_VISITOR.lists; i += 1) { assert.equal(allowed("a", "lists"), true); }
  assert.equal(allowed("a", "lists"), false);
  assert.equal(allowed("a", "files"), true);
  assert.equal(allowed("b", "lists"), true);
});

test("fetchFile stops trying once the visitor has gone", async () => {
  let calls = 0;
  const get = async () => { calls += 1; return new Response("busy", { status: 500 }); };
  let gone = false;
  const stopped = () => { const was = gone; gone = true; return was; };   // gone after the first try
  await assert.rejects(fetchFile("c".repeat(32), get, stopped), { name: "AbortError" });
  assert.equal(calls, 1);
});
