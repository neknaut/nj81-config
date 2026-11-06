/* A thin wrapper around WebHID (Chrome / Edge on desktop, HTTPS or localhost only).
   It never sends anything by itself: the NJ81 client (royuan.js) uses `featureTransport()`. */

export const hidSupported = () => typeof navigator !== "undefined" && "hid" in navigator;

/* The device and its HID collections as plain data (written to the log on connect). */
export const describeDevice = (device) => ({
  name: device.productName || "(unnamed)",
  vendorId: device.vendorId,
  productId: device.productId,
  collections: device.collections.map((collection) => ({
    usagePage: collection.usagePage,
    usage: collection.usage,
    inputReports: (collection.inputReports || []).map((report) => report.reportId),
    outputReports: (collection.outputReports || []).map((report) => report.reportId),
    featureReports: (collection.featureReports || []).map((report) => report.reportId),
  })),
});

/* Chrome returns every interface of the keyboard that was picked: use the one that carries the settings. */
export const interfaceScore = (device) => {
  const collections = device.collections || [];
  if (collections.some((c) => c.usagePage === 0xffff && (c.featureReports || []).length)) { return 3; }
  if (collections.some((c) => c.usagePage >= 0xff00)) { return 1; }
  return 0;
};
export const pickInterface = (devices) => [...devices].sort((a, b) => interfaceScore(b) - interfaceScore(a))[0] ?? null;

export const hex4 = (value) => "0x" + value.toString(16).padStart(4, "0");

/* Emits "connected" (with describeDevice) and "disconnected". */
export class HidSession extends EventTarget {
  device = null;

  async request(filters = []) {
    const device = pickInterface(await navigator.hid.requestDevice({ filters }));   // the browser shows its own device chooser
    if (!device) { return null; }
    await this.use(device);
    return device;
  }

  /* Reconnects a keyboard the user already allowed on this site (no chooser). */
  async reconnect() {
    const device = pickInterface((await navigator.hid.getDevices()).filter((d) => interfaceScore(d) >= 3));
    if (device) { await this.use(device); }
    return device;
  }

  async use(device) {
    await this.close();
    if (!device.opened) { await device.open(); }
    this.device = device;
    this.dispatchEvent(new CustomEvent("connected", { detail: describeDevice(device) }));
  }

  async close() {
    if (!this.device) { return; }
    try { await this.device.close(); } catch (error) { /* already gone */ }
    this.device = null;
    this.dispatchEvent(new CustomEvent("disconnected"));
  }

  /* Feature-report transport for the vendor protocol (64 bytes, report ID 0). Some platforms put the report ID in front of
     the data they return: that byte is dropped so the caller always gets the 64 payload bytes.
     The keyboard sometimes refuses a transfer while it is busy (writing flash, or another program has it open): each
     transfer is tried up to 7 times, starting with short waits (the refusal usually clears within a few tens of ms, so a
     long first wait only adds delay) and waiting longer each time, about a second in all, before the error is passed on. */
  featureTransport(size = 64, waits = [0, 20, 40, 80, 150, 250, 450]) {
    const attempt = async (transfer) => {
      let last;
      for (const ms of waits) {
        if (ms) { await new Promise((resolve) => setTimeout(resolve, ms)); }
        if (!this.device) { throw new Error("No keyboard connected"); }
        try { return await transfer(this.device); } catch (error) { last = error; }
      }
      throw Object.assign(new Error(last?.message || "HID transfer failed"), { busy: true, attempts: waits.length });
    };
    return {
      setFeature: (bytes) => attempt((device) => device.sendFeatureReport(0, bytes)),
      getFeature: () => attempt(async (device) => {
        const view = await device.receiveFeatureReport(0);
        const data = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
        return Uint8Array.from(data.length > size ? data.subarray(data.length - size) : data);
      }),
      /* One try, no retries: for the read-back after a write, which must give the line back at once when the keyboard
         is still busy (it refuses reads for about a second after a lighting write) so a newer change is not held up. */
      getFeatureOnce: async () => {
        if (!this.device) { throw new Error("No keyboard connected"); }
        const view = await this.device.receiveFeatureReport(0);
        const data = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
        return Uint8Array.from(data.length > size ? data.subarray(data.length - size) : data);
      },
      /* Input reports the keyboard sends by itself (e.g. "screen cleared": 05 2C 00 00). The listener gets the bytes with
         the report ID in front (when it is not 0), as they appear on the wire. Returns a function that stops listening. */
      /* Windows can hand a report to another HID device of the same keyboard (one per top-level collection), so every
         vendor-page device of this keyboard the user allowed is listened to, and opened if needed (a failure is skipped). */
      onInput: (listener) => {
        const main = this.device;
        if (!main) { return () => {}; }
        const handler = (event) => {
          const data = new Uint8Array(event.data.buffer, event.data.byteOffset, event.data.byteLength);
          listener(event.reportId ? Uint8Array.from([event.reportId, ...data]) : Uint8Array.from(data), event.device);
        };
        const watched = new Set([main]);
        main.addEventListener("inputreport", handler);
        let stopped = false;
        (async () => {
          let others = [];
          try { others = await navigator.hid.getDevices(); } catch (error) { return; }
          for (const device of others) {
            if (stopped || watched.has(device) || device.vendorId !== main.vendorId || device.productId !== main.productId) { continue; }
            if (!(device.collections || []).some((c) => c.usagePage >= 0xff00)) { continue; }
            try { if (!device.opened) { await device.open(); } } catch (error) { continue; }
            if (stopped) { break; }
            device.addEventListener("inputreport", handler);
            watched.add(device);
          }
        })();
        return () => { stopped = true; for (const device of watched) { device.removeEventListener("inputreport", handler); } };
      },
    };
  }
}
