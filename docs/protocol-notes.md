# NJ81 protocol notes

**Status: nothing is known yet.** Fill this in from a capture ([capturing-usb.md](capturing-usb.md)), then write the encoder in
`public/js/protocol.js`.

## The device

| Field | Value |
|---|---|
| Model / variant (dual or triple mode) | |
| Vendor ID / Product ID (wired) | |
| Vendor ID / Product ID (2.4 GHz dongle) | |
| Configuration interface (usage page / usage) | |
| Report ID, report length | |

(The protocol lab in the web app lists the interfaces of a connected keyboard: copy them here.)

## Commands

One row per command you saw. Keep the full frame in hex.

| What changed | Direction | Report type | Frame (hex) | Notes |
|---|---|---|---|---|
| e.g. effect Static | host to device | output | | |
| e.g. colour #ff0000 | host to device | output | | |

## Checksum

How the last bytes are computed (sum, CRC...), if any.

## Not in scope

Firmware update, bootloader and factory-reset frames are **not** recorded and **not** implemented.
