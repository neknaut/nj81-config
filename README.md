# NJ81 Config

A web app to set the **lighting, keys, macros and screen** of the Keydous NJ81 right in the browser, over **USB** with
[WebHID](https://developer.mozilla.org/docs/Web/API/WebHID_API): nothing to install but Node.

![Chrome / Edge](https://img.shields.io/badge/browser-Chrome%20%7C%20Edge-4285f4?logo=googlechrome&logoColor=white)
![Node 20+](https://img.shields.io/badge/node-20%2B-339933?logo=node.js&logoColor=white)

The NJ81 speaks Keydous's own vendor protocol (ROYUAN, the one the official driver uses), not VIA. The app implements it in
[`public/js/royuan.js`](public/js/royuan.js) ([notes](docs/protocol-notes.md)). Real-hardware results come from an **NJ81-ED**;
the other models are recognised and get lighting, clock and still pictures.

## Run it

You need **Node 20 or newer** (no Python, no `npm install`: there are no dependencies) and **Chrome or Edge** on a computer.

```bash
git clone https://github.com/neknaut/nj81-config.git
cd nj81-config
npm start
```

Then open **http://localhost:8080** in Chrome or Edge (WebHID only works on HTTPS or `localhost`; use `localhost`, not
`127.0.0.1`).

Before you press **Connect keyboard**:

1. Plug the keyboard in with its **USB-C cable** (not Bluetooth, not the 2.4 GHz dongle).
2. **Close the official Keydous driver** (and any other tab with this page): only one program can talk to the keyboard.
3. Pick the NJ81 in the browser's dialog. Not listed? Use *Keyboard not listed? Show all devices*.

The page reconnects by itself next time (until you press *Disconnect*) and keeps the tab you were on across F5.
Stop the server with `Ctrl+C`.

**`Port 8080 is already in use`:** another copy of the server (or another program) holds the port. Close it with `Ctrl+C` in
its terminal and run `npm start` again. To see which program it is:

```powershell
Get-Process -Id (Get-NetTCPConnection -LocalPort 8080 -State Listen).OwningProcess   # Windows PowerShell
```

```bash
lsof -i :8080   # macOS / Linux
```

Another port works too: `PORT=3000 npm start` in bash, `$env:PORT=3000; npm start` in PowerShell.

## What it does

| Tab | |
|---|---|
| **Lighting** | The keyboard's own effects, direction, colour or rainbow, brightness and speed in its steps, lights off. Every write is spaced for the keyboard's flash, read back and reported; changes made with the keyboard's own keys show up. The drawing plays each effect and lights the keys you type. |
| **Keys** | Works as the driver's main page (NJ81-ED): pick a key on the drawing, then a key with up to two of Ctrl/Alt/Shift/Win, media, mouse or a macro (loop N times, on/off, while held); the Fn layer; Forbidden and Reset write at once. Set keys are tinted on the drawing. |
| **Macro** | Record, read and store the keyboard's 8 macro slots. |
| **Screen** | 160×80 pictures from a file, the built-in gallery or a GIF; a still into one of 5 picture layers, a GIF into layer 1 (as the driver); *Clear keyboard pictures*; the clock is synced on every connect. |
| **Profile** | Save lighting profiles in the browser, export / import JSON. |
| **Library** | What Keydous users share in the driver's Share page, read live from the Keydous servers (read only, no account): every screen picture / GIF, and the settings shared from an NJ81-ED (lighting + keys) with a keyboard picture of each. Goes through the app's server (`/keydous/*`), so it works locally and deployed. |
| **Log**, **Guide** | A log per connection; a guide to every part, in Vietnamese and English. |

## Safety

There is **no firmware, bootloader, erase or factory-reset command** in this project and there will not be: `packet()` refuses those
opcodes. One exception, copied byte for byte from a USB capture of the official driver: **Clear keyboard pictures** (Screen tab,
NJ81-ED only) sends the driver's Clear (`AC 00 00 00 00 00 00 53`) so only the status screen is left, then leaves the keyboard alone
for about a minute. The yc500 display erase (`0x2C`) stays blocked.

## Deploy

Deploy **`server.mjs`**, not only `public/`: the Library needs it. The Keydous servers refuse any browser page not opened at
`http://localhost:8080` (their CORS rule), so on a deployed site the browser cannot call them; `server.mjs` makes those calls
itself under `/keydous/*` — only the Library's three calls (picture list, picture file, settings list), with checked bodies, at
most 4 at a time to Keydous and 120 a minute per visitor. It is not an open proxy.

**Render:** **New → Blueprint**, pick this repo. [`render.yaml`](render.yaml) creates a Node web service (`node server.mjs`, no
build) on Render's HTTPS. On Render the server listens on `0.0.0.0` by itself (Render sets `RENDER`), so no `HOST` is needed. The free plan sleeps when unused: the first visit after a while takes ~30 s.
**Keep-alive** (as the slack-bot): a free web service sleeps after 15 minutes without a visit, and the next visitor waits
~50 s. Every 10 minutes the server visits its own `/keydous/ping` at the address Render gives it (`RENDER_EXTERNAL_URL`), so it
stays awake. Locally nothing happens. `KEEPALIVE=0` turns it off, `KEEPALIVE_MINUTES` changes the interval, `KEEPALIVE_URL`
sets the address on other hosts. Note: Render's free plan has 750 instance hours a month for the whole workspace; one service
kept awake uses ~720 of them, so two kept-awake free services (e.g. this and the slack-bot) run out before the month ends.
A service that is already asleep cannot wake itself: an external cron hitting the site every few minutes covers that.

If you made the old static site from an earlier `render.yaml`, delete it and create the Blueprint again (a static site cannot
run `server.mjs`).

**Any other host:** run `node server.mjs` with `HOST=0.0.0.0` (locally it listens on `localhost` only) and `PORT` set by the host, behind HTTPS (Node 20+, nothing to
install). The server sets the security headers itself: strict Content-Security-Policy (the page talks only to its own server)
and `Permissions-Policy: hid=(self)`.

Served without `server.mjs` (as plain static files), everything works except the Library, which shows a notice
(it still works at exactly `http://localhost:8080`, calling Keydous straight).

## Develop

```bash
npm test                 # node --test: protocol, keys and macros, effects drawing, profiles, colours, translations
```

| Path | What is in it |
|---|---|
| `server.mjs` | `npm start` and the deployed web service: serves `public/`, security headers, the Library's `/keydous/*` calls |
| `public/index.html`, `public/css/style.css` | The page |
| `public/js/app.js` | Wires the page together (lighting, screen, profiles, tabs, loading) |
| `public/js/royuan.js` | **The NJ81 vendor protocol** (identify, lighting, clock, screen, key map, Fn layer, macros) |
| `public/js/keymap.js`, `keys-ui.js` | Key actions and macro encoding; the Keys and Macro tabs |
| `public/js/share.js` | The Library tab (Keydous shared pictures and settings) |
| `public/js/hid.js` | WebHID wrapper (pick the settings interface, connect, feature reports) |
| `public/js/lighting-nj81.js`, `layout.js` | What the drawing shows for each effect, and the NJ81 layout |
| `public/js/gallery.js`, `guide.js`, `i18n.js` | Built-in screen pictures, the Guide tab, translations |
| `docs/` | [Protocol notes](docs/protocol-notes.md) and [capturing the official driver](docs/capturing-usb.md) |

Plain ES modules, no build step and no dependencies.

## License

No license file yet: add one before sharing the project.
