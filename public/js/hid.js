/* A thin wrapper around WebHID (Chrome / Edge on desktop, HTTPS or localhost only).
   It never sends anything by itself: the protocol lab and a driver call `send` explicitly. */
import { bytesToHex } from "./util.js";

export const hidSupported = () => typeof navigator !== "undefined" && "hid" in navigator;

/* Reports, items and collections as plain data, for the table in the protocol lab. */
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

export const hex4 = (value) => "0x" + value.toString(16).padStart(4, "0");

/* Emits "report" ({ reportId, hex, time }), "connected" and "disconnected" events. */
export class HidSession extends EventTarget {
  device = null;

  async request(filters = []) {
    const [device] = await navigator.hid.requestDevice({ filters });   // the browser shows its own device chooser
    if (!device) { return null; }
    await this.use(device);
    return device;
  }

  async use(device) {
    await this.close();
    if (!device.opened) { await device.open(); }
    device.addEventListener("inputreport", this.onReport);
    this.device = device;
    this.dispatchEvent(new CustomEvent("connected", { detail: describeDevice(device) }));
  }

  onReport = (event) => {
    const data = new Uint8Array(event.data.buffer, event.data.byteOffset, event.data.byteLength);
    this.dispatchEvent(new CustomEvent("report", { detail: { reportId: event.reportId, hex: bytesToHex(data), data, time: Date.now() } }));
  };

  async close() {
    if (!this.device) { return; }
    this.device.removeEventListener("inputreport", this.onReport);
    try { await this.device.close(); } catch (error) { /* already gone */ }
    this.device = null;
    this.dispatchEvent(new CustomEvent("disconnected"));
  }

  async send(kind, reportId, bytes) {
    if (!this.device) { throw new Error("No keyboard connected"); }
    if (kind === "feature") { await this.device.sendFeatureReport(reportId, bytes); } else { await this.device.sendReport(reportId, bytes); }
  }

  /* Sends one report and resolves with the next report the keyboard sends back (VIA style request / response). */
  transact(bytes, timeoutMs = 1500) {
    if (!this.device) { return Promise.reject(new Error("No keyboard connected")); }
    return new Promise((resolve, reject) => {
      const done = (fn, value) => { clearTimeout(timer); this.removeEventListener("report", onReply); fn(value); };
      const onReply = (event) => done(resolve, Uint8Array.from(event.detail.data));
      const timer = setTimeout(() => done(reject, new Error("The keyboard did not answer (no VIA support on this interface?)")), timeoutMs);
      this.addEventListener("report", onReply);
      this.device.sendReport(0, bytes).catch((error) => done(reject, error));
    });
  }

  async readFeature(reportId) {
    if (!this.device) { throw new Error("No keyboard connected"); }
    const view = await this.device.receiveFeatureReport(reportId);
    return bytesToHex(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
  }
}
