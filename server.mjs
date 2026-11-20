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
import { brotliCompressSync, gzipSync, constants as zlib } from "node:zlib";
import { APP, BODY_LIMIT, FILE_HEADERS, FILE_PATH, KEYDOUS, SECURITY, TIMEOUT_MS, cleanBody, fetchFile, rateLimit } from "./keydous.mjs";

const ROOT = resolve(fileURLToPath(new URL("./public/", import.meta.url)));
/* Nothing to configure. A Node host (Railway, Fly, Heroku…) gives the port in PORT: then that port, on every interface,
   as its router reaches the app from outside. Run by hand (npm start): http://localhost:8080, this computer only, or the
   next free port up to 8089 when another program holds 8080 (see start below). */
const DEPLOYED = Boolean(process.env.PORT);
const PORT = Number(process.env.PORT) || 8080;
const HOST = DEPLOYED ? "0.0.0.0" : "localhost";
const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".ico": "image/x-icon", ".xml": "application/xml; charset=utf-8",
  ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8", ".md": "text/markdown; charset=utf-8",
};

/* ---------- the Library's Keydous calls ---------- */
const UPSTREAM_AT_ONCE = 4;   // calls to Keydous at the same time, for every visitor together: more and it answers "busy"
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

const allowed = rateLimit();

const readBody = (request, limit = BODY_LIMIT) => new Promise((done, fail) => {
  let size = 0;
  const parts = [];
  request.on("data", (part) => { size += part.length; if (size > limit) { fail(new Error("too big")); request.destroy(); } else { parts.push(part); } });
  request.on("end", () => done(Buffer.concat(parts).toString("utf8")));
  request.on("error", fail);
});
const upstream = async (url, gone, timeout = TIMEOUT_MS, init = {}) => {
  await slot(gone);
  try { return await fetch(url, { ...init, signal: AbortSignal.any([gone, AbortSignal.timeout(timeout)]), headers: { ...init.headers, "User-Agent": "nj81-config" } }); }
  finally { release(); }
};
const send = (response, status, body, headers = {}) => { response.writeHead(status, { ...SECURITY, ...headers }); response.end(body); };

const keydous = async (request, response, path) => {
  // behind a host's proxy the visitor's address is the first of X-Forwarded-For
  const visitor = String(request.headers["x-forwarded-for"] ?? "").split(",")[0].trim() || request.socket.remoteAddress || "?";
  if (path === "/keydous/ping") { send(response, 204, undefined, { "Cache-Control": "no-store", "X-App": APP }); return; }
  const file = FILE_PATH.exec(path);
  if (!allowed(visitor, file ? "files" : "lists")) { send(response, 429, JSON.stringify({ code: -1, err_message: "Too many requests" }), { "Content-Type": "application/json", "Retry-After": "5" }); return; }
  const leaving = new AbortController();   // the browser cancelled or went away before the answer
  response.on("close", () => { if (!response.writableEnded) { leaving.abort(); } });
  const gone = leaving.signal;
  if (file && request.method === "GET") {
    const md5 = file[1];
    const kept = fileCache.get(md5);
    if (kept) { fileCache.delete(md5); fileCache.set(md5, kept); send(response, 200, kept, FILE_HEADERS); return; }
    const { body, tries } = await fetchFile(md5, (url, timeout) => upstream(url, gone, timeout), () => gone.aborted);
    if (!body) { send(response, 502, "", { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Upstream": tries.join(",") }); return; }
    const whole = Buffer.from(body);
    cacheFile(md5, whole);
    send(response, 200, whole, { ...FILE_HEADERS, "X-Upstream": tries.join(",") });
    return;
  }
  const call = KEYDOUS[path];
  if (!call || request.method !== "POST") { send(response, 404, "Not found", { "Content-Type": "text/plain; charset=utf-8" }); return; }
  let body;
  try { body = cleanBody(await readBody(request), call.fields); } catch (error) { send(response, 400, JSON.stringify({ code: -1, err_message: "Bad request" }), { "Content-Type": "application/json" }); return; }
  const answer = await upstream(call.url, gone, TIMEOUT_MS, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  send(response, answer.status, await answer.text(), { "Content-Type": answer.headers.get("content-type") ?? "application/json", "Cache-Control": "no-store" });
};

/* ---------- the page ---------- */
/* Text files go out compressed (brotli, else gzip): a third of the size or less. Each is compressed once per version
   (its ETag) and kept; the public/ folder is small. */
const COMPRESS = /\.(html|css|js|mjs|json|svg|xml|txt)$/i;
const packedFiles = new Map();
const packed = async (file, tag, accept = "") => {
  if (!COMPRESS.test(file)) { return { body: await readFile(file) }; }
  let entry = packedFiles.get(file);
  if (entry?.tag !== tag) {
    const raw = await readFile(file);
    entry = {
      tag,
      raw,
      br: brotliCompressSync(raw, { params: { [zlib.BROTLI_PARAM_QUALITY]: 11, [zlib.BROTLI_PARAM_SIZE_HINT]: raw.length } }),
      gzip: gzipSync(raw, { level: 9 }),
    };
    packedFiles.set(file, entry);
  }
  if (/\bbr\b/.test(accept)) { return { body: entry.br, encoding: "br" }; }
  if (/\bgzip\b/.test(accept)) { return { body: entry.gzip, encoding: "gzip" }; }
  return { body: entry.raw };
};

const server = createServer(async (request, response) => {
  try {
    const path = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    if (path.startsWith("/keydous/")) { await keydous(request, response, path); return; }
    if (path === "/_headers") { send(response, 404, "Not found", { "Content-Type": "text/plain; charset=utf-8" }); return; }   // Cloudflare's config
    let file = normalize(join(ROOT, path));
    if (file !== ROOT && !file.startsWith(ROOT + sep)) { send(response, 403, "Forbidden"); return; }   // no ../ out of public/
    let info = await stat(file).catch(() => null);
    if (info?.isDirectory()) { file = join(file, "index.html"); info = await stat(file); }
    if (!info) { await readFile(file); }   // throws ENOENT: a 404
    // "no-cache" = ask every time; the ETag lets the browser keep its copy (304, no body) until the file changes
    const tag = `"${info.size.toString(36)}-${Math.floor(info.mtimeMs).toString(36)}"`;
    const headers = { "Content-Type": TYPES[extname(file).toLowerCase()] ?? "application/octet-stream", "Cache-Control": "no-cache", ETag: tag };
    if (request.headers["if-none-match"]?.split(/,\s*/).includes(tag)) { send(response, 304, undefined, headers); return; }
    const { body, encoding } = await packed(file, tag, request.headers["accept-encoding"]);
    if (encoding) { headers["Content-Encoding"] = encoding; }
    if (COMPRESS.test(file)) { headers.Vary = "Accept-Encoding"; }
    send(response, 200, request.method === "HEAD" ? undefined : body, headers);
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
