/* The settings the app edits, how they are validated and how they are saved. Pure functions: tested with `node --test`. */
import { clamp, isHexColor } from "./util.js";

export const SCHEMA_VERSION = 1;
export const EFFECTS = ["static", "breathing", "spectrum", "wave", "reactive", "perkey", "off"];
export const SCREEN_LIMIT = { min: 8, max: 512 };

export const defaultProfile = () => ({
  schema: SCHEMA_VERSION,
  name: "My profile",
  lighting: { effect: "static", color: "#ff7a66", brightness: 80, speed: 50, perKey: {} },
  screen: { width: 160, height: 80, name: "" },   // the NJ81's screen is 160x80
});

const asNumber = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback);

/* Takes anything (a parsed file, localStorage content...) and returns { ok, errors, profile }.
   Values that are out of range are clamped; a wrong effect or colour is an error. */
export const validateProfile = (input) => {
  const errors = [];
  const base = defaultProfile();
  if (!input || typeof input !== "object" || Array.isArray(input)) { return { ok: false, errors: ["Not a profile object"], profile: base }; }
  if (input.schema !== undefined && input.schema !== SCHEMA_VERSION) { errors.push(`Unsupported schema ${input.schema}`); }

  const lighting = input.lighting && typeof input.lighting === "object" ? input.lighting : {};
  if (lighting.effect !== undefined && !EFFECTS.includes(lighting.effect)) { errors.push(`Unknown effect "${lighting.effect}"`); }
  if (lighting.color !== undefined && !isHexColor(lighting.color)) { errors.push(`Bad colour "${lighting.color}"`); }
  const perKey = {};
  for (const [keyId, color] of Object.entries(lighting.perKey && typeof lighting.perKey === "object" ? lighting.perKey : {})) {
    if (isHexColor(color)) { perKey[keyId] = color.toLowerCase(); } else { errors.push(`Bad colour for key ${keyId}`); }
  }

  const viaEffect = Number.isInteger(lighting.viaEffect) && lighting.viaEffect >= 0 && lighting.viaEffect <= 255 ? lighting.viaEffect : undefined;
  const nj = lighting.nj81 && typeof lighting.nj81 === "object" ? lighting.nj81 : null;
  const nj81 = nj && Number.isInteger(nj.mode) && nj.mode >= 1 && nj.mode <= 31
    ? { mode: nj.mode, option: Number.isInteger(nj.option) && nj.option >= 0 && nj.option <= 3 ? nj.option : 0, rainbow: nj.rainbow === true }
    : undefined;
  const screen = input.screen && typeof input.screen === "object" ? input.screen : {};
  const profile = {
    schema: SCHEMA_VERSION,
    name: String(input.name ?? base.name).slice(0, 60) || base.name,
    lighting: {
      effect: EFFECTS.includes(lighting.effect) ? lighting.effect : base.lighting.effect,
      color: isHexColor(lighting.color) ? lighting.color.toLowerCase() : base.lighting.color,
      brightness: clamp(Math.round(asNumber(lighting.brightness, base.lighting.brightness)), 0, 100),
      speed: clamp(Math.round(asNumber(lighting.speed, base.lighting.speed)), 0, 100),
      perKey,
      ...(viaEffect !== undefined ? { viaEffect } : {}),
      ...(nj81 ? { nj81 } : {}),
    },
    screen: {
      width: clamp(Math.round(asNumber(screen.width, base.screen.width)), SCREEN_LIMIT.min, SCREEN_LIMIT.max),
      height: clamp(Math.round(asNumber(screen.height, base.screen.height)), SCREEN_LIMIT.min, SCREEN_LIMIT.max),
      name: String(screen.name ?? "").slice(0, 80),
    },
  };
  return { ok: errors.length === 0, errors, profile };
};

export const serializeProfile = (profile) => JSON.stringify(validateProfile(profile).profile, null, 2);

export const parseProfile = (text) => {
  try { return validateProfile(JSON.parse(text)); } catch (error) { return { ok: false, errors: [`Invalid JSON: ${error.message}`], profile: defaultProfile() }; }
};
