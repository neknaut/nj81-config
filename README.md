# NJ81 Config

Configure the **Keydous NJ81** keyboard from the browser over USB: lighting, key remaps, macros, the 160×80 screen and a
library of shared pictures and settings. No driver to install.

[![Live site](https://img.shields.io/badge/live-nj81.ngohoanganhtuan.com-f38020?logo=cloudflare&logoColor=white)](https://nj81.ngohoanganhtuan.com)
![Chrome | Edge](https://img.shields.io/badge/browser-Chrome%20%7C%20Edge-4285f4?logo=googlechrome&logoColor=white)
![Node 20+](https://img.shields.io/badge/node-20%2B-339933?logo=node.js&logoColor=white)
![No dependencies](https://img.shields.io/badge/dependencies-none-lightgrey)

**Live:** <https://nj81.ngohoanganhtuan.com> · Vietnamese and English · Unofficial, not affiliated with Keydous.

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

Tested on a real **NJ81-ED**. The gen2 boards (NJ81-CP, CP V3, MAX, MAX CP) get lighting, clock, pictures and GIFs from
public protocol notes, not tested on a real board; other NJ81 models are recognised and asked which command set they speak.

## Quick start

Requirements: **Node.js 20+** and **Chrome or Edge** on a computer. Nothing to install and nothing to configure.

```bash
git clone https://github.com/neknaut/nj81-config.git
cd nj81-config
npm start
```

Open **<http://localhost:8080>**. Use `localhost`, not `127.0.0.1`: the browser keeps saved profiles and the keyboard
permission per address.

If port 8080 is busy, `npm start` handles it:

- **The app is already running there:** it prints the address and starts nothing new, so you keep using the same page.
- **Another program holds 8080:** it starts on the next free port (8081–8089) and warns you. The browser keeps saved
  profiles, pictures and the keyboard permission per address, so data saved at `:8080` is not visible on the new port.

## Connecting the keyboard

1. Plug the keyboard in with the **USB-C cable** (Bluetooth and the 2.4 GHz dongle cannot be configured).
2. **Close the official Keydous driver** and any other tab with this page: only one program can talk to the keyboard.
3. Press **Connect keyboard** and pick the NJ81. Not listed? Press *Keyboard not listed? Show all devices*.

The page reconnects by itself next time until you press **Disconnect**. Once connected it opens on Lighting; F5 keeps the
tab that was open.

## Deployment

The site runs on **Cloudflare Workers with static assets**: free, never asleep, no instance hours. Cloudflare serves
`public/` with the security headers of [`public/_headers`](public/_headers) (a strict Content-Security-Policy and
`Permissions-Policy: hid=(self)`), and [`worker.mjs`](worker.mjs) answers the Library's `/keydous/*` calls (see
[How it works](#how-it-works)). Static files do not run the Worker, so they do not count against its request limit.
[`wrangler.jsonc`](wrangler.jsonc) holds the settings.

Deploy `public/` together with the Worker, not on its own: the Library needs `/keydous/*`.

### Cloudflare

From the dashboard: **Workers & Pages → Create → Import a repository**, pick this repository, leave the build command
empty, deploy command `npx wrangler deploy`. Each push to the production branch (`main`) then deploys.

From a computer:

1. Log in once: `npx wrangler login`.
2. Try it locally: `npm run cf:dev` (http://localhost:8787).
3. Deploy: `npm run cf:deploy`. It prints the address (`https://nj81-config.<your-subdomain>.workers.dev`).

The site's own address, `nj81.ngohoanganhtuan.com`, is a custom domain on the Worker (**Settings → Domains & Routes → Add →
Custom domain**); the `workers.dev` address keeps working too.

The Worker reaches Keydous on its ports 3814 and 3816 (`allow_custom_ports`, on by default for the compatibility date in
`wrangler.jsonc`). Failures show in the dashboard's **Observability** logs, and a failed picture answers 502 with
`X-Upstream` listing what Keydous answered each try.

Search engines get a full title and description, Open Graph / X cards with [`public/og.png`](public/og.png),
JSON-LD, [`robots.txt`](public/robots.txt) and [`sitemap.xml`](public/sitemap.xml) (they name `nj81.ngohoanganhtuan.com`:
change them for another address). To be found sooner, add the site in
[Google Search Console](https://search.google.com/search-console) and submit `/sitemap.xml`.

### A Node host

`server.mjs` does the same job on any Node host: start it with `npm start` (or `node server.mjs`) behind HTTPS. It uses
the port the host gives in `PORT` and needs no settings. Hosts that put a free service to sleep make the first visit
after a pause wait while it starts.

## How it works

- **Keyboard protocol.** The NJ81 uses Keydous's own vendor protocol (ROYUAN, the one the official driver speaks), not VIA.
  It is implemented in [`public/js/royuan.js`](public/js/royuan.js) over WebHID feature reports. See the
  [protocol notes](docs/protocol-notes.md).
- **Library.** The Keydous servers only answer browser pages opened at exactly `http://localhost:8080` (their CORS rule).
  So `server.mjs` makes the Library's three requests itself under `/keydous/*`: the picture list, picture files and the
  settings list. It is not an open proxy: request bodies are validated, at most 4 requests run at once and each visitor
  is limited to 120 lists and 900 picture files a minute. Only whole picture files are sent and kept. Without `server.mjs`
  the Library shows a notice instead.
- **No build.** Plain ES modules, no framework and no dependencies.

## Safety

The project contains **no firmware, bootloader, erase or factory-reset command**, and `packet()` refuses those opcodes.
The one exception is **Clear keyboard pictures** (Screen tab, NJ81-ED only). It sends the official driver's own Clear
command (`AC 00 00 00 00 00 00 53`), copied byte for byte from a USB capture, and then leaves the keyboard alone until it
reports the clear done (about 40 seconds).

## Development

```bash
npm start     # run the app on http://localhost:8080
npm test      # node --test: protocol, keys and macros, lighting, profiles, translations, the Worker
npm run cf:dev     # the Cloudflare version locally (npx wrangler dev)
```

| Path | Contents |
|---|---|
| [`server.mjs`](server.mjs) | Static server (brotli/gzip, ETag so a repeat visit downloads only what changed), security headers, the Library's `/keydous/*` requests; `npm start` on this computer |
| [`worker.mjs`](worker.mjs), [`wrangler.jsonc`](wrangler.jsonc), [`public/_headers`](public/_headers) | The same on Cloudflare Workers (Library calls in the Worker, `public/` served by Cloudflare) |
| [`keydous.mjs`](keydous.mjs) | What both share: the Keydous addresses, body checks, per-visitor limit, picture retries, security headers |
| [`public/js/royuan.js`](public/js/royuan.js) | The NJ81 vendor protocol: identify, lighting, clock, screen, key map, Fn layer, macros |
| [`public/js/app.js`](public/js/app.js) | Wires the page together: tabs, lighting, screen, profiles, loading |
| [`public/js/keymap.js`](public/js/keymap.js), [`keys-ui.js`](public/js/keys-ui.js) | Key and macro encoding; the Keys and Macro tabs |
| [`public/js/share.js`](public/js/share.js) | The Library tab |
| [`public/js/sharp.js`](public/js/sharp.js) | Draws 160×80 pictures sharp at any size (whole-number enlargement, then smooth) |
| [`public/js/hid.js`](public/js/hid.js) | WebHID connection |
| [`public/js/lighting-nj81.js`](public/js/lighting-nj81.js), [`layout.js`](public/js/layout.js) | The keyboard drawing and its effects |
| [`public/js/i18n.js`](public/js/i18n.js), [`guide.js`](public/js/guide.js), [`gallery.js`](public/js/gallery.js) | Translations, the Guide tab, built-in pictures |
| [`public/js/fonts.js`](public/js/fonts.js) | Adds the Google Fonts stylesheet without holding back the first paint |
| [`scripts/static-text.mjs`](scripts/static-text.mjs) | Writes the Vietnamese text into `index.html` so the page draws at once without shifting; run it after changing a text in `i18n.js` (a test checks) |
| [`scripts/og-image.mjs`](scripts/og-image.mjs) | Draws `public/og.png`, the picture shown with a shared link (`node scripts/og-image.mjs`) |
| [`docs/`](docs) | [Protocol notes](docs/protocol-notes.md), [capturing the official driver](docs/capturing-usb.md) |
| [`tests/`](tests) | Unit tests |

## Troubleshooting

| Problem | Fix |
|---|---|
| The keyboard is not in the list | Use the USB-C cable, close the official driver, then press *Keyboard not listed? Show all devices*. |
| Connected, but no tabs: "The keyboard did not answer the Keydous protocol" | Another tab with this page or the official driver has the keyboard. Close them, then *Disconnect* and connect again. |
| "The keyboard did not take the transfer" | The same: close other tabs or programs using the keyboard. It may also be busy saving: wait a second and retry. |
| `Port 8080 is used by another program, so this runs on 8081` | Close that program (the server prints the command that finds it) and run `npm start` again. |
| The Library shows a notice | The page is served without `server.mjs` or the Worker. Run `npm start`, or deploy to Cloudflare. |

## License

No license yet. Add a `LICENSE` file before others reuse the code.
