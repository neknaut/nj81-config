/* A driver turns a profile into bytes for the keyboard. Two exist:
   - SimulationDriver: sends nothing, only lists what it WOULD do (safe, works without a keyboard);
   - Nj81Driver: the real one. It needs the NJ81's protocol, which is not known yet (see docs/protocol-notes.md),
     so it refuses to send anything until the commands are filled in. */
import { hexToRgb } from "./util.js";
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
