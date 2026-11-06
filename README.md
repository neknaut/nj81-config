# NJ81 Config

A web app to edit the **RGB lighting and the screen** of the Keydous NJ81 keyboard right in the browser, over **USB** with
[WebHID](https://developer.mozilla.org/docs/Web/API/WebHID_API): nothing to install.

![Chrome / Edge](https://img.shields.io/badge/browser-Chrome%20%7C%20Edge-4285f4?logo=googlechrome&logoColor=white)
![Static site](https://img.shields.io/badge/deploy-Render%20static%20site-46e3b7?logo=render&logoColor=white)
![Status](https://img.shields.io/badge/status-protocol%20unknown-orange)

> [!IMPORTANT]
> **The NJ81's HID protocol is not known yet.** The app already works as a lighting and screen editor with a live preview, saved
> profiles and a safe **simulation mode**, and it contains a **protocol lab** to explore the keyboard. It cannot change the real
> keyboard until the commands are captured from the official driver ([how](docs/capturing-usb.md)) and written into
> [`public/js/protocol.js`](public/js/protocol.js). Until then the real driver refuses to send anything.

## What it does

- **Lighting:** effect, colour, brightness, speed and per-key painting, with an animated preview (an approximation of a 75% layout).
- **Screen:** pick an image, see it at the display's size and export it as raw RGB565 (the real size and the way to send it still have to be confirmed).
- **Profiles:** save in the browser, export and import as JSON.
- **Protocol lab:** lists the keyboard's HID interfaces, shows incoming reports and, only after an explicit opt-in, sends a report you type.
- **Vietnamese and English.**

## Use it

```bash
npm start                # serves public/ on http://localhost:8080 (needs python3)
```

Open it in **Chrome or Edge** on a computer (WebHID needs HTTPS or `localhost`), plug the keyboard in with its **USB-C cable** and press
*Connect*. Bluetooth normally does not expose the configuration interface, so wired (or the 2.4 GHz dongle) is the way to configure it.

## Safety

There is **no firmware, bootloader or factory-reset command** in this project and there will not be. The protocol lab can send any
bytes you type, so it is off until you tick the opt-in; a wrong packet can make a keyboard misbehave. Use it at your own risk. This
project is not affiliated with Keydous.

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
| `public/js/protocol.js` | **The NJ81 protocol: to be filled in** |
| `public/js/drivers.js` | Simulation driver and the real driver (refuses while the protocol is unknown) |
| `public/js/profile.js`, `lighting.js`, `layout.js`, `util.js`, `i18n.js` | Profile validation, preview effects, preview layout, helpers, translations |
| `docs/` | [Capturing the official driver](docs/capturing-usb.md) and the [protocol notes](docs/protocol-notes.md) |

Plain ES modules, no build step and no dependencies.

## License

No license file yet: add one before sharing the project.
