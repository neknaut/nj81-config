/* What the preview shows for each effect. This is a simulation drawn in the page, not what the keyboard does:
   the keyboard's own effect names, speeds and directions come from the protocol. */
import { hexToRgb, hslToRgb, scaleRgb } from "./util.js";
import { LAYOUT_WIDTH } from "./layout.js";

const OFF = [0, 0, 0];

/* The colour of one key at time `timeMs`. `pressed` is a Set of key ids that were just clicked (for "reactive"). */
export const keyColor = (profile, key, timeMs, pressed = new Set()) => {
  const { effect, color, brightness, speed, perKey } = profile.lighting;
  const level = brightness / 100;
  const rate = 0.2 + (speed / 100) * 1.8;   // cycles per second scale
  const seconds = timeMs / 1000;
  switch (effect) {
    case "off": return OFF;
    case "static": return scaleRgb(hexToRgb(color), level);
    case "breathing": return scaleRgb(hexToRgb(color), level * (0.5 + 0.5 * Math.sin(seconds * rate * Math.PI)));
    case "spectrum": return hslToRgb(seconds * rate * 60, 1, 0.5 * (0.3 + 0.7 * level));
    case "wave": return hslToRgb((key.x / LAYOUT_WIDTH) * 360 - seconds * rate * 120, 1, 0.5 * (0.3 + 0.7 * level));
    case "reactive": return scaleRgb(hexToRgb(color), level * (pressed.has(key.id) ? 1 : 0.18));
    case "perkey": return perKey[key.id] ? scaleRgb(hexToRgb(perKey[key.id]), level) : OFF;
    default: return OFF;
  }
};
