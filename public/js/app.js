/* Wires the page together: connection, lighting preview, screen, profiles, log. */
import { EFFECTS, defaultProfile, parseProfile, serializeProfile, validateProfile } from "./profile.js";
import { KEYS, LAYOUT_HEIGHT, LAYOUT_WIDTH, SCREEN_TILE } from "./layout.js";
import { keyColor } from "./lighting.js";
import { HidSession, hex4, hidSupported } from "./hid.js";
import { Nj81Driver, SimulationDriver, ViaDriver } from "./drivers.js";
import { CHANNEL, RGB_EFFECTS, VIA, Via, previewEffectFor } from "./via.js";
import { LEVELS, MODES, OFF, ROYUAN, Royuan, isOff, isWritable, modeInfo, pictureBytes } from "./royuan.js";
import { hueSatToHex, rgbToHex } from "./util.js";
import { languages, setLanguage, t } from "./i18n.js";

const $ = (id) => document.getElementById(id);
const STORAGE_KEY = "nj81-config.profiles";
const FRAME_MS = 50;

let profile = defaultProfile();
const pressed = new Set();
const session = new HidSession();
const keyEls = new Map();
let screenPixels = null;
let via = null;          // a Via client once a VIA keyboard answered
let viaChannel = null;   // which RGB channel of the keyboard we control
let nj = null;           // { client, model, deviceId, firmware } once a Keydous NJ81 (vendor protocol) answered

/* The NJ81 has 5 steps (0-4) for brightness and speed; the sliders keep 0-100 and snap to 25s. */
const toLevel = (percent) => Math.round((percent / 100) * LEVELS);
const fromLevel = (value) => Math.round((value / LEVELS) * 100);
const PREVIEW_FOR_MODE = { 1: "static", 2: "breathing", 3: "spectrum", 4: "wave", 5: "reactive", 8: "reactive" };
const njSettings = () => ({
  mode: profile.lighting.nj81?.mode ?? 1,
  option: profile.lighting.nj81?.option ?? 0,
  rainbow: profile.lighting.nj81?.rainbow ?? false,
  speed: toLevel(profile.lighting.speed),
  brightness: toLevel(profile.lighting.brightness),
  off: profile.lighting.nj81?.off ?? false,   // the client turns this into brightness 0 (gen2) or the backlight-off bit (yc500)
  color: profile.lighting.color,
});
const njPreview = (nj81) => (nj81.off ? "off" : nj81.rainbow ? "spectrum" : PREVIEW_FOR_MODE[nj81.mode] ?? "static");
let clockOffsetMs = 0;   // standard time minus this computer's clock
const standardNow = () => new Date(Date.now() + clockOffsetMs);

/* ---------- log ---------- */
const log = (message) => {
  const box = $("log");
  box.textContent += `${new Date().toLocaleTimeString()}  ${message}\n`;
  box.scrollTop = box.scrollHeight;
};

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
        return { nj81, effect: njPreview(nj81) };
      })() : via ? { viaEffect: Number($("effect").value), effect: previewEffectFor(Number($("effect").value)) } : { effect: $("effect").value }),
    },
    screen: profile.screen,
  }).profile;
  profile = next;
};

const writeForm = () => {
  $("profile-name").value = profile.name;
  $("effect").value = nj ? String(profile.lighting.nj81?.off ? OFF : profile.lighting.nj81?.mode ?? 1) : via ? String(profile.lighting.viaEffect ?? 1) : profile.lighting.effect;
  refreshOptionControl();
  const option = String(profile.lighting.nj81?.option ?? 0);
  if ([...$("light-option").options].some((o) => o.value === option)) { $("light-option").value = option; }
  $("rainbow").checked = profile.lighting.nj81?.rainbow ?? false;
  $("color").value = profile.lighting.color;
  $("brightness").value = profile.lighting.brightness;
  $("speed").value = profile.lighting.speed;
  $("brightness-out").textContent = profile.lighting.brightness;
  $("speed-out").textContent = profile.lighting.speed;
  updatePaintControls();
  drawScreen();
};

const updatePaintControls = () => {
  const painting = profile.lighting.effect === "perkey";
  for (const id of ["paint-help", "fill-all", "clear-all"]) { $(id).hidden = !painting; }
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
  $("show-modes").hidden = !nj || hiddenModes().size === 0;
  const options = info?.options ?? [];
  const keep = $("light-option").value;
  $("light-option").replaceChildren(...options.map((name, i) => new Option(name, String(i))));
  if (options.length) { $("light-option").value = keep !== "" && options[Number(keep)] ? keep : "0"; }
  $("light-option-box").hidden = options.length === 0;
  $("rainbow-box").hidden = !nj || !info || Boolean(info.noColor) || off;
  for (const id of ["brightness", "speed"]) { $(id).step = nj ? String(100 / LEVELS) : "1"; }
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
  $("brightness-out").textContent = profile.lighting.brightness;
  $("speed-out").textContent = profile.lighting.speed;
  updatePaintControls();
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
    el.textContent = key.label;
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

const onKeyClick = (key) => {
  if (profile.lighting.effect === "perkey") {
    profile.lighting.perKey[key.id] = $("color").value.toLowerCase();
  } else {
    pressed.add(key.id);
    setTimeout(() => pressed.delete(key.id), 450);
  }
};

const paintKeyboard = (time) => {
  for (const key of KEYS) {
    const [red, green, blue] = keyColor(profile, key, time, pressed);
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
  const tile = $("screen-tile");
  if (tile) {
    tile.width = width;
    tile.height = height;
    tile.getContext("2d").drawImage(canvas, 0, 0);
  }
};

const onScreenFile = async (event) => {
  const [file] = event.target.files;
  if (!file) { return; }
  try {
    screenPixels = await createImageBitmap(file);
    profile.screen.name = file.name;
    $("screen-name").textContent = `${file.name} · ${screenPixels.width}×${screenPixels.height} → ${profile.screen.width}×${profile.screen.height}`;
    drawScreen();
    log(`${t("screenImage")}: ${file.name} (${screenPixels.width}×${screenPixels.height})`);
  } catch (error) { log(`${t("importFailed")}: ${error.message}`); }
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
  if (!nj?.model?.screen || $("simulation").checked) { log(t("screenNeedsKeyboard")); return; }
  const { width, height } = nj.model.screen;
  readForm();
  profile.screen.width = width;
  profile.screen.height = height;
  drawScreen();
  const canvas = $("screen-canvas");
  const { data } = canvas.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, width, height);
  const slot = Number($("screen-slot").value);
  const bar = $("screen-progress");
  bar.hidden = false;
  $("screen-send").disabled = true;
  try {
    await nj.client.uploadPicture(slot, pictureBytes(data, width, height), nj.model.screen, (done, total) => { bar.max = total; bar.value = done; });
    log(`${t("pictureSent")} ${slot + 1}`);
  } catch (error) { log(`${t("applyFailed")}: ${error.message}`); }
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
    if (down) { pressed.add(key.id); setTimeout(() => pressed.delete(key.id), 450); }
  }
};

const download = (name, data, type) => {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const link = Object.assign(document.createElement("a"), { href: url, download: name });
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};


/* ---------- connection ---------- */
const setConnected = (on, detail) => {
  const status = $("status");
  status.className = `chip ${on ? "on" : "off"}`;
  status.textContent = t(on ? "status_on" : "status_off");
  status.dataset.i18n = on ? "status_on" : "status_off";
  $("connect").hidden = on;
  $("connect-other").hidden = on;
  $("disconnect").hidden = !on;
  const name = $("device-name");
  name.hidden = !on;
  if (on && detail) { name.textContent = `${detail.name} · VID ${hex4(detail.vendorId)} · PID ${hex4(detail.productId)}`; }
  if (on && detail) {   // the interfaces, in the log, to help when something does not work
    log(`${detail.name} VID ${hex4(detail.vendorId)} PID ${hex4(detail.productId)}: ` +
      detail.collections.map((c) => `${hex4(c.usagePage)}/${hex4(c.usage)}${c.featureReports.length ? " feature" : ""}`).join(", "));
  }
};

/* Any Keydous vendor id (every interface), any vendor collection, and VIA keyboards. */
const DEVICE_FILTERS = [
  ...ROYUAN.VENDOR_IDS.map((vendorId) => ({ vendorId })),
  { usagePage: ROYUAN.USAGE_PAGE },
  { usagePage: VIA.USAGE_PAGE, usage: VIA.USAGE },
];

const connect = async (filters) => {
  try {
    const device = await session.request(filters);
    if (!device) { log(t("noDevicePicked")); }
  } catch (error) { log(`${t("applyFailed")}: ${error.message}`); }
};

/* ---------- reading what the keyboard is set to (VIA) ---------- */
/* Effects this keyboard does not run (it did not keep them, or the user hid them), remembered per keyboard model. */
const modesKey = () => `nj81-config.hidden-modes.${nj?.deviceId ?? "none"}`;
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
  log(`${t("modeHidden")}: ${modeInfo(mode)?.name ?? mode}`);
};

const fillEffectOptions = () => {
  const options = nj ? [new Option(t("lightsOff"), String(OFF)), ...MODES.filter((m) => !hiddenModes().has(m.mode)).map((m) => new Option(m.name, String(m.mode)))] : via ? RGB_EFFECTS.map((effect) => new Option(effect.label, String(effect.id))) : EFFECTS.map((id) => new Option(t(`effect_${id}`), id));
  $("effect").replaceChildren(...options);
};

const detectVia = async (detail) => {
  const hasRaw = detail.collections.some((c) => c.usagePage === VIA.USAGE_PAGE && c.usage === VIA.USAGE);
  if (!hasRaw) { log(t("viaNoRawHid")); return; }
  const client = new Via((bytes) => session.transact(bytes));
  let version;
  try { version = await client.protocolVersion(); } catch (error) { log(`${t("viaNoAnswer")} (${error.message})`); return; }
  const layers = await client.layerCount().catch(() => "?");
  let found = null;
  for (const [name, channel] of [["rgb_matrix", CHANNEL.RGB_MATRIX], ["rgblight", CHANNEL.RGBLIGHT]]) {
    try { found = { name, channel, values: await client.getRgb(channel) }; break; } catch (error) { /* try the next channel */ }
  }
  const info = $("via-info");
  info.hidden = false;
  if (!found) {
    info.textContent = `VIA v${version} · ${layers} layers · ${t("viaNoRgb")}`;
    log(t("viaNoRgb"));
    return;
  }
  via = client;
  viaChannel = found.channel;
  const { brightness, speed, effect, hue, saturation } = found.values;
  profile = validateProfile({
    ...profile,
    lighting: { ...profile.lighting, effect: previewEffectFor(effect), viaEffect: effect, color: hueSatToHex(hue, saturation),
      brightness: Math.round((brightness / 255) * 100), speed: Math.round((speed / 255) * 100) },
  }).profile;
  fillEffectOptions();
  writeForm();
  $("simulation").checked = false;   // a real keyboard answered: send for real
  info.textContent = `VIA v${version} · ${layers} layers · ${found.name} · effect ${effect} · brightness ${brightness}/255 · speed ${speed}/255 · hue ${hue} sat ${saturation}`;
  log(`${t("viaReady")}: ${info.textContent}`);
};

/* Keydous NJ81 (vendor protocol): identify the model, then read its current lighting into the form. */
const detectNj81 = async () => {
  const client = new Royuan(session.featureTransport());
  let id;
  try { id = await client.identify(); } catch (error) { log(`${t("njNoAnswer")} (${error.message})`); return false; }
  const info = $("via-info");
  info.hidden = false;
  info.textContent = `${id.model.name} · id ${id.deviceId} · firmware ${id.firmware}`;
  let model = id.model;
  if (!isWritable(model)) {   // older boards: ask which command set they speak (reads only)
    const family = await client.probeFamily().catch(() => null);
    if (!family) { log(`${t("njUnsupported")}: ${info.textContent}`); return true; }
    client.family = family;
    model = { ...model, family, screen: model.screen ?? null };
    info.textContent += ` · ${family}`;
    log(`${t("familyDetected")}: ${family}`);
  }
  const display = Boolean(model.screen) || await client.hasDisplay().catch(() => false);
  nj = { client, ...id, model, display };
  try {
    const [light, active] = [await client.readLight(), await client.profile().catch(() => null)];
    profile = validateProfile({
      ...profile,
      lighting: { ...profile.lighting, color: light.color, brightness: fromLevel(light.brightness), speed: fromLevel(light.speed),
        nj81: { mode: modeInfo(light.mode) ? light.mode : 1, option: light.option, rainbow: light.rainbow, off: isOff(light) },
        effect: njPreview({ ...light, off: isOff(light) }) },
      screen: model.screen ? { ...profile.screen, width: model.screen.width, height: model.screen.height } : profile.screen,
    }).profile;
    fillEffectOptions();
    writeForm();
    $("simulation").checked = false;   // the keyboard answered: changes go to it for real
    const mode = isOff(light) ? t("lightsOff") : modeInfo(light.mode)?.name ?? `mode ${light.mode}`;
    info.textContent += ` · profile ${active === null ? "?" : active + 1} · ${mode} · ${light.rainbow ? "rainbow" : light.color} · brightness ${light.brightness}/4 · speed ${light.speed}/4`;
    log(`${t("viaReady")}: ${info.textContent}`);
  } catch (error) { log(`${t("applyFailed")}: ${error.message}`); }
  if (display) { await syncClock(); }   // like the official driver: set the screen's clock on every connect
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

const syncClock = async () => {
  try {
    const fromServer = await measureClock();
    await nj.client.setClock(standardNow);
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const drift = Math.round(clockOffsetMs / 1000);
    log(`${t("clockSent")}: ${standardNow().toLocaleString()} (${zone}${fromServer ? `, ${t("clockStandard")}${drift ? `, ${t("clockDrift")} ${drift}s` : ""}` : ""})`);
  } catch (error) { log(`${t("applyFailed")}: ${error.message}`); }
};

const dropVia = () => {
  const wasVia = via !== null || nj !== null;
  via = null;
  nj = null;
  updateScreenControls();
  viaChannel = null;
  $("via-info").hidden = true;
  if (wasVia) { fillEffectOptions(); profile.lighting.effect = "static"; writeForm(); }
};

session.addEventListener("connected", async (event) => {
  setConnected(true, event.detail);
  const vendor = event.detail.collections.some((c) => c.usagePage === ROYUAN.USAGE_PAGE && ROYUAN.USAGES.includes(c.usage));
  if (vendor && await detectNj81()) { return; }
  await detectVia(event.detail);
});
session.addEventListener("disconnected", () => { setConnected(false); dropVia(); });

/* ---------- apply ---------- */
const apply = async () => {
  readForm();
  if (nj && !$("simulation").checked) { pushNj81(); return; }
  const driver = $("simulation").checked ? new SimulationDriver() : via ? new ViaDriver(via, viaChannel, true) : new Nj81Driver(session);
  try {
    const result = await driver.apply(profile, log);
    log(`${t("applied")} (${driver.name}${result && result.sent === false ? ", nothing sent" : ""})`);
  } catch (error) { log(`${t("applyFailed")}: ${error.message}`); }
};

/* Changes in the form reach a VIA keyboard right away (not saved in its memory until "Apply"). */
let liveTimer = null;
/* One write at a time, the latest settings win: the keyboard takes about one lighting write per second. */
let njBusy = false;
let njDirty = false;
const describeNj = (s) => s.off || s.brightness === 0 ? t("lightsOff")
  : `${modeInfo(s.mode)?.name ?? s.mode}${modeInfo(s.mode)?.options ? ` (${modeInfo(s.mode).options[s.option]})` : ""} · ${s.rainbow ? "rainbow" : s.color} · ${t("brightness")} ${s.brightness}/4 · ${t("speed")} ${s.speed}/4`;
const pushNj81 = async () => {
  njDirty = true;
  if (njBusy || !nj) { return; }
  njBusy = true;
  while (njDirty && nj) {
    njDirty = false;
    const settings = njSettings();
    try {
      const { kept, light } = await nj.client.writeLight(settings);
      log(kept ? `${t("applied")}: ${describeNj(settings)}` : `${t("notKept")}: ${describeNj(settings)} → ${describeNj({ ...light, mode: light.mode })}`);
      if (!kept && !settings.off && light.mode !== settings.mode && modeInfo(settings.mode)) {   // the keyboard refused this effect
        log(`${t("modeRefused")}: ${modeInfo(settings.mode).name}`);
        hideMode(settings.mode);
      }
    } catch (error) { log(`${t("applyFailed")}: ${error.message}`); }
  }
  njBusy = false;
};

const scheduleLive = () => {
  if (nj && !$("simulation").checked) { pushNj81(); return; }
  if (!via || $("simulation").checked) { return; }
  clearTimeout(liveTimer);
  liveTimer = setTimeout(async () => {
    try { await new ViaDriver(via, viaChannel, false).apply(profile, () => {}); } catch (error) { log(`${t("applyFailed")}: ${error.message}`); }
  }, 120);
};

/* ---------- profiles ---------- */
const saveLocal = () => {
  readForm();
  const all = readSaved();
  all[profile.name] = JSON.parse(serializeProfile(profile));
  writeSaved(all);
  refreshSavedList();
  $("saved-list").value = profile.name;
  log(`${t("saved")}: ${profile.name}`);
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
  if (!result.ok) { log(`${t("importFailed")}: ${result.errors.join("; ")}`); }
  if (result.ok) { profile = result.profile; writeForm(); log(`${t("imported")}: ${profile.name}`); }
  event.target.value = "";
};

/* ---------- start ---------- */
const init = () => {
  fillEffectOptions();
  const fillEffectNames = () => { if (!via) { const keep = $("effect").value; fillEffectOptions(); $("effect").value = keep; } };

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
  $("disconnect").addEventListener("click", () => session.close());
  for (const id of ["effect", "color", "brightness", "speed", "profile-name", "light-option", "rainbow"]) { $(id).addEventListener("input", onFormChange); }
  // the keyboard gets a setting once it is chosen (slider released, colour picked), not on every step of a drag
  for (const id of ["effect", "color", "brightness", "speed", "light-option", "rainbow"]) {
    $(id).addEventListener("change", (event) => { scheduleLive(); if (event.target.tagName === "SELECT" || event.target.type === "range") { event.target.blur(); } });
  }
  // a mouse click must not leave the button focused, or the next key press on the keyboard would trigger it again
  document.addEventListener("click", (event) => { if (event.detail > 0 && event.target.closest("button")) { event.target.closest("button").blur(); } });
  $("screen-send").addEventListener("click", sendPicture);
  $("screen-clock").addEventListener("click", () => { if (nj) { syncClock(); } });
  window.addEventListener("keydown", (event) => {
    showKey(event.code, true);
    // outside a text box a key press only lights the drawing: no scrolling, no menu changes, no browser shortcuts (F11/F12 stay)
    if (!isTyping(document.activeElement) && event.code !== "F11" && event.code !== "F12") { event.preventDefault(); }
  });
  window.addEventListener("keyup", (event) => showKey(event.code, false));
  window.addEventListener("blur", () => { for (const el of keyEls.values()) { el.classList.remove("down"); } });
  $("screen-fit").addEventListener("change", (event) => { drawScreen(); event.target.blur(); });
  $("hide-mode").addEventListener("click", () => { const mode = Number($("effect").value); if (modeInfo(mode)) { hideMode(mode); } });
  $("show-modes").addEventListener("click", () => { setHiddenModes(new Set()); const keep = $("effect").value; fillEffectOptions(); $("effect").value = keep; refreshOptionControl(); });  $("screen-file").addEventListener("change", onScreenFile);
  $("fill-all").addEventListener("click", () => { for (const key of KEYS) { profile.lighting.perKey[key.id] = $("color").value.toLowerCase(); } });
  $("clear-all").addEventListener("click", () => { profile.lighting.perKey = {}; });
  $("save-local").addEventListener("click", saveLocal);
  $("load-local").addEventListener("click", loadLocal);
  $("export-json").addEventListener("click", () => { readForm(); download(`${profile.name || "profile"}.nj81.json`, serializeProfile(profile), "application/json"); });
  $("import-json").addEventListener("change", importJson);
  $("apply").addEventListener("click", apply);

  buildKeyboard();
  applyCaps((() => { try { return localStorage.getItem(CAPS_KEY); } catch (error) { return null; } })() === "black" ? "black" : "white");
  $("caps").addEventListener("change", (event) => { applyCaps(event.target.value); event.target.blur(); });
  updateScreenControls();
  writeForm();
  refreshSavedList();
  setConnected(false);
  log(hidSupported() ? "WebHID ok" : "WebHID not available");
  if (hidSupported()) {
    session.reconnect().catch(() => {});   // a keyboard this site was already allowed to use connects by itself
    navigator.hid.addEventListener("disconnect", (event) => { if (event.device === session.device) { session.close(); } });
  }
  requestAnimationFrame(frame);
};

init();
