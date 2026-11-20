import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import worker from "../worker.mjs";
import { KEYDOUS, SECURITY } from "../keydous.mjs";

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });
const ctx = { waitUntil: () => {} };
const env = { ASSETS: { fetch: async () => new Response("asset") } };
let ip = 0;
const call = (path, init = {}) => worker.fetch(new Request(`https://nj81.example${path}`, {
  ...init, headers: { "cf-connecting-ip": `10.0.0.${(ip += 1) % 250}`, ...init.headers },
}), env, ctx);

test("public/_headers sends the same security headers as SECURITY", () => {
  const sent = Object.fromEntries(readFileSync(new URL("../public/_headers", import.meta.url), "utf8").split("\n")
    .filter((line) => line.startsWith("  ")).map((line) => { const at = line.indexOf(": "); return [line.slice(2, at), line.slice(at + 2)]; }));
  assert.deepEqual(sent, SECURITY);
});

test("ping answers 204 with X-App, so the page uses the Worker for the Library", async () => {
  const reply = await call("/keydous/ping");
  assert.equal(reply.status, 204);
  assert.equal(reply.headers.get("x-app"), "nj81-config");
  assert.equal(reply.headers.get("permissions-policy"), SECURITY["Permissions-Policy"]);
});

test("other paths go to the static assets", async () => {
  assert.equal(await (await call("/index.html")).text(), "asset");
});

test("a list call sends only the checked fields, to Keydous's own port", async () => {
  let sent;
  globalThis.fetch = async (url, init) => { sent = { url, body: JSON.parse(init.body) }; return new Response('{"code":0}', { headers: { "content-type": "application/json" } }); };
  const reply = await call("/keydous/images", { method: "POST", body: JSON.stringify({ page: 1, per_page: 12, company: "Keydous" }) });
  assert.equal(reply.status, 200);
  assert.equal(sent.url, KEYDOUS["/keydous/images"].url);
  assert.match(sent.url, /:3816\//);
  assert.deepEqual(sent.body, { page: 1, per_page: 12, company: "Keydous" });
});

test("a bad body is refused without calling Keydous", async () => {
  globalThis.fetch = async () => { throw new Error("must not be called"); };
  assert.equal((await call("/keydous/images", { method: "POST", body: JSON.stringify({ page: "1; drop" }) })).status, 400);
  assert.equal((await call("/keydous/anything", { method: "POST", body: "{}" })).status, 404);
  assert.equal((await call("/keydous/file/not-an-md5")).status, 404);
});

test("a cut-off file is asked for again and only a whole one is sent", async () => {
  const whole = new Uint8Array([1, 2, 3, 4]);
  let tries = 0;
  globalThis.fetch = async () => {
    tries += 1;
    return tries === 1
      ? new Response(whole.slice(0, 2), { headers: { "content-length": "4" } })
      : new Response(whole, { headers: { "content-length": "4" } });
  };
  const reply = await call(`/keydous/file/${"a".repeat(32)}`);
  assert.equal(reply.status, 200);
  assert.equal(tries, 2);
  assert.deepEqual(new Uint8Array(await reply.arrayBuffer()), whole);
  assert.match(reply.headers.get("cache-control"), /immutable/);
});
