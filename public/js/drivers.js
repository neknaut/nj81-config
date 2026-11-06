/* A driver turns a profile into bytes for the keyboard. Two exist:
   - SimulationDriver: sends nothing, only lists what it WOULD do (safe, works without a keyboard);
   - Nj81Driver: the real one. It needs the NJ81's protocol, which is not known yet (see docs/protocol-notes.md),
     so it refuses to send anything until the commands are filled in. */
import { hexToHueSat, hexToRgb } from "./util.js";
import { PROTOCOL } from "./protocol.js";

/* The steps needed to apply a profile, independent of the protocol. */
export const buildPlan = (profile) => {
  const { effect, color, brightness, speed, perKey } = profile.lighting;
  const plan = [{ kind: "lighting", effect, rgb: hexToRgb(color), brightness, speed }];
  const painted = Object.keys(perKey).length;
  if (effect === "perkey" && painted) { plan.push({ kind: "perKey", keys: painted }); }
  plan.push({ kind: "screen", width: profile.screen.width, height: profile.screen.height, image: profile.screen.name || null });
  return plan;
};

export class NotImplementedError extends Error {}

export class SimulationDriver {
  name = "simulation";
  async apply(profile, log) {
    for (const step of buildPlan(profile)) { log(`[simulation] ${JSON.stringify(step)}`); }
    return { sent: false };
  }
}

export class Nj81Driver {
  name = "nj81";
  constructor(session) { this.session = session; }
  async apply() {
    if (PROTOCOL.status !== "known") {
      throw new NotImplementedError("The NJ81 protocol is not known yet: capture the official driver first (docs/capturing-usb.md), then fill in js/protocol.js.");
    }
    throw new NotImplementedError("Protocol marked as known but no command encoder is wired up in js/drivers.js yet.");
  }
}

const toByte = (percent) => Math.round((Math.min(100, Math.max(0, percent)) / 100) * 255);

/* Profile -> the values VIA's RGB channel understands (brightness, speed, hue, saturation, and the firmware effect number). */
export const profileToViaRgb = (profile) => {
  const { color, brightness, speed, viaEffect } = profile.lighting;
  return { brightness: toByte(brightness), speed: toByte(speed), ...hexToHueSat(color), ...(viaEffect !== undefined ? { effect: viaEffect } : {}) };
};

/* Writes lighting to a VIA/QMK keyboard. `save` also stores it in the keyboard's memory so it survives unplugging. */
export class ViaDriver {
  name = "via";
  constructor(via, channel, save = false) { this.via = via; this.channel = channel; this.save = save; }
  async apply(profile, log) {
    const values = profileToViaRgb(profile);
    await this.via.setRgb(values, this.channel);
    if (this.save) { await this.via.saveRgb(this.channel); }
    log(`[via] ${JSON.stringify(values)}${this.save ? " + saved" : ""}`);
    return { sent: true };
  }
}
