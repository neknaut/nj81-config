/* The app on Cloudflare (Workers with static assets), free and never asleep: the same page as server.mjs, without Node.
   - public/ is served by Cloudflare itself, with the security headers of public/_headers (the Worker does not run for it).
   - /keydous/*: the Library's three Keydous calls, made from here (the Keydous servers answer a browser only at
     http://localhost:8080). Only these calls, with checked bodies, as in server.mjs: it is not an open proxy.
   Needs fetch() to custom ports (Keydous uses :3814 and :3816): on by default since compatibility date 2024-09-02
   (allow_custom_ports), for hosts that are not behind Cloudflare. Config: wrangler.jsonc. */
import { APP, FILE_TIMEOUT_MS, FILE_URL, KEYDOUS, SECURITY, TIMEOUT_MS, cleanBody } from "./keydous.mjs";

const UPSTREAM_AT_ONCE = 4;   // calls to Keydous at the same time from one Worker instance: more and it answers "busy"
/* A visitor may make this many calls a minute (a page of pictures is 12 files). Kept per Worker instance: a best effort. */
const PER_VISITOR = { lists: 120, files: 900, perMs: 60_000 };
const BODY_LIMIT = 2048;
const FILE_TRIES = 3;
const RETRY_STEP_MS = 600;

let running = 0;
const waiting = [];
const slot = () => new Promise((go) => { if (running < UPSTREAM_AT_ONCE) { running += 1; go(); } else { waiting.push(go); } });
const release = () => { const next = waiting.shift(); if (next) { next(); } else { running -= 1; } };
const upstream = async (url, init, timeout = TIMEOUT_MS) => {
  await slot();
  try { return await fetch(url, { ...init, signal: AbortSignal.timeout(timeout), headers: { ...init?.headers, "User-Agent": "nj81-config" } }); }
  finally { release(); }
};

const visitors = new Map();   // address -> { lists, files, since }
const allowed = (address, kind) => {
  const now = Date.now();
  let visitor = visitors.get(address);
  if (!visitor || now - visitor.since > PER_VISITOR.perMs) {
    visitor = { lists: 0, files: 0, since: now };
    visitors.set(address, visitor);
    for (const [key, old] of visitors) { if (now - old.since > PER_VISITOR.perMs) { visitors.delete(key); } }
  }
  visitor[kind] += 1;
  return visitor[kind] <= PER_VISITOR[kind];
};

const answer = (status, body, headers = {}) => new Response(body, { status, headers: { ...SECURITY, ...headers } });
const json = (status, message, headers = {}) => answer(status, JSON.stringify({ code: -1, err_message: message }), { "Content-Type": "application/json", ...headers });
const FILE_HEADERS = { "Content-Type": "application/octet-stream", "Cache-Control": "public, max-age=86400, immutable" };

/* A file is named by its md5 and never changes: kept in Cloudflare's cache (on a custom domain; a no-op on workers.dev)
   and by browsers for a day. Keydous sometimes answers 400 / 5xx when asked many at once, or cuts a big GIF off: asked
   again twice, a little later each time, and only a whole file is sent as one. */
const file = async (request, md5, ctx) => {
  const cache = globalThis.caches?.default;
  const key = new Request(new URL(`/keydous/file/${md5}`, request.url).toString());
  const kept = await cache?.match(key);
  if (kept) { return answer(200, kept.body, FILE_HEADERS); }
  const tries = [];   // what Keydous answered each time: sent back in X-Upstream and logged (Workers Logs)
  for (let attempt = 0; attempt < FILE_TRIES; attempt += 1) {
    if (attempt) { await new Promise((wake) => { setTimeout(wake, RETRY_STEP_MS * attempt); }); }
    const reply = await upstream(FILE_URL + md5, undefined, FILE_TIMEOUT_MS).catch((error) => { tries.push(error?.name ?? "error"); return null; });
    if (!reply) { continue; }
    const body = await reply.arrayBuffer().catch(() => null);
    const size = Number(reply.headers.get("content-length"));
    if (reply.ok && body?.byteLength && (!size || body.byteLength === size)) {
      const response = answer(200, body, { ...FILE_HEADERS, "X-Upstream": [...tries, reply.status].join(",") });
      if (cache) { ctx.waitUntil(cache.put(key, response.clone())); }
      return response;
    }
    tries.push(reply.ok ? `cut:${body?.byteLength ?? 0}/${size || "?"}` : reply.status);
  }
  console.warn(`file ${md5}: Keydous answered ${tries.join(", ")}`);
  // never Keydous's own status: a 500 here would look like the Worker failing
  return answer(502, "", { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Upstream": tries.join(",") });
};

const list = async (request, call) => {
  const text = await request.text();
  if (text.length > BODY_LIMIT) { return json(413, "Too big"); }
  let body;
  try { body = cleanBody(text, call.fields); } catch (error) { return json(400, "Bad request"); }
  const reply = await upstream(call.url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!reply.ok) { console.warn(`${call.url}: Keydous answered ${reply.status}`); }
  return answer(reply.status, await reply.text(), { "Content-Type": reply.headers.get("content-type") ?? "application/json", "Cache-Control": "no-store" });
};

const keydous = async (request, path, ctx) => {
  if (path === "/keydous/ping") { return answer(204, null, { "Cache-Control": "no-store", "X-App": APP }); }
  const md5 = /^\/keydous\/file\/([0-9a-f]{32})$/.exec(path)?.[1];
  const visitor = request.headers.get("cf-connecting-ip") ?? "?";
  if (!allowed(visitor, md5 ? "files" : "lists")) { return json(429, "Too many requests", { "Retry-After": "5" }); }
  if (md5 && request.method === "GET") { return file(request, md5, ctx); }
  const call = KEYDOUS[path];
  if (!call || request.method !== "POST") { return answer(404, "Not found", { "Content-Type": "text/plain; charset=utf-8" }); }
  return list(request, call);
};

export default {
  async fetch(request, env, ctx) {
    const path = new URL(request.url).pathname;
    if (!path.startsWith("/keydous/")) { return env.ASSETS.fetch(request); }
    try { return await keydous(request, path, ctx); } catch (error) {
      console.error(`${path}: ${error?.name}: ${error?.message}`);
      const timeout = error?.name === "TimeoutError";
      return answer(timeout ? 504 : 502, timeout ? "Keydous did not answer" : "Error", { "Content-Type": "text/plain; charset=utf-8" });
    }
  },
};
