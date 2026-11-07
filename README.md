# NJ81 Config

Configure the **Keydous NJ81** keyboard from the browser over USB: lighting, key remaps, macros, the 160×80 screen and a
library of shared pictures and settings. No driver to install.

[![Live site](https://img.shields.io/badge/live-nj81--config.onrender.com-46e3b7?logo=render&logoColor=white)](https://nj81-config.onrender.com)
![Chrome | Edge](https://img.shields.io/badge/browser-Chrome%20%7C%20Edge-4285f4?logo=googlechrome&logoColor=white)
![Node 20+](https://img.shields.io/badge/node-20%2B-339933?logo=node.js&logoColor=white)
![No dependencies](https://img.shields.io/badge/dependencies-none-lightgrey)

**Live:** <https://nj81-config.onrender.com> · Vietnamese and English · Unofficial, not affiliated with Keydous.

## Contents

- [Features](#features)
- [Quick start](#quick-start)
- [Connecting the keyboard](#connecting-the-keyboard)
- [Deployment](#deployment)
- [How it works](#how-it-works)
- [Safety](#safety)
- [Development](#development)
- [Troubleshooting](#troubleshooting)
- [License](#license)

## Features

| Tab | What you can do |
|---|---|
| **Lighting** | Built-in effects, direction, colour or rainbow, brightness, speed, lights off. Every change is read back to confirm it, and changes made on the keyboard itself show up. |
| **Keys** | Remap any key (with up to two modifiers), media and mouse actions, macros, the Fn layer; works like the official driver's main page. |
| **Macro** | Record and store the keyboard's 8 macro slots. |
| **Screen** | Pick a picture or GIF in the preview (click or drop), drag it into place, send it (160×80) into one of 5 layers with a progress modal; clear pictures, sync the clock. |
| **Profile** | Save lighting profiles in the browser; export and import JSON. |
| **Library** | Browse what Keydous users share (every picture and GIF, and NJ81-ED settings), open a picture big, and apply it in one click. |
| **Log**, **Guide** | A log per connection and a guide to every feature. |

Tested on a real **NJ81-ED**. Other NJ81 models (CP, MAX, S) are recognised and get lighting, clock and still pictures.

## Quick start

Requirements: **Node.js 20+** and **Chrome or Edge** on a computer. Nothing to install and nothing to configure.

```bash
git clone https://github.com/neknaut/nj81-config.git
cd nj81-config
npm start
```

Open **<http://localhost:8080>**. Use `localhost`, not `127.0.0.1`: WebHID needs HTTPS or `localhost`.

If port 8080 is busy, `npm start` handles it:

- **The app is already running there:** it prints the address and starts nothing new, so you keep using the same page.
- **Another program holds 8080:** it starts on the next free port (8081–8089) and warns you. The browser keeps saved
  profiles, pictures and the keyboard permission per address, so data saved at `:8080` is not visible on the new port.

## Connecting the keyboard

1. Plug the keyboard in with the **USB-C cable** (Bluetooth and the 2.4 GHz dongle cannot be configured).
2. **Close the official Keydous driver** and any other tab with this page: only one program can talk to the keyboard.
3. Press **Connect keyboard** and pick the NJ81. Not listed? Press *Show all devices*.

The page reconnects by itself next time until you press **Disconnect**.

## Deployment

Deploy the whole app with **`server.mjs`**, not only the `public/` folder: the Library needs the server (see
[How it works](#how-it-works)).

### Render

1. **New → Blueprint** and pick this repository. [`render.yaml`](render.yaml) creates a free Node web service running
   `node server.mjs`, with no build step.
2. That is all: Render provides HTTPS and the port, and the server picks them up by itself.

Free instances sleep after 15 minutes without traffic. The server pings its own `/keydous/ping` every 10 minutes to stay
awake. Render's free plan has **750 instance hours per month for the whole workspace**: one always-on service uses about
720, so do not keep two free services awake at once.

> A service created earlier as a **Static Site** cannot run `server.mjs`. Delete it and create a **Web Service** (or the
> Blueprint) instead.

### Other hosts

Start it with `npm start` (or `node server.mjs`) behind HTTPS. It uses the port the host gives and needs no settings. The server sets its own security headers
(a strict Content-Security-Policy and `Permissions-Policy: hid=(self)`).

## How it works

- **Keyboard protocol.** The NJ81 uses Keydous's own vendor protocol (ROYUAN, the one the official driver speaks), not VIA.
  It is implemented in [`public/js/royuan.js`](public/js/royuan.js) over WebHID feature reports. See the
  [protocol notes](docs/protocol-notes.md).
- **Library.** The Keydous servers only answer browser pages opened at exactly `http://localhost:8080` (their CORS rule).
  So `server.mjs` makes the Library's three requests itself under `/keydous/*`: the picture list, picture files and the
  settings list. It is not an open proxy: request bodies are validated, at most 4 requests run at once and each visitor
  is limited to 120 a minute. Without `server.mjs` the Library shows a notice instead.
- **No build.** Plain ES modules, no framework and no dependencies.

## Safety

The project contains **no firmware, bootloader, erase or factory-reset command**, and `packet()` refuses those opcodes.
The one exception is **Clear keyboard pictures** (Screen tab, NJ81-ED only). It sends the official driver's own Clear
command (`AC 00 00 00 00 00 00 53`), copied byte for byte from a USB capture, and then leaves the keyboard alone for about a
minute while it clears.

## Development

```bash
npm start     # run the app on http://localhost:8080
npm test      # node --test: protocol, keys and macros, lighting, profiles, translations
```

| Path | Contents |
|---|---|
| [`server.mjs`](server.mjs) | Static server, security headers, the Library's `/keydous/*` requests, keep-alive |
| [`public/js/royuan.js`](public/js/royuan.js) | The NJ81 vendor protocol: identify, lighting, clock, screen, key map, Fn layer, macros |
| [`public/js/app.js`](public/js/app.js) | Wires the page together: tabs, lighting, screen, profiles, loading |
| [`public/js/keymap.js`](public/js/keymap.js), [`keys-ui.js`](public/js/keys-ui.js) | Key and macro encoding; the Keys and Macro tabs |
| [`public/js/share.js`](public/js/share.js) | The Library tab |
| [`public/js/sharp.js`](public/js/sharp.js) | Draws 160×80 pictures sharp at any size (whole-number enlargement, then smooth) |
| [`public/js/hid.js`](public/js/hid.js) | WebHID connection |
| [`public/js/lighting-nj81.js`](public/js/lighting-nj81.js), [`layout.js`](public/js/layout.js) | The keyboard drawing and its effects |
| [`public/js/i18n.js`](public/js/i18n.js), [`guide.js`](public/js/guide.js), [`gallery.js`](public/js/gallery.js) | Translations, the Guide tab, built-in pictures |
| [`docs/`](docs) | [Protocol notes](docs/protocol-notes.md), [capturing the official driver](docs/capturing-usb.md) |
| [`tests/`](tests) | Unit tests |

## Troubleshooting

| Problem | Fix |
|---|---|
| The keyboard is not in the list | Use the USB-C cable, close the official driver, then press *Show all devices*. |
| "Keyboard did not take the command" | Close other tabs or programs using the keyboard. It may also be busy saving: wait a second and retry. |
| `Port 8080 is used by another program, so this runs on 8081` | Close that program to get `:8080` back. Find it with `Get-Process -Id (Get-NetTCPConnection -LocalPort 8080 -State Listen).OwningProcess` (PowerShell) or `lsof -i :8080` (macOS / Linux). |
| `NJ81 Config is already running` | Nothing is wrong: open the address it prints. |
| The Library shows a notice | The page is served without `server.mjs`. Run `npm start` or deploy the web service. |
| The live site is slow on the first visit | The free instance was asleep. The next visits are fast. |

## License

No license yet. Add a `LICENSE` file before others reuse the code.
