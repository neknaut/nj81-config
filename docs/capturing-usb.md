# Capturing the official driver's USB traffic

The NJ81 is not a VIA/QMK keyboard as far as we know, so its commands have to be learned from the official Keydous driver. This page
shows how to record them. **You only record traffic between your own keyboard and your own PC.** Nothing here writes firmware.

## What you need

- A Windows PC with the **official Keydous driver** for the NJ81 (use the version for your model: dual-mode or triple-mode).
- The keyboard on a **USB-C cable** (the configuration interface is normally not exposed over Bluetooth).
- [Wireshark](https://www.wireshark.org/) with **USBPcap** (the Windows installer offers it).

## Record

1. Close everything that uses the keyboard's lighting. Open the official driver but do not change anything yet.
2. Start Wireshark, pick the **USBPcap** interface that your keyboard is on (the one that shows traffic when you press a key),
   and start the capture.
3. In the driver, make **one change at a time** and write down the time and what you did, for example:
   `12:01:10 effect -> Breathing`, `12:01:40 colour -> pure red #ff0000`, `12:02:10 brightness -> 100%`.
4. Between changes wait about 5 seconds, so each change is easy to find.
5. Cover: every effect, colour (use pure red, green and blue first), brightness, speed, direction, the screen (a picture, the
   clock, the brightness of the screen) and saving to the keyboard, if the driver has such a button.
6. Stop the capture and save it as `.pcapng`. **Do not commit it** (it can contain the device serial number); `.gitignore` already
   skips `*.pcap` and `*.pcapng`.

## Read it

- In Wireshark use the display filter `usb.transfer_type == 0x01 || usb.transfer_type == 0x02` (interrupt and control) and look for
  frames whose **host to device** direction carries your change at the time you wrote down.
- Control transfers with `SET_REPORT` (request `0x09`) are HID output or feature reports; interrupt `OUT` frames are output
  reports. Note the **report ID** (first byte when the interface uses report IDs), the **length**, and every byte.
- Change one thing and compare two frames: the bytes that differ are the field you changed (a colour byte, an effect number...).
  The last bytes are often a checksum (a sum or CRC of the others): see whether it changes with every edit.

## What to share

Copy the frames of each change into [`protocol-notes.md`](protocol-notes.md) (hex bytes plus what you changed). With those notes the
`js/protocol.js` encoder can be written and tested. Please **do not** record or share anything related to firmware updates.

## Bluetooth

Only try Bluetooth after the wired protocol works. Chrome does not expose most Bluetooth keyboards' vendor interface, so a wired or
2.4 GHz connection is the realistic way to configure the keyboard.
