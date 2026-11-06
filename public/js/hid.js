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
     the data they return: that byte is dropped so the caller always gets the 64 payload bytes. */
  featureTransport(size = 64) {
    return {
      setFeature: async (bytes) => {
        if (!this.device) { throw new Error("No keyboard connected"); }
        await this.device.sendFeatureReport(0, bytes);
      },
      getFeature: async () => {
        if (!this.device) { throw new Error("No keyboard connected"); }
        const view = await this.device.receiveFeatureReport(0);
        const data = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
        return Uint8Array.from(data.length > size ? data.subarray(data.length - size) : data);
      },
    };
  }
}
