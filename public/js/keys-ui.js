/* The Keys tab: remap keys on the normal layer and the Fn layer, and record / save macros (NJ81-ED).
   Every change is written, then the keyboard is read back and the result shown. The Fn key itself is never remapped,
   so the Fn layer always stays reachable; every key can be put back (normal layer: the factory matrix; Fn layer: what
   the keyboard had when this browser first read it). */
import {
  HID_KEYS, MACRO_MODES, MEDIA, MODIFIERS, NJ81ED_DEFAULT, NJ81ED_FN_POSITION, decodeAction, decodeMacro, describeAction,
  describeMacro, encodeAction, encodeMacro, hidForCode, keyLabel, macroFromRecording, sameAction,
} from "./keymap.js";

export const MACRO_SLOTS = 8;

export const initKeys = (ctx) => {
  const { $, t, log, logOk, logWarn, logError, why, getNj, keyEls, KEYS } = ctx;
  const state = { layer: "normal", profile: 0, normal: null, fn: null, selected: null, recording: null, macroEvents: [] };

  /* Which layout key sits at which matrix position: the factory HID at a position and the layout key with that code. */
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

  const snapshotKey = () => `nj81-config.keys.${getNj()?.deviceId ?? "none"}`;
  const snapshot = () => { try { return JSON.parse(localStorage.getItem(snapshotKey()) || "{}"); } catch (error) { return {}; } };
  const saveSnapshot = (value) => { try { localStorage.setItem(snapshotKey(), JSON.stringify(value)); } catch (error) { /* private mode */ } };
  const factory = (layer, position) => (layer === "normal"
    ? (NJ81ED_DEFAULT[position] ? [0, 0, NJ81ED_DEFAULT[position], 0] : null)
    : snapshot().fn?.[position] ?? null);
  const table = () => (state.layer === "normal" ? state.normal : state.fn);

  /* ---------- reading ---------- */
  const load = async () => {
    const nj = getNj();
    if (!nj || nj.client.family !== "yc500") { $("keys-unsupported").hidden = Boolean(nj && nj.client.family === "yc500"); return; }
    $("keys-unsupported").hidden = true;
    $("keys-state").textContent = t("keysReading");
    try {
      state.profile = await nj.client.profile().catch(() => 0);
      state.normal = await nj.client.readKeymap(state.profile);
      state.fn = await nj.client.readFnLayer(0);
      const snap = snapshot();
      if (!snap.fn) { saveSnapshot({ ...snap, fn: state.fn }); }   // the Fn layer's own defaults, as first found
      $("keys-state").textContent = `${t("keysRead")} · ${t("profile")} ${state.profile} · ${changedCount()} ${t("keysChangedCount")}`;
      markDrawing();
      showSelected();
    } catch (error) { $("keys-state").textContent = ""; logError("areaKeys", `${t("keysReadFailed")}: ${why(error)}`); }
  };
  const changedCount = () => {
    let n = 0;
    state.normal?.forEach((a, p) => { const f = factory("normal", p); if (f && a.join() !== f.join()) { n += 1; } });
    state.fn?.forEach((a, p) => { const f = factory("fn", p); if (f && a.join() !== f.join()) { n += 1; } });
    return n;
  };

  /* ---------- the drawing: changed keys marked, the chosen one outlined ---------- */
  const markDrawing = () => {
    for (const [id, el] of keyEls) {
      const position = positionByKey.get(id);
      const current = position === undefined ? null : table()?.[position];
      const f = position === undefined ? null : factory(state.layer, position);
      const changed = Boolean(current && f && current.join() !== f.join());
      el.classList.toggle("remapped", changed && keysTabOpen());
      el.classList.toggle("selected", keysTabOpen() && state.selected === position);
      el.dataset.remap = changed ? describeAction(decodeAction(current)) : "";
    }
  };
  const keysTabOpen = () => !$("tab-keys").hidden;

  const select = (layoutKey) => {
    if (!keysTabOpen()) { return false; }
    const position = positionByKey.get(layoutKey.id);
    if (position === undefined) { logWarn("areaKeys", t("keysNoPosition")); return true; }
    state.selected = position;
    markDrawing();
    showSelected();
    return true;
  };

  /* ---------- the editor ---------- */
  const fillSelects = () => {
    $("key-target").replaceChildren(...HID_KEYS.map((k) => new Option(k.label, String(k.hid))));
    $("key-media").replaceChildren(...MEDIA.map((m) => new Option(t(`media_${m.id}`) || m.label, String(m.usage))));
    $("key-macro-slot").replaceChildren(...Array.from({ length: MACRO_SLOTS }, (_, i) => new Option(`${t("macro")} ${i + 1}`, String(i))));
    $("macro-slot").replaceChildren(...Array.from({ length: MACRO_SLOTS }, (_, i) => new Option(`${t("macro")} ${i + 1}`, String(i))));
    $("key-macro-mode").replaceChildren(...MACRO_MODES.map((m) => new Option(t(`macroMode_${m}`), m)));
  };
  const showType = () => {
    const type = $("key-type").value;
    $("key-key-box").hidden = type !== "key";
    $("key-media-box").hidden = type !== "media";
    $("key-macro-box").hidden = type !== "macro";
  };
  const showSelected = () => {
    const box = $("key-editor");
    if (state.selected === null || !table()) { box.hidden = true; $("key-pick-hint").hidden = false; return; }
    box.hidden = false;
    $("key-pick-hint").hidden = true;
    const layoutKey = keyByPosition.get(state.selected);
    const current = decodeAction(table()[state.selected]);
    const isFn = state.selected === NJ81ED_FN_POSITION;
    $("key-name").textContent = `${layoutKey?.label ?? `#${state.selected}`} · ${t(state.layer === "normal" ? "layerNormal" : "layerFn")}`;
    $("key-current").textContent = `${t("keysNow")}: ${describeAction(current)}`;
    $("key-fn-note").hidden = !isFn;
    for (const id of ["key-type", "key-apply", "key-reset"]) { $(id).disabled = isFn; }
    $("key-type").value = ["key", "media", "macro", "disabled"].includes(current.type) ? current.type : "key";
    if (current.type === "key") {
      $("key-target").value = String(current.hid);
      $("key-modifier").value = String(current.modifier || 0);
    } else if (current.type === "media") {
      $("key-media").value = String(current.usage);
    } else if (current.type === "macro") {
      $("key-macro-slot").value = String(current.index);
      $("key-macro-mode").value = current.mode;
    }
    showType();
  };
  const chosenAction = () => {
    switch ($("key-type").value) {
      case "key": return { type: "key", hid: Number($("key-target").value), modifier: Number($("key-modifier").value) };
      case "media": return { type: "media", usage: Number($("key-media").value) };
      case "macro": return { type: "macro", index: Number($("key-macro-slot").value), mode: $("key-macro-mode").value };
      default: return { type: "disabled" };
    }
  };

  /* ---------- writing ---------- */
  const busy = (on) => { for (const id of ["key-apply", "key-reset", "keys-reset-all", "macro-save", "macro-load"]) { $(id).disabled = on; } };
  const write = async (position, bytes) => {
    const nj = getNj();
    if (state.layer === "normal") { await nj.client.setKey(state.profile, position, bytes); } else { await nj.client.setFnKey(0, position, bytes); }
  };
  const reread = async () => {
    const nj = getNj();
    if (state.layer === "normal") { state.normal = await nj.client.readKeymap(state.profile); } else { state.fn = await nj.client.readFnLayer(0); }
  };
  const apply = async (bytes, label) => {
    const position = state.selected;
    if (position === null || position === NJ81ED_FN_POSITION) { return; }
    const layoutKey = keyByPosition.get(position);
    busy(true);
    try {
      await write(position, bytes);
      await reread();
      const kept = table()[position].join() === bytes.join();
      const text = `${layoutKey?.label ?? `#${position}`} (${t(state.layer === "normal" ? "layerNormal" : "layerFn")}) → ${label}`;
      if (kept) { logOk("areaKeys", text); } else { logWarn("areaKeys", `${t("keysNotKept")}: ${text}`); }
      markDrawing();
      showSelected();
      $("keys-state").textContent = `${t("keysRead")} · ${t("profile")} ${state.profile} · ${changedCount()} ${t("keysChangedCount")}`;
    } catch (error) { logError("areaKeys", `${t("applyFailed")}: ${why(error)}`); }
    busy(false);
  };
  const resetAll = async () => {
    if (!window.confirm(t(state.layer === "normal" ? "keysResetAllConfirm" : "keysResetFnConfirm"))) { return; }
    const nj = getNj();
    busy(true);
    let done = 0;
    try {
      for (let position = 0; position < 128; position += 1) {
        const f = factory(state.layer, position);
        if (!f || position === NJ81ED_FN_POSITION || table()[position].join() === f.join()) { continue; }
        await write(position, f);
        done += 1;
      }
      await reread();
      logOk("areaKeys", `${t("keysResetDone")} (${done})`);
      markDrawing();
      showSelected();
      $("keys-state").textContent = `${t("keysRead")} · ${t("profile")} ${state.profile} · ${changedCount()} ${t("keysChangedCount")}`;
    } catch (error) { logError("areaKeys", `${t("applyFailed")}: ${why(error)}`); }
    busy(false);
    return nj;
  };

  /* ---------- macros ---------- */
  const showMacro = () => {
    $("macro-events").textContent = state.macroEvents.length ? describeMacro(state.macroEvents) : t("macroEmpty");
  };
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
    if (state.recording) {
      window.removeEventListener("keydown", onRecordKey, true);
      window.removeEventListener("keyup", onRecordKey, true);
      state.recording = null;
      $("macro-record").textContent = t("macroRecord");
      $("macro-record").classList.remove("primary");
      return;
    }
    state.recording = [];
    state.macroEvents = [];
    showMacro();
    window.addEventListener("keydown", onRecordKey, true);
    window.addEventListener("keyup", onRecordKey, true);
    $("macro-record").textContent = t("macroStop");
    $("macro-record").classList.add("primary");
  };
  const saveMacro = async () => {
    if (state.recording) { toggleRecord(); }
    const nj = getNj();
    if (!nj || !state.macroEvents.length) { logWarn("areaKeys", t("macroEmpty")); return; }
    const index = Number($("macro-slot").value);
    let bytes;
    try { bytes = encodeMacro(state.macroEvents, Math.max(1, Math.min(65535, Number($("macro-repeat").value) || 1))); } catch (error) { logError("areaKeys", t("macroTooLong")); return; }
    busy(true);
    try {
      await nj.client.writeMacro(index, bytes);
      const back = decodeMacro(await nj.client.readMacro(index));
      const same = describeMacro(back.events) === describeMacro(decodeMacro(bytes).events);
      if (same) { logOk("areaKeys", `${t("macroSaved")} ${index + 1}: ${describeMacro(back.events)}`); } else { logWarn("areaKeys", `${t("macroNotKept")} ${index + 1}`); }
    } catch (error) { logError("areaKeys", `${t("applyFailed")}: ${why(error)}`); }
    busy(false);
  };
  const loadMacro = async () => {
    const nj = getNj();
    if (!nj) { return; }
    const index = Number($("macro-slot").value);
    busy(true);
    try {
      const back = decodeMacro(await nj.client.readMacro(index));
      state.macroEvents = back.events;
      $("macro-repeat").value = String(back.repeat || 1);
      showMacro();
      log(`${t("macro")} ${index + 1}: ${back.events.length ? describeMacro(back.events) : t("macroEmpty")}`, "info", "areaKeys");
    } catch (error) { logError("areaKeys", `${t("applyFailed")}: ${why(error)}`); }
    busy(false);
  };

  /* ---------- wiring ---------- */
  fillSelects();
  showMacro();
  $("key-type").addEventListener("change", showType);
  $("key-apply").addEventListener("click", () => { const action = chosenAction(); apply(encodeAction(action), describeAction(action)); });
  $("key-reset").addEventListener("click", () => {
    const f = state.selected === null ? null : factory(state.layer, state.selected);
    if (f) { apply(f, `${t("keysDefault")} (${describeAction(decodeAction(f))})`); }
  });
  $("key-capture").addEventListener("click", () => {
    $("key-capture").textContent = t("keysPressNow");
    const once = (event) => {
      event.preventDefault();
      event.stopPropagation();
      const hid = hidForCode(event.code);
      if (hid !== undefined) { $("key-target").value = String(hid); }
      $("key-capture").textContent = t("keysCapture");
      window.removeEventListener("keydown", once, true);
    };
    window.addEventListener("keydown", once, true);
  });
  $("keys-reset-all").addEventListener("click", resetAll);
  $("keys-reload").addEventListener("click", load);
  for (const button of document.querySelectorAll("[data-layer]")) {
    button.addEventListener("click", () => {
      state.layer = button.dataset.layer;
      for (const b of document.querySelectorAll("[data-layer]")) { b.setAttribute("aria-pressed", String(b === button)); }
      $("keys-reset-all").textContent = t(state.layer === "normal" ? "keysResetAll" : "keysResetFn");
      markDrawing();
      showSelected();
    });
  }
  $("macro-record").addEventListener("click", toggleRecord);
  $("macro-save").addEventListener("click", saveMacro);
  $("macro-load").addEventListener("click", loadMacro);
  $("macro-clear").addEventListener("click", () => { if (state.recording) { toggleRecord(); } state.macroEvents = []; showMacro(); });

  return {
    select,
    onShow: () => { if (getNj() && !state.normal) { load(); } else { markDrawing(); } },
    onHide: () => { if (state.recording) { toggleRecord(); } markDrawing(); },
    onDisconnect: () => { state.normal = null; state.fn = null; state.selected = null; markDrawing(); showSelected(); },
    keyLabel,
    modifiers: MODIFIERS,
  };
};
