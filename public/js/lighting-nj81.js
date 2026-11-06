/* What the drawing shows for each NJ81 effect: an approximation of the keyboard's own animations, so the page looks like the
   board. Pure functions (tested with node --test). Reactive effects light only around keys that were just pressed.

   key: { x, y, w } in key units; s: { mode, option, rainbow, color [r,g,b], level 0..1, speed 0..1, off };
   presses: [{ x, y, t }] recent key presses (centre, time in ms). */
import { hslToRgb, scaleRgb } from "./util.js";

export const WIDTH = 16;
export const HEIGHT = 6.25;
const OFF = [0, 0, 0];

/* Effects that stay dark until a key is pressed (default; the user can change it per keyboard). */
export const REACTIVE_DEFAULT = new Set([5, 8, 14]);   // ripple, key shadow, radiant (radiant and key shadow confirmed on an NJ81-ED)

const hash = (a, b) => { const v = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return v - Math.floor(v); };
const clamp01 = (v) => Math.max(0, Math.min(1, v));

export const nj81KeyColor = (s, key, timeMs, presses = [], reactive = REACTIVE_DEFAULT) => {
  if (s.off) { return OFF; }
  const cx = key.x + key.w / 2;
  const cy = key.y + 0.5;
  const sec = timeMs / 1000;
  const rate = 0.35 + s.speed * 1.65;            // faster with speed
  const hueAt = (h) => hslToRgb(h, 1, 0.5);
  const colour = (h = 0) => (s.rainbow ? hueAt(h) : s.color);
  const lit = (rgb, amount) => scaleRgb(rgb, clamp01(amount) * s.level);
  const dir = s.option ?? 0;

  if (reactive.has(s.mode)) {   // only around recent presses
    let best = 0;
    let hue = 0;
    for (const p of presses) {
      const age = (timeMs - p.t) / 1000;
      if (age < 0 || age > 2.5) { continue; }
      const dx = Math.abs(cx - p.x);
      const sameRow = Math.abs(cy - p.y) < 0.5;
      const dist = Math.hypot(cx - p.x, (cy - p.y) * 1.2);
      let v = 0;
      if (s.mode === 14) {          // radiant: from the pressed key out to both sides along its row
        const front = age * (5 + rate * 6);
        v = sameRow ? Math.max(dx < 0.6 ? 1 - age : 0, Math.max(0, 1 - Math.abs(dx - front) / 1.4) * (1 - age / 2.5)) : 0;
      } else if (s.mode === 8) {    // key shadow: the pressed key itself, fading out
        v = dist < 0.6 ? 1 - age / (1.6 - s.speed) : 0;
      } else if (s.mode === 5) {    // ripple: a ring spreading from the pressed key
        const ring = age * (4 + rate * 4);
        v = Math.max(0, 1 - Math.abs(dist - ring) / 0.9) * (1 - age / 2.5);
      } else {                      // anything else marked reactive: a soft glow around the key
        v = dist < 1.3 ? (1 - age / 2.5) * (1 - dist / 1.3) : 0;
      }
      if (v > best) { best = v; hue = (p.x / WIDTH) * 360 + age * 90; }
    }
    return lit(colour(hue), best);
  }

  switch (s.mode) {
    case 1: return lit(colour(cx * 22), 1);                                                                   // static
    case 2: return lit(colour(sec * 40), 0.5 - 0.5 * Math.cos(sec * rate * 2));                                // breathing
    case 3: return lit(hueAt(sec * rate * 60), 1);                                                            // spectrum cycle
    case 4: {                                                                                                 // wave: right, left, down, up
      const pos = dir === 0 ? cx / WIDTH : dir === 1 ? 1 - cx / WIDTH : dir === 2 ? cy / HEIGHT : 1 - cy / HEIGHT;
      const phase = pos - sec * rate * 0.5;
      return s.rainbow ? lit(hueAt(-phase * 360), 1) : lit(s.color, 0.15 + 0.85 * (0.5 + 0.5 * Math.cos(phase * Math.PI * 4)));
    }
    case 6: {                                                                                                 // star dots
      const slot = Math.floor(sec * rate * 2);
      const on = hash(cx + slot, cy) > 0.8;
      return on ? lit(colour(hash(cy, slot) * 360), 1 - ((sec * rate * 2) % 1)) : OFF;
    }
    case 7: {                                                                                                 // flow: zigzag, spiral
      const v = dir === 1 ? Math.atan2(cy - HEIGHT / 2, cx - WIDTH / 2) / (Math.PI * 2) + Math.hypot(cx - WIDTH / 2, cy - HEIGHT / 2) / 8
        : (cx + (Math.floor(cy) % 2 ? WIDTH - cx : cx)) / (WIDTH * 2) + cy / 12;
      return lit(colour((v - sec * rate * 0.4) * 360), 0.4 + 0.6 * (0.5 + 0.5 * Math.sin((v - sec * rate * 0.4) * Math.PI * 6)));
    }
    case 9: {                                                                                                 // layers: one row after the other
      const row = Math.floor(sec * rate * 2) % 6;
      return Math.round(cy - 0.75) === row || (row === 0 && cy < 1) ? lit(colour(row * 60), 1) : lit(colour(row * 60), 0.12);
    }
    case 10: {                                                                                                // sine wave
      const y = HEIGHT / 2 + Math.sin(cx / 2 - sec * rate * 2) * 2.2;
      return lit(colour(cx * 20 + sec * 40), Math.max(0, 1 - Math.abs(cy - y) / 1.1));
    }
    case 11: {                                                                                                // spring: outward, inward
      const d = Math.hypot((cx - WIDTH / 2) / 1.6, cy - HEIGHT / 2);
      const phase = (dir === 0 ? d - sec * rate * 3 : d + sec * rate * 3);
      return lit(colour(phase * 50), 0.5 + 0.5 * Math.cos(phase * 1.6));
    }
    case 12: {                                                                                                // neon: right, left
      const x = dir === 0 ? cx : WIDTH - cx;
      return lit(hueAt((x / WIDTH) * 360 - sec * rate * 120), 1);
    }
    case 15: {                                                                                                // loop: ccw, cw
      const a = Math.atan2(cy - HEIGHT / 2, (cx - WIDTH / 2) / 2) / (Math.PI * 2);
      return lit(hueAt((dir === 0 ? a : -a) * 360 + sec * rate * 120), 1);
    }
    case 16: {                                                                                                // colour grid
      const slot = Math.floor(sec * rate);
      return lit(hueAt(hash(Math.floor(cx), Math.floor(cy) + slot) * 360), 0.6 + 0.4 * hash(cy, cx + slot));
    }
    case 17: {                                                                                                // snowfall: drops down each column
      const col = Math.floor(cx);
      const fall = (sec * rate * 2 + hash(col, 3) * 6) % 8;
      return lit(colour(col * 25), Math.max(0, 1 - Math.abs(cy - fall) / 0.8));
    }
    case 18: {                                                                                                // meteor: streaks to the right with a tail
      const row = Math.floor(cy);
      const head = (sec * rate * 6 + hash(row, 9) * 20) % 22 - 3;
      const behind = head - cx;
      return behind >= 0 && behind < 4 ? lit(colour(row * 50), 1 - behind / 4) : OFF;
    }
    case 19: {                                                                                                // silent snow: keys glow at random, slowly
      const slot = Math.floor(sec * rate * 0.8 + hash(cx, cy) * 4);
      const phase = (sec * rate * 0.8 + hash(cx, cy) * 4) % 1;
      return hash(Math.floor(cx), Math.floor(cy) * 7 + slot) > 0.72 ? lit(colour(hash(cy, slot) * 360), Math.sin(phase * Math.PI)) : OFF;
    }
    case 5: {                                                                                                 // ripple when not reactive: rings from the centre
      const d = Math.hypot((cx - WIDTH / 2) / 1.4, cy - HEIGHT / 2) - sec * rate * 3;
      return lit(colour(d * 40), Math.max(0, Math.cos(d * 1.5)));
    }
    case 8: case 14: return lit(colour(cx * 22), 1);
    default: return lit(colour(), 1);
  }
};
