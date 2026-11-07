/* Wires the page together: connection, lighting preview, screen, profiles, log. */
import { defaultProfile, parseProfile, serializeProfile, validateProfile } from "./profile.js";
import { KEYS, LAYOUT_HEIGHT, LAYOUT_WIDTH, SCREEN_TILE } from "./layout.js";
import { HidSession, hex4, hidSupported } from "./hid.js";
import { ANIMATION, LEVELS, MODES, OFF, PRESET_COLOURS, ROYUAN, Royuan, TFT, isOff, isWritable, modeInfo, pictureBytes } from "./royuan.js";
import { hexToRgb, rgbToHex } from "./util.js";
import { GALLERY, LINKS } from "./gallery.js";
import { initKeys } from "./keys-ui.js";
import { REACTIVE_DEFAULT, nj81KeyColor } from "./lighting-nj81.js";
import { currentLanguage, languages, setLanguage, t } from "./i18n.js";
import { renderGuide } from "./guide.js";
import { initShare } from "./share.js";
import { decodeAction, describeAction, keyLabel } from "./keymap.js";

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
/* WebHID's own messages ("Failed to write the feature report") say little: name the likely cause. */
const why = (error) => (error?.busy ? `${t("hidBusy")} (${error.attempts}×: ${error.message})` : error?.message ?? String(error));
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
        // gen2 has no off switch: brightness 0 is off there; on yc500 brightness 0 is a level and off is its own switch
        const off = chosen === OFF || (nj.client.family === "gen2" && Number($("brightness").value) === 0);
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
  $("show-modes").hidden = !nj || !board().done;
  const mode = Number($("effect").value);
  const options = info?.options ?? [];
  const keep = $("light-option").value;
  $("light-option").replaceChildren(...options.map((name, i) => new Option(optionLabel(mode, i) ?? name, String(i))));
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

let keys = null;   // the Keys tab (keys-ui.js)
let share = null;   // the Share tab (share.js)
const onKeyClick = (key) => { if (keys?.select(key)) { return; } notePress(key); };   // on the Keys tab a click picks the key; elsewhere it is a key press for the effects

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

/* Each key's colour is written only when it changes: a style change makes the browser redraw that key's glow. */
const ledOf = new Map();   // key id -> the --led value written last
const setLed = (key, value) => {
  if (ledOf.get(key.id) === value) { return; }
  ledOf.set(key.id, value);
  keyEls.get(key.id).style.setProperty("--led", value);   // the CSS of the chosen keycap colour decides how it shows
};
const paintKeyboard = (time) => {
  if (currentTab === "keys") {   // the Keys tab: lights off; keys-ui.js tints the keys that have a setting, as the driver
    for (const key of KEYS) { setLed(key, "#000000"); }
    return;
  }
  const nj81 = nj81Preview();
  const reactive = nj81 ? reactiveModes() : null;
  for (const key of KEYS) {
    const [red, green, blue] = nj81 ? nj81KeyColor(nj81, key, time, presses, reactive) : [0, 0, 0];
    setLed(key, rgbToHex(red, green, blue));
  }
};

/* The drawing is painted 20 times a second (10 with "reduce motion"), and not at all while it cannot be seen: another tab
   of the page (Macro, Profile, Library…) or the browser tab in the background. */
const slowMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)");
let lastFrame = 0;
const frame = (time) => {
  const gap = slowMotion?.matches ? FRAME_MS * 2 : FRAME_MS;
  if (time - lastFrame >= gap && !document.hidden && !$("keyboard-panel").hidden) { lastFrame = time; paintKeyboard(time); }
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
    GALLERY[0].draw(context, width, height);   // the default picture: "Nek NauT", white on black
  }
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
  // the frame count grows while the file is read: wait until all of it is read, or a big GIF looks like one frame
  try { await decoder.completed; } catch (error) { /* a broken tail: use the frames read so far */ }
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
  syncLayerBox();
};
/* "Picture layer" 1-5: shown for a still picture on a board with layers, never for a GIF (as the driver on the NJ81-ED). */
const syncLayerBox = () => { $("screen-slot-box").hidden = !(nj?.model?.screen?.slots > 1) || Boolean(gif); };

const setScreenSource = (source, name) => {
  $("screen-send").classList.add("pending");
  screenPixels = source;
  syncLayerBox();
  profile.screen.name = name;
  $("screen-name").textContent = `${name} · ${source.width}×${source.height} → ${profile.screen.width}×${profile.screen.height}`;
  drawScreen();
};

let screenFile = null;   // the file on show (null: a picture from the library)
/* The picture chosen on this machine (each browser keeps its own: several people can use the page): a library picture
   by its id in localStorage, a file (a GIF is too big for localStorage) in IndexedDB. Shown again on the next visit,
   connected or not. The keyboard cannot report the picture it shows, so nothing is read from it. */
const CHOSEN_KEY = "nj81-config.chosen";
const rememberChosen = (choice) => {
  try {
    if (choice.gallery) { localStorage.setItem(CHOSEN_KEY, JSON.stringify({ gallery: choice.gallery })); pictureStore("readwrite", (store) => store.delete(CHOSEN_KEY)); }
    else { localStorage.setItem(CHOSEN_KEY, JSON.stringify({ file: true })); pictureStore("readwrite", (store) => store.put({ blob: choice.file, name: choice.file.name, type: choice.file.type, at: Date.now() }, CHOSEN_KEY)); }
  } catch (error) { /* private mode: nothing kept */ }
};
const restoreChosen = async () => {
  let choice = null;
  try { choice = JSON.parse(localStorage.getItem(CHOSEN_KEY) || "null"); } catch (error) { choice = null; }
  if (!choice) { return; }
  if (choice.gallery) {
    const item = GALLERY.find((g) => g.id === choice.gallery);
    const button = item && [...$("gallery").children].find((b) => b.title === item.name);
    if (button) { stopGif(); screenFile = null; setScreenSource(button.querySelector("canvas"), item.name); $("screen-send").classList.remove("pending"); }
    return;
  }
  const kept = await pictureStore("readonly", (store) => store.get(CHOSEN_KEY));
  if (!kept?.blob) { return; }
  try {
    await loadScreenFile(new File([kept.blob], kept.name || "picture", { type: kept.type || kept.blob.type }), { restored: true });
    $("screen-send").classList.remove("pending");
  } catch (error) { /* a broken entry: the default picture stays */ }
};

const loadScreenFile = async (file, { restored = false } = {}) => {
  stopGif();
  const frames = file.type === "image/gif" || file.type === "image/webp" || file.type === "image/png" ? await decodeAnimation(file).catch(() => null) : null;
  if (frames) {
    gif = { frames, index: 0, timer: null, playing: false };
    $("gif-frame").max = String(frames.length - 1);
    $("gif-controls").hidden = false;
    setScreenSource(frames[0].bitmap, file.name);
    showGifFrame(0);
    playGif(true);
    if (!restored) { log(`${file.name} (GIF, ${frames.length} ${t("gifFrames")})`, "info", "areaScreen"); }
  } else {
    setScreenSource(await createImageBitmap(file), file.name);
    if (!restored) { log(`${file.name} (${screenPixels.width}×${screenPixels.height})`, "info", "areaScreen"); }
  }
  screenFile = file;
  if (!restored) { rememberChosen({ file }); }
};
const onScreenFile = async (event) => {
  const [file] = event.target.files;
  if (!file) { return; }
  try { await loadScreenFile(file); } catch (error) { logError("areaScreen", `${t("importFailed")}: ${error.message}`); }
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
    button.addEventListener("click", () => { stopGif(); screenFile = null; setScreenSource(canvas, item.name); rememberChosen({ gallery: item.id }); });
    return button;
  });
  $("gallery").replaceChildren(...items);
  $("gallery-links").replaceChildren(...LINKS.map(({ group, items }) => {
    const box = document.createElement("div");
    box.className = "link-group";
    const title = Object.assign(document.createElement("h4"), { textContent: t(group) });
    title.dataset.i18n = group;
    const list = document.createElement("ul");
    list.className = "links";
    list.append(...items.map((link) => {
      const li = document.createElement("li");
      li.append(Object.assign(document.createElement("a"), { href: link.url, textContent: link.name, target: "_blank", rel: "noopener noreferrer" }));
      return li;
    }));
    box.append(title, list);
    return box;
  }));
};

/* With a NJ81 connected the screen is fixed at its real size and pictures can be sent into one of its slots. */
const updateScreenControls = () => {
  const screen = nj?.model?.screen;
  $("screen-device").hidden = !nj?.display;
  $("screen-connect-note").hidden = Boolean(nj?.display);
  $("screen-send").hidden = !screen;
  syncLayerBox();
  $("screen-clear-all").hidden = !(nj?.display && nj.client.family === "yc500");   // the driver's Clear, captured on an NJ81-ED
  $("screen-size-note").hidden = !screen?.assumed;
  $("screen-device-note").hidden = !screen || screen.assumed;
  if (screen) { $("screen-slot").replaceChildren(...Array.from({ length: screen.slots }, (_, i) => new Option(String(i + 1), String(i)))); }
  if (nj) { showLastPicture(); }
};

/* The keyboard cannot report the picture its screen shows, so the page remembers the last one it sent from this browser
   (per keyboard model and slot) and shows it again on connect. */
const pictureKey = (slot) => `nj81-config.picture.${nj?.deviceId ?? "none"}.${slot}`;
const rememberPicture = (canvas, slot) => {
  try { localStorage.setItem(pictureKey(slot), JSON.stringify({ url: canvas.toDataURL("image/png"), name: profile.screen.name, at: Date.now() })); } catch (error) { /* full or private */ }
};
/* The file of the picture or GIF last sent (this browser only, IndexedDB: a GIF is too big for localStorage). */
const pictureStore = (mode, use) => new Promise((resolve) => {
  try {
    const open = indexedDB.open("nj81-config", 1);
    open.onupgradeneeded = () => open.result.createObjectStore("pictures");
    open.onerror = () => resolve(null);
    open.onsuccess = () => {
      try {
        const tx = open.result.transaction("pictures", mode);
        const request = use(tx.objectStore("pictures"));
        tx.oncomplete = () => { resolve(request?.result ?? null); open.result.close(); };
        tx.onerror = () => { resolve(null); open.result.close(); };
      } catch (error) { resolve(null); }
    };
  } catch (error) { resolve(null); }
});
const rememberFile = (file, slot) => pictureStore("readwrite", (store) => store.put({ blob: file, name: file.name, type: file.type, at: Date.now() }, pictureKey(slot)));
const forgetFiles = (slots) => pictureStore("readwrite", (store) => { for (let slot = 0; slot < slots; slot += 1) { store.delete(pictureKey(slot)); } });

/* Only says when a picture was last sent from this browser: the preview and the drawing keep the default "Nek NauT"
   picture (or the one chosen on this machine), not the last one sent. */
const showLastPicture = async () => {
  const slot = Number($("screen-slot").value) || 0;
  const kept = await pictureStore("readonly", (store) => store.get(pictureKey(slot)));
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(pictureKey(slot)) || "null"); } catch (error) { saved = null; }
  const last = kept?.blob ? { at: kept.at, name: kept.name } : saved?.url ? saved : null;
  if (screenFile || screenPixels) { return; }   // a picture picked here: its own name is on show
  $("screen-name").textContent = last ? `${t("lastPictureSent")} ${new Date(last.at).toLocaleString()}${last.name ? ` · ${last.name}` : ""}` : t("noPictureSent");
};

/* "Clear pictures and GIFs" (NJ81-ED): the official driver's Clear, copied from a USB capture. The keyboard is left alone
   while it clears (about a minute): the lighting watch and the clock skip while screenBusy is set, and the client queues
   any lighting change until it is done. */
let screenBusy = false;
const clearScreenAll = async () => {
  if (!nj?.display || nj.client.family !== "yc500") { return; }
  if (!window.confirm(t("clearAllConfirm"))) { return; }
  stopGif();
  $("screen-clear-all").disabled = true;
  screenBusy = true;
  log(t("clearingAll"), "info", "areaScreen");
  const bar = $("screen-progress");
  bar.max = 100;
  bar.value = 0;
  bar.hidden = false;
  const name = $("screen-name");
  try {
    const { ms, confirmed } = await nj.client.clearScreen({ progress: (f) => { bar.value = Math.round(f * 100); name.textContent = `${t("clearingAll")} ${Math.round(f * 100)}%`; } });
    for (let slot = 0; slot < 8; slot += 1) { try { localStorage.removeItem(pictureKey(slot)); } catch (error) { /* private mode */ } }
    forgetFiles(8);
    screenFile = null;
    screenPixels = null;
    $("screen-name").textContent = t("noPictureSent");
    drawScreen();
    const secs = (ms / 1000).toFixed(1);
    logOk("areaScreen", confirmed ? `${t("clearedAll")} (${secs} s)` : `${t("clearedAll")} · ${t("clearedNoConfirm")}`);
  } catch (error) { logError("areaScreen", `${t("applyFailed")}: ${why(error)}`); }
  bar.hidden = true;
  screenBusy = false;
  $("screen-clear-all").disabled = false;
};

/* NJ81-ED: the picture, or every frame of the GIF (at most TFT.MAX_FRAMES; a longer GIF keeps every n-th frame), drawn
   as the preview shows it, sent as the official driver does with the GIF's own speed: the average frame delay in ms. */
const sendScreenNj81Ed = async (slot, capture, progress) => {
  const { width, height } = nj.model.screen;
  const frames = [];
  let totalMs = 0;
  if (gif) {
    const step = Math.ceil(gif.frames.length / TFT.MAX_FRAMES);
    const keep = gif.index;
    const playing = gif.playing;
    clearTimeout(gif.timer);
    for (let i = 0; i < gif.frames.length; i += step) {
      showGifFrame(i);
      frames.push(Uint8ClampedArray.from(capture()));
    }
    totalMs = gif.frames.reduce((sum, f) => sum + f.ms, 0);
    showGifFrame(keep);
    playGif(playing);   // the preview keeps playing
  } else {
    frames.push(Uint8ClampedArray.from(capture()));
  }
  const delayMs = frames.length > 1 ? totalMs / frames.length : 0;
  const bar = $("screen-progress");
  bar.hidden = false;
  $("screen-send").disabled = true;
  try {
    const { count, delay } = await nj.client.uploadScreen(frames, nj.model.screen, { layer: slot, delayMs, progress });
    logOk("areaScreen", count > 1 ? `${t("animationSent")} (${count} ${t("gifFrames")}, ${delay} ms/${t("gifFrame").toLowerCase()})` : t("pictureSentScreen"));
    const first = document.createElement("canvas");
    first.width = width;
    first.height = height;
    first.getContext("2d").putImageData(new ImageData(frames[0], width, height), 0, 0);
    rememberPicture(first, slot);
    if (screenFile) { rememberFile(screenFile, slot); } else { forgetFiles(1); }   // a library picture: the still above is enough
  } catch (error) { logError("areaScreen", `${t("applyFailed")}: ${why(error)}`); }
  $("screen-send").disabled = false;
  $("screen-send").textContent = t("screenSend");
  bar.hidden = true;
  $("screen-send").classList.remove("pending");
};

const sendPicture = async () => {
  if (!nj?.model?.screen) { logWarn("areaScreen", t("screenNeedsKeyboard")); return; }
  const { width, height } = nj.model.screen;
  readForm();
  profile.screen.width = width;
  profile.screen.height = height;
  drawScreen();
  const canvas = $("screen-canvas");
  const capture = () => canvas.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, width, height).data;
  const slot = gif ? 0 : Number($("screen-slot").value) || 0;   // a still picture: its layer; a GIF: no layer (always the first)
  const bar = $("screen-progress");
  const progress = (done, total) => {
    bar.max = total;
    bar.value = done;
    $("screen-send").textContent = `${t("screenSending")} ${Math.round((done / total) * 100)}%`;
  };
  if (nj.client.family === "yc500") { await sendScreenNj81Ed(slot, capture, progress); return; }
  // a GIF goes as an animation: its frames (at most ANIMATION.MAX_FRAMES, long GIFs keep every n-th frame and add up the
  // delays), each drawn as the preview shows it; the preview keeps playing
  let animation = null;
  if (gif) {
    const step = Math.ceil(gif.frames.length / ANIMATION.MAX_FRAMES);
    const keep = gif.index;
    clearTimeout(gif.timer);
    animation = [];
    for (let i = 0; i < gif.frames.length; i += step) {
      showGifFrame(i);
      const ms = gif.frames.slice(i, i + step).reduce((sum, f) => sum + f.ms, 0);
      animation.push({ bytes: pictureBytes(capture(), width, height), ms, first: i === 0 ? capture() : null });
    }
    showGifFrame(keep);
    playGif(gif.playing);
  }
  const data = animation ? animation[0].first : capture();
  const sentFrame = document.createElement("canvas");
  sentFrame.width = width;
  sentFrame.height = height;
  sentFrame.getContext("2d").putImageData(new ImageData(data, width, height), 0, 0);
  bar.hidden = false;
  $("screen-send").disabled = true;
  try {
    if (animation) {
      await nj.client.uploadAnimation(animation, nj.model.screen, progress);
      logOk("areaScreen", `${t("animationSent")} (${animation.length} ${t("gifFrames")})`);
    } else {
      await nj.client.uploadPicture(slot, pictureBytes(data, width, height), nj.model.screen, progress);
      logOk("areaScreen", `${t("pictureSent")} ${slot + 1}`);
    }
    rememberPicture(sentFrame, animation ? 0 : slot);
  } catch (error) { logError("areaScreen", `${t("applyFailed")}: ${why(error)}`); }
  $("screen-send").disabled = false;
  $("screen-send").textContent = t("screenSend");
  bar.hidden = true;
  $("screen-send").classList.remove("pending");
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
const TAB_KEY = "nj81-config.tab";
/* The tab is kept for F5 only (sessionStorage): closing the page and opening it again starts on Lighting. */
try { localStorage.removeItem(TAB_KEY); } catch (error) { /* private mode */ }   // kept there by older versions
let currentTab = (() => { try { const saved = sessionStorage.getItem(TAB_KEY); return ["light", "keys", "macro", "screen", "profile", "share", "log", "guide"].includes(saved) ? saved : "light"; } catch (error) { return "light"; } })();
const TAB_SUB = { light: "subLight", keys: "subKeys", macro: "subMacro", screen: "subScreen", profile: "subProfile", share: "subShare", log: "subLog", guide: "subGuide" };
const TAB_TITLE = { light: "lighting", keys: "keysTab", macro: "macroTab", screen: "screen", profile: "profile", share: "shareTab", log: "log", guide: "guide" };
/* The Guide is long: it is drawn the first time its tab opens, and again only if the language changed since. */
let guideLanguage = "";
const showGuide = () => {
  if (currentTab !== "guide" || guideLanguage === currentLanguage()) { return; }
  guideLanguage = currentLanguage();
  renderGuide($("guide-body"), guideLanguage);
};
const showTab = (tab) => {
  currentTab = tab;
  try { sessionStorage.setItem(TAB_KEY, tab); } catch (error) { /* private mode */ }
  showGuide();
  queueMicrotask(() => { keys?.onTab(tab, ready); if (tab === "share") { share?.onShow(); } else { share?.onHide(); } });
  $("keyboard-panel").hidden = !ready || !["light", "keys", "screen"].includes(tab);
  for (const button of document.querySelectorAll("[data-tab]")) {
    if (button.dataset.tab === tab) { button.setAttribute("aria-current", "page"); } else { button.removeAttribute("aria-current"); }
  }
  for (const name of Object.keys(TAB_SUB)) {
    const panel = $(`tab-${name}`);
    panel.hidden = name !== tab || (panel.classList.contains("needs-keyboard") && !ready);
  }
  $("start-hint").hidden = ready || tab === "log" || tab === "guide" || tab === "share";
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
/* The pill next to the title, updated at each step of a change so the page answers the click at once:
   "sending" (clicked), "sent" (the write went out: the keyboard shows it now), then confirmed or reported otherwise. */
const setConfirm = (ok) => {
  const state = ok === "sending" || ok === "sent" ? ok : ok ? "ok" : "bad";
  $("confirm-pill").hidden = false;
  $("confirm-pill").classList.toggle("warn", state === "bad");
  $("confirm-pill").classList.toggle("pending", state === "sending" || state === "sent");
  $("confirm-text").textContent = t({ sending: "confirmSending", sent: "confirmSent", ok: "confirmOk", bad: "confirmBad" }[state]);
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
  } catch (error) { logError("areaConn", `${t("applyFailed")}: ${why(error)}`); }
};

/* What this keyboard model really has, learned by watching it while the user cycles effects with its own keys:
   { seen: [mode numbers in the order they came], done: bool, brightnessTop } */
const boardKey = () => `nj81-config.board.${nj?.deviceId ?? "none"}`;
const board = () => { try { return { seen: [], done: false, ...JSON.parse(localStorage.getItem(boardKey()) || "{}") }; } catch (error) { return { seen: [], done: false }; } };
const saveBoard = (value) => { try { localStorage.setItem(boardKey(), JSON.stringify(value)); } catch (error) { /* private mode */ } };
const modeLabel = (mode) => (currentLanguage() === "vi" && modeInfo(mode)?.vi) || modeInfo(mode)?.name || `${t("modeNumber")} ${mode}`;
/* A direction in the page's language (the driver's names). */
const optionLabel = (mode, index) => (currentLanguage() === "vi" && modeInfo(mode)?.viOptions?.[index]) || modeInfo(mode)?.options?.[index];
const modeChoices = () => {
  const known = board();
  // learned on this keyboard > the model's list on file > the full NJ81 table
  const list = known.done && known.seen.length ? known.seen : (nj?.model?.modes ?? MODES.map((m) => m.mode));
  const current = profile.lighting.nj81?.mode;
  return current && !list.includes(current) ? [...list, current] : list;
};
/* Effects that light only when a key is pressed (ripple, key shadow, radiant: checked on an NJ81-ED). */
const reactiveModes = () => REACTIVE_DEFAULT;
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
  // NJ81-ED (yc500): the official driver's record says 160x80 RGB565 with 5 picture slots ("layer 1-5"); pictures and
  // GIFs go out as the driver sends them (Royuan.uploadScreen).
  if (display && !model.screen && client.family === "yc500") { model = { ...model, screen: { width: 160, height: 80, slots: 5 } }; }
  else if (display && !model.screen) { model = { ...model, screen: { width: 160, height: 80, slots: 1, assumed: true } }; }
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
  } catch (error) { logError("areaLight", `${t("applyFailed")}: ${why(error)}`); }
  if (nj.client.family !== "gen2") { const known = board(); if (known.family !== nj.client.family) { known.family = nj.client.family; saveBoard(known); } }
  startWatching();
  // like the official driver, the clock is set on every connect, but a little later: it is a flash write too, and the
  // lighting must not wait a second behind it right after connecting
  if (display) { scheduleClock(5000); }
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
    if (njBusy || njDirty || screenBusy || Date.now() - lastLocalChange < 5000) { scheduleClock(2000); return; }   // lighting first: only when idle for 5 s
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
  } catch (error) { logError("areaClock", `${t("applyFailed")}: ${why(error)}`); }
  clockBusy = false;
  clockDoneAt = Date.now();
};

/* Puts what the keyboard reports into the form (on connect, and when it is changed with the keyboard's own keys). */
let lastBoardLight = "";
const showKeyboardLight = (light) => {
  lastDoneKey = "";   // the keyboard was read (on connect, or changed with its own keys): any choice is sent again
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
    // nobody sees the page while it is in the background: no reads then (it catches up when shown again)
    if (!document.hidden && !njBusy && !njDirty && !screenBusy && Date.now() - lastLocalChange > 3000) {
      try {
        const light = await nj.client.readLight();
        if (JSON.stringify(light) !== lastBoardLight && nj) {
          const learned = noteSeen(light);
          const raw = typeof light.off === "boolean" ? ` (${t("offSwitch")}: ${t(light.off ? "yes" : "no")}, ${t("brightness")} ${light.brightness})` : "";
          log(`${t("keyboardChanged")}: ${describeNj(light)}${raw}`, "kbd", "areaLight");
          if (learned && learning) { log(`${t("learnedMode")}: ${modeLabel(light.mode)} (${t("modeNumber")} ${light.mode})`, "ok", "areaLight"); }
          showKeyboardLight(light);
        }
      } catch (error) { /* unplugged or busy: try again next time */ }
    }
    watchTimer = setTimeout(tick, learning ? 700 : 2500);
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
  keys?.onDisconnect();
  const had = nj !== null;
  nj = null;
  clearTimeout(watchTimer);
  clearTimeout(clockTimer);
  if (learning) { learning = false; $("learn-box").hidden = true; $("learn-start").hidden = false; }
  updateScreenControls();
  $("device-info").hidden = true;
  if (had) { fillEffectOptions(); writeForm(); }
};

/* One log per connection: connecting starts an empty log, disconnecting clears it. */
const clearLog = () => { $("log").replaceChildren(); $("mini-log").replaceChildren(); };
session.addEventListener("connected", async (event) => {
  clearLog();
  effectReport.clear();
  $("effect-report").replaceChildren();
  setConnected(true, event.detail);
  const vendor = event.detail.collections.some((c) => c.usagePage === ROYUAN.USAGE_PAGE && ROYUAN.USAGES.includes(c.usage));
  if (!vendor) { logWarn("areaConn", t("njNoInterface")); return; }
  await detectNj81();
  finishBoot();
});
session.addEventListener("disconnected", () => { setConnected(false); dropKeyboard(); clearLog(); effectReport.clear(); $("effect-report").replaceChildren(); $("light-status").hidden = true; });

/* ---------- apply ---------- */
/* "Apply" (profile card): sends the whole profile's lighting to the keyboard. */
const apply = () => {
  readForm();
  if (nj) { pushNj81(); }
};

/* One write at a time, the latest settings win: the keyboard takes about one lighting write per second. */
let njBusy = false;
let lastDoneKey = "";   // the settings the keyboard last confirmed
let njDirty = false;
const describeNj = (s) => isOff(s) ? t("lightsOff")
  : `${modeLabel(s.mode)}${modeInfo(s.mode)?.options ? ` (${optionLabel(s.mode, s.option) ?? s.option})` : ""} · ${s.rainbow ? t("rainbowShort") : s.color} · ${t("brightness")} ${s.brightness}/${brightnessTop} · ${t("speed")} ${s.speed}/${LEVELS}`;
/* A setting's value in words, for the log and the status table. */
const FIELD_LABEL = { off: "fieldOff", mode: "effect", brightness: "brightness", speed: "speed", rainbow: "rainbowShort", color: "color", option: "direction" };
const fieldValue = (field, value, mode) => {
  if (field === "off" || field === "rainbow") { return t(value ? "yes" : "no"); }
  if (field === "mode") { return modeLabel(value); }
  if (field === "brightness") { return `${value}/${brightnessTop}`; }
  if (field === "speed") { return `${value}/${LEVELS}`; }
  if (field === "option") { return optionLabel(mode, value) ?? String(value); }
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
  $("effect-report").replaceChildren(...[...effectReport].map(([mode, r]) => {
    const item = Object.assign(document.createElement("span"), { className: "report-item", textContent: mode === OFF ? t("lightsOff") : modeLabel(mode) });
    item.append(Object.assign(document.createElement("span"), { className: `tag-state ${r.bad ? "bad" : "ok"}`, textContent: r.bad ? `${t("differs")}: ${r.issue}` : t("match") }));
    return item;
  }));
  $("light-status").hidden = false;
};

const pushNj81 = async () => {
  njDirty = true;
  if (nj) { setConfirm("sending"); }
  if (njBusy || !nj) { return; }
  njBusy = true;
  while (njDirty && nj) {
    njDirty = false;
    const settings = njSettings();
    const key = JSON.stringify(settings);
    if (key === lastDoneKey) { continue; }   // the same as what the keyboard already confirmed (a click fires input and change)
    lastDoneKey = "";   // something else goes out now: the keyboard no longer shows what was confirmed before
    const asked = Date.now();
    // newer settings are waiting: do not hold them up checking these. The same settings again are not newer.
    const superseded = () => {
      if (!njDirty) { return false; }
      if (JSON.stringify(njSettings()) === key) { njDirty = false; return false; }
      return true;
    };
    const onSent = () => { if (!njDirty) { setConfirm("sent"); } };
    try {
      let { light, diffs, sentAt, superseded: stale, unconfirmed } = await nj.client.writeLight(settings, { superseded, onSent });
      // the first write of this change (lights back on before the effect), waiting for the flash gap or a busy keyboard
      const sentAfter = Math.max(0, Math.round((sentAt ?? asked) - asked));
      if (unconfirmed) {   // sent, but the keyboard would not answer the read-back: the watch reads it again in a moment
        lastLocalChange = 0;
        setConfirm("sent");
        logWarn("areaLight", `${t("sentNotConfirmed")}: ${describeNj(settings)} (${t("sentAfter")} ${sentAfter} ms)`);
        continue;
      }
      let retried = false;
      if (diffs.length && !njDirty && !stale) {   // not taken: send the same once more (a write can be dropped while the keyboard is busy)
        log(`${t("retrying")}: ${describeDiffs(diffs, settings.mode)}`, "info", "areaLight");
        ({ light, diffs, superseded: stale } = await nj.client.writeLight(settings, { superseded, onSent }));
        retried = true;
      }
      if (stale) {   // sent, then a newer change came before the check: it goes out next and is reported
        if (light) { lastBoardLight = JSON.stringify(light); }
        log(`${t("replacedByNext")}: ${describeNj(settings)} (${t("sentAfter")} ${sentAfter} ms)`, "info", "areaLight");
        continue;
      }
      lastBoardLight = JSON.stringify(light);
      noteSeen(light);
      noteResult(settings, diffs);
      showStatus(settings, light, diffs);
      const typing = !settings.off && reactiveModes().has(settings.mode) ? ` · ${t("reactiveNote")}` : "";
      setConfirm(!diffs.length);
      const timing = ` (${t("sentAfter")} ${sentAfter} ms, ${t("confirmedAfter")} ${Date.now() - asked} ms)`;
      if (!diffs.length) { lastDoneKey = key; }
      if (!diffs.length) { logOk("areaLight", `${t("applied")}${retried ? ` (${t("afterRetry")})` : ""}: ${describeNj(settings)}${typing}${timing}`); }
      else { logWarn("areaLight", `${t("notApplied")} ${settings.off ? t("lightsOff") : modeLabel(settings.mode)}: ${describeDiffs(diffs, settings.mode)}`); }
    } catch (error) { logError("areaLight", `${t("applyFailed")}: ${why(error)}`); }
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
/* The page shows a full-screen loading until it is ready: built, the keyboard this site may use connected and read (or
   found missing), and the Library loaded (its first page of pictures and the NJ81-ED settings). At most 90 s (the very
   first visit reads the whole list of shared settings once). */
let booted = false;
let keyboardSettled = false;
let libraryReady = false;
const bootText = (text) => { const el = document.querySelector("#app-loading span"); if (el && text) { el.textContent = text; } };
const finishBoot = (force = false) => {
  if (booted) { return; }
  if (force !== true) { keyboardSettled = true; }
  if (force !== true && !(keyboardSettled && libraryReady)) { return; }
  booted = true;
  let gone = false;
  const lift = () => {
    if (gone) { return; }
    gone = true;
    const cover = $("app-loading");
    if (!cover) { return; }
    cover.classList.add("done");
    setTimeout(() => cover.remove(), 350);
  };
  requestAnimationFrame(() => requestAnimationFrame(lift));   // after the page has been painted once
  setTimeout(lift, 600);   // a browser that paints nothing (tab in the background) must not keep the cover
};

const init = () => {
  fillEffectOptions();
  const fillEffectNames = () => { const keep = $("effect").value; fillEffectOptions(); $("effect").value = keep; };   // "Lights off" is translated

  const applyLanguage = (language) => {
    setLanguage(language);
    showGuide();   // drawn only once the Guide tab is open
    for (const button of document.querySelectorAll("[data-lang]")) { button.setAttribute("aria-pressed", String(button.dataset.lang === language)); }
    fillEffectNames();
    refreshOptionControl();   // directions in the new language
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
  $("screen-clear-all").addEventListener("click", clearScreenAll);
  $("screen-slot").addEventListener("change", () => showLastPicture());
  $("gif-frame").addEventListener("input", (event) => { if (gif) { playGif(false); showGifFrame(Number(event.target.value)); } });
  buildGallery();
  keys = initKeys({ $, t, log, logOk, logWarn, logError, why, getNj: () => nj, keyEls, KEYS });
  share = initShare({
    $, t, logOk, logWarn, logError, why, getNj: () => nj,
    /* a shared picture / GIF goes to the Screen tab, ready to send */
    usePicture: async (file) => { await loadScreenFile(file); $("screen-send").classList.add("pending"); showTab("screen"); },
    /* a shared lighting setting: into the form, then sent as any change made here */
    applyLight: async (light, name) => {
      if (!nj) { logWarn("areaShare", t("screenNeedsKeyboard")); return; }
      profile = validateProfile({
        ...profile,
        lighting: { ...profile.lighting, color: light.color, brightness: fromLevel(Math.min(light.brightness, brightnessTop), brightnessTop), speed: fromLevel(light.speed),
          nj81: { mode: light.off ? profile.lighting.nj81?.mode || 1 : light.mode, option: light.option, rainbow: light.rainbow, off: light.off } },
      }).profile;
      fillEffectOptions();
      writeForm();
      logOk("areaShare", `${name}: ${describeNj(light)}`);
      apply();
    },
    applyKeys: async (list, name, fnLayer) => {
      if (!nj) { logWarn("areaShare", t("screenNeedsKeyboard")); return; }
      if (!window.confirm(`${t(fnLayer ? "shareKeysConfirmFn" : "shareKeysConfirm")} (${list.length})`)) { return; }
      await keys.applyShared(list, name, fnLayer);
    },
    describeLight: (light) => describeNj(light),
    describeKey: (v, bytes) => {
      const action = decodeAction(bytes);
      return `${keyLabel(v.original)} → ${action.type === "disabled" ? t("actDisabled") : describeAction(action)}`;
    },
  });
  restoreChosen();   // the picture this browser chose last time
  $("learn-start").addEventListener("click", () => setLearning(true));
  $("learn-done").addEventListener("click", () => setLearning(false));
  for (const swatch of PRESET_COLOURS) {
    const button = Object.assign(document.createElement("button"), { type: "button", className: "swatch", title: swatch });
    button.style.background = swatch;
    button.addEventListener("click", () => { $("color").value = swatch; onFormChange({ target: $("color") }); scheduleLive(); });
    $("swatches").insertBefore(button, $("swatches").querySelector(".custom"));
  }
  // "Clear log" (Status and Log): empties both views of the log; the keyboard is not touched
  for (const clear of document.querySelectorAll(".clear-log")) {
    clear.addEventListener("click", clearLog);
  }
  for (const tab of document.querySelectorAll("[data-tab]")) { tab.addEventListener("click", () => showTab(tab.dataset.tab)); }
  $("mini-clock").addEventListener("click", () => { if (nj) { syncClock(); } });
  $("show-modes").addEventListener("click", () => { const known = board(); known.done = false; saveBoard(known); const keep = $("effect").value; fillEffectOptions(); $("effect").value = keep; refreshOptionControl(); });  $("screen-file").addEventListener("change", onScreenFile);
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
    if (autoConnect()) { session.reconnect().then((device) => { if (!device) { finishBoot(); } }).catch(finishBoot); } else { finishBoot(); }
    navigator.hid.addEventListener("disconnect", (event) => { if (event.device === session.device) { session.close(); } });
  }
  else { finishBoot(); }
  share.preload(bootText).catch(() => {}).finally(() => { libraryReady = true; if (keyboardSettled) { finishBoot(); } });
  setTimeout(() => finishBoot(true), 90000);
  requestAnimationFrame(frame);
};

init();
