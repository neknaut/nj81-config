/* The app on Cloudflare (Workers with static assets), free and never asleep: the same page as server.mjs, without Node.
   - public/ is served by Cloudflare itself, with the security headers of public/_headers (the Worker does not run for it).
   - /keydous/*: the Library's three Keydous calls, made from here (the Keydous servers answer a browser only at
     http://localhost:8080). Only these calls, with checked bodies, as in server.mjs: it is not an open proxy.
   Keydous uses ports 3814 and 3816: fetch() keeps them (allow_custom_ports, on by default since compatibility date
   2024-09-02). Config: wrangler.jsonc. */
import { APP, BODY_LIMIT, FILE_HEADERS, FILE_PATH, KEYDOUS, SECURITY, TIMEOUT_MS, cleanBody, fetchFile, fetchList, rateLimit } from "./keydous.mjs";

/* No limit on calls to Keydous at once (server.mjs has one): in a Worker a request may not wake another one waiting in a
   shared queue (the runtime cancels it as hung). Each call stands alone; Keydous's "busy" answers are retried. */
const upstream = (url, timeout = TIMEOUT_MS, init = {}) => fetch(url, {
  ...init, signal: AbortSignal.timeout(timeout), headers: { ...init.headers, "User-Agent": "nj81-config" },
});
const allowed = rateLimit();   // per Worker instance: a best effort

const answer = (status, body, headers = {}) => new Response(body, { status, headers: { ...SECURITY, ...headers } });
const text = (status, message) => answer(status, message, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
const json = (status, message, headers = {}) => answer(status, JSON.stringify({ code: -1, err_message: message }), { "Content-Type": "application/json", ...headers });

const file = async (md5) => {
  const { body, tries } = await fetchFile(md5, upstream);
  if (body) { return answer(200, body, { ...FILE_HEADERS, "X-Upstream": tries.join(",") }); }
  console.warn(`file ${md5}: Keydous answered ${tries.join(", ")}`);
  return answer(502, "", { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Upstream": tries.join(",") });
};

const list = async (request, call) => {
  if (Number(request.headers.get("content-length")) > BODY_LIMIT) { return json(400, "Bad request"); }
  let body;
  try { body = cleanBody(await request.text(), call.fields); } catch (error) { return json(400, "Bad request"); }
  const { reply, tries } = await fetchList(call, body, upstream);
  if (!reply) {
    console.warn(`${call.url}: Keydous answered ${tries.join(", ")}`);
    return json(502, "Keydous did not answer", { "X-Upstream": tries.join(",") });
  }
  return answer(reply.status, await reply.text(), { "Content-Type": reply.headers.get("content-type") ?? "application/json", "Cache-Control": "no-store", "X-Upstream": tries.join(",") });
};

const keydous = (request, path) => {
  if (path === "/keydous/ping") { return answer(204, null, { "Cache-Control": "no-store", "X-App": APP }); }
  const md5 = FILE_PATH.exec(path)?.[1];
  if (!allowed(request.headers.get("cf-connecting-ip") ?? "?", md5 ? "files" : "lists")) { return json(429, "Too many requests", { "Retry-After": "5" }); }
  if (md5 && request.method === "GET") { return file(md5); }
  const call = KEYDOUS[path];
  return call && request.method === "POST" ? list(request, call) : text(404, "Not found");
};

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (!path.startsWith("/keydous/")) { return env.ASSETS.fetch(request); }
    try { return await keydous(request, path); } catch (error) {
      console.error(`${path}: ${error?.name}: ${error?.message}`);
      return error?.name === "TimeoutError" ? text(504, "Keydous did not answer") : text(502, "Error");
    }
  },
};
