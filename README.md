# NJ81 Config

A web app to edit the **RGB lighting and the screen** of the Keydous NJ81 keyboard right in the browser, over **USB** with
[WebHID](https://developer.mozilla.org/docs/Web/API/WebHID_API): nothing to install.

![Chrome / Edge](https://img.shields.io/badge/browser-Chrome%20%7C%20Edge-4285f4?logo=googlechrome&logoColor=white)
![Static site](https://img.shields.io/badge/deploy-Render%20static%20site-46e3b7?logo=render&logoColor=white)
![Status](https://img.shields.io/badge/status-protocol%20unknown-orange)

> [!IMPORTANT]
> **Supported keyboards.** The NJ81 does not run VIA: it speaks Keydous's own vendor protocol ("ROYUAN gen2", the one the official
> driver uses). The app now speaks it for the **NJ81-CP, NJ81-CP V3, NJ81-MAX and NJ81-MAX CP**: on *Connect* it identifies the model,
> **reads the current lighting** (effect, direction, colour or rainbow, brightness, speed, profile) and every change in the page is
> written to the keyboard and read back. The 160×80 screen takes still pictures in its 5 slots and the clock can be synced.
> Older NJ81 boards (yc500 generation) are recognised but read-only. Tested against a simulated keyboard only, not yet on real
> hardware. Use the **USB cable** and close the official driver first (only one program can talk to the keyboard).
>
> Limits: the keyboard cannot report which picture its screen shows, so the page cannot display it; GIFs, key remapping and
> per-key colours are not in the app yet. VIA/QMK keyboards still work through the same *Connect* button.

## What it does

- **Lighting:** effect, colour, brightness, speed and per-key painting, with an animated preview (an approximation of a 75% layout).
- **Screen:** pick an image, see it at the display's size and export it as raw RGB565 (the real size and the way to send it still have to be confirmed).
- **Profiles:** save in the browser, export and import as JSON.
- **Live key presses:** keys typed on the real keyboard light up on an NJ81-shaped drawing (80 keys, screen top right).
- **Vietnamese and English.**

## Use it

```bash
npm start                # serves public/ on http://localhost:8080 (needs python3)
```

Open it in **Chrome or Edge** on a computer (WebHID needs HTTPS or `localhost`), plug the keyboard in with its **USB-C cable** and press
*Connect*. If the chooser is empty, close the official driver, use the cable (not Bluetooth or the 2.4 GHz dongle) and try
*Show all devices*. Bluetooth normally does not expose the configuration interface, so wired (or the 2.4 GHz dongle) is the way to configure it.

## Safety

There is **no firmware, bootloader, erase or factory-reset command** in this project and there will not be: `packet()` refuses those
opcodes. This project is not affiliated with Keydous.

## Deploy on Render

The site is static (`public/`). Push the repo, then in Render choose **New → Blueprint** and pick it ([`render.yaml`](render.yaml)):
a static site with no build, served over HTTPS, with a strict Content-Security-Policy and `Permissions-Policy: hid=(self)`.

## Develop

```bash
npm test                 # node --test: colours, RGB565, profiles, effects, drivers, translations (Node 20+, no dependencies)
```

| Path | What is in it |
|---|---|
| `public/index.html`, `public/css/` | The page |
| `public/js/app.js` | Wires the page together |
| `public/js/hid.js` | WebHID wrapper (connect, describe interfaces, send, read) |
| `public/js/royuan.js` | **The NJ81 vendor protocol** (identify, lighting, clock, screen pictures) |
| `public/js/via.js`, `keycodes.js` | VIA/QMK protocol, for VIA keyboards |
| `public/js/drivers.js` | Simulation driver and the real driver (refuses while the protocol is unknown) |
| `public/js/profile.js`, `lighting.js`, `layout.js`, `util.js`, `i18n.js` | Profile validation, preview effects, preview layout, helpers, translations |
| `docs/` | [Capturing the official driver](docs/capturing-usb.md) and the [protocol notes](docs/protocol-notes.md) |

Plain ES modules, no build step and no dependencies.

## License

No license file yet: add one before sharing the project.
