/* Wires the page together: connection, lighting preview, screen, profiles, protocol lab, log. */
import { EFFECTS, SCREEN_LIMIT, defaultProfile, parseProfile, serializeProfile, validateProfile } from "./profile.js";
import { KEYS, LAYOUT_HEIGHT, LAYOUT_WIDTH } from "./layout.js";
import { keyColor } from "./lighting.js";
import { HidSession, hex4, hidSupported } from "./hid.js";
import { Nj81Driver, SimulationDriver } from "./drivers.js";
import { bytesToHex, hexToBytes, rgbToHex, rgbaToRgb565Bytes } from "./util.js";
import { languages, setLanguage, t } from "./i18n.js";

const $ = (id) => document.getElementById(id);
const STORAGE_KEY = "nj81-config.profiles";
const FRAME_MS = 50;

let profile = defaultProfile();
const pressed = new Set();
const session = new HidSession();
const keyEls = new Map();
let screenPixels = null;

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
    lighting: { ...profile.lighting, effect: $("effect").value, color: $("color").value, brightness: $("brightness").value, speed: $("speed").value },
    screen: { ...profile.screen, width: $("screen-w").value, height: $("screen-h").value },
  }).profile;
  profile = next;
};

const writeForm = () => {
  $("profile-name").value = profile.name;
  $("effect").value = profile.lighting.effect;
  $("color").value = profile.lighting.color;
  $("brightness").value = profile.lighting.brightness;
  $("speed").value = profile.lighting.speed;
  $("brightness-out").textContent = profile.lighting.brightness;
  $("speed-out").textContent = profile.lighting.speed;
  $("screen-w").value = profile.screen.width;
  $("screen-h").value = profile.screen.height;
  updatePaintControls();
  drawScreen();
};

const updatePaintControls = () => {
  const painting = profile.lighting.effect === "perkey";
  for (const id of ["paint-help", "fill-all", "clear-all"]) { $(id).hidden = !painting; }
};

const onFormChange = () => {
  readForm();
  $("brightness-out").textContent = profile.lighting.brightness;
  $("speed-out").textContent = profile.lighting.speed;
  updatePaintControls();
  drawScreen();
};

/* ---------- keyboard preview ---------- */
const buildKeyboard = () => {
  const box = $("keyboard");
  const surface = document.createElement("div");
  surface.className = "keys";
  surface.style.aspectRatio = `${LAYOUT_WIDTH} / ${LAYOUT_HEIGHT}`;
  for (const key of KEYS) {
    const el = document.createElement("button");
    el.type = "button";
    el.className = "key";
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
    el.style.background = rgbToHex(red, green, blue);
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
    const scale = Math.min(width / screenPixels.width, height / screenPixels.height);   // fit, keep the proportions
    const w = screenPixels.width * scale;
    const h = screenPixels.height * scale;
    context.drawImage(screenPixels, (width - w) / 2, (height - h) / 2, w, h);
  }
};

const onScreenFile = async (event) => {
  const [file] = event.target.files;
  if (!file) { return; }
  try {
    screenPixels = await createImageBitmap(file);
    profile.screen.name = file.name;
    drawScreen();
    log(`${t("screenImage")}: ${file.name} (${screenPixels.width}×${screenPixels.height})`);
  } catch (error) { log(`${t("importFailed")}: ${error.message}`); }
};

const download = (name, data, type) => {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const link = Object.assign(document.createElement("a"), { href: url, download: name });
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const exportRgb565 = () => {
  const canvas = $("screen-canvas");
  const { data } = canvas.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, canvas.width, canvas.height);
  download(`screen-${canvas.width}x${canvas.height}.rgb565.bin`, rgbaToRgb565Bytes(data), "application/octet-stream");
  log(`RGB565 ${canvas.width}×${canvas.height}, ${canvas.width * canvas.height * 2} bytes`);
};

/* ---------- connection ---------- */
const setConnected = (on, detail) => {
  const status = $("status");
  status.className = `chip ${on ? "on" : "off"}`;
  status.textContent = t(on ? "status_on" : "status_off");
  status.dataset.i18n = on ? "status_on" : "status_off";
  $("connect").hidden = on;
  $("disconnect").hidden = !on;
  const name = $("device-name");
  name.hidden = !on;
  if (on && detail) { name.textContent = `${detail.name} · VID ${hex4(detail.vendorId)} · PID ${hex4(detail.productId)}`; }
  $("lab-device").textContent = on && detail ? labDeviceText(detail) : "-";
  updateLabButtons();
};

const labDeviceText = (detail) => [
  `${detail.name}  VID ${hex4(detail.vendorId)}  PID ${hex4(detail.productId)}`,
  ...detail.collections.map((c, i) =>
    `#${i} usagePage ${hex4(c.usagePage)} usage ${hex4(c.usage)}  in [${c.inputReports}]  out [${c.outputReports}]  feature [${c.featureReports}]`),
].join("\n");

const connect = async () => {
  try {
    const device = await session.request();
    if (device) { log(`${t("status_on")}: ${device.productName || "?"}`); }
  } catch (error) { log(`${t("applyFailed")}: ${error.message}`); }
};

session.addEventListener("connected", (event) => setConnected(true, event.detail));
session.addEventListener("disconnected", () => setConnected(false));
session.addEventListener("report", (event) => {
  const box = $("lab-log");
  if (box.textContent === "-") { box.textContent = ""; }
  box.textContent += `${new Date(event.detail.time).toLocaleTimeString()}  id ${event.detail.reportId}  ${event.detail.hex}\n`;
  box.scrollTop = box.scrollHeight;
});

/* ---------- apply ---------- */
const apply = async () => {
  readForm();
  const driver = $("simulation").checked ? new SimulationDriver() : new Nj81Driver(session);
  try {
    const result = await driver.apply(profile, log);
    log(`${t("applied")} (${driver.name}${result && result.sent === false ? ", nothing sent" : ""})`);
  } catch (error) { log(`${t("applyFailed")}: ${error.message}`); }
};

/* ---------- protocol lab ---------- */
const updateLabButtons = () => {
  const ready = $("lab-enable").checked && session.device !== null;
  $("lab-send").disabled = !ready;
  $("lab-read").disabled = !ready;
};

const labSend = async () => {
  try {
    const bytes = hexToBytes($("lab-bytes").value);
    const reportId = Number($("lab-report").value);
    await session.send($("lab-kind").value, reportId, bytes);
    log(`lab ${$("lab-kind").value} id ${reportId}: ${bytesToHex(bytes)}`);
  } catch (error) { log(`lab: ${error.message}`); }
};

const labRead = async () => {
  try {
    const reportId = Number($("lab-report").value);
    log(`lab feature id ${reportId} -> ${await session.readFeature(reportId)}`);
  } catch (error) { log(`lab: ${error.message}`); }
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
  $("effect").replaceChildren(...EFFECTS.map((id) => new Option("", id)));
  const fillEffectNames = () => { for (const option of $("effect").options) { option.textContent = t(`effect_${option.value}`); } };

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
  $("connect").addEventListener("click", connect);
  $("disconnect").addEventListener("click", () => session.close());
  for (const id of ["effect", "color", "brightness", "speed", "screen-w", "screen-h", "profile-name"]) { $(id).addEventListener("input", onFormChange); }
  $("screen-w").min = $("screen-h").min = SCREEN_LIMIT.min;
  $("screen-w").max = $("screen-h").max = SCREEN_LIMIT.max;
  $("screen-file").addEventListener("change", onScreenFile);
  $("screen-export").addEventListener("click", exportRgb565);
  $("fill-all").addEventListener("click", () => { for (const key of KEYS) { profile.lighting.perKey[key.id] = $("color").value.toLowerCase(); } });
  $("clear-all").addEventListener("click", () => { profile.lighting.perKey = {}; });
  $("save-local").addEventListener("click", saveLocal);
  $("load-local").addEventListener("click", loadLocal);
  $("export-json").addEventListener("click", () => { readForm(); download(`${profile.name || "profile"}.nj81.json`, serializeProfile(profile), "application/json"); });
  $("import-json").addEventListener("change", importJson);
  $("apply").addEventListener("click", apply);
  $("lab-enable").addEventListener("change", updateLabButtons);
  $("lab-send").addEventListener("click", labSend);
  $("lab-read").addEventListener("click", labRead);
  $("lab-clear").addEventListener("click", () => { $("lab-log").textContent = "-"; });

  buildKeyboard();
  writeForm();
  refreshSavedList();
  setConnected(false);
  log(hidSupported() ? "WebHID ok" : "WebHID not available");
  requestAnimationFrame(frame);
};

init();
