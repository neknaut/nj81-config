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
