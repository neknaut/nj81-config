/* The Share tab: what Keydous users share in the official driver's Share page, read from the same Keydous servers
   (read only: no account, nothing is sent to them but the list and file requests the driver makes).
   - Pictures / GIFs for the screen: every one shared (POST api3 .../list, file at .../download/bit_image_file/<md5>,
     deflate-raw of the original GIF / PNG).
   - Keyboard settings (lighting + keys): only those shared from an NJ81-ED (deviceType.name "yc500_nj81_ed"). The server
     cannot filter by model, so its list (newest first, 10 a page) is read through once and the NJ81-ED ones are kept in
     this browser; later visits only read the pages newer than the newest one kept. */

import { KEYS, LAYOUT_HEIGHT, LAYOUT_WIDTH } from "./layout.js";
import { REACTIVE_DEFAULT, nj81KeyColor } from "./lighting-nj81.js";
import { HID_KEYS } from "./keymap.js";

/* Where the Library's three calls go. Through the app's own server (server.mjs, /keydous/*) when it is there: that works
   on any address, deployed or local. Straight to the Keydous servers only at http://localhost:8080 with no such server
   (public/ served some other way), as they answer only that address. Anywhere else the tab says so and calls nothing. */
const DIRECT = {
  images: "https://api3.rongyuan.tech:3816/api/v2/list",
  file: "https://api3.rongyuan.tech:3816/download/bit_image_file/",
  configs: "https://api.rongyuan.tech:3814/v1/shared_config_list",
};
const PROXY = { images: "/keydous/images", file: "/keydous/file/", configs: "/keydous/configs" };
let API = null;   // DIRECT, PROXY or null (unreachable), set by findApi()
const findApi = async () => {
  try { if ((await fetch("/keydous/ping", { cache: "no-store" })).status === 204) { API = PROXY; return; } } catch (error) { /* no server of ours */ }
  API = globalThis.location?.origin === ALLOWED_ORIGIN ? DIRECT : null;
};
const COMPANY = "Keydous";
const GROUP = "rongyuan_k_rgb";   // the NJ81-ED's group in the driver
export const MODEL = "yc500_nj81_ed";
const CACHE_KEY = "nj81-config.share.configs.v2";
/* The only address the Keydous servers answer from a browser (their CORS rule: "Origin is not allowed" for any other). */
export const ALLOWED_ORIGIN = "http://localhost:8080";
const reachable = () => API !== null;
const PER_PAGE = 12;

/* The driver's light types and the mode numbers its encoder writes for these keyboards (rongyuan_k_rgb). */
export const LIGHT_MODE = {
  LightOff: 0, LightAlwaysOn: 1, LightBreath: 2, LightNeon: 3, LightWave: 4, LightRipple: 5, LightRaindrop: 6, LightSnake: 7,
  LightPressAction: 8, LightConverage: 9, LightSineWave: 10, LightKaleidoscope: 11, LightLineWave: 12, LightLaser: 14,
  LightCircleWave: 15, LightDazzing: 16, LightRainDown: 17, LightMeteor: 18, LightPressActionOff: 19,
};
const LIGHT_OPTIONS = { 4: ["right", "left", "down", "up"], 7: ["z", "return"], 11: ["out", "in"], 12: ["right", "left"], 15: ["anti-clockwise", "clockwise"] };
/* A shared light setting -> the page's NJ81 settings (levels 0..4), or null for one the NJ81-ED does not have. */
export const lightFromShared = (light) => {
  if (!light || !(light.type in LIGHT_MODE)) { return null; }
  const mode = LIGHT_MODE[light.type];
  const options = LIGHT_OPTIONS[mode];
  const option = options ? Math.max(0, options.indexOf(String(light.option ?? "").toLowerCase())) : 0;
  const clamp = (v) => Math.max(0, Math.min(4, Math.round(Number(v) || 0)));
  const rgb = Number(light.rgb ?? 0xffffff);
  return {
    mode, option, off: mode === 0, rainbow: Boolean(light.dazzle),
    color: `#${(rgb & 0xffffff).toString(16).padStart(6, "0")}`,
    brightness: clamp(light.value ?? 4), speed: clamp(light.speed ?? 2),
  };
};

/* The driver's key settings -> the 4 bytes the keyboard keeps (its vF), for the kinds this page can write. */
const SKEY = { none: 0, alt: 226, ctrl: 224, shift: 225, win: 227 };
const MOUSE_BYTES = { [-1000]: [1, 0, 240, 0], [-999]: [1, 0, 241, 0], [-998]: [1, 0, 242, 0], [-997]: [1, 0, 244, 0], [-996]: [1, 0, 243, 0],
  [-994]: [1, 0, 247, 0], [-993]: [1, 0, 248, 0], [-992]: [1, 0, 245, 0], [-991]: [1, 0, 246, 0], [-988]: [1, 0, 245, 1], [-987]: [1, 0, 245, 255] };
const FUNCTION_BYTES = {
  fn: [10, 1, 0, 0], 播放器: [3, 0, 131, 1], "播放/暂停": [3, 0, 205, 0], 停止: [3, 0, 183, 0], 上一曲: [3, 0, 182, 0], 下一曲: [3, 0, 181, 0],
  音量减: [3, 0, 234, 0], 音量加: [3, 0, 233, 0], 静音: [3, 0, 226, 0], 计算器: [3, 0, 146, 1], 邮件: [3, 0, 138, 1], 我的电脑: [3, 0, 148, 1],
  搜索: [3, 0, 33, 2], 主页: [3, 0, 35, 2], 亮度加: [3, 0, 111, 0], 亮度减: [3, 0, 112, 0], 刷新: [3, 0, 39, 2], 缩小: [0, 0, 227, 45],
  放大: [0, 0, 227, 46], 麦克风开关: [6, 128, 0, 0],
};
const u32 = (k) => [(k >>> 24) & 255, (k >>> 16) & 255, (k >>> 8) & 255, k & 255];   // the driver's hF: a key code above 255 is the 4 bytes
export const keyBytes = (entry) => {
  if (!entry || !(entry.original >= 0 && entry.original <= 255)) { return null; }   // Fn and other system keys are never changed here
  switch (entry.type) {
    case "combo": return entry.key <= 255 ? [0, SKEY[entry.skey] ?? 0, entry.key & 0xff, (entry.key2 ?? 0) & 0xff] : u32(entry.key);
    case "ConfigUnknown": return Array.isArray(entry.value) && entry.value.length === 4 ? entry.value.map((b) => b & 255) : null;
    case "forbidden": return [0, 0, 0, 0];
    case "ConfigMouse": return MOUSE_BYTES[entry.key] ?? null;
    case "ConfigFunction": return FUNCTION_BYTES[entry.key] ?? null;
    default: return null;   // macros (need the driver's macro library), snap keys, gamepad…
  }
};

/* A shared key list saved from the driver's Fn layer: most keys are "forbidden" there (the driver's "no feature set"). */
export const isFnLayer = (value) => value.filter((v) => v.type === "forbidden").length >= 20;

/* ---------- the keyboard picture of a shared setting ----------
   Its lighting played on a small NJ81 drawing, as the page's own preview does: the effect's animation (reactive effects get
   made-up key presses so they show), or, for a per-key drawing (the driver's LightUserPicture), each key in its colour. */
const FN_CODE = 167837696;
const keyForHid = (hid) => (hid === FN_CODE ? KEYS.find((k) => k.label === "Fn") : KEYS.find((k) => k.code === HID_KEYS.find((h) => h.hid === hid)?.code));
const hex = (rgb) => [(rgb >> 16) & 255, (rgb >> 8) & 255, rgb & 255];
const previews = new Set();
let previewLoop = 0;
let lastPreview = 0;
const PREVIEW_MS = 1000 / 30;   // 30 frames a second is plenty for a 220 px picture
/* Only pictures on screen are drawn: one observer for all of them. */
const onScreen = typeof IntersectionObserver === "function"
  ? new IntersectionObserver((entries) => { for (const e of entries) { e.target.dataset.seen = e.isIntersecting ? "1" : ""; } if (entries.some((e) => e.isIntersecting) && !previewLoop) { previewLoop = requestAnimationFrame(runPreviews); } })
  : null;
const drawPreview = (p, time) => {
  const { canvas, settings, pic, presses } = p;
  const ctx = canvas.getContext("2d");
  const unit = canvas.width / LAYOUT_WIDTH;
  ctx.fillStyle = "#0b0c10";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (settings && REACTIVE_DEFAULT.has(settings.mode) && (!presses.length || time - presses[presses.length - 1].t > 450)) {
    const k = KEYS[Math.floor(Math.random() * KEYS.length)];
    presses.push({ x: k.x + k.w / 2, y: k.y + 0.5, t: time });
    while (presses.length && time - presses[0].t > 2500) { presses.shift(); }
  }
  for (const key of KEYS) {
    const rgb = pic ? pic.get(key.id) ?? [0, 0, 0] : settings ? nj81KeyColor(settings, key, time, presses, REACTIVE_DEFAULT) : [0, 0, 0];
    const x = key.x * unit + 1.5;
    const y = key.y * unit + 1.5;
    const w = key.w * unit - 3;
    const h = unit - 3;
    ctx.fillStyle = "#1c1e24";
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, Math.max(2, unit * 0.12));
    ctx.fill();
    const [r, g, b] = rgb;
    if (r + g + b > 0) {
      ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
      ctx.globalAlpha = 0.92;
      ctx.beginPath();
      ctx.roundRect(x + 1, y + 1, w - 2, h - 2, Math.max(2, unit * 0.1));
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }
};
function runPreviews(time) {
  previewLoop = 0;
  let animating = false;
  const due = time - lastPreview >= PREVIEW_MS;
  if (due) { lastPreview = time; }
  for (const p of [...previews]) {
    if (!p.canvas.isConnected) { previews.delete(p); onScreen?.unobserve(p.canvas); continue; }
    const visible = onScreen ? p.canvas.dataset.seen === "1" : p.canvas.offsetParent !== null;
    if (!visible) { continue; }
    if (!p.static) { animating = true; }
    if ((due && !p.static) || !p.drawn) { drawPreview(p, time); p.drawn = true; }
  }
  // stops when nothing on screen moves; the observer starts it again when a picture comes into view
  if (animating || [...previews].some((p) => !p.drawn && p.canvas.dataset.seen === "1")) { previewLoop = requestAnimationFrame(runPreviews); }
}
export const keyboardPreview = (light, lightPic) => {
  const canvas = document.createElement("canvas");
  canvas.className = "share-kbd";
  const width = Math.round(220 * Math.min(2, window.devicePixelRatio || 1));   // the size it is shown at, sharp on HiDPI
  canvas.width = width;
  canvas.height = Math.round((width * LAYOUT_HEIGHT) / LAYOUT_WIDTH);
  let pic = null;
  if (light?.type === "LightUserPicture" && Array.isArray(lightPic)) {
    pic = new Map();
    for (const { hid, rgb } of lightPic) { const key = keyForHid(hid); if (key) { pic.set(key.id, hex(Number(rgb) || 0)); } }
  }
  const s = pic ? null : lightFromShared(light);
  const settings = s && !s.off ? { mode: s.mode, option: s.option, rainbow: s.rainbow, off: false, color: hex(parseInt(s.color.slice(1), 16)), level: Math.max(0.35, s.brightness / 4), speed: s.speed / 4 } : null;
  previews.add({ canvas, settings, pic, presses: [], static: !settings });
  onScreen?.observe(canvas);
  if (!previewLoop) { previewLoop = requestAnimationFrame(runPreviews); }
  return canvas;
};

/* The page numbers, as the usual pagination components lay them out (MUI's usePagination: boundaryCount 1, siblingCount 1):
   the first and last page, the current one with a neighbour on each side, "…" for the rest; a "…" that would hide one page
   shows that page instead. The count of items stays the same (7 with siblings 1) wherever the current page is, so the
   numbers and the arrows never move under the pointer. siblings 0 on a narrow screen (5 items). */
const range = (a, b) => Array.from({ length: Math.max(0, b - a + 1) }, (_, i) => a + i);
export const pageList = (current, total, siblings = 1) => {
  const boundary = 1;
  const start = range(1, Math.min(boundary, total));
  const end = range(Math.max(total - boundary + 1, boundary + 1), total);
  const from = Math.max(Math.min(current - siblings, total - boundary - siblings * 2 - 1), boundary + 2);
  const to = Math.min(Math.max(current + siblings, boundary + siblings * 2 + 2), end.length ? end[0] - 2 : total - 1);
  return [
    ...start,
    ...(from > boundary + 2 ? ["…"] : boundary + 1 < total - boundary ? [boundary + 1] : []),
    ...range(from, to),
    ...(to < total - boundary - 1 ? ["…"] : total - boundary > boundary ? [total - boundary] : []),
    ...end,
  ];
};
const narrow = () => globalThis.matchMedia?.("(max-width: 520px)").matches ?? false;
/* Fills a pager with the numbers; the current page marked (aria-current), go(page) on a click. */
const pageNumbers = (box, current, total, go, label) => {
  box.replaceChildren(...pageList(current, total, narrow() ? 0 : 1).map((p) => {
    if (p === "…") { return Object.assign(document.createElement("span"), { className: "page-gap", textContent: "…", ariaHidden: "true" }); }
    const b = Object.assign(document.createElement("button"), { type: "button", className: "small-btn page-num", textContent: String(p) });
    b.setAttribute("aria-label", `${label} ${p}`);
    if (p === current) { b.setAttribute("aria-current", "page"); }
    b.addEventListener("click", () => { if (p !== current) { go(p); } });
    return b;
  }));
};

const post = async (url, body, signal) => {
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
  if (!response.ok) { throw new Error(`HTTP ${response.status}`); }
  return response.json();
};
const inflate = async (buffer) => new Response(new Blob([buffer]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).blob();

export const initShare = (ctx) => {
  const { $, t, logOk, logWarn, logError, why, getNj, usePicture, applyLight, applyKeys, describeLight, describeKey } = ctx;
  let waiting = 0;   // API calls on the way: the panel shows a loading in its middle
  const wait = async (work) => { waiting += 1; $("share-loading").hidden = false; try { return await work(); } finally { waiting -= 1; $("share-loading").hidden = waiting > 0 ? false : true; } };
  /* Which list and page is on show is kept, so F5 comes back to it (and loads only that page). */
  const VIEW_KEY = "nj81-config.share.view";
  // kept for F5 only (sessionStorage): a page opened again starts on the first page of the pictures
  try { localStorage.removeItem(VIEW_KEY); } catch (error) { /* private mode */ }   // kept there by older versions
  const saved = (() => { try { return JSON.parse(sessionStorage.getItem(VIEW_KEY) || "{}"); } catch (error) { return {}; } })();
  const state = {
    view: saved.view === "configs" ? "configs" : "images", imgOrder: saved.imgOrder === "top" ? "top" : "new", imgPage: Math.max(1, saved.imgPage | 0 || 1), imgPages: 1,
    cfgOrder: saved.cfgOrder === "count" ? "count" : "time", cfgPage: Math.max(1, saved.cfgPage | 0 || 1), configs: null, scanning: false, urls: [],
    shown: "",   // the pictures page on show ("order:page")
    onShow: new Set(),   // the md5 of the pictures on show (their files are kept)
  };
  const aborted = (error) => error?.name === "AbortError";
  const remember = () => { try { sessionStorage.setItem(VIEW_KEY, JSON.stringify({ view: state.view, imgOrder: state.imgOrder, imgPage: state.imgPage, cfgOrder: state.cfgOrder, cfgPage: state.cfgPage })); } catch (error) { /* private mode */ } };
  /* Newest / Featured (Most downloaded) are tabs: the one on show is marked */
  const markOrder = (id, value) => {
    for (const b of $(id).querySelectorAll("[data-order]")) {
      const on = b.dataset.order === value;
      b.setAttribute("aria-selected", String(on));
      b.tabIndex = on ? 0 : -1;
    }
  };
  markOrder("share-img-order", state.imgOrder);
  markOrder("share-cfg-order", state.cfgOrder);

  /* ---------- pictures / GIFs ---------- */
  /* Files by md5 (the same picture is not fetched twice, e.g. in both orders), as blob URLs, decoded ahead so a page shows
     in one go. At most FILES kept; the oldest go first, never one of the page on show. */
  const FILES = 120;
  const files = new Map();   // md5 -> { url, type }
  const typeOf = (image) => (image.screen_type === "GIF" ? "image/gif" : "image/png");
  const fileOf = async (image, signal) => {
    const kept = files.get(image.md5);
    if (kept) { files.delete(image.md5); files.set(image.md5, kept); return kept; }   // most recent last
    // a file that fails (server busy, too many at once, network) is asked again twice, a little later each time
    let response = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (attempt) { await pause(700 * attempt, signal); }
      try { response = await fetch(API.file + image.md5, { signal }); } catch (error) { if (aborted(error)) { throw error; } response = null; }
      if (response?.ok) { break; }
    }
    if (!response?.ok) { throw new Error(`HTTP ${response?.status ?? "-"}`); }
    const blob = await inflate(await response.arrayBuffer());
    const type = typeOf(image);
    const url = URL.createObjectURL(blob.type === type ? blob : new Blob([blob], { type }));
    const pic = new Image();
    pic.src = url;
    await pic.decode().catch(() => {});   // decoded now, not when the page is shown
    const file = { url, type };
    files.set(image.md5, file);
    for (const [md5, old] of files) {
      if (files.size <= FILES) { break; }
      if (state.onShow.has(md5)) { continue; }
      URL.revokeObjectURL(old.url);
      files.delete(md5);
    }
    return file;
  };
  /* Pages of pictures, list and files together, by "order:page". The page on show is read first; then the next AHEAD
     pages are read one after the other in the background, so "next" shows at once. Anything else the user does (another
     tab, the other list, another order, an Apply button) cancels the reads still on their way. */
  const AHEAD = 3;
  const pages = new Map();   // key -> { promise, controller, done }
  const keyOf = (order, page) => `${order}:${page}`;
  const fetchPage = async (order, page, signal) => {
    const answer = await post(API.images, { page, per_page: PER_PAGE, company: COMPANY, order_by_date: order === "new" }, signal);
    if (answer.code !== 0) { throw new Error(answer.err_message || "error"); }
    const total = Math.max(1, Math.ceil((answer.data.totle_count || 0) / PER_PAGE));
    // all the files of the page first: the grid then shows in one go instead of pictures popping in one by one
    const items = await Promise.all(answer.data.data.map(async (item) => ({
      item, file: await fileOf(item.bit_image, signal).catch((error) => { if (aborted(error)) { throw error; } return null; }),
    })));
    return { total, items };
  };
  const getPage = (order, page) => {
    const key = keyOf(order, page);
    const kept = pages.get(key);
    if (kept) { return kept.promise; }
    const entry = { controller: new AbortController(), done: false };
    entry.promise = fetchPage(order, page, entry.controller.signal).then(
      (data) => {
        entry.done = true;
        // a page with a picture that could not be read is not kept: shown once, read again next time
        if (data.items.some((it) => !it.file)) { queueMicrotask(() => { if (pages.get(key) === entry) { pages.delete(key); } }); }
        return data;
      },
      (error) => { if (pages.get(key) === entry) { pages.delete(key); } throw error; },
    );
    pages.set(key, entry);
    return entry.promise;
  };
  let readAhead = 0;   // bumped to stop the reading ahead
  /* Cancels the reads on their way (all of them, or all but `keep`), and drops pages far from the one on show. */
  const cancelPictures = (keep = null) => {
    readAhead += 1;
    for (const [key, entry] of pages) {
      const [order, page] = key.split(":");
      const far = order !== state.imgOrder || Math.abs(Number(page) - state.imgPage) > AHEAD;
      if ((!entry.done && key !== keep) || (far && key !== keep)) { if (!entry.done) { entry.controller.abort(); } pages.delete(key); }
    }
  };
  const idle = (run) => new Promise((resolve) => { (window.requestIdleCallback ?? ((f) => setTimeout(f, 200)))(() => resolve(run === readAhead), { timeout: 1500 }); });
  const readNext = async () => {
    const run = ++readAhead;
    if (navigator.connection?.saveData) { return; }   // the user asked the browser to save data: only what is asked for
    for (let page = state.imgPage + 1; page <= Math.min(state.imgPages, state.imgPage + AHEAD); page += 1) {   // none on the last page
      if (!(await idle(run))) { return; }
      try { await getPage(state.imgOrder, page); } catch (error) { return; }
    }
  };
  const loadImages = async () => {
    if (!reachable()) { return; }
    const box = $("share-images");
    const key = keyOf(state.imgOrder, state.imgPage);
    cancelPictures(key);
    $("share-img-state").textContent = "";
    pagerState();   // the new page marked at once
    if (!pages.get(key)?.done) { box.classList.add("busy"); }
    try {
      const ready = pages.get(key)?.done;
      const { total, items } = await (ready ? getPage(state.imgOrder, state.imgPage) : wait(() => getPage(state.imgOrder, state.imgPage)));
      if (key !== keyOf(state.imgOrder, state.imgPage)) { return; }   // the user moved on meanwhile
      state.imgPages = total;
      if (state.imgPage > total) { state.imgPage = total; return loadImages(); }   // a kept page that no longer exists
      state.onShow = new Set(items.map(({ item }) => item.bit_image.md5));
      box.replaceChildren(...items.map(({ item, file }) => card(item, file)));
      state.shown = key;
      const bar = $("share-images-box").querySelector(".share-bar");
      if (bar && bar.getBoundingClientRect().top < 0) { bar.scrollIntoView({ block: "start", behavior: "smooth" }); }   // back to the top of the list
      readNext();
    } catch (error) {
      if (aborted(error)) { return; }
      $("share-img-state").textContent = `${t("shareFailed")}: ${why(error)}`;
    } finally { box.classList.remove("busy"); }
    remember();
    pagerState();
  };
  /* « ‹ page › »: first and previous off on the first page, next and last off on the last one. */
  function pagerState() {
    $("share-img-prev").disabled = state.imgPage <= 1;
    $("share-img-next").disabled = state.imgPage >= state.imgPages;
    pageNumbers($("share-img-page"), state.imgPage, state.imgPages, (p) => turn(0, p), t("sharePage"));
  }
  const card = (item, file) => {
    const image = item.bit_image;
    const el = document.createElement("figure");
    el.className = "share-card";
    const shot = Object.assign(document.createElement("div"), { className: "share-shot" });
    const meta = Object.assign(document.createElement("figcaption"), { className: "share-meta" });
    meta.append(
      Object.assign(document.createElement("strong"), { textContent: image.title || "—" }),
      Object.assign(document.createElement("span"), { textContent: `${item.user_name || "?"} · ${image.screen_type || ""} · ${image.width}×${image.height} · ↓${image.download_times ?? 0}` }),
    );
    const use = Object.assign(document.createElement("button"), { type: "button", className: "small-btn", textContent: t("shareUsePicture") });
    use.disabled = true;
    el.append(shot, meta, use);
    if (!file) { shot.textContent = "✕"; return el; }
    {
      const { url, type } = file;
      shot.append(Object.assign(document.createElement("img"), { src: url, alt: image.title || "", decoding: "sync" }));
      use.disabled = false;
      use.addEventListener("click", async () => {
        cancelAll();
        const typed = await (await fetch(url)).blob();
        const name = `${(image.title || "share").replace(/[\\/:*?"<>|]+/g, " ").trim() || "share"}.${type === "image/gif" ? "gif" : "png"}`;
        usePicture(new File([typed], name, { type }));
        logOk("areaShare", `${t("sharePictureTaken")}: ${image.title || name} (${item.user_name || "?"})`);
      });
    }
    return el;
  };

  /* ---------- NJ81-ED settings ---------- */
  const readCache = () => { try { return JSON.parse(localStorage.getItem(CACHE_KEY) || "null"); } catch (error) { return null; } };
  const keep = (configs, newest, resume) => { try { localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), newest, configs, resume })); } catch (error) { /* full or private */ } };
  /* One page of the list. The server answers "busy" when asked too fast: such a page is asked again, up to 4 times, a
     little later each time. */
  const pause = (ms, signal) => new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => { clearTimeout(timer); reject(new DOMException("Aborted", "AbortError")); }, { once: true });
  });
  const listPage = async (page, signal, rankType = "time") => {
    let last = null;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      if (attempt) { await pause(1500 * attempt, signal); }
      try {
        const answer = await post(API.configs, { rankType, page, company: COMPANY, deviceType: "keyboard", deviceGroup: GROUP }, signal);
        if (answer.errCode === 0) { return answer.data; }
        last = new Error(answer.errMsg || "error");
      } catch (error) { if (aborted(error)) { throw error; } last = error; }
    }
    throw last;
  };
  let scanControl = null;
  const cancelScan = () => { scanControl?.abort(); };
  const slim = (c) => ({ id: c.id, describe: c.describe, createAt: c.createAt, updatedAt: c.updatedAt, downloadTimes: c.downloadTimes,
    name: c.config.name, user: c.config.user?.name ?? c.config.user?.nickname ?? "", light: c.config.light, value: c.config.value || [],
    lightPic: c.config.light?.type === "LightUserPicture" ? (c.config.lightPic || []).map((k) => ({ hid: k.hid, rgb: k.rgb })) : undefined });
  /* Reads the list newest first, down to the newest setting seen by the last complete read. Cancelled (another tab, the
     pictures list, an Apply button), it keeps what it found and where it was, and reads on from there next time. */
  const scan = async () => {
    if (state.scanning || !reachable()) { return; }
    state.scanning = true;
    scanControl = new AbortController();
    const { signal } = scanControl;
    $("share-cfg-refresh").disabled = true;
    const cache = readCache();
    const kept = cache?.configs ?? [];
    const newest = cache?.newest ?? -1;   // the newest setting (any model) of the last complete read
    const resume = cache?.resume ?? null;   // a read cancelled half way: { page, found, top }
    const known = new Set(kept.map((c) => c.id));
    const found = [...(resume?.found ?? [])];
    let top = resume?.top ?? -1;
    let page = resume?.page ?? 2;
    const merged = () => [...found, ...kept.filter((c) => !found.some((f) => f.id === c.id))].sort((a, b) => b.id - a.id);
    try {
      const first = await wait(() => listPage(1, signal));
      const count = Math.max(1, Math.ceil(first.configsCount / 10));
      top = Math.max(top, ...first.configs.map((c) => c.id));
      let stop = false;
      let missed = 0;   // pages that never answered: then the list is read again from the top next time
      const take = (data, mayStop = true) => {
        for (const c of data.configs) {
          if (found.some((f) => f.id === c.id)) { continue; }
          if (known.has(c.id) || c.id <= newest) { if (mayStop) { stop = true; } }
          else if (c.config?.deviceType?.name === MODEL) { found.push(slim(c)); }
        }
      };
      take(first, !resume);   // read on from a cancelled read: page 1 only brings what is new since
      if (found.length) { state.configs = merged(); renderConfigs(); }
      const AT_ONCE = 3;   // pages asked at the same time: more makes the server answer "busy"
      for (; page <= count && !stop; page += AT_ONCE) {   // what is found shows at once
        const at = page;
        const read = () => Promise.all(Array.from({ length: Math.min(AT_ONCE, count - at + 1) }, (_, i) => listPage(at + i, signal)
          .catch((error) => { if (aborted(error)) { throw error; } missed += 1; return { configs: [] }; })));
        const batch = await (state.configs?.length ? read() : wait(read));   // the loading stays until something can be shown
        const before = found.length;
        batch.forEach((data) => take(data));
        $("share-cfg-state").textContent = `${t("shareScanning")} ${Math.min(count, at + AT_ONCE - 1)}/${count} · ${t("shareFound")} ${kept.length + found.length}`;
        if (found.length !== before) { state.configs = merged(); renderConfigs(); }
      }
      const all = merged();
      keep(all, missed ? newest : top);
      state.configs = all;
      $("share-cfg-state").textContent = `${all.length} ${t("shareConfigsOf")} NJ81-ED · ${t("shareOutOf")} ${first.configsCount}`;
    } catch (error) {
      if (aborted(error)) {
        keep(kept, newest, { page, found, top });   // read on from here next time
        state.configs = merged();
        $("share-cfg-state").textContent = `${t("sharePaused")} · ${t("shareFound")} ${state.configs.length}`;
      } else {
        state.configs = state.configs?.length ? state.configs : kept;
        $("share-cfg-state").textContent = `${t("shareFailed")}: ${why(error)}`;
      }
    }
    state.scanning = false;
    scanControl = null;
    $("share-cfg-refresh").disabled = false;
    renderConfigs();
  };
  const renderConfigs = () => {
    const list = [...(state.configs ?? [])];
    if (state.cfgOrder === "count") { list.sort((a, b) => (b.downloadTimes ?? 0) - (a.downloadTimes ?? 0)); }
    const pages = Math.max(1, Math.ceil(list.length / 10));
    state.cfgPage = Math.min(state.cfgPage, pages);
    pageNumbers($("share-cfg-page"), state.cfgPage, pages, (p) => { state.cfgPage = p; renderConfigs(); }, t("sharePage"));
    remember();
    $("share-cfg-prev").disabled = state.cfgPage <= 1;
    $("share-cfg-next").disabled = state.cfgPage >= pages;
    const rows = list.slice((state.cfgPage - 1) * 10, state.cfgPage * 10);
    if (!rows.length && state.configs) { $("share-configs").replaceChildren(Object.assign(document.createElement("p"), { className: "hint", textContent: t("shareNoConfigs") })); return; }
    $("share-configs").replaceChildren(...rows.map(configRow));
  };
  const configRow = (c) => {
    const row = Object.assign(document.createElement("article"), { className: "share-config" });
    const light = lightFromShared(c.light);
    const fnLayer = isFnLayer(c.value);
    const keysOk = c.value.map((v) => ({ v, bytes: keyBytes(v) })).filter((k) => k.bytes);
    const shown = keysOk.filter((k) => k.v.type !== "forbidden" || !fnLayer);   // on the Fn layer "forbidden" only means no feature
    const SHOW = 12;
    const head = Object.assign(document.createElement("div"), { className: "share-config-head" });
    head.append(Object.assign(document.createElement("strong"), { textContent: c.name || `#${c.id}` }),
      Object.assign(document.createElement("span"), { className: "hint", textContent: `↓${c.downloadTimes ?? 0} · ${new Date(c.createAt).toLocaleDateString()}` }));
    const lines = [
      `${t("lighting")}: ${light ? describeLight(light) : c.light?.type === "LightUserPicture" ? t("sharePerKey") : t("shareNoLight")}`,
      `${t("keysTab")}${fnLayer ? ` (${t("layerFn")})` : ""}: ${shown.length ? shown.slice(0, SHOW).map((k) => describeKey(k.v, k.bytes)).join(", ") + (shown.length > SHOW ? `, … (+${shown.length - SHOW})` : "") : t("shareNoKeys")}${c.value.length > keysOk.length ? ` · ${c.value.length - keysOk.length} ${t("shareSkipped")}` : ""}`,
    ];
    const body = Object.assign(document.createElement("div"), { className: "share-config-body" });
    if (c.describe?.trim()) { body.append(Object.assign(document.createElement("p"), { textContent: c.describe.trim() })); }
    body.append(...lines.map((text) => Object.assign(document.createElement("p"), { className: "hint", textContent: text })));
    const actions = Object.assign(document.createElement("div"), { className: "row" });
    const button = (label, on, run) => { const b = Object.assign(document.createElement("button"), { type: "button", className: "small-btn", textContent: t(label) }); b.disabled = !on; b.addEventListener("click", run); return b; };
    const doLight = () => { cancelAll(); return applyLight(light, c.name); };
    const doKeys = () => { cancelAll(); return applyKeys(keysOk, c.name, fnLayer); };
    actions.append(
      button("shareApplyLight", Boolean(light), doLight),
      button("shareApplyKeys", keysOk.length > 0, doKeys),
      button("shareApplyBoth", Boolean(light) && keysOk.length > 0, async () => { await doLight(); await doKeys(); }),
    );
    row.append(head, keyboardPreview(c.light, c.lightPic), body, actions);
    return row;
  };

  /* ---------- wiring ---------- */
  const cancelAll = () => { cancelPictures(); cancelScan(); };
  const show = (view) => {
    if (!reachable()) {   // only the notice: nothing to read
      for (const b of document.querySelectorAll("[data-share-view]")) { b.setAttribute("aria-pressed", String(b.dataset.shareView === view)); }
      $("share-images-box").hidden = view !== "images";
      $("share-configs-box").hidden = view !== "configs";
      return;
    }
    if (view === "images") { cancelScan(); } else { cancelPictures(); }   // the other list's reads stop
    state.view = view;
    remember();
    for (const b of document.querySelectorAll("[data-share-view]")) { b.setAttribute("aria-pressed", String(b.dataset.shareView === view)); }
    $("share-images-box").hidden = view !== "images";
    $("share-configs-box").hidden = view !== "configs";
    if (view === "images") { if (state.shown !== keyOf(state.imgOrder, state.imgPage)) { loadImages(); } else { readNext(); } }
    if (view === "configs") {
      if (!state.configs) { state.configs = readCache()?.configs ?? null; renderConfigs(); }
      if (!state.scanning && (readCache()?.resume || !readCache())) { scan(); }   // a read that was cancelled goes on
    }
  };
  for (const b of document.querySelectorAll("[data-share-view]")) { b.addEventListener("click", () => show(b.dataset.shareView)); }
  $("share-img-order").addEventListener("click", (event) => {
    const order = event.target.closest("[data-order]")?.dataset.order;
    if (!order || order === state.imgOrder) { return; }
    state.imgOrder = order;
    state.imgPage = 1;
    markOrder("share-img-order", order);
    loadImages();
  });
  const turn = (step, to = null) => {
    const page = Math.max(1, Math.min(state.imgPages, to ?? state.imgPage + step));
    if (page === state.imgPage) { return; }   // first / last page: nothing to ask the server
    state.imgPage = page;
    loadImages();
  };
  $("share-img-prev").addEventListener("click", () => turn(-1));
  $("share-img-next").addEventListener("click", () => turn(1));

  window.addEventListener("keydown", (event) => {
    if ($("tab-share").hidden || state.view !== "images" || event.altKey || event.ctrlKey || event.metaKey) { return; }
    if (event.target.closest?.("input, select, textarea")) { return; }
    if (event.key === "ArrowLeft") { event.preventDefault(); turn(-1); }
    if (event.key === "ArrowRight") { event.preventDefault(); turn(1); }
    if (event.key === "Home") { event.preventDefault(); turn(0, 1); }
    if (event.key === "End") { event.preventDefault(); turn(0, state.imgPages); }
  });
  $("share-cfg-order").addEventListener("click", (event) => {
    const order = event.target.closest("[data-order]")?.dataset.order;
    if (!order || order === state.cfgOrder) { return; }
    state.cfgOrder = order;
    state.cfgPage = 1;
    markOrder("share-cfg-order", order);
    renderConfigs();
  });
  $("share-cfg-prev").addEventListener("click", () => { if (state.cfgPage > 1) { state.cfgPage -= 1; renderConfigs(); } });
  $("share-cfg-next").addEventListener("click", () => { state.cfgPage += 1; renderConfigs(); });

  $("share-cfg-refresh").addEventListener("click", () => scan());

  /* At start (the full-screen loading waits for it): the first page of pictures, and the NJ81-ED settings (kept ones at
     once, then the list read down to them; the first time the whole list). progress(text) tells how far it is. */
  /* At start the full-screen loading waits only for the page on show: the pictures of that page, or the NJ81-ED
     settings kept from before (the first time: until the first one is found; the rest of the list is read behind). */
  /* No way to the Keydous servers (no server of ours, not at http://localhost:8080): one clear notice, no calls. */
  const showBlocked = () => {
    const note = () => Object.assign(document.createElement("p"), { className: "notice", textContent: t("shareOriginBlocked").replace("{origin}", location.origin) });
    $("share-images").replaceChildren(note());
    $("share-configs").replaceChildren(note());
    for (const b of document.querySelectorAll("#share-img-order button, #share-cfg-order button")) { b.disabled = true; }
    for (const id of ["share-img-prev", "share-img-next", "share-cfg-refresh", "share-cfg-prev", "share-cfg-next"]) { $(id).disabled = true; }
  };
  let preloading = false;
  /* Always run at start (the full-screen loading waits for it): finds the way to the Keydous servers, then the page on show. */
  const preload = async (progress = () => {}) => {
    preloading = true;
    await findApi();
    if (!reachable()) { preloading = false; showBlocked(); return; }
    try { await preloadPage(progress); } finally { preloading = false; }
  };
  const preloadPage = async (progress) => {
    progress(t("shareLoading"));
    for (const b of document.querySelectorAll("[data-share-view]")) { b.setAttribute("aria-pressed", String(b.dataset.shareView === state.view)); }
    $("share-images-box").hidden = state.view !== "images";
    $("share-configs-box").hidden = state.view !== "configs";
    if (state.view === "images") { await loadImages(); return; }
    state.configs = readCache()?.configs ?? null;
    if (state.configs) { renderConfigs(); }
    const reading = scan();
    if (state.configs?.length) { return; }
    const watch = setInterval(() => progress($("share-cfg-state").textContent), 300);
    try {
      await Promise.race([reading, new Promise((resolve) => { const check = setInterval(() => { if (state.configs?.length) { clearInterval(check); resolve(); } }, 200); })]);
    } finally { clearInterval(watch); }
  };

  return {
    preload,
    onShow: () => show(state.view),
    onHide: () => { if (!preloading) { cancelAll(); } },   // another tab: the Library stops reading (not while the page starts)
    rerender: () => { if (state.configs) { renderConfigs(); } },
  };
};
