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

const IMAGE_API = "https://api3.rongyuan.tech:3816/api/v2";
const IMAGE_FILE = "https://api3.rongyuan.tech:3816/download/bit_image_file/";
const CONFIG_API = "https://api.rongyuan.tech:3814/v1/shared_config_list";
const COMPANY = "Keydous";
const GROUP = "rongyuan_k_rgb";   // the NJ81-ED's group in the driver
export const MODEL = "yc500_nj81_ed";
const CACHE_KEY = "nj81-config.share.configs.v2";   // v2: keeps the per-key colours too
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
const runPreviews = (time) => {
  previewLoop = 0;
  for (const p of [...previews]) {
    if (!p.canvas.isConnected) { previews.delete(p); continue; }
    if (p.canvas.offsetParent !== null && (p.static !== true || !p.drawn)) { drawPreview(p, time); p.drawn = true; }
  }
  if (previews.size) { previewLoop = requestAnimationFrame(runPreviews); }
};
export const keyboardPreview = (light, lightPic) => {
  const canvas = document.createElement("canvas");
  canvas.className = "share-kbd";
  canvas.width = 480;
  canvas.height = Math.round((480 * LAYOUT_HEIGHT) / LAYOUT_WIDTH);
  let pic = null;
  if (light?.type === "LightUserPicture" && Array.isArray(lightPic)) {
    pic = new Map();
    for (const { hid, rgb } of lightPic) { const key = keyForHid(hid); if (key) { pic.set(key.id, hex(Number(rgb) || 0)); } }
  }
  const s = pic ? null : lightFromShared(light);
  const settings = s && !s.off ? { mode: s.mode, option: s.option, rainbow: s.rainbow, off: false, color: hex(parseInt(s.color.slice(1), 16)), level: Math.max(0.35, s.brightness / 4), speed: s.speed / 4 } : null;
  previews.add({ canvas, settings, pic, presses: [], static: !settings });
  if (!previewLoop) { previewLoop = requestAnimationFrame(runPreviews); }
  return canvas;
};

const post = async (url, body) => {
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
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
  const saved = (() => { try { return JSON.parse(localStorage.getItem(VIEW_KEY) || "{}"); } catch (error) { return {}; } })();
  const state = {
    view: saved.view === "configs" ? "configs" : "images", imgOrder: saved.imgOrder === "top" ? "top" : "new", imgPage: Math.max(1, saved.imgPage | 0 || 1), imgPages: 1,
    cfgOrder: saved.cfgOrder === "count" ? "count" : "time", cfgPage: Math.max(1, saved.cfgPage | 0 || 1), configs: null, scanning: false, urls: [],
  };
  const remember = () => { try { localStorage.setItem(VIEW_KEY, JSON.stringify({ view: state.view, imgOrder: state.imgOrder, imgPage: state.imgPage, cfgOrder: state.cfgOrder, cfgPage: state.cfgPage })); } catch (error) { /* private mode */ } };
  $("share-img-order").value = state.imgOrder;
  $("share-cfg-order").value = state.cfgOrder;

  /* ---------- pictures / GIFs ---------- */
  const fileOf = async (md5) => {
    const response = await fetch(IMAGE_FILE + md5);
    if (!response.ok) { throw new Error(`HTTP ${response.status}`); }
    return inflate(await response.arrayBuffer());
  };
  const loadImages = async () => {
    const box = $("share-images");
    $("share-img-state").textContent = t("shareLoading");
    try {
      const items = await wait(async () => {
        const answer = await post(`${IMAGE_API}/list`, { page: state.imgPage, per_page: PER_PAGE, company: COMPANY, order_by_date: state.imgOrder === "new" });
        if (answer.code !== 0) { throw new Error(answer.err_message || "error"); }
        state.imgPages = Math.max(1, Math.ceil((answer.data.totle_count || 0) / PER_PAGE));
        if (state.imgPage > state.imgPages) { state.imgPage = state.imgPages; return null; }   // a kept page that no longer exists
        // all the files of the page first: the grid then shows in one go instead of pictures popping in one by one
        return Promise.all(answer.data.data.map(async (item) => ({ item, blob: await fileOf(item.bit_image.md5).catch(() => null) })));
      });
      if (!items) { return loadImages(); }
      state.urls.forEach((u) => URL.revokeObjectURL(u));
      state.urls = [];
      box.replaceChildren(...items.map(({ item, blob }) => card(item, blob)));
      $("share-img-state").textContent = "";
    } catch (error) { $("share-img-state").textContent = `${t("shareFailed")}: ${why(error)}`; }
    $("share-img-page").textContent = `${state.imgPage} / ${state.imgPages}`;
    remember();
    $("share-img-prev").disabled = state.imgPage <= 1;
    $("share-img-next").disabled = state.imgPage >= state.imgPages;
  };
  const card = (item, blob) => {
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
    if (!blob) { shot.textContent = "✕"; return el; }
    {
      const type = image.screen_type === "GIF" ? "image/gif" : "image/png";
      const typed = blob.type === type ? blob : new Blob([blob], { type });
      const url = URL.createObjectURL(typed);
      state.urls.push(url);
      shot.append(Object.assign(document.createElement("img"), { src: url, alt: image.title || "" }));
      use.disabled = false;
      use.addEventListener("click", () => {
        const name = `${(image.title || "share").replace(/[\\/:*?"<>|]+/g, " ").trim() || "share"}.${type === "image/gif" ? "gif" : "png"}`;
        usePicture(new File([typed], name, { type }));
        logOk("areaShare", `${t("sharePictureTaken")}: ${image.title || name} (${item.user_name || "?"})`);
      });
    }
    return el;
  };

  /* ---------- NJ81-ED settings ---------- */
  const readCache = () => { try { return JSON.parse(localStorage.getItem(CACHE_KEY) || "null"); } catch (error) { return null; } };
  const keep = (configs, newest) => { try { localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), newest, configs })); } catch (error) { /* full or private */ } };
  /* One page of the list. The server answers "busy" when asked too fast: such a page is asked again, up to 4 times, a
     little later each time. */
  const pause = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
  const listPage = async (page, rankType = "time") => {
    let last = null;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      if (attempt) { await pause(1500 * attempt); }
      try {
        const answer = await post(CONFIG_API, { rankType, page, company: COMPANY, deviceType: "keyboard", deviceGroup: GROUP });
        if (answer.errCode === 0) { return answer.data; }
        last = new Error(answer.errMsg || "error");
      } catch (error) { last = error; }
    }
    throw last;
  };
  const slim = (c) => ({ id: c.id, describe: c.describe, createAt: c.createAt, updatedAt: c.updatedAt, downloadTimes: c.downloadTimes,
    name: c.config.name, user: c.config.user?.name ?? c.config.user?.nickname ?? "", light: c.config.light, value: c.config.value || [],
    lightPic: c.config.light?.type === "LightUserPicture" ? (c.config.lightPic || []).map((k) => ({ hid: k.hid, rgb: k.rgb })) : undefined });
  /* Reads the list newest first. With configs kept from before, stops at the first page that reaches them. */
  const scan = async () => {
    if (state.scanning) { return; }
    state.scanning = true;
    $("share-cfg-refresh").disabled = true;
    const cache = readCache();
    const kept = cache?.configs ?? [];
    const newest = cache?.newest ?? -1;   // the newest setting (any model) seen last time: the list is read down to it
    const known = new Set(kept.map((c) => c.id));
    const found = [];
    try {
      const first = await wait(() => listPage(1));
      const pages = Math.max(1, Math.ceil(first.configsCount / 10));
      let stop = false;
      let missed = 0;   // pages that never answered: then the list is read again from the top next time
      const take = (data) => {
        for (const c of data.configs) {
          if (known.has(c.id) || c.id <= newest) { stop = true; }
          else if (c.config?.deviceType?.name === MODEL) { found.push(slim(c)); }
        }
      };
      const merged = () => [...found, ...kept.filter((c) => !found.some((f) => f.id === c.id))].sort((a, b) => b.id - a.id);
      take(first);
      const AT_ONCE = 3;   // pages asked at the same time: more makes the server answer "busy"
      for (let page = 2; page <= pages && !stop; page += AT_ONCE) {   // what is found shows at once
        const read = () => Promise.all(Array.from({ length: Math.min(AT_ONCE, pages - page + 1) }, (_, i) => listPage(page + i).catch(() => { missed += 1; return { configs: [] }; })));
        const batch = await (state.configs?.length ? read() : wait(read));   // the loading stays until something can be shown
        const before = found.length;
        batch.forEach(take);
        $("share-cfg-state").textContent = `${t("shareScanning")} ${Math.min(pages, page + AT_ONCE - 1)}/${pages} · ${t("shareFound")} ${kept.length + found.length}`;
        if (found.length !== before) { state.configs = merged(); renderConfigs(); }
      }
      const all = merged();
      keep(all, missed ? cache?.newest ?? -1 : Math.max(...first.configs.map((c) => c.id), cache?.newest ?? 0));
      state.configs = all;
      $("share-cfg-state").textContent = `${all.length} ${t("shareConfigsOf")} NJ81-ED · ${t("shareOutOf")} ${first.configsCount}`;
    } catch (error) {
      state.configs = state.configs?.length ? state.configs : kept;
      $("share-cfg-state").textContent = `${t("shareFailed")}: ${why(error)}`;
    }
    state.scanning = false;
    $("share-cfg-refresh").disabled = false;
    renderConfigs();
  };
  const renderConfigs = () => {
    const list = [...(state.configs ?? [])];
    if (state.cfgOrder === "count") { list.sort((a, b) => (b.downloadTimes ?? 0) - (a.downloadTimes ?? 0)); }
    const pages = Math.max(1, Math.ceil(list.length / 10));
    state.cfgPage = Math.min(state.cfgPage, pages);
    $("share-cfg-page").textContent = `${state.cfgPage} / ${pages}`;
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
    const doLight = () => applyLight(light, c.name);
    const doKeys = () => applyKeys(keysOk, c.name, fnLayer);
    actions.append(
      button("shareApplyLight", Boolean(light), doLight),
      button("shareApplyKeys", keysOk.length > 0, doKeys),
      button("shareApplyBoth", Boolean(light) && keysOk.length > 0, async () => { await doLight(); await doKeys(); }),
    );
    row.append(head, keyboardPreview(c.light, c.lightPic), body, actions);
    return row;
  };

  /* ---------- wiring ---------- */
  const show = (view) => {
    state.view = view;
    remember();
    for (const b of document.querySelectorAll("[data-share-view]")) { b.setAttribute("aria-pressed", String(b.dataset.shareView === view)); }
    $("share-images-box").hidden = view !== "images";
    $("share-configs-box").hidden = view !== "configs";
    if (view === "images" && !$("share-images").childElementCount) { loadImages(); }
    if (view === "configs" && !state.configs) { state.configs = readCache()?.configs ?? null; renderConfigs(); scan(); }
  };
  for (const b of document.querySelectorAll("[data-share-view]")) { b.addEventListener("click", () => show(b.dataset.shareView)); }
  $("share-img-order").addEventListener("change", () => { state.imgOrder = $("share-img-order").value; state.imgPage = 1; loadImages(); });
  $("share-img-prev").addEventListener("click", () => { state.imgPage -= 1; loadImages(); });
  $("share-img-next").addEventListener("click", () => { state.imgPage += 1; loadImages(); });
  $("share-cfg-order").addEventListener("change", () => { state.cfgOrder = $("share-cfg-order").value; state.cfgPage = 1; renderConfigs(); });
  $("share-cfg-prev").addEventListener("click", () => { state.cfgPage -= 1; renderConfigs(); });
  $("share-cfg-next").addEventListener("click", () => { state.cfgPage += 1; renderConfigs(); });
  $("share-cfg-refresh").addEventListener("click", scan);

  /* At start (the full-screen loading waits for it): the first page of pictures, and the NJ81-ED settings (kept ones at
     once, then the list read down to them; the first time the whole list). progress(text) tells how far it is. */
  /* At start the full-screen loading waits only for the page on show: the pictures of that page, or the NJ81-ED
     settings kept from before (the first time: until the first one is found; the rest of the list is read behind). */
  const preload = async (progress = () => {}) => {
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
    rerender: () => { if (state.configs) { renderConfigs(); } },
  };
};
