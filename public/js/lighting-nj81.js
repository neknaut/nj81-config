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
      } else if (s.mode === 5) {    // waves ripple: from the pressed key a many-coloured wave spreads over nearly the whole board
        const ring = age * (5 + rate * 5);
        const fade = 1 - age / 2.5;
        v = (dist <= ring ? Math.max(0.45, 1 - (ring - dist) / 8) : Math.max(0, 1 - (dist - ring) / 0.9)) * fade;
        if (v > best) { best = v; hue = dist * 45 - age * 120; }
        continue;
      } else {                      // anything else marked reactive: a soft glow around the key
        v = dist < 1.3 ? (1 - age / 2.5) * (1 - dist / 1.3) : 0;
      }
      if (v > best) { best = v; hue = (p.x / WIDTH) * 360 + age * 90; }
    }
    return lit(s.mode === 5 ? hueAt(hue) : colour(hue), best);   // waves ripple is many-coloured on the NJ81-ED
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
    case 7: {   // steady stream: Z runs along each row in turn, zigzagging; Return runs round the edge and spirals inwards
      let pos;   // where the key sits on the path, 0..1
      if (dir === 1) {
        const u = cx / WIDTH;
        const v = cy / HEIGHT;
        const ring = Math.min(u, 1 - u, v, 1 - v);                                   // 0 at the edge, 0.5 at the centre
        const around = (Math.atan2(v - 0.5, u - 0.5) / (Math.PI * 2) + 1.25) % 1;    // clockwise from the top left
        pos = Math.min(0.999, ring * 1.9 + around / 5);
      } else {
        const row = Math.min(5, Math.floor(cy));
        pos = (row + (row % 2 ? 1 - cx / WIDTH : cx / WIDTH)) / 6;
      }
      const head = (sec * rate * 0.12) % 1;
      const behind = (head - pos + 1) % 1;
      return behind < 0.22 ? lit(colour(pos * 360 + sec * 30), 1 - behind / 0.22) : OFF;
    }
    case 9: {   // peaks rising: the top-left and bottom-right corners run into the middle, swirl, then a full column spreads to both sides
      const t = (sec * rate * 0.22) % 1;
      const mx = WIDTH / 2;
      const my = HEIGHT / 2;
      let v = 0;
      if (t < 0.4) {
        const k = t / 0.4;
        const near = (x, y) => Math.max(0, 1 - Math.hypot((cx - x) / 1.4, cy - y) / 1.6);
        v = Math.max(near(mx * k, my * k), near(WIDTH - mx * k, HEIGHT - my * k));
      } else if (t < 0.55) {
        const a = Math.atan2(cy - my, (cx - mx) / 1.5);
        const r = Math.hypot((cx - mx) / 1.5, cy - my);
        const arm = (((a - (t - 0.4) * 60) / (Math.PI * 2)) % 0.5 + 0.5) % 0.5;
        v = r < 3 ? Math.max(0, 1 - Math.abs(arm - 0.25) * 6) * (1 - r / 3.5) : 0;
      } else {
        const front = ((t - 0.55) / 0.45) * (WIDTH / 2 + 1);
        v = Math.max(0, 1 - Math.abs(Math.abs(cx - mx) - front) / 1.2);
      }
      return lit(colour(t * 360 + cx * 10), v);
    }
    case 10: {                                                                                                // sine wave
      const y = HEIGHT / 2 + Math.sin(cx / 2 - sec * rate * 2) * 2.2;
      return lit(colour(cx * 20 + sec * 40), Math.max(0, 1 - Math.abs(cy - y) / 1.1));
    }
    case 11: {   // caispring surging (out, in): nearly the whole board lit, colours surging out from (or into) the centre
      const d = Math.hypot((cx - WIDTH / 2) / 1.6, cy - HEIGHT / 2);
      const phase = (dir === 0 ? d - sec * rate * 3 : d + sec * rate * 3);
      return lit(colour(phase * 50), 0.8 + 0.2 * Math.cos(phase * 1.6));
    }
    case 12: {   // flowers blooming: every key keeps changing colour on its own
      return lit(hueAt(hash(Math.floor(cx * 2), Math.floor(cy)) * 360 + sec * rate * (60 + hash(cy, cx) * 80)), 1);
    }
    case 15: {                                                                                                // loop: ccw, cw
      const a = Math.atan2(cy - HEIGHT / 2, (cx - WIDTH / 2) / 2) / (Math.PI * 2);
      return lit(hueAt((dir === 0 ? a : -a) * 360 + sec * rate * 120), 1);
    }
    case 16: {   // colorful vertical and horizontal: a smooth many-coloured wave across the board
      return lit(hueAt(cx * 18 + cy * 30 - sec * rate * 90), 1);
    }
    case 17: {                                                                                                // snowfall: drops down each column
      const col = Math.floor(cx);
      const fall = (sec * rate * 2 + hash(col, 3) * 6) % 8;
      return lit(colour(col * 25), Math.max(0, 1 - Math.abs(cy - fall) / 0.8));
    }
    case 18: {   // meteor: random rows, each a streak running from left to right with a tail
      const row = Math.min(5, Math.floor(cy));
      const run = sec * rate * 6 + hash(row, 9) * 22;
      const pass = Math.floor(run / 22);
      if (hash(row, pass) < 0.45) { return OFF; }                                    // this row stays dark this time round
      const behind = (run % 22) - 3 - cx;
      return behind >= 0 && behind < 4 ? lit(colour(hash(pass, row) * 360), 1 - behind / 4) : OFF;
    }
    case 19: {   // through the snow non-trace: looks like always on; a pressed key goes dark for a moment
      let dark = 0;
      for (const p of presses) {
        const age = (timeMs - p.t) / 1000;
        if (age >= 0 && age < 1.5 && Math.hypot(cx - p.x, (cy - p.y) * 1.2) < 0.6) { dark = Math.max(dark, 1 - age / 1.5); }
      }
      return lit(colour(cx * 22), 1 - dark);
    }
    case 5: {                                                                                                 // ripple when not reactive: rings from the centre
      const d = Math.hypot((cx - WIDTH / 2) / 1.4, cy - HEIGHT / 2) - sec * rate * 3;
      return lit(colour(d * 40), Math.max(0, Math.cos(d * 1.5)));
    }
    case 8: case 14: return lit(colour(cx * 22), 1);
    default: return lit(colour(), 1);
  }
};
