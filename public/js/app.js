/* Wires the page together: connection, lighting preview, screen, profiles, log. */
import { defaultProfile, parseProfile, serializeProfile, validateProfile } from "./profile.js";
import { KEYS, LAYOUT_HEIGHT, LAYOUT_WIDTH, SCREEN_TILE } from "./layout.js";
import { HidSession, hex4, hidSupported } from "./hid.js";
import { LEVELS, MODES, OFF, PRESET_COLOURS, ROYUAN, Royuan, isOff, isWritable, modeInfo, pictureBytes } from "./royuan.js";
import { hexToRgb, rgbToHex } from "./util.js";
import { GALLERY, LINKS } from "./gallery.js";
import { REACTIVE_DEFAULT, nj81KeyColor } from "./lighting-nj81.js";
import { languages, setLanguage, t } from "./i18n.js";

const $ = (id) => document.getElementById(id);
const STORAGE_KEY = "nj81-config.profiles";
const FRAME_MS = 50;

let profile = defaultProfile();
const session = new HidSession();
const keyEls = new Map();
let screenPixels = null;
let nj = null;           // { client, model, deviceId, firmware } once a Keydous NJ81 (vendor protocol) answered

/* Speed has 5 steps (0-4). Brightness has 5 on most boards; when the board reports a higher level (changed with its own
   keys), the top is raised for that model. The sliders keep 0-100 and snap to the steps. */
let brightnessTop = LEVELS;
const toLevel = (percent, top = LEVELS) => Math.round((percent / 100) * top);
const fromLevel = (value, top = LEVELS) => Math.round((value / top) * 100);
const njSettings = () => ({
  mode: profile.lighting.nj81?.mode ?? 1,
  option: profile.lighting.nj81?.option ?? 0,
  rainbow: profile.lighting.nj81?.rainbow ?? false,
  speed: toLevel(profile.lighting.speed),
  brightness: toLevel(profile.lighting.brightness, brightnessTop),
  off: profile.lighting.nj81?.off ?? false,   // the client turns this into brightness 0 (gen2) or the backlight-off bit (yc500)
  color: profile.lighting.color,
});
let clockOffsetMs = 0;   // standard time minus this computer's clock
const standardNow = () => new Date(Date.now() + clockOffsetMs);

/* ---------- log ----------
   Each line says what part it is about; its dot says whether it worked: green done and checked on the keyboard, orange sent
   but the keyboard reports something else, red failed, blue changed on the keyboard itself, grey information. */
const log = (message, level = "info", area = "") => {
  const box = $("log");
  const line = document.createElement("div");
  line.className = `log-line log-${level}`;
  line.textContent = `${new Date().toLocaleTimeString()}  ${area ? `${t(area)}: ` : ""}${message}`;
  box.appendChild(line);
  while (box.childElementCount > 400) { box.firstElementChild.remove(); }
  box.scrollTop = box.scrollHeight;
  const mini = $("mini-log");   // the last five lines, next to the lighting controls
  if (mini) {
    mini.appendChild(line.cloneNode(true));
    while (mini.childElementCount > 5) { mini.firstElementChild.remove(); }
  }
};
const logOk = (area, message) => log(message, "ok", area);
const logWarn = (area, message) => log(message, "warn", area);
const logError = (area, message) => log(message, "error", area);

/* ---------- saved profiles (this browser only) ---------- */
const readSaved = () => {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"); } catch (error) { return {}; }
};
const writeSaved = (all) => { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(all)); } catch (error) { log(String(error)); } };

const refreshSavedList = () => {
  const names = Object.keys(readSaved()).sort();
  $("saved-list").replaceChildren(...names.map((name) => new Option(name, name)));
  $("load-local").disabled = names.length === 0;
};

/* ---------- reading the form into the profile, and the profile into the form ---------- */
const readForm = () => {
  const next = validateProfile({
    ...profile,
    name: $("profile-name").value,
    lighting: {
      ...profile.lighting, color: $("color").value, brightness: $("brightness").value, speed: $("speed").value,
      ...(nj ? (() => {
        const chosen = Number($("effect").value);
        const off = chosen === OFF || Number($("brightness").value) === 0;
        const nj81 = chosen === OFF
          ? { ...(profile.lighting.nj81 ?? { mode: 1, option: 0, rainbow: false }), off: true }
          : { mode: chosen, option: Number($("light-option").value || 0), rainbow: $("rainbow").checked, off };
        return { nj81 };
      })() : {}),
    },
    screen: profile.screen,
  }).profile;
  profile = next;
};

const writeForm = () => {
  $("profile-name").value = profile.name;
  if (nj) { $("effect").value = String(profile.lighting.nj81?.off ? OFF : profile.lighting.nj81?.mode ?? 1); }
  refreshOptionControl();
  const option = String(profile.lighting.nj81?.option ?? 0);
  if ([...$("light-option").options].some((o) => o.value === option)) { $("light-option").value = option; }
  $("rainbow").checked = profile.lighting.nj81?.rainbow ?? false;
  $("color").value = profile.lighting.color;
  $("brightness").value = profile.lighting.brightness;
  $("speed").value = profile.lighting.speed;
  renderControls();
  drawScreen();
};

/* ---------- the visible controls (option A): effect list, direction chips, swatches, 0..4 steps ----------
   The <select>/<input range> elements stay the single source of truth; these buttons set them and fire their events. */
const fire = (el) => { el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); };
const button = (label, pressed, onClick, extra = {}) => {
  const b = Object.assign(document.createElement("button"), { type: "button", ...extra });
  if (typeof label === "string") { b.textContent = label; } else { b.append(...label); }
  b.setAttribute("aria-pressed", String(pressed));
  b.addEventListener("click", onClick);
  return b;
};
const renderEffectList = () => {
  const select = $("effect");
  const reactive = nj ? reactiveModes() : new Set();
  $("effect-list").replaceChildren(...[...select.options].map((option) => {
    const parts = [Object.assign(document.createElement("span"), { textContent: option.textContent })];
    if (nj && reactive.has(Number(option.value))) { parts.push(Object.assign(document.createElement("span"), { className: "tag", textContent: t("typeTag") })); }
    return button(parts, option.value === select.value, () => { select.value = option.value; fire(select); });
  }));
  const count = nj ? select.options.length - 1 : 0;
  $("effect-count").textContent = nj ? `· ${count} ${t("modesOf")} ${nj.model.name}` : "";
};
const renderSteps = (id, top) => {
  const range = $(id);
  const level = toLevel(Number(range.value), top);
  const box = $(`${id}-steps`);
  box.style.setProperty("--n", String(top + 1));
  box.replaceChildren(...Array.from({ length: top + 1 }, (_, n) =>
    button(String(n), n === level, () => { range.value = String(fromLevel(n, top)); fire(range); }, { ariaLabel: `${t(id)} ${n}` })));
  $(`${id}-out`).textContent = `${level}/${top}`;
};
const renderControls = () => {
  if (!$("effect-list")) { return; }
  renderEffectList();
  const dirs = $("light-option");
  $("dir-chips").replaceChildren(...[...dirs.options].map((option) =>
    button(option.textContent, option.value === dirs.value, () => { dirs.value = option.value; fire(dirs); })));
  const colour = $("color").value.toLowerCase();
  $("color-hex").textContent = colour;
  for (const swatch of $("swatches").querySelectorAll("button.swatch")) { swatch.setAttribute("aria-pressed", String(swatch.title === colour)); }
  renderSteps("brightness", nj ? brightnessTop : LEVELS);
  renderSteps("speed", LEVELS);
};

/* Direction choices and the rainbow switch only exist for the NJ81's own effects. */
/* Only the settings the chosen effect has are shown: no colour for Spectrum, no speed for Static, nothing but the
   menu for "Lights off", no single colour while rainbow is on. */
const refreshOptionControl = () => {
  const info = nj ? modeInfo(Number($("effect").value)) : null;
  const off = Boolean(nj) && Number($("effect").value) === OFF;
  $("speed-box").hidden = off || Boolean(info?.noSpeed);
  $("brightness-box").hidden = off;
  $("color-box").hidden = off || Boolean(info?.noColor) || (Boolean(info) && $("rainbow").checked);
  $("mode-tools").hidden = !nj;
  $("hide-mode").hidden = !info;
  $("show-modes").hidden = !nj || (hiddenModes().size === 0 && !board().done);
  $("rename-mode").hidden = !nj || off;
  const mode = Number($("effect").value);
  $("reactive-box").hidden = !nj || off || !info;
  if (nj && info) { $("reactive").checked = reactiveModes().has(mode); }
  $("reactive-hint").hidden = $("reactive-box").hidden || !$("reactive").checked;
  const options = info?.options ?? [];
  const keep = $("light-option").value;
  $("light-option").replaceChildren(...options.map((name, i) => new Option(name, String(i))));
  if (options.length) { $("light-option").value = keep !== "" && options[Number(keep)] ? keep : "0"; }
  $("light-option-box").hidden = options.length === 0;
  $("rainbow-box").hidden = !nj || !info || Boolean(info.noColor) || off;
  queueMicrotask(renderControls);
  $("speed").step = nj ? String(100 / LEVELS) : "1";
  $("brightness").step = nj ? String(100 / brightnessTop) : "1";
};

const onFormChange = (event) => {
  if (event?.target?.id === "rainbow") { refreshOptionControl(); }
  if (event?.target?.id === "effect") {
    refreshOptionControl();
    // leaving "off": light the keyboard back up instead of sending the new effect at brightness 0
    if (nj && Number($("effect").value) !== OFF && Number($("brightness").value) === 0) { $("brightness").value = 100; }
  }
  readForm();
  if (nj && profile.lighting.nj81?.off && Number($("effect").value) !== OFF) { $("effect").value = String(OFF); refreshOptionControl(); }
  renderControls();
  drawScreen();
};

/* ---------- keyboard preview ---------- */
/* Keycap colours: white like the user's NJ81 (light shows as a soft glow around the caps, accent caps dark as on the
   real board), or black (the whole cap shows the light). Remembered in this browser. */
const ACCENT_KEYS = new Set(["Esc", "Enter", "Up", "Down", "Left", "Right"]);
const CAPS_KEY = "nj81-config.caps";
const applyCaps = (caps) => {
  $("keyboard").classList.toggle("caps-white", caps === "white");
  $("keyboard").classList.toggle("caps-black", caps !== "white");
  $("caps").value = caps;
  try { localStorage.setItem(CAPS_KEY, caps); } catch (error) { /* private mode */ }
};

const buildKeyboard = () => {
  const box = $("keyboard");
  const surface = document.createElement("div");
  surface.className = "keys";
  surface.style.aspectRatio = `${LAYOUT_WIDTH} / ${LAYOUT_HEIGHT}`;
  for (const key of KEYS) {
    const el = document.createElement("button");
    el.type = "button";
    el.tabIndex = -1;   // clicking a key must not focus it (a focused key shows a ring when the keyboard is used)
    el.addEventListener("mousedown", (event) => event.preventDefault());
    el.className = ACCENT_KEYS.has(key.label) ? "key accent" : "key";   // dark caps on the real white NJ81
    const top = Object.assign(document.createElement("span"), { className: "cap-top", textContent: key.label });   // the cap's top face
    // the sides are the same width on every key, so a long key (Space, Shift, Enter...) has a long top face, not a centred 1u one
    top.style.left = top.style.right = `${13 / key.w}%`;
    el.replaceChildren(top);
    el.title = key.label;
    el.style.left = `${(key.x / LAYOUT_WIDTH) * 100}%`;
    el.style.top = `${(key.y / LAYOUT_HEIGHT) * 100}%`;
    el.style.width = `calc(${(key.w / LAYOUT_WIDTH) * 100}% - 3px)`;
    el.style.height = `calc(${100 / LAYOUT_HEIGHT}% - 3px)`;
    el.addEventListener("click", () => onKeyClick(key));
    surface.appendChild(el);
    keyEls.set(key.id, el);
  }
  const tile = document.createElement("canvas");   // the NJ81's screen, showing the picture from the Screen card
  tile.id = "screen-tile";
  tile.className = "screen-tile";
  tile.title = t("screenTile");
  Object.assign(tile.style, {
    left: `${(SCREEN_TILE.x / LAYOUT_WIDTH) * 100}%`, top: `${(SCREEN_TILE.y / LAYOUT_HEIGHT) * 100}%`,
    width: `calc(${(SCREEN_TILE.w / LAYOUT_WIDTH) * 100}% - 3px)`, height: `calc(${(SCREEN_TILE.h / LAYOUT_HEIGHT) * 100}% - 3px)`,
  });
  surface.appendChild(tile);
  box.replaceChildren(surface);
};

const onKeyClick = (key) => notePress(key);   // a click counts as a key press for the effects that react to typing

/* Recent key presses (real keyboard or clicks), for the effects that react to typing. */
const presses = [];
const notePress = (key) => {
  presses.push({ x: key.x + key.w / 2, y: key.y + 0.5, t: performance.now() });
  while (presses.length && performance.now() - presses[0].t > 2500) { presses.shift(); }
};

/* The drawing plays the connected NJ81's own effect (dark when nothing is connected). */
const nj81Preview = () => {
  const l = profile.lighting;
  if (!nj || !l.nj81) { return null; }
  return { mode: l.nj81.mode, option: l.nj81.option, rainbow: l.nj81.rainbow, off: l.nj81.off, color: hexToRgb(l.color), level: l.brightness / 100, speed: l.speed / 100 };
};

const paintKeyboard = (time) => {
  const nj81 = nj81Preview();
  const reactive = nj81 ? reactiveModes() : null;
  for (const key of KEYS) {
    const [red, green, blue] = nj81 ? nj81KeyColor(nj81, key, time, presses, reactive) : [0, 0, 0];
    const el = keyEls.get(key.id);
    el.style.setProperty("--led", rgbToHex(red, green, blue));   // the CSS of the chosen keycap colour decides how it shows
  }
};

let lastFrame = 0;
const frame = (time) => {
  if (time - lastFrame >= FRAME_MS) { lastFrame = time; paintKeyboard(time); }
  requestAnimationFrame(frame);
};

/* ---------- screen ---------- */
const drawScreen = () => {
  const canvas = $("screen-canvas");
  const { width, height } = profile.screen;
  if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.fillStyle = "#000";
  context.fillRect(0, 0, width, height);
  if (screenPixels) {
    const fit = $("screen-fit").value === "contain" ? Math.min : Math.max;   // contain: whole picture; cover: fill and crop, like the official driver
    const scale = fit(width / screenPixels.width, height / screenPixels.height);
    const w = screenPixels.width * scale;
    const h = screenPixels.height * scale;
    context.drawImage(screenPixels, (width - w) / 2, (height - h) / 2, w, h);
  } else {
    context.fillStyle = "#8fd3ff";
    context.font = `bold ${Math.round(height / 3)}px system-ui, sans-serif`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText("NJ81", width / 2, height / 2);
  }
  const mini = $("mini-screen");
  if (mini) { mini.width = width; mini.height = height; mini.getContext("2d").drawImage(canvas, 0, 0); }
  const tile = $("screen-tile");
  if (tile) {
    tile.width = width;
    tile.height = height;
    tile.getContext("2d").drawImage(canvas, 0, 0);
  }
};

/* ---------- GIFs: every frame is decoded and played in the preview; the frame on show is the one sent ---------- */
const GIF_MAX_FRAMES = 150;
let gif = null;   // { frames: [{ bitmap, ms }], index, timer, playing }

const decodeAnimation = async (file) => {
  if (!("ImageDecoder" in window)) { return null; }   // older browsers: first frame only
  const decoder = new ImageDecoder({ data: await file.arrayBuffer(), type: file.type });
  await decoder.tracks.ready;
  const count = Math.min(decoder.tracks.selectedTrack.frameCount, GIF_MAX_FRAMES);
  if (count < 2) { decoder.close(); return null; }
  const frames = [];
  for (let frameIndex = 0; frameIndex < count; frameIndex += 1) {
    const { image } = await decoder.decode({ frameIndex });
    frames.push({ bitmap: await createImageBitmap(image), ms: Math.max(20, (image.duration ?? 100000) / 1000) });
    image.close();
  }
  decoder.close();
  return frames;
};

const showGifFrame = (index) => {
  gif.index = index;
  screenPixels = gif.frames[index].bitmap;
  $("gif-frame").value = String(index);
  $("gif-frame-out").textContent = `${index + 1}/${gif.frames.length}`;
  drawScreen();
};
const playGif = (on) => {
  if (!gif) { return; }
  clearTimeout(gif.timer);
  gif.playing = on;
  $("gif-play").textContent = t(on ? "gifPause" : "gifPlay");
  const step = () => { showGifFrame((gif.index + 1) % gif.frames.length); gif.timer = setTimeout(step, gif.frames[gif.index].ms); };
  if (on) { gif.timer = setTimeout(step, gif.frames[gif.index].ms); }
};
const stopGif = () => {
  if (gif) { clearTimeout(gif.timer); }
  gif = null;
  $("gif-controls").hidden = true;
};

const setScreenSource = (source, name) => {
  screenPixels = source;
  profile.screen.name = name;
  $("screen-name").textContent = `${name} · ${source.width}×${source.height} → ${profile.screen.width}×${profile.screen.height}`;
  drawScreen();
};

const onScreenFile = async (event) => {
  const [file] = event.target.files;
  if (!file) { return; }
  stopGif();
  try {
    const frames = file.type === "image/gif" || file.type === "image/webp" || file.type === "image/png" ? await decodeAnimation(file).catch(() => null) : null;
    if (frames) {
      gif = { frames, index: 0, timer: null, playing: false };
      $("gif-frame").max = String(frames.length - 1);
      $("gif-controls").hidden = false;
      setScreenSource(frames[0].bitmap, file.name);
      showGifFrame(0);
      playGif(true);
      log(`${file.name} (GIF, ${frames.length} ${t("gifFrames")})`, "info", "areaScreen");
    } else {
      setScreenSource(await createImageBitmap(file), file.name);
      log(`${file.name} (${screenPixels.width}×${screenPixels.height})`, "info", "areaScreen");
    }
  } catch (error) { logError("areaScreen", `${t("importFailed")}: ${error.message}`); }
  event.target.value = "";
};

/* ---------- built-in pictures ---------- */
const buildGallery = () => {
  const items = GALLERY.map((item) => {
    const canvas = document.createElement("canvas");
    canvas.width = 160;
    canvas.height = 80;
    item.draw(canvas.getContext("2d"), 160, 80);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "thumb";
    button.title = item.name;
    button.append(canvas, Object.assign(document.createElement("span"), { textContent: item.name }));
    button.addEventListener("click", () => { stopGif(); setScreenSource(canvas, item.name); });
    return button;
  });
  $("gallery").replaceChildren(...items);
  $("gallery-links").replaceChildren(...LINKS.map((link) => {
    const li = document.createElement("li");
    li.append(Object.assign(document.createElement("a"), { href: link.url, textContent: link.name, target: "_blank", rel: "noopener noreferrer" }));
    return li;
  }));
};

/* With a NJ81 connected the screen is fixed at its real size and pictures can be sent into one of its slots. */
const updateScreenControls = () => {
  const screen = nj?.model?.screen;
  $("screen-device").hidden = !nj?.display;
  $("screen-connect-note").hidden = Boolean(nj?.display);
  $("screen-device-note").hidden = !screen;
  for (const id of ["screen-slot-box", "screen-send"]) { $(id).hidden = !screen; }
  $("screen-size-note").hidden = Boolean(screen);
  if (screen) { $("screen-slot").replaceChildren(...Array.from({ length: screen.slots }, (_, i) => new Option(String(i + 1), String(i)))); }
};

const sendPicture = async () => {
  if (!nj?.model?.screen) { logWarn("areaScreen", t("screenNeedsKeyboard")); return; }
  const { width, height } = nj.model.screen;
  readForm();
  profile.screen.width = width;
  profile.screen.height = height;
  drawScreen();
  const canvas = $("screen-canvas");
  const { data } = canvas.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, width, height);
  playGif(false);   // send the frame on show, and keep it on show
  const slot = Number($("screen-slot").value);
  const bar = $("screen-progress");
  bar.hidden = false;
  $("screen-send").disabled = true;
  try {
    await nj.client.uploadPicture(slot, pictureBytes(data, width, height), nj.model.screen, (done, total) => { bar.max = total; bar.value = done; });
    logOk("areaScreen", `${t("pictureSent")} ${slot + 1}`);
  } catch (error) { logError("areaScreen", `${t("applyFailed")}: ${error.message}`); }
  $("screen-send").disabled = false;
  bar.hidden = true;
};

/* A text box keeps its keys; everywhere else the page swallows them while you try the keyboard. */
const isTyping = (el) => Boolean(el) && (el.isContentEditable || el.tagName === "TEXTAREA"
  || (el.tagName === "INPUT" && ["text", "number", "search", "email", "url"].includes(el.type)));

/* Keys pressed on the real keyboard (while this page has focus) light up on the drawing. */
const showKey = (code, down) => {
  for (const key of KEYS) {
    if (key.code !== code) { continue; }
    keyEls.get(key.id)?.classList.toggle("down", down);
    if (down) { notePress(key); }
  }
};

const download = (name, data, type) => {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const link = Object.assign(document.createElement("a"), { href: url, download: name });
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};


/* ---------- connection ---------- */
/* Tabs in the sidebar. Lighting, screen and profile only make sense with a keyboard that answered: until then they
   show the "connect to start" card; the log is always there. */
let ready = false;
let currentTab = "light";
const TAB_SUB = { light: "subLight", screen: "subScreen", profile: "subProfile", log: "subLog" };
const TAB_TITLE = { light: "lighting", screen: "screen", profile: "profile", log: "log" };
const showTab = (tab) => {
  currentTab = tab;
  for (const button of document.querySelectorAll("[data-tab]")) {
    if (button.dataset.tab === tab) { button.setAttribute("aria-current", "page"); } else { button.removeAttribute("aria-current"); }
  }
  for (const name of Object.keys(TAB_SUB)) {
    const panel = $(`tab-${name}`);
    panel.hidden = name !== tab || (panel.classList.contains("needs-keyboard") && !ready);
  }
  $("start-hint").hidden = ready || tab === "log";
  $("page-title").dataset.i18n = TAB_TITLE[tab];
  $("page-title").textContent = t(TAB_TITLE[tab]);
  $("page-sub").dataset.i18n = TAB_SUB[tab];
  $("page-sub").textContent = t(TAB_SUB[tab]);
};
const setControlsEnabled = (on) => {
  ready = on;
  if (!on) { $("confirm-pill").hidden = true; }
  showTab(currentTab);
};
/* The pill next to the title: the keyboard confirmed the last change, or reported something else. */
const setConfirm = (ok) => {
  $("confirm-pill").hidden = false;
  $("confirm-pill").classList.toggle("warn", !ok);
  $("confirm-text").textContent = t(ok ? "confirmOk" : "confirmBad");
};

const setConnected = (on, detail) => {
  if (!on) { setControlsEnabled(false); }
  const status = $("status");
  $("status-dot").classList.toggle("on", on);
  $("connection-help").hidden = on;
  status.textContent = t(on ? "status_on" : "status_off");
  status.dataset.i18n = on ? "status_on" : "status_off";
  $("connect").hidden = on;
  $("connect-other").hidden = on;
  $("disconnect").hidden = !on;
  const name = $("device-name");
  name.hidden = !on;
  if (on && detail) { name.textContent = `${detail.name} · VID ${hex4(detail.vendorId)} · PID ${hex4(detail.productId)}`; }
  if (on && detail) {   // the interfaces, in the log, to help when something does not work
    log(`${detail.name} VID ${hex4(detail.vendorId)} PID ${hex4(detail.productId)}, ${t("interfaces")}: ` +
      detail.collections.map((c) => `${hex4(c.usagePage)}/${hex4(c.usage)}${c.featureReports.length ? " feature" : ""}`).join(", "), "info", "areaConn");
  }
};

/* Any Keydous vendor id (every interface) and any vendor collection. */
const DEVICE_FILTERS = [
  ...ROYUAN.VENDOR_IDS.map((vendorId) => ({ vendorId })),
  { usagePage: ROYUAN.USAGE_PAGE },
];

/* After "Disconnect" the page stays disconnected, also after a reload, until "Connect" is pressed again. */
const AUTO_KEY = "nj81-config.autoconnect";
const setAutoConnect = (on) => { try { localStorage.setItem(AUTO_KEY, on ? "on" : "off"); } catch (error) { /* private mode */ } };
const autoConnect = () => { try { return localStorage.getItem(AUTO_KEY) !== "off"; } catch (error) { return true; } };

const connect = async (filters) => {
  try {
    const device = await session.request(filters);
    if (device) { setAutoConnect(true); }
    if (!device) { logWarn("areaConn", t("noDevicePicked")); }
  } catch (error) { logError("areaConn", `${t("applyFailed")}: ${error.message}`); }
};

/* Effects this keyboard does not run (it did not keep them, or the user hid them), remembered per keyboard model. */
const modesKey = () => `nj81-config.hidden-modes.${nj?.deviceId ?? "none"}`;
/* What this keyboard model really has, learned by watching it while the user cycles effects with its own keys:
   { seen: [mode numbers in the order they came], done: bool, names: { mode: name }, brightnessTop } */
const boardKey = () => `nj81-config.board.${nj?.deviceId ?? "none"}`;
const board = () => { try { return { seen: [], done: false, names: {}, ...JSON.parse(localStorage.getItem(boardKey()) || "{}") }; } catch (error) { return { seen: [], done: false, names: {} }; } };
const saveBoard = (value) => { try { localStorage.setItem(boardKey(), JSON.stringify(value)); } catch (error) { /* private mode */ } };
const modeLabel = (mode) => board().names[mode] || modeInfo(mode)?.name || `${t("modeNumber")} ${mode}`;
const modeChoices = () => {
  const known = board();
  // learned on this keyboard > the model's list on file > the full NJ81 table
  const list = known.done && known.seen.length ? known.seen
    : (nj?.model?.modes ?? MODES.map((m) => m.mode)).filter((m) => !hiddenModes().has(m));
  const current = profile.lighting.nj81?.mode;
  return current && !list.includes(current) ? [...list, current] : list;
};
/* Effects that light only when a key is pressed. The page cannot see the LEDs, so this is a default per effect that the
   user corrects per keyboard model with the checkbox under the menu. */
const reactiveModes = () => { const list = board().reactive; return Array.isArray(list) ? new Set(list) : REACTIVE_DEFAULT; };
const setReactive = (mode, on) => {
  const known = board();
  const set = reactiveModes();
  if (on) { set.add(mode); } else { set.delete(mode); }
  known.reactive = [...set];
  saveBoard(known);
};
let learning = false;
const noteSeen = (light) => {
  const known = board();
  let changed = false;
  if (!isOff(light) && light.mode && !known.seen.includes(light.mode)) { known.seen.push(light.mode); changed = true; }
  if (light.brightness > (known.brightnessTop ?? LEVELS)) { known.brightnessTop = light.brightness; changed = true; }
  if (changed) { saveBoard(known); }
  brightnessTop = Math.max(LEVELS, known.brightnessTop ?? LEVELS);
  if (learning) { $("learn-seen").textContent = known.seen.map(modeLabel).join(" → ") || "-"; }
  return changed;
};
const hiddenModes = () => { try { return new Set(JSON.parse(localStorage.getItem(modesKey()) || "[]")); } catch (error) { return new Set(); } };
const setHiddenModes = (set) => { try { localStorage.setItem(modesKey(), JSON.stringify([...set])); } catch (error) { /* private mode */ } };
const hideMode = (mode) => {
  const set = hiddenModes();
  set.add(mode);
  setHiddenModes(set);
  fillEffectOptions();
  $("effect").value = String(profile.lighting.nj81?.off ? OFF : MODES.find((m) => !set.has(m.mode))?.mode ?? OFF);
  onFormChange({ target: $("effect") });
  scheduleLive();
  log(`${t("modeHidden")}: ${modeLabel(mode)}`, "info", "areaLight");
};

const fillEffectOptions = () => {
  const options = nj ? [new Option(t("lightsOff"), String(OFF)), ...modeChoices().map((mode) => new Option(modeLabel(mode), String(mode)))] : [];
  $("effect").replaceChildren(...options);
  renderEffectList();
};

/* Keydous NJ81 (vendor protocol): identify the model, then read its current lighting into the form. */
const detectNj81 = async () => {
  const client = new Royuan(session.featureTransport());
  let id;
  try { id = await client.identify(); } catch (error) { logError("areaConn", `${t("njNoAnswer")} (${error.message})`); return false; }
  const info = $("device-info");
  info.hidden = false;
  info.textContent = `${id.model.name} · id ${id.deviceId} · firmware ${id.firmware}`;
  let model = id.model;
  if (!isWritable(model)) {   // older boards: ask which command set they speak (reads only)
    const knownFamily = (() => { try { return JSON.parse(localStorage.getItem(`nj81-config.board.${id.deviceId}`) || "{}").family; } catch (error) { return null; } })();
    const family = knownFamily || await client.probeFamily().catch(() => null);   // asked once, then remembered for this model
    if (!family) { logWarn("areaConn", `${t("njUnsupported")}: ${info.textContent}`); return true; }
    client.family = family;
    model = { ...model, family, screen: model.screen ?? null };
    info.textContent += ` · ${family}`;
    logOk("areaConn", `${t("familyDetected")}: ${family}`);
  }
  const display = Boolean(model.screen) || await client.hasDisplay().catch(() => false);
  nj = { client, ...id, model, display };
  setControlsEnabled(true);
  try {
    const [light, active] = [await client.readLight(), await client.profile().catch(() => null)];
    profile = validateProfile({
      ...profile,
      lighting: { ...profile.lighting,
      },
      screen: model.screen ? { ...profile.screen, width: model.screen.width, height: model.screen.height } : profile.screen,
    }).profile;
    showKeyboardLight(light);
    info.textContent += ` · profile ${active === null ? "?" : active + 1}`;
    logOk("areaConn", `${t("viaReady")}: ${info.textContent}`);
    logOk("areaLight", `${t("lightNow")}: ${describeNj(light)}`);
  } catch (error) { logError("areaLight", `${t("applyFailed")}: ${error.message}`); }
  if (nj.client.family !== "gen2") { const known = board(); if (known.family !== nj.client.family) { known.family = nj.client.family; saveBoard(known); } }
  startWatching();
  // like the official driver, the clock is set on every connect, but a little later: it is a flash write too, and the
  // lighting must not wait a second behind it right after connecting
  if (display) { scheduleClock(3000); }
  updateScreenControls();
  return true;
};

/* Standard time: the web server's Date header (kept on time by the host), shown in this computer's time zone. */
const measureClock = async () => {
  try {
    const start = Date.now();
    const reply = await fetch(location.pathname, { method: "HEAD", cache: "no-store" });
    const end = Date.now();
    const server = Date.parse(reply.headers.get("date") || "");
    if (Number.isFinite(server)) { clockOffsetMs = server + 500 - (start + end) / 2; return true; }   // the header is whole seconds
  } catch (error) { /* offline: keep this computer's clock */ }
  clockOffsetMs = 0;
  return false;
};

let clockTimer = null;
const scheduleClock = (delayMs) => {
  clearTimeout(clockTimer);
  clockTimer = setTimeout(() => {
    if (!nj) { return; }
    if (njBusy || njDirty || Date.now() - lastLocalChange < 2000) { scheduleClock(1500); return; }   // lighting first
    syncClock();
  }, delayMs);
};

/* One clock write at a time: clicks while one is on its way (or just done) are ignored. */
let clockBusy = false;
let clockDoneAt = 0;
const syncClock = async () => {
  if (clockBusy || Date.now() - clockDoneAt < 3000) { return; }
  clockBusy = true;
  try {
    const fromServer = await measureClock();
    await nj.client.setClock(standardNow);
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const drift = Math.round(clockOffsetMs / 1000);
    logOk("areaClock", `${t("clockSent")}: ${standardNow().toLocaleString()} (${zone}${fromServer ? `, ${t("clockStandard")}${drift ? `, ${t("clockDrift")} ${drift}s` : ""}` : ""})`);
  } catch (error) { logError("areaClock", `${t("applyFailed")}: ${error.message}`); }
  clockBusy = false;
  clockDoneAt = Date.now();
};

/* Puts what the keyboard reports into the form (on connect, and when it is changed with the keyboard's own keys). */
let lastBoardLight = "";
const showKeyboardLight = (light) => {
  noteSeen(light);
  lastBoardLight = JSON.stringify(light);
  profile = validateProfile({
    ...profile,
    lighting: { ...profile.lighting, color: light.color, brightness: fromLevel(light.brightness, brightnessTop), speed: fromLevel(light.speed),
      nj81: { mode: light.mode || profile.lighting.nj81?.mode || 1, option: light.option, rainbow: light.rainbow, off: isOff(light) } },
  }).profile;
  fillEffectOptions();
  writeForm();
};

/* Watches the keyboard: reads (never writes) its lighting every 1.5 s, 0.6 s while learning, and follows changes made
   with its own keys. Skipped while the page is writing or right after a change in the page. */
let watchTimer = null;
let lastLocalChange = 0;
const startWatching = () => {
  clearTimeout(watchTimer);
  const tick = async () => {
    if (!nj) { return; }
    if (!njBusy && !njDirty && Date.now() - lastLocalChange > 2500) {
      try {
        const light = await nj.client.readLight();
        if (JSON.stringify(light) !== lastBoardLight && nj) {
          const learned = noteSeen(light);
          log(`${t("keyboardChanged")}: ${describeNj(light)}`, "kbd", "areaLight");
          if (learned && learning) { log(`${t("learnedMode")}: ${modeLabel(light.mode)} (${t("modeNumber")} ${light.mode})`, "ok", "areaLight"); }
          showKeyboardLight(light);
        }
      } catch (error) { /* unplugged or busy: try again next time */ }
    }
    watchTimer = setTimeout(tick, learning ? 600 : 1500);
  };
  watchTimer = setTimeout(tick, 1500);
};

const setLearning = (on) => {
  learning = on;
  $("learn-box").hidden = !on;
  $("learn-start").hidden = on;
  if (on) {
    const known = board();
    known.seen = [];
    known.done = false;
    saveBoard(known);
    noteSeen(JSON.parse(lastBoardLight || "{}"));
    log(t("learnStarted"), "info", "areaLight");
  } else {
    const known = board();
    known.done = known.seen.length > 0;
    saveBoard(known);
    fillEffectOptions();
    writeForm();
    logOk("areaLight", `${t("learnDone")}: ${known.seen.map(modeLabel).join(", ") || "-"}`);
  }
};

const dropKeyboard = () => {
  const had = nj !== null;
  nj = null;
  clearTimeout(watchTimer);
  clearTimeout(clockTimer);
  if (learning) { learning = false; $("learn-box").hidden = true; $("learn-start").hidden = false; }
  updateScreenControls();
  $("device-info").hidden = true;
  if (had) { fillEffectOptions(); writeForm(); }
};

session.addEventListener("connected", async (event) => {
  setConnected(true, event.detail);
  const vendor = event.detail.collections.some((c) => c.usagePage === ROYUAN.USAGE_PAGE && ROYUAN.USAGES.includes(c.usage));
  if (!vendor) { logWarn("areaConn", t("njNoInterface")); return; }
  await detectNj81();
});
session.addEventListener("disconnected", () => { setConnected(false); dropKeyboard(); });

/* ---------- apply ---------- */
/* "Apply" (profile card): sends the whole profile's lighting to the keyboard. */
const apply = () => {
  readForm();
  if (nj) { pushNj81(); }
};

/* One write at a time, the latest settings win: the keyboard takes about one lighting write per second. */
let njBusy = false;
let njDirty = false;
const describeNj = (s) => s.off || s.brightness === 0 ? t("lightsOff")
  : `${modeLabel(s.mode)}${modeInfo(s.mode)?.options ? ` (${modeInfo(s.mode).options[s.option] ?? s.option})` : ""} · ${s.rainbow ? t("rainbowShort") : s.color} · ${t("brightness")} ${s.brightness}/${brightnessTop} · ${t("speed")} ${s.speed}/${LEVELS}`;
/* A setting's value in words, for the log and the status table. */
const FIELD_LABEL = { off: "fieldOff", mode: "effect", brightness: "brightness", speed: "speed", rainbow: "rainbowShort", color: "color", option: "direction" };
const fieldValue = (field, value, mode) => {
  if (field === "off" || field === "rainbow") { return t(value ? "yes" : "no"); }
  if (field === "mode") { return modeLabel(value); }
  if (field === "brightness") { return `${value}/${brightnessTop}`; }
  if (field === "speed") { return `${value}/${LEVELS}`; }
  if (field === "option") { return modeInfo(mode)?.options?.[value] ?? String(value); }
  return String(value);
};
const describeDiffs = (diffs, mode) => diffs.map((d) => `${t(FIELD_LABEL[d.field])}: ${t("sentWord")} ${fieldValue(d.field, d.sent, mode)}, ${t("keptWord")} ${fieldValue(d.field, d.got, mode)}`).join(" · ");

/* Per effect: how often it was taken or not, shown under the lighting controls. */
const effectReport = new Map();
const noteResult = (settings, diffs) => {
  const key = settings.off ? OFF : settings.mode;
  const entry = effectReport.get(key) ?? { ok: 0, bad: 0, issue: "" };
  if (diffs.length) { entry.bad += 1; entry.issue = diffs.map((d) => t(FIELD_LABEL[d.field])).join(", "); } else { entry.ok += 1; }
  effectReport.set(key, entry);
};

/* The status table: what the page asked for, what the keyboard reports, row by row. */
const showStatus = (settings, light, diffs) => {
  const wrong = new Set(diffs.map((d) => d.field));
  // as in option A: effect, direction, colour, brightness, speed (the lights-off row only when it matters)
  const rows = (settings.off ? ["off"] : [...(wrong.has("off") ? ["off"] : []), "mode", ...(modeInfo(settings.mode)?.options ? ["option"] : []), "color", "brightness", "speed"])
    .filter((field) => !(field === "speed" && modeInfo(settings.mode)?.noSpeed) && !(field === "color" && (modeInfo(settings.mode)?.noColor || settings.rainbow)));
  const cell = (text, cls = "") => Object.assign(document.createElement("td"), { textContent: text, className: cls });
  const value = (source, field) => field === "off" ? (field in source ? source.off : isOff(source)) : source[field];
  $("light-status-body").replaceChildren(...rows.map((field) => {
    const tr = document.createElement("tr");
    const ok = !wrong.has(field);
    tr.append(cell(t(FIELD_LABEL[field])), cell(fieldValue(field, value(settings, field), settings.mode)),
      cell(`${fieldValue(field, field === "off" ? isOff(light) : light[field], settings.mode)} · ${t(ok ? "match" : "differs")}`, ok ? "ok" : "bad"));
    return tr;
  }));
  $("effect-report").textContent = [...effectReport].map(([mode, r]) =>
    `${mode === OFF ? t("lightsOff") : modeLabel(mode)} ${r.bad ? `⚠️ (${r.issue})` : "✅"}`).join(" · ");
  $("light-status").hidden = false;
};

const pushNj81 = async () => {
  njDirty = true;
  if (njBusy || !nj) { return; }
  njBusy = true;
  while (njDirty && nj) {
    njDirty = false;
    const settings = njSettings();
    try {
      let { light, diffs } = await nj.client.writeLight(settings);
      let retried = false;
      if (diffs.length && !njDirty) {   // not taken: send the same once more (a write can be dropped while the keyboard is busy)
        log(`${t("retrying")}: ${describeDiffs(diffs, settings.mode)}`, "info", "areaLight");
        ({ light, diffs } = await nj.client.writeLight(settings));
        retried = true;
      }
      lastBoardLight = JSON.stringify(light);
      noteSeen(light);
      noteResult(settings, diffs);
      showStatus(settings, light, diffs);
      const typing = !settings.off && reactiveModes().has(settings.mode) ? ` · ${t("reactiveNote")}` : "";
      setConfirm(!diffs.length);
      if (!diffs.length) { logOk("areaLight", `${t("applied")}${retried ? ` (${t("afterRetry")})` : ""}: ${describeNj(settings)}${typing}`); }
      else { logWarn("areaLight", `${t("notApplied")} ${settings.off ? t("lightsOff") : modeLabel(settings.mode)}: ${describeDiffs(diffs, settings.mode)}`); }
    } catch (error) { logError("areaLight", `${t("applyFailed")}: ${error.message}`); }
  }
  njBusy = false;
};

const scheduleLive = () => {
  lastLocalChange = Date.now();
  if (nj) { pushNj81(); }
};

/* ---------- profiles ---------- */
const saveLocal = () => {
  readForm();
  const all = readSaved();
  all[profile.name] = JSON.parse(serializeProfile(profile));
  writeSaved(all);
  refreshSavedList();
  $("saved-list").value = profile.name;
  logOk("areaProfile", `${t("saved")}: ${profile.name}`);
};

const loadLocal = () => {
  const found = readSaved()[$("saved-list").value];
  if (!found) { return; }
  profile = validateProfile(found).profile;
  writeForm();
};

const importJson = async (event) => {
  const [file] = event.target.files;
  if (!file) { return; }
  const result = parseProfile(await file.text());
  if (!result.ok) { logError("areaProfile", `${t("importFailed")}: ${result.errors.join("; ")}`); }
  if (result.ok) { profile = result.profile; writeForm(); logOk("areaProfile", `${t("imported")}: ${profile.name}`); }
  event.target.value = "";
};

/* ---------- start ---------- */
const init = () => {
  fillEffectOptions();
  const fillEffectNames = () => { const keep = $("effect").value; fillEffectOptions(); $("effect").value = keep; };   // "Lights off" is translated

  const applyLanguage = (language) => {
    setLanguage(language);
    for (const button of document.querySelectorAll("[data-lang]")) { button.setAttribute("aria-pressed", String(button.dataset.lang === language)); }
    fillEffectNames();
    $("status").textContent = t($("status").dataset.i18n);
  };
  for (const button of document.querySelectorAll("[data-lang]")) {
    button.addEventListener("click", () => {
      applyLanguage(button.dataset.lang);
      try { localStorage.setItem("nj81-config.lang", button.dataset.lang); } catch (error) { /* private mode */ }
    });
  }
  const saved = (() => { try { return localStorage.getItem("nj81-config.lang"); } catch (error) { return null; } })();
  applyLanguage(languages().includes(saved) ? saved : "vi");

  if (!hidSupported()) {
    $("unsupported").hidden = false;
    $("connect").disabled = true;
  }
  $("connect").addEventListener("click", () => connect(DEVICE_FILTERS));
  $("connect-other").addEventListener("click", () => connect([]));
  $("disconnect").addEventListener("click", () => { setAutoConnect(false); session.close(); log(t("disconnectedByUser"), "info", "areaConn"); });
  for (const id of ["effect", "color", "brightness", "speed", "profile-name", "light-option", "rainbow"]) { $(id).addEventListener("input", onFormChange); }
  // the keyboard gets a setting once it is chosen (slider released, colour picked), not on every step of a drag
  for (const id of ["color", "brightness", "speed"]) { $(id).addEventListener("input", () => scheduleLive()); }
  for (const id of ["effect", "color", "brightness", "speed", "light-option", "rainbow"]) {
    $(id).addEventListener("change", (event) => { scheduleLive(); if (event.target.tagName === "SELECT" || event.target.type === "range") { event.target.blur(); } });
  }
  // a mouse click must not leave the button focused, or the next key press on the keyboard would trigger it again
  document.addEventListener("click", (event) => { if (event.detail > 0 && event.target.closest("button")) { event.target.closest("button").blur(); } });
  $("screen-send").addEventListener("click", sendPicture);
  window.addEventListener("keydown", (event) => {
    showKey(event.code, true);
    // outside a text box a key press only lights the drawing: no scrolling, no menu changes, no browser shortcuts (F11/F12 stay)
    if (!isTyping(document.activeElement) && event.code !== "F11" && event.code !== "F12") { event.preventDefault(); }
  });
  window.addEventListener("keyup", (event) => showKey(event.code, false));
  window.addEventListener("blur", () => { for (const el of keyEls.values()) { el.classList.remove("down"); } });
  $("screen-fit").addEventListener("change", (event) => { drawScreen(); event.target.blur(); });
  $("gif-play").addEventListener("click", () => playGif(!gif?.playing));
  $("gif-frame").addEventListener("input", (event) => { if (gif) { playGif(false); showGifFrame(Number(event.target.value)); } });
  buildGallery();
  $("hide-mode").addEventListener("click", () => { const mode = Number($("effect").value); if (mode !== OFF) { hideMode(mode); } });
  $("learn-start").addEventListener("click", () => setLearning(true));
  $("reactive").addEventListener("change", (event) => {
    const mode = Number($("effect").value);
    setReactive(mode, event.target.checked);
    refreshOptionControl();
    log(`${modeLabel(mode)}: ${t(event.target.checked ? "reactiveOn" : "reactiveOff")}`, "info", "areaLight");
    event.target.blur();
  });
  $("learn-done").addEventListener("click", () => setLearning(false));
  $("rename-mode").addEventListener("click", () => {
    const mode = Number($("effect").value);
    if (!nj || mode === OFF) { return; }
    const name = window.prompt(t("renamePrompt"), modeLabel(mode));
    if (name === null) { return; }
    const known = board();
    if (name.trim()) { known.names[mode] = name.trim().slice(0, 40); } else { delete known.names[mode]; }
    saveBoard(known);
    fillEffectOptions();
    $("effect").value = String(mode);
    log(`${t("renamed")}: ${t("modeNumber")} ${mode} = ${modeLabel(mode)}`, "info", "areaLight");
  });
  for (const swatch of PRESET_COLOURS) {
    const button = Object.assign(document.createElement("button"), { type: "button", className: "swatch", title: swatch });
    button.style.background = swatch;
    button.addEventListener("click", () => { $("color").value = swatch; onFormChange({ target: $("color") }); scheduleLive(); });
    $("swatches").insertBefore(button, $("swatches").querySelector(".custom"));
  }
  for (const tab of document.querySelectorAll("[data-tab]")) { tab.addEventListener("click", () => showTab(tab.dataset.tab)); }
  $("mini-clock").addEventListener("click", () => { if (nj) { syncClock(); } });
  $("reactive").addEventListener("change", () => renderEffectList());
  $("show-modes").addEventListener("click", () => { setHiddenModes(new Set()); const known = board(); known.done = false; saveBoard(known); const keep = $("effect").value; fillEffectOptions(); $("effect").value = keep; refreshOptionControl(); });  $("screen-file").addEventListener("change", onScreenFile);
  $("save-local").addEventListener("click", saveLocal);
  $("load-local").addEventListener("click", loadLocal);
  $("export-json").addEventListener("click", () => { readForm(); download(`${profile.name || "profile"}.nj81.json`, serializeProfile(profile), "application/json"); });
  $("import-json").addEventListener("change", importJson);
  $("apply").addEventListener("click", apply);

  buildKeyboard();
  queueMicrotask(() => setControlsEnabled(false));   // after the gallery and swatches exist
  applyCaps((() => { try { return localStorage.getItem(CAPS_KEY); } catch (error) { return null; } })() === "black" ? "black" : "white");
  $("caps").addEventListener("change", (event) => { applyCaps(event.target.value); event.target.blur(); });
  updateScreenControls();
  writeForm();
  refreshSavedList();
  setConnected(false);
  log(hidSupported() ? "WebHID ok" : "WebHID not available");
  if (hidSupported()) {
    // a keyboard this site was already allowed to use connects by itself, unless the user pressed "Disconnect"
    if (autoConnect()) { session.reconnect().catch(() => {}); }
    navigator.hid.addEventListener("disconnect", (event) => { if (event.device === session.device) { session.close(); } });
  }
  requestAnimationFrame(frame);
};

init();
