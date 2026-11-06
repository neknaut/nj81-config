# NJ81 Config

A web app to set the **RGB lighting and the screen** of the Keydous NJ81 right in the browser, over **USB** with
[WebHID](https://developer.mozilla.org/docs/Web/API/WebHID_API): nothing to install.

![Chrome / Edge](https://img.shields.io/badge/browser-Chrome%20%7C%20Edge-4285f4?logo=googlechrome&logoColor=white)
![Static site](https://img.shields.io/badge/deploy-Render%20static%20site-46e3b7?logo=render&logoColor=white)

The NJ81 speaks Keydous's own vendor protocol (ROYUAN, the one the official driver uses), not VIA. The app implements it in
[`public/js/royuan.js`](public/js/royuan.js) ([notes](docs/protocol-notes.md)):

- **NJ81-CP, NJ81-CP V3, NJ81-MAX, NJ81-MAX CP** (gen2 command set): lighting, clock, still pictures for the 160×80 screen.
- **NJ81, NJ81S, NJ81-ED** (older yc500 command set, recognised with read-only commands): lighting, lights off, clock. Their screen
  size is not on file: the NJ81-ED takes still pictures at the family's 160×80 (they join the screen rotation; **Clear pictures and
  GIFs**, the driver's own Clear, removes them). Animated GIFs for it wait for a capture of the official driver.

Use the **USB cable** and close the official driver first (only one program can talk to the keyboard). Tested against simulated
keyboards; real-hardware results so far come from an NJ81-ED.

## What it does

- **Connect** identifies the model and reads its current lighting; the page then follows changes made with the keyboard's own keys.
- **Lighting:** the keyboard's own effects (the NJ81-ED's 15, or a list learned from the keyboard), direction, colour or rainbow,
  brightness and speed in the keyboard's steps, lights off. Every write is spaced for the keyboard's flash, read back and reported
  setting by setting.
- **Drawing:** an NJ81-shaped keyboard (80 keys, white caps, screen top right) that plays each effect and lights the keys you type.
- **Screen:** pictures from a file, a GIF (the frame on show is sent) or the built-in library, into the screen's 5 slots; the clock is
  synced to standard time on every connect.
- **Profiles:** save in the browser, export and import as JSON. **Log** with a clear status per line. **Vietnamese and English.**

## Use it

```bash
npm start                # serves public/ on http://localhost:8080 (needs python3)
```

Open it in **Chrome or Edge** on a computer (WebHID needs HTTPS or `localhost`), plug the keyboard in with its **USB-C cable** and press
*Connect*. If the chooser is empty, close the official driver, use the cable (not Bluetooth or the 2.4 GHz dongle) and try
*Show all devices*.

## Safety

There is **no firmware, bootloader, erase or factory-reset command** in this project and there will not be: `packet()` refuses those
opcodes. One exception, copied byte for byte from a USB capture of the official driver: **Clear pictures and GIFs** (Screen tab,
NJ81-ED only) sends the driver's Clear (`AC 00 00 00 00 00 00 53`) so only the status screen is left, then leaves the keyboard alone
for a minute. The yc500 display erase (`0x2C`) was sent once to an NJ81-ED by mistake and stays blocked.

## Deploy on Render

The site is static (`public/`). In Render choose **New → Blueprint** and pick this repo ([`render.yaml`](render.yaml)): a static site
with no build, served over HTTPS, with a strict Content-Security-Policy (Google Fonts allowed) and `Permissions-Policy: hid=(self)`.

## Develop

```bash
npm test                 # node --test: protocol, effects drawing, profiles, colours, translations (Node 20+, no dependencies)
```

| Path | What is in it |
|---|---|
| `public/index.html`, `public/css/style.css` | The page (dark control panel: sidebar, Lighting / Screen / Profile / Log tabs) |
| `public/js/app.js` | Wires the page together |
| `public/js/royuan.js` | **The NJ81 vendor protocol** (identify, family probe, lighting, clock, screen pictures) |
| `public/js/hid.js` | WebHID wrapper (pick the settings interface, connect, feature reports) |
| `public/js/lighting-nj81.js`, `layout.js` | What the drawing shows for each effect, and the NJ81 layout |
| `public/js/gallery.js` | Built-in screen pictures and picture/GIF links |
| `public/js/profile.js`, `util.js`, `i18n.js` | Profile validation, colour helpers, translations |
| `docs/` | [Protocol notes](docs/protocol-notes.md) and [capturing the official driver](docs/capturing-usb.md) (for models not on file) |

Plain ES modules, no build step and no dependencies.

## License

No license file yet: add one before sharing the project.
