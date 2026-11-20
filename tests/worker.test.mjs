import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import worker from "../worker.mjs";
import { KEYDOUS, SECURITY } from "../keydous.mjs";

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });
const env = { ASSETS: { fetch: async () => new Response("asset") } };
let ip = 0;
const call = (path, init = {}) => worker.fetch(new Request(`https://nj81.example${path}`, {
  ...init, headers: { "cf-connecting-ip": `10.0.0.${(ip += 1) % 250}`, ...init.headers },
}), env);

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
  assert.equal(reply.headers.get("x-upstream"), "cut:2/4,200");
});

test("when Keydous keeps failing the Worker answers 502 and says what Keydous answered", async () => {
  globalThis.fetch = async () => new Response("busy", { status: 500 });
  const warn = console.warn;
  console.warn = () => {};
  try {
    const reply = await call(`/keydous/file/${"b".repeat(32)}`);
    assert.equal(reply.status, 502);
    assert.equal(reply.headers.get("x-upstream"), "500,500,500");
  } finally { console.warn = warn; }
});

test("calls do not wait on each other (a Worker request may not wake another one)", async () => {
  let open = 0;
  let most = 0;
  globalThis.fetch = async () => {
    open += 1; most = Math.max(most, open);
    await new Promise((wake) => { setTimeout(wake, 20); });
    open -= 1;
    return new Response(new Uint8Array([1]), { headers: { "content-length": "1" } });
  };
  const replies = await Promise.all(Array.from({ length: 8 }, (unused, i) => call(`/keydous/file/${String(i).repeat(32)}`)));
  assert.ok(replies.every((reply) => reply.status === 200));
  assert.equal(most, 8);
});

test("a list call that fails the TLS handshake (525) is tried again", async () => {
  let tries = 0;
  globalThis.fetch = async () => { tries += 1; return tries === 1 ? new Response("", { status: 525 }) : new Response('{"code":0}'); };
  const reply = await call("/keydous/images", { method: "POST", body: JSON.stringify({ page: 1 }) });
  assert.equal(reply.status, 200);
  assert.equal(reply.headers.get("x-upstream"), "525,200");
});

test("a list call Keydous keeps failing answers 502, not Keydous's own status", async () => {
  globalThis.fetch = async () => new Response("", { status: 525 });
  const warn = console.warn;
  console.warn = () => {};
  try {
    const reply = await call("/keydous/configs", { method: "POST", body: JSON.stringify({ page: 1 }) });
    assert.equal(reply.status, 502);
    assert.equal(reply.headers.get("x-upstream"), "525,525,525");
  } finally { console.warn = warn; }
});

test("a 4xx from Keydous is passed on without trying again", async () => {
  let tries = 0;
  globalThis.fetch = async () => { tries += 1; return new Response('{"code":1}', { status: 400 }); };
  const reply = await call("/keydous/images", { method: "POST", body: JSON.stringify({ page: 1 }) });
  assert.equal(reply.status, 400);
  assert.equal(tries, 1);
});
