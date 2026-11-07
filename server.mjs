/* The app's server, Node only (no dependencies): `npm start` locally, and the web service when deployed.
   - Serves public/ (WebHID needs HTTPS or localhost).
   - /keydous/*: the Library's three Keydous calls, made from here. The Keydous servers refuse any page not opened at exactly
     http://localhost:8080 (their CORS rule), so a deployed site cannot call them from the browser; the server calls them
     without a browser Origin. Only these three calls, with checked bodies: it is not an open proxy.
   - Security headers on every answer (CSP: the page talks only to its own server). */
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("./public/", import.meta.url)));
/* Nothing to configure. A host (Render, Railway, Fly, Heroku…) gives the port in PORT: then that port, on every interface,
   as its router reaches the app from outside. Run by hand (npm start): http://localhost:8080, this computer only, or the
   next free port up to 8089 when another program holds 8080 (see start below). */
const DEPLOYED = Boolean(process.env.PORT);
const PORT = Number(process.env.PORT) || 8080;
const HOST = DEPLOYED ? "0.0.0.0" : "localhost";
const APP = "nj81-config";   // answered in X-App by /keydous/ping, so a second start can tell this server is already running
const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".ico": "image/x-icon",
  ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8", ".md": "text/markdown; charset=utf-8",
};
const SECURITY = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "Permissions-Policy": "hid=(self), camera=(), microphone=(), geolocation=()",
  "Content-Security-Policy": "default-src 'self'; img-src 'self' data: blob:; style-src 'self' https://fonts.googleapis.com; "
    + "font-src https://fonts.gstatic.com; script-src 'self'; connect-src 'self' blob:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
};

/* ---------- the Library's Keydous calls ---------- */
const KEYDOUS = {
  "/keydous/images": { url: "https://api3.rongyuan.tech:3816/api/v2/list", fields: { page: "int", per_page: "int", company: "str", order_by_date: "bool" } },
  "/keydous/configs": { url: "https://api.rongyuan.tech:3814/v1/shared_config_list", fields: { rankType: "str", page: "int", company: "str", deviceType: "str", deviceGroup: "str" } },
};
const FILE_URL = "https://api3.rongyuan.tech:3816/download/bit_image_file/";
const UPSTREAM_AT_ONCE = 4;   // calls to Keydous at the same time, for every visitor together: more and it answers "busy"
/* A visitor may make this many calls a minute: lists are few; a page of pictures is 12 files, so files get more room
   (pages turned quickly must not run out and lose their pictures). */
const PER_VISITOR = { lists: 120, files: 900, perMs: 60_000 };
/* Files kept in memory (they never change: named by md5), up to FILE_CACHE_BYTES: a picture asked for again (another visitor,
   another order) does not go to Keydous again. */
const FILE_CACHE_BYTES = 40 * 1024 * 1024;
const fileCache = new Map();   // md5 -> Buffer, least recently used first
let fileCacheBytes = 0;
const cacheFile = (md5, body) => {
  fileCache.set(md5, body);
  fileCacheBytes += body.length;
  for (const [key, old] of fileCache) {
    if (fileCacheBytes <= FILE_CACHE_BYTES) { break; }
    fileCache.delete(key);
    fileCacheBytes -= old.length;
  }
};
const TIMEOUT_MS = 20_000;
const FILE_TIMEOUT_MS = 90_000;   // a big GIF (several MB) can take a while to come from Keydous

/* Calls to Keydous wait their turn here. A visitor who has gone (the browser cancelled: another page, another tab) leaves
   the line at once, and a call already running for them is stopped: the next visitor's pictures are not held up by
   pictures nobody waits for any more. */
let running = 0;
const queue = [];   // { go, gone }
const slot = (gone) => new Promise((go, fail) => {
  if (gone.aborted) { fail(gone.reason); return; }
  if (running < UPSTREAM_AT_ONCE) { running += 1; go(); return; }
  const waiting = { go, gone };
  queue.push(waiting);
  gone.addEventListener("abort", () => { const i = queue.indexOf(waiting); if (i >= 0) { queue.splice(i, 1); fail(gone.reason); } }, { once: true });
});
const release = () => { const next = queue.shift(); if (next) { next.go(); } else { running -= 1; } };

const visitors = new Map();   // address -> { count, since }
const allowed = (address, kind) => {
  const now = Date.now();
  let v = visitors.get(address);
  if (!v || now - v.since > PER_VISITOR.perMs) { v = { lists: 0, files: 0, since: now }; visitors.set(address, v); }
  v[kind] += 1;
  return v[kind] <= PER_VISITOR[kind];
};
setInterval(() => { const now = Date.now(); for (const [a, v] of visitors) { if (now - v.since > PER_VISITOR.perMs) { visitors.delete(a); } } }, PER_VISITOR.perMs).unref();

const readBody = (request, limit = 2048) => new Promise((done, fail) => {
  let size = 0;
  const parts = [];
  request.on("data", (part) => { size += part.length; if (size > limit) { fail(new Error("too big")); request.destroy(); } else { parts.push(part); } });
  request.on("end", () => done(Buffer.concat(parts).toString("utf8")));
  request.on("error", fail);
});
/* Only the fields the driver sends, with the right types: nothing else reaches Keydous. */
const cleanBody = (text, fields) => {
  const input = JSON.parse(text);
  const out = {};
  for (const [name, kind] of Object.entries(fields)) {
    const v = input[name];
    if (v === undefined) { continue; }
    if (kind === "int" && Number.isInteger(v) && v >= 0 && v <= 100_000) { out[name] = v; }
    else if (kind === "bool" && typeof v === "boolean") { out[name] = v; }
    else if (kind === "str" && typeof v === "string" && v.length <= 64) { out[name] = v; }
    else { throw new Error(`bad ${name}`); }
  }
  return out;
};
const upstream = async (url, init, gone, timeout = TIMEOUT_MS) => {
  await slot(gone);
  try { return await fetch(url, { ...init, signal: AbortSignal.any([gone, AbortSignal.timeout(timeout)]), headers: { ...init?.headers, "User-Agent": "nj81-config" } }); }
  finally { release(); }
};
const send = (response, status, body, headers = {}) => { response.writeHead(status, { ...SECURITY, ...headers }); response.end(body); };

const keydous = async (request, response, path) => {
  // behind a host's proxy (Render) the visitor's address is the first of X-Forwarded-For
  const visitor = String(request.headers["x-forwarded-for"] ?? "").split(",")[0].trim() || request.socket.remoteAddress || "?";
  if (path === "/keydous/ping") { send(response, 204, undefined, { "Cache-Control": "no-store", "X-App": APP }); return; }
  const file = /^\/keydous\/file\/([0-9a-f]{32})$/.exec(path);
  if (!allowed(visitor, file ? "files" : "lists")) { send(response, 429, JSON.stringify({ code: -1, err_message: "Too many requests" }), { "Content-Type": "application/json", "Retry-After": "5" }); return; }
  const leaving = new AbortController();   // the browser cancelled or went away before the answer
  response.on("close", () => { if (!response.writableEnded) { leaving.abort(); } });
  const gone = leaving.signal;
  // a file is named by its md5: it never changes, browsers may keep it a day
  const fileHeaders = { "Content-Type": "application/octet-stream", "Cache-Control": "public, max-age=86400, immutable" };
  if (file && request.method === "GET") {
    const kept = fileCache.get(file[1]);
    if (kept) { fileCache.delete(file[1]); fileCache.set(file[1], kept); send(response, 200, kept, fileHeaders); return; }
    // Keydous sometimes answers a file with 400 / 5xx when asked many at once, or sends a big GIF so slowly that it is cut
    // off: asked again twice, a little later each time. Only a whole file is sent as a file (and kept): a cut-off one sent
    // as 200 was kept by browsers for a day as an empty picture.
    let status = 502;
    let body = null;
    for (let attempt = 0; attempt < 3 && !body; attempt += 1) {
      if (attempt) { await new Promise((wake) => { setTimeout(wake, 600 * attempt); }); }
      if (gone.aborted) { throw gone.reason; }
      const answer = await upstream(FILE_URL + file[1], undefined, gone, FILE_TIMEOUT_MS).catch((error) => { if (gone.aborted) { throw error; } return null; });
      if (!answer) { continue; }
      status = answer.status;
      const read = await answer.arrayBuffer().then((b) => Buffer.from(b), () => null);
      const size = Number(answer.headers.get("content-length"));
      if (answer.ok && read?.length && (!size || read.length === size)) { body = read; } else if (answer.ok) { status = 502; }
    }
    if (gone.aborted) { throw gone.reason; }
    if (!body) { send(response, status, "", { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" }); return; }
    cacheFile(file[1], body);
    send(response, 200, body, fileHeaders);
    return;
  }
  const call = KEYDOUS[path];
  if (!call || request.method !== "POST") { send(response, 404, "Not found", { "Content-Type": "text/plain; charset=utf-8" }); return; }
  let body;
  try { body = cleanBody(await readBody(request), call.fields); } catch (error) { send(response, 400, JSON.stringify({ code: -1, err_message: "Bad request" }), { "Content-Type": "application/json" }); return; }
  const answer = await upstream(call.url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }, gone);
  send(response, answer.status, await answer.text(), { "Content-Type": answer.headers.get("content-type") ?? "application/json", "Cache-Control": "no-store" });
};

/* ---------- the page ---------- */
const server = createServer(async (request, response) => {
  try {
    const path = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    if (path.startsWith("/keydous/")) { await keydous(request, response, path); return; }
    let file = normalize(join(ROOT, path));
    if (file !== ROOT && !file.startsWith(ROOT + sep)) { send(response, 403, "Forbidden"); return; }   // no ../ out of public/
    if ((await stat(file).catch(() => null))?.isDirectory()) { file = join(file, "index.html"); }
    const body = await readFile(file);
    send(response, 200, request.method === "HEAD" ? undefined : body, { "Content-Type": TYPES[extname(file).toLowerCase()] ?? "application/octet-stream", "Cache-Control": "no-cache" });
  } catch (error) {
    if (response.headersSent || response.destroyed || error.name === "AbortError") { if (!response.writableEnded) { response.destroy(); } return; }
    const missing = error.code === "ENOENT";
    const timeout = error.name === "TimeoutError";
    send(response, missing ? 404 : timeout ? 504 : 502, missing ? "Not found" : timeout ? "Keydous did not answer" : "Error", { "Content-Type": "text/plain; charset=utf-8" });
  }
});

/* ---------- start ----------
   Port 8080 busy (only when no PORT was asked for):
   - by this app already running: say where it is and stop, so the page opened before (its saved profiles, pictures, the
     keyboard permission, all kept per address by the browser) is the one used, and two copies never talk to the keyboard;
   - by another program: take the next free port (up to 8089) and say that what the browser saved at :8080 is not there. */
const LAST_PORT = PORT + 9;
const listen = (port) => new Promise((done, fail) => {
  const failed = (error) => { server.off("listening", listening); fail(error); };
  const listening = () => { server.off("error", failed); done(port); };
  server.once("error", failed);
  server.once("listening", listening);
  server.listen(port, HOST);
});
const isThisApp = async (port) => {
  try {
    const answer = await fetch(`http://localhost:${port}/keydous/ping`, { signal: AbortSignal.timeout(2000) });
    return answer.status === 204 && answer.headers.get("x-app") === APP;
  } catch (error) { return false; }
};
const whoHolds = (port) => (process.platform === "win32"
  ? `  PowerShell: Get-Process -Id (Get-NetTCPConnection -LocalPort ${port} -State Listen).OwningProcess`
  : `  lsof -i :${port}`);

const start = async () => {
  for (let port = PORT; ; port += 1) {
    try {
      await listen(port);
      console.log(`NJ81 Config: http://localhost:${port}/  (open it in Chrome or Edge; Ctrl+C to stop)`);
      if (port !== PORT) {
        console.warn(`Port ${PORT} is used by another program, so this runs on ${port}.`);
        console.warn(`The browser keeps saved profiles, pictures and the keyboard permission per address: what was saved at :${PORT} is not at :${port}.`);
        console.warn(`To use :${PORT}, close that program (find it with the command below) and run npm start again.`);
        console.warn(whoHolds(PORT));
      }
      keepAlive();
      return;
    } catch (error) {
      if (error.code !== "EADDRINUSE") { throw error; }
      if (await isThisApp(port)) {
        console.log(`NJ81 Config is already running: http://localhost:${port}/  (nothing new started)`);
        process.exit(0);
      }
      if (DEPLOYED || port >= LAST_PORT) {
        console.error(`Port ${port} is already in use${DEPLOYED ? " (the port the host gave)" : ` (and ${PORT}-${LAST_PORT - 1} too)`}. Close the program using it. To see which program it is:`);
        console.error(whoHolds(port));
        process.exit(1);
      }
    }
  }
};
start().catch((error) => { console.error(error.message); process.exit(1); });

/* Keep-alive (as the slack-bot does): a free Render web service sleeps after 15 minutes without a visit, and the next visitor
   then waits ~50 s. Every 10 minutes the server visits its own public address, which Render gives in RENDER_EXTERNAL_URL.
   Elsewhere (no such variable) nothing happens. A sleeping service cannot wake itself: this keeps an awake one awake. */
function keepAlive() {
  const base = (process.env.RENDER_EXTERNAL_URL || "").replace(/\/+$/, "");
  if (!base) { return; }
  const ping = async () => {
    try {
      const answer = await fetch(`${base}/keydous/ping`, { signal: AbortSignal.timeout(30_000), headers: { "User-Agent": "nj81-config keep-alive" } });
      if (answer.status !== 204) { console.warn(`keep-alive: ${base} answered ${answer.status}`); }
    } catch (error) { console.warn(`keep-alive: ${error.message}`); }
  };
  setInterval(ping, 10 * 60_000).unref();
  console.log(`keep-alive: ${base}/keydous/ping every 10 min`);
}
