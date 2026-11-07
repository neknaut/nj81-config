/* The Keys tab, working as the official driver's main page (Keydous Driver 3.2.23):
   - the drawing: a key with a setting of its own is tinted cyan (#23FFE9), a forbidden key yellow (#FFFF00), the picked key
     has a red border, and hovering a set key shows its name and what it does. With the Fn layer on, every key that does
     something with Fn is a set key.
   - picking a key loads what it does now into the editor (the driver's "oldValue"); Fn and other system keys cannot be picked.
   - left card: Fn-layer switch, "read the current setting", the key's setting on the first layer and on the Fn layer.
   - big card: Key / Macro / Media / Mouse, then Forbidden (writes at once), Reset (writes at once) and Confirm (writes the
     editor's value). Key: up to two of Ctrl / Alt / Shift / Win plus a key, typed or picked on the on-screen keyboard.
     Media / Mouse / Macro: one tick, a second click clears it. Macro: Loop N times, Auto (on / off) or While pressed.
   Every write is read back and logged. */
import {
  HID_KEYS, MEDIA, MOUSE, NJ81ED_DEFAULT, NJ81ED_FN_POSITION, decodeAction, decodeMacro, describeAction,
  describeMacro, encodeAction, encodeMacro, hidForCode, keyLabel, macroFromRecording, setActionLabels,
} from "./keymap.js";

export const MACRO_SLOTS = 8;
const MOD_CODE = { ctrl: 224, alt: 226, shift: 225, win: 227 };
const MOD_OF = { 224: "ctrl", 226: "alt", 225: "shift", 227: "win" };

export const initKeys = (ctx) => {
  const { $, t, logOk, logWarn, logError, why, getNj, keyEls, KEYS } = ctx;
  const state = {
    fn: false, profile: 0, normalMap: null, fnMap: null, selected: null, category: "key",
    pending: null,   // the editor's value, as the driver's oldValue: an action, or null when nothing is chosen
    macros: null,    // what each macro slot holds: { repeat, events } (read when the Macro list is first shown)
    recording: null, macroEvents: [],
  };
  setActionLabels({ media: (id) => t(`media_${id}`), mouse: (id) => t(`mouse_${id}`), macro: t("macro"), special: t("keysSpecial") });

  /* matrix position <-> layout key */
  const keyByPosition = new Map();
  const positionByKey = new Map();
  NJ81ED_DEFAULT.forEach((hid, position) => {
    if (!hid) { return; }
    const code = HID_KEYS.find((k) => k.hid === hid)?.code;
    const layoutKey = KEYS.find((k) => k.code === code && !positionByKey.has(k.id));
    if (layoutKey) { keyByPosition.set(position, layoutKey); positionByKey.set(layoutKey.id, position); }
  });
  const fnKey = KEYS.find((k) => k.label === "Fn");
  if (fnKey) { keyByPosition.set(NJ81ED_FN_POSITION, fnKey); positionByKey.set(fnKey.id, NJ81ED_FN_POSITION); }

  const snapKey = () => `nj81-config.keys.${getNj()?.deviceId ?? "none"}`;
  const snapshot = () => { try { return JSON.parse(localStorage.getItem(snapKey()) || "{}"); } catch (error) { return {}; } };
  /* What Reset writes: the factory key on the first layer; on the Fn layer what the keyboard had when the page first read it
     (the driver's NJ81-ED record has no factory Fn table). */
  const factory = (fnLayer, position) => (fnLayer ? snapshot().fn?.[position] ?? [0, 0, 0, 0] : NJ81ED_DEFAULT[position] ? [0, 0, NJ81ED_DEFAULT[position], 0] : null);
  const map = (fnLayer = state.fn) => (fnLayer ? state.fnMap : state.normalMap);
  const keysTabOpen = () => !$("tab-keys").hidden;
  const isFactory = (bytes, position) => bytes.join() === [0, 0, NJ81ED_DEFAULT[position], 0].join();
  /* The key's own setting on a layer, as the driver's config list holds it: undefined when it does what it always does.
     On the Fn layer an empty entry means "no feature set". */
  const configOf = (fnLayer, position) => {
    const bytes = map(fnLayer)?.[position];
    if (!bytes || position === NJ81ED_FN_POSITION) { return undefined; }   // Fn is a system key: never a setting of its own
    if (fnLayer) { return bytes.some((b) => b) ? decodeAction(bytes) : undefined; }
    return isFactory(bytes, position) ? undefined : decodeAction(bytes);
  };

  /* ---------- read ---------- */
  const load = async () => {
    const nj = getNj();
    $("keys-unsupported").hidden = !nj || nj.client.family === "yc500";
    if (!nj || nj.client.family !== "yc500") { return; }
    $("keys-state").textContent = t("keysReading");
    try {
      state.profile = await nj.client.profile().catch(() => 0);
      state.normalMap = await nj.client.readKeymap(state.profile);
      state.fnMap = await nj.client.readFnLayer(0);
      const snap = snapshot();
      if (!snap.fn) { try { localStorage.setItem(snapKey(), JSON.stringify({ ...snap, fn: state.fnMap })); } catch (error) { /* private mode */ } }
      $("keys-state").textContent = t("keysRead");
      if (state.selected !== null) { state.pending = configOf(state.fn, state.selected) ?? null; }
      paint();
      render();
    } catch (error) { $("keys-state").textContent = ""; logError("areaKeys", `${t("keysReadFailed")}: ${why(error)}`); }
  };

  /* ---------- drawing ---------- */
  const paint = () => {
    const open = keysTabOpen();
    for (const [id, el] of keyEls) {
      const position = positionByKey.get(id);
      const config = open && position !== undefined ? configOf(state.fn, position) : undefined;
      el.classList.toggle("kset-on", Boolean(config) && config.type !== "disabled");
      el.classList.toggle("kset-off", Boolean(config) && config.type === "disabled");
      el.classList.toggle("selected", open && position !== undefined && state.selected === position);
      el.dataset.remap = config ? (config.type === "disabled" ? t("actDisabled") : describeAction(config)) : "";
      el.title = config ? `${keyByPosition.get(position)?.label ?? ""}\n${el.dataset.remap}` : "";
    }
  };
  const select = (layoutKey) => {
    if (!keysTabOpen()) { return false; }
    const position = positionByKey.get(layoutKey.id);
    if (position === undefined) { logWarn("areaKeys", t("keysNoPosition")); return true; }
    if (position === NJ81ED_FN_POSITION) { logWarn("areaKeys", t("keysSystemKey")); return true; }   // the driver: "System keys cannot be modified"
    state.selected = position;
    state.pending = configOf(state.fn, position) ?? null;
    closeVirtual();
    paint();
    render();
    return true;
  };

  /* ---------- left card: current setting ---------- */
  const settingText = (fnLayer) => {
    if (state.selected === null) { return t("keysNotConfigured"); }
    if (!map(fnLayer)) { return t("keysNotRead"); }
    const config = configOf(fnLayer, state.selected);
    if (fnLayer) { return config ? describeAction(config) : t("keysNotConfigured"); }
    if (!config) { return keyByPosition.get(state.selected)?.label ?? describeAction(decodeAction(map(false)[state.selected])); }
    return config.type === "disabled" ? t("actDisabled") : describeAction(config);
  };

  /* ---------- big card ---------- */
  const showCategory = (category) => {
    state.category = category;
    for (const b of document.querySelectorAll("[data-kcat]")) { b.setAttribute("aria-pressed", String(b.dataset.kcat === category)); }
    for (const pane of document.querySelectorAll("[data-kpane]")) { pane.hidden = pane.dataset.kpane !== category; }
    $("kmacro-modes").hidden = category !== "macro";
    closeVirtual();
    if (category === "macro" && !state.macros) { readMacros(); }
  };

  /* the Key page's value: up to two modifiers and a key, as the driver's { hid, specialKey1, specialKey2 } */
  const comboOf = (action) => {
    if (action?.type !== "key") { return { hid: 0, m1: null, m2: null }; }
    const m1 = MOD_OF[action.modifier] ?? null;
    if (MOD_OF[action.hid]) { return { hid: action.hid2 || 0, m1, m2: MOD_OF[action.hid] }; }
    return { hid: action.hid || 0, m1, m2: null };
  };
  const setCombo = (c) => {
    if (!c.hid && !c.m1 && !c.m2) { state.pending = null; render(); return; }
    const first = c.m1 ?? c.m2;
    const both = Boolean(c.m1 && c.m2);
    state.pending = both
      ? { type: "key", modifier: MOD_CODE[c.m1], hid: MOD_CODE[c.m2], hid2: c.hid }
      : { type: "key", modifier: first ? MOD_CODE[first] : 0, hid: c.hid, hid2: 0 };
    render();
  };
  const toggleModifier = (name) => {
    const c = comboOf(state.pending);
    if (c.m1 === name) { c.m1 = null; } else if (c.m2 === name) { c.m2 = null; } else if (!c.m1) { c.m1 = name; } else { c.m2 = name; }
    setCombo(c);
  };
  /* a key typed or picked: a modifier joins the free modifier place (none twice), any other key becomes the key */
  const takeKey = (hid) => {
    if (hid === undefined) { return; }
    const c = comboOf(state.pending);
    const mod = MOD_OF[hid];
    if (mod) {
      if (mod === c.m1 || mod === c.m2) { return; }
      if (!c.m1) { c.m1 = mod; } else if (!c.m2) { c.m2 = mod; } else { c.hid = hid; }
    } else { c.hid = hid; }
    setCombo(c);
  };

  const render = () => {
    const position = state.selected;
    const layoutKey = position === null ? null : keyByPosition.get(position);
    $("kset-key").textContent = layoutKey ? layoutKey.label : "—";
    $("kset-profile-label").textContent = t("keysFirstProfile");
    $("kset-profile").textContent = settingText(false);
    $("kset-fn").textContent = settingText(true);
    $("key-fn-note").hidden = true;
    const off = position === null || !map();
    for (const id of ["kconfirm", "kreset", "kforbidden"]) { $(id).disabled = off; }
    const p = state.pending;
    $("kforbidden").checked = p?.type === "disabled";
    const c = comboOf(p);
    for (const box of document.querySelectorAll("[data-kmod]")) { box.checked = c.m1 === box.dataset.kmod || c.m2 === box.dataset.kmod; }
    $("kkey").value = p?.type === "key" && c.hid ? keyLabel(c.hid) : "";
    for (const m of MEDIA) { const box = document.querySelector(`[data-kmedia="${m.id}"]`); if (box) { box.checked = p?.type === "media" && p.id === m.id; } }
    for (const box of document.querySelectorAll("[data-kmouse]")) { box.checked = p?.type === "mouse" && p.id === box.dataset.kmouse; }
    for (const box of document.querySelectorAll("[data-kmacro]")) { box.checked = p?.type === "macro" && p.index === Number(box.dataset.kmacro); }
    for (const box of document.querySelectorAll("[data-kmode]")) { box.checked = p?.type === "macro" && p.mode === box.dataset.kmode; box.disabled = p?.type !== "macro"; }
    $("macro-repeat").disabled = p?.type !== "macro" || p.mode !== "times";
    $("macro-repeat").value = String(p?.type === "macro" ? p.repeat ?? state.macros?.[p.index]?.repeat ?? 1 : 1);
    buildMedia();   // the Fn layer has no "Fn" entry, as the driver
  };

  /* ---------- write ---------- */
  const busy = (on) => { for (const id of ["kconfirm", "kreset", "kread", "kforbidden", "macro-save", "macro-load"]) { $(id).disabled = on; } };
  /* Reads a layer back after writing `positions`. Feature reports carry no header: a reply meant for someone else (another
     tab or program talking to the keyboard at the same moment) can land in a page, so a read that changes keys nobody
     wrote is read again (up to twice) before it is believed. */
  const readBack = async (fnLayer, positions) => {
    const nj = getNj();
    const before = map(fnLayer);
    let now = null;
    for (let tries = 0; tries < 3; tries += 1) {
      now = fnLayer ? await nj.client.readFnLayer(0) : await nj.client.readKeymap(state.profile);
      const strays = before ? now.filter((b, i) => !positions.includes(i) && b.join() !== before[i].join()).length : 0;
      if (strays === 0) { break; }
    }
    if (fnLayer) { state.fnMap = now; } else { state.normalMap = now; }
    return now;
  };
  const write = async (position, bytes) => {
    const nj = getNj();
    if (state.fn) { await nj.client.setFnKey(0, position, bytes); } else { await nj.client.setKey(state.profile, position, bytes); }
    await readBack(state.fn, [position]);
  };
  const apply = async (bytes, label, before) => {
    const position = state.selected;
    if (position === null || position === NJ81ED_FN_POSITION || !getNj()) { return; }
    busy(true);
    try {
      if (before) { await before(); }
      await write(position, bytes);
      const kept = map()[position].join() === bytes.join();
      const text = `${keyByPosition.get(position)?.label ?? `#${position}`} (${t(state.fn ? "layerFn" : "layerNormal")}) → ${label}`;
      if (kept) { logOk("areaKeys", text); } else { logWarn("areaKeys", `${t("keysNotKept")}: ${text}`); }
      state.pending = configOf(state.fn, position) ?? null;
    } catch (error) { logError("areaKeys", `${t("applyFailed")}: ${why(error)}`); }
    busy(false);
    paint();
    render();
  };
  /* Loop N times: the count lives in the macro itself, so a new count rewrites that macro first (as the driver writes the
     macro with the key). */
  const setRepeat = async (index, repeat) => {
    const nj = getNj();
    const now = decodeMacro(await nj.client.readMacro(index));
    if (!now.events.length || now.repeat === repeat) { return; }
    await nj.client.writeMacro(index, encodeMacro(now.events, repeat));
    if (state.macros) { state.macros[index] = { ...now, repeat }; }
  };
  const confirm = () => {
    const p = state.pending;
    if (!p) { logWarn("areaKeys", t("keysChooseFirst")); return; }
    if (p.type === "macro" && !state.macros?.[p.index]?.events.length && state.macros) { logWarn("areaKeys", `${t("macro")} ${p.index + 1} ${t("kmacroEmpty")}`); }
    const before = p.type === "macro" && p.mode === "times" ? () => setRepeat(p.index, p.repeat ?? 1) : null;
    apply(encodeAction(p), describeAction(p), before);
  };

  /* ---------- Macro list (Keys tab) ---------- */
  const readMacros = async () => {
    const nj = getNj();
    if (!nj || nj.client.family !== "yc500") { return; }
    state.macros = [];
    buildMacroList();
    for (let i = 0; i < MACRO_SLOTS; i += 1) {
      try { state.macros[i] = decodeMacro(await nj.client.readMacro(i)); } catch (error) { state.macros[i] = { repeat: 1, events: [] }; }
      buildMacroList();
    }
    render();
  };
  const buildMacroList = () => {
    $("kmacro-list").replaceChildren(...Array.from({ length: MACRO_SLOTS }, (_, i) => {
      const m = state.macros?.[i];
      const summary = !m ? "…" : m.events.length ? m.events.filter((e) => e.type === "key" && e.down).map((e) => keyLabel(e.hid)).join(" ") : t("kmacroEmpty");
      const row = tick("kmacro", String(i), `${t("macro")} ${i + 1}`);
      row.append(Object.assign(document.createElement("small"), { className: "kmacro-sum", textContent: summary }));
      return row;
    }));
    render();
  };

  /* ---------- on-screen keyboard (the driver's keyboard icon) ---------- */
  const VIRTUAL_GROUPS = [
    ["Escape", "F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10", "F11", "F12", "F13", "F14", "F15", "F16", "F17", "F18", "F19", "F20", "F21", "F22", "F23", "F24"],
    ["Backquote", "Digit1", "Digit2", "Digit3", "Digit4", "Digit5", "Digit6", "Digit7", "Digit8", "Digit9", "Digit0", "Minus", "Equal", "Backspace"],
    ["Tab", "KeyQ", "KeyW", "KeyE", "KeyR", "KeyT", "KeyY", "KeyU", "KeyI", "KeyO", "KeyP", "BracketLeft", "BracketRight", "Backslash"],
    ["CapsLock", "KeyA", "KeyS", "KeyD", "KeyF", "KeyG", "KeyH", "KeyJ", "KeyK", "KeyL", "Semicolon", "Quote", "Enter"],
    ["ShiftLeft", "KeyZ", "KeyX", "KeyC", "KeyV", "KeyB", "KeyN", "KeyM", "Comma", "Period", "Slash", "ShiftRight"],
    ["ControlLeft", "MetaLeft", "AltLeft", "Space", "AltRight", "MetaRight", "ContextMenu", "ControlRight"],
    ["PrintScreen", "ScrollLock", "Pause", "Insert", "Home", "PageUp", "Delete", "End", "PageDown", "ArrowUp", "ArrowLeft", "ArrowDown", "ArrowRight"],
    ["NumLock", "NumpadDivide", "NumpadMultiply", "NumpadSubtract", "NumpadAdd", "NumpadEnter", "NumpadDecimal", "Numpad0", "Numpad1", "Numpad2", "Numpad3", "Numpad4", "Numpad5", "Numpad6", "Numpad7", "Numpad8", "Numpad9"],
  ];
  const buildVirtual = () => {
    const used = new Set();
    const rows = VIRTUAL_GROUPS.map((codes) => codes.map((code) => HID_KEYS.find((k) => k.code === code)).filter(Boolean));
    rows.flat().forEach((k) => used.add(k.hid));
    rows.push(HID_KEYS.filter((k) => !used.has(k.hid)));   // anything else the key table knows
    $("kvirtual-keys").replaceChildren(...rows.filter((r) => r.length).map((row) => {
      const line = Object.assign(document.createElement("div"), { className: "kvirtual-row" });
      line.append(...row.map((k) => {
        const b = Object.assign(document.createElement("button"), { type: "button", textContent: k.label });
        b.addEventListener("click", () => { takeKey(k.hid); closeVirtual(); });
        return b;
      }));
      return line;
    }));
  };
  const openVirtual = () => { if (state.selected === null) { return; } if (!$("kvirtual-keys").childElementCount) { buildVirtual(); } $("kvirtual").hidden = false; };
  function closeVirtual() { $("kvirtual").hidden = true; }

  /* ---------- Macro tab: record and store macros ---------- */
  const showMacro = () => { $("macro-events").textContent = state.macroEvents.length ? describeMacro(state.macroEvents) : t("macroEmpty"); };
  const onRecordKey = (event) => {
    if (!state.recording) { return; }
    event.preventDefault();
    event.stopPropagation();
    if (event.repeat) { return; }
    state.recording.push({ code: event.code, down: event.type === "keydown", t: performance.now() });
    state.macroEvents = macroFromRecording(state.recording);
    showMacro();
  };
  const toggleRecord = () => {
    const on = !state.recording;
    if (on) { state.recording = []; state.macroEvents = []; showMacro(); } else { state.recording = null; }
    for (const type of ["keydown", "keyup"]) { (on ? window.addEventListener : window.removeEventListener)(type, onRecordKey, true); }
    $("macro-record").textContent = t(on ? "macroStop" : "macroRecord");
    $("macro-record").classList.toggle("primary", on);
  };
  const saveMacro = async () => {
    if (state.recording) { toggleRecord(); }
    const nj = getNj();
    if (!nj || !state.macroEvents.length) { logWarn("areaKeys", t("macroEmpty")); return; }
    const index = Number($("macro-slot").value);
    const repeat = state.macros?.[index]?.repeat || 1;
    let bytes;
    try { bytes = encodeMacro(state.macroEvents, repeat); } catch (error) { logError("areaKeys", t("macroTooLong")); return; }
    busy(true);
    try {
      await nj.client.writeMacro(index, bytes);
      const back = decodeMacro(await nj.client.readMacro(index));
      if (state.macros) { state.macros[index] = back; buildMacroList(); }
      if (describeMacro(back.events) === describeMacro(decodeMacro(bytes).events)) { logOk("areaKeys", `${t("macroSaved")} ${index + 1}: ${describeMacro(back.events)}`); }
      else { logWarn("areaKeys", `${t("macroNotKept")} ${index + 1}`); }
    } catch (error) { logError("areaKeys", `${t("applyFailed")}: ${why(error)}`); }
    busy(false);
    render();
  };
  const loadMacro = async () => {
    const nj = getNj();
    if (!nj) { return; }
    const index = Number($("macro-slot").value);
    busy(true);
    try {
      const back = decodeMacro(await nj.client.readMacro(index));
      state.macroEvents = back.events;
      showMacro();
    } catch (error) { logError("areaKeys", `${t("applyFailed")}: ${why(error)}`); }
    busy(false);
    render();
  };

  /* ---------- build the lists ---------- */
  function tick(attr, id, label) {
    const wrap = Object.assign(document.createElement("label"), { className: "kcheck" });
    const box = Object.assign(document.createElement("input"), { type: "checkbox" });
    box.dataset[attr] = id;
    wrap.append(box, Object.assign(document.createElement("span"), { textContent: label }));
    return wrap;
  }
  let mediaFor = null;
  function buildMedia() {
    if (mediaFor === state.fn) { return; }
    mediaFor = state.fn;
    $("kmedia-list").replaceChildren(...MEDIA.filter((m) => !(state.fn && m.id === "fn")).map((m) => tick("kmedia", m.id, t(`media_${m.id}`))));
    render();
  }
  $("kmouse-list").replaceChildren(...MOUSE.map((m) => tick("kmouse", m.id, t(`mouse_${m.id}`))));
  $("macro-slot").replaceChildren(...Array.from({ length: MACRO_SLOTS }, (_, i) => new Option(`${t("macro")} ${i + 1}`, String(i))));
  buildMacroList();
  showMacro();
  showCategory("key");

  /* ---------- wiring ---------- */
  for (const b of document.querySelectorAll("[data-kcat]")) { b.addEventListener("click", () => showCategory(b.dataset.kcat)); }
  document.addEventListener("click", (event) => {
    const box = event.target.closest?.("input[type=checkbox]");
    if (!box || !box.closest("#tab-keys")) { return; }
    if (state.selected === null && !box.matches("#fn-layer")) { event.preventDefault(); return; }
    /* The box has already flipped; render() then sets every box from the editor's value (no preventDefault: it would flip
       the clicked box back after render). */
    const p = state.pending;
    if (box.dataset.kmod) { toggleModifier(box.dataset.kmod); }
    else if (box.dataset.kmedia) { state.pending = p?.type === "media" && p.id === box.dataset.kmedia ? null : { type: "media", id: box.dataset.kmedia }; render(); }
    else if (box.dataset.kmouse) { state.pending = p?.type === "mouse" && p.id === box.dataset.kmouse ? null : { type: "mouse", id: box.dataset.kmouse }; render(); }
    else if (box.dataset.kmacro) {
      const index = Number(box.dataset.kmacro);
      state.pending = p?.type === "macro" && p.index === index ? null : { type: "macro", index, mode: p?.type === "macro" ? p.mode : "times", repeat: state.macros?.[index]?.repeat || 1 };
      render();
    } else if (box.dataset.kmode) { if (p?.type === "macro") { state.pending = { ...p, mode: box.dataset.kmode }; } render(); }
    else if (box.id === "kforbidden") {   // the driver writes Forbidden at once; ticking it again does nothing
      box.checked = true;
      if (p?.type !== "disabled") { apply([0, 0, 0, 0], t("actDisabled")); }
    }
  });
  $("macro-repeat").addEventListener("change", () => {
    const p = state.pending;
    if (p?.type !== "macro") { return; }
    state.pending = { ...p, repeat: Math.max(1, Math.min(65535, Math.round(Number($("macro-repeat").value) || 1))) };
    render();
  });
  $("fn-layer").addEventListener("change", () => {
    state.fn = $("fn-layer").checked;
    if (state.selected !== null) { state.pending = configOf(state.fn, state.selected) ?? null; }
    paint();
    render();
  });
  $("kread").addEventListener("click", load);
  /* the key box: a click empties the key (the modifiers stay), then a key typed fills it */
  $("kkey").addEventListener("click", () => { if (state.selected === null) { return; } const c = comboOf(state.pending); c.hid = 0; setCombo(c); $("kkey").focus(); });
  $("kkey").addEventListener("keydown", (event) => { event.preventDefault(); event.stopPropagation(); if (state.selected !== null) { takeKey(hidForCode(event.code)); } });
  /* As the driver: while the Key page holds a key setting, a key typed anywhere on the page fills it too. */
  window.addEventListener("keydown", (event) => {
    if (!keysTabOpen() || state.recording || state.category !== "key" || state.pending?.type !== "key") { return; }
    if (event.target.closest?.("input, select, textarea") ) { return; }
    event.preventDefault();
    takeKey(hidForCode(event.code));
  });
  $("kkey-pick").addEventListener("click", () => { if ($("kvirtual").hidden) { openVirtual(); } else { closeVirtual(); } });
  $("kvirtual-close").addEventListener("click", closeVirtual);
  $("kconfirm").addEventListener("click", confirm);
  $("kreset").addEventListener("click", () => {
    const f = state.selected === null ? null : factory(state.fn, state.selected);
    if (f) { apply(f, `${t("keysDefault")} (${f.some((b) => b) ? describeAction(decodeAction(f)) : t("keysNotConfigured")})`); }
  });
  $("macro-record").addEventListener("click", toggleRecord);
  $("macro-save").addEventListener("click", saveMacro);
  $("macro-load").addEventListener("click", loadMacro);
  $("macro-slot").addEventListener("change", () => { if (state.recording) { toggleRecord(); } state.macroEvents = state.macros?.[Number($("macro-slot").value)]?.events ?? []; showMacro(); });
  $("macro-clear").addEventListener("click", () => { if (state.recording) { toggleRecord(); } state.macroEvents = []; showMacro(); });

  /* A shared setting's keys (Share tab): [{ v: the driver's entry, bytes }] written to the first layer, then read back once. */
  const applyShared = async (list, name, fnLayer = false) => {
    const nj = getNj();
    if (!nj || nj.client.family !== "yc500") { logWarn("areaShare", t("keysUnsupported")); return; }
    const writes = [];
    for (const { v, bytes } of list) {
      let seen = 0;
      const position = NJ81ED_DEFAULT.findIndex((hid) => hid === v.original && (v.index === undefined || seen++ === v.index));
      if (position >= 0 && position !== NJ81ED_FN_POSITION) { writes.push({ position, bytes }); }
    }
    if (!writes.length) { logWarn("areaShare", t("shareNoKeys")); return; }
    busy(true);
    try {
      for (const w of writes) { if (fnLayer) { await nj.client.setFnKey(0, w.position, w.bytes); } else { await nj.client.setKey(state.profile, w.position, w.bytes); } }
      const now = await readBack(fnLayer, writes.map((w) => w.position));
      const kept = writes.filter((w) => now[w.position].join() === w.bytes.join()).length;
      const text = `${name} (${t(fnLayer ? "layerFn" : "layerNormal")}): ${writes.map((w) => `${keyByPosition.get(w.position)?.label ?? `#${w.position}`} → ${describeAction(decodeAction(w.bytes))}`).join(", ")}`;
      if (kept === writes.length) { logOk("areaShare", text); } else { logWarn("areaShare", `${t("keysNotKept")} (${writes.length - kept}/${writes.length}): ${text}`); }
    } catch (error) { logError("areaShare", `${t("applyFailed")}: ${why(error)}`); }
    busy(false);
    if (state.selected !== null) { state.pending = configOf(state.fn, state.selected) ?? null; }
    paint();
    render();
  };

  return {
    select,
    applyShared,
    onTab: (tab, ready) => {
      if (tab !== "macro" && state.recording) { toggleRecord(); }
      if (tab === "keys" && ready && getNj() && !state.normalMap) { load(); return; }
      if (tab === "macro" && ready && !state.macros) { readMacros(); }
      paint();
    },
    onDisconnect: () => { state.normalMap = null; state.fnMap = null; state.selected = null; state.pending = null; state.macros = null; paint(); render(); },
  };
};
