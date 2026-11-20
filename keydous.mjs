/* What the Node server (server.mjs) and the Cloudflare Worker (worker.mjs) share: the Library's Keydous calls, the checks on
   what is sent to them, and the security headers. Web APIs only (no node: imports), so it runs in both. */

export const APP = "nj81-config";   // answered in X-App by /keydous/ping: the page (and a second npm start) know it is ours

export const SECURITY = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "Permissions-Policy": "hid=(self), camera=(), microphone=(), geolocation=()",
  "Content-Security-Policy": "default-src 'self'; img-src 'self' data: blob:; style-src 'self' https://fonts.googleapis.com; "
    + "font-src https://fonts.gstatic.com; script-src 'self'; connect-src 'self' blob:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
};

/* ---------- the Library's Keydous calls ---------- */
export const KEYDOUS = {
  "/keydous/images": { url: "https://api3.rongyuan.tech:3816/api/v2/list", fields: { page: "int", per_page: "int", company: "str", order_by_date: "bool" } },
  "/keydous/configs": { url: "https://api.rongyuan.tech:3814/v1/shared_config_list", fields: { rankType: "str", page: "int", company: "str", deviceType: "str", deviceGroup: "str" } },
};
export const FILE_URL = "https://api3.rongyuan.tech:3816/download/bit_image_file/";
export const TIMEOUT_MS = 20_000;
export const FILE_TIMEOUT_MS = 90_000;   // a big GIF (several MB) can take a while to come from Keydous

/* Only the fields the driver sends, with the right types: nothing else reaches Keydous. */
export const cleanBody = (text, fields) => {
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

/* A visitor may make this many calls a minute: lists are few; a page of pictures is 12 files, so files get more room
   (pages turned quickly must not run out and lose their pictures). */
export const PER_VISITOR = { lists: 120, files: 900, perMs: 60_000 };
export const BODY_LIMIT = 2048;   // bytes of a list call's body
export const FILE_PATH = /^\/keydous\/file\/([0-9a-f]{32})$/;   // a picture, named by its md5
// a file is named by its md5: it never changes, browsers may keep it a day
export const FILE_HEADERS = { "Content-Type": "application/octet-stream", "Cache-Control": "public, max-age=86400, immutable" };
const FILE_TRIES = 3;
const RETRY_STEP_MS = 600;
const RETRY_JITTER_MS = 400;   // spreads the retries of a page of pictures, so they do not reach Keydous all at once again

/* allowed(address, "lists" | "files"): false once the visitor has made PER_VISITOR calls of that kind this minute. */
export const rateLimit = () => {
  const visitors = new Map();   // address -> { lists, files, since }
  return (address, kind) => {
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
};

/* One picture from Keydous. It sometimes answers 400 / 5xx when asked many at once, or cuts a big GIF off: asked again
   twice, a little later each time. Only a whole file is returned (a cut-off one sent as 200 was kept by browsers for a
   day as an empty picture). get(url, timeout) makes the call; stopped() ends the tries when the visitor has gone.
   Returns { body: ArrayBuffer | null, tries: what Keydous answered each time (sent back in X-Upstream) }. */
export const fetchFile = async (md5, get, stopped = () => false) => {
  const tries = [];
  for (let attempt = 0; attempt < FILE_TRIES; attempt += 1) {
    if (attempt) { await new Promise((wake) => { setTimeout(wake, RETRY_STEP_MS * attempt + Math.random() * RETRY_JITTER_MS); }); }
    if (stopped()) { throw new DOMException("The visitor has gone", "AbortError"); }
    const reply = await get(FILE_URL + md5, FILE_TIMEOUT_MS).catch((error) => { if (stopped()) { throw error; } tries.push(error?.name ?? "error"); return null; });
    if (!reply) { continue; }
    const body = await reply.arrayBuffer().catch(() => null);
    const size = Number(reply.headers.get("content-length"));
    const whole = reply.ok && body?.byteLength > 0 && (!size || body.byteLength === size);
    tries.push(whole || !reply.ok ? reply.status : `cut:${body?.byteLength ?? 0}/${size || "?"}`);
    if (whole) { return { body, tries }; }
  }
  return { body: null, tries };
};
