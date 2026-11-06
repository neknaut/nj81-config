/* The NJ81's HID protocol. NOTHING IS KNOWN YET: this file is the one place to fill in once the official driver has been
   captured (docs/capturing-usb.md) and the notes written (docs/protocol-notes.md). Until `status` is "known" the real driver
   refuses to send anything, and only the simulation and the protocol lab work.

   Shape to fill in (all numbers are examples of the fields, not real values):
     status:      "known"
     usagePage:   vendor-defined usage page of the configuration interface (0xFF00..0xFFFF)
     reportId:    report id the commands use (0 when the interface has none)
     packetSize:  bytes per report
     commands:    { lighting(profile) -> Uint8Array[], screen(profile, rgb565) -> Uint8Array[] }
   There must be NO firmware, bootloader or "reset to factory" command in this file. */
export const PROTOCOL = {
  status: "unknown",
  usagePage: null,
  reportId: null,
  packetSize: null,
  commands: {},
};
