# NJ81 protocol notes

**Status: known for the gen2 boards** (NJ81-CP, NJ81-CP V3, NJ81-MAX, NJ81-MAX CP). Implemented in `public/js/royuan.js`.
Source: the public protocol notes of [sharkfin](https://github.com/dniminenn/sharkfin/blob/master/docs/PROTOCOL.md) and its device
table; the code here is an independent implementation of those facts.

| Field | Value |
|---|---|
| USB | VID `0x3151` (PID `0x5030` NJ81-CP, `0x504c` NJ81-MAX), VID `0x39ab` PID `0x9016` (NJ81-MAX CP) |
| Interface | vendor collection, usage page `0xFFFF`, usage `2` (sometimes `1`) |
| Reports | 64-byte **feature** reports, report ID 0, both directions; a GET is a SET of the opcode then a read that echoes it |
| Checksum | `0xFF - (sum & 0xFF)` of bytes 0..6 at byte 7; lighting writes: bytes 0..7 at byte 8 |
| Device ids | `0x8F` identify, id = bytes 1..4 little-endian: 2454 NJ81-CP, 3459 NJ81-CP V3, 4140 NJ81-MAX, 4207 NJ81-MAX CP |

## Commands used

| Opcode | What | Frame |
|---|---|---|
| `0x8F` | identify | reply `[8F, id u32 LE, .., fw lo, fw hi]` |
| `0x84` | active profile | reply `[84, index]` |
| `0x87` / `0x07` | lighting get / set | `[op, mode, 4 - speed, brightness 0..4, (direction << 4) or (7 fixed colour / 8 rainbow), R, G, B, ck]`; white goes as `FA FA FA` |
| `0x28` | clock | bytes 8..14: year (BE), month, day, hour, minute, second |
| `0xA5` | picture announce | `[A5, slot, 1, 0, len lo, len hi, 0, ck, 0, 0, 160, 80]`, ready when reply `[1] == 1` |
| `0x25` | picture page | `[25, slot, 1, 0, page lo, page hi, length, ck, 56 data bytes]`; RGB565 big-endian, column by column |

Effects: 1 static, 2 breathing, 3 spectrum, 4 wave (right/left/down/up), 5 ripple, 6 stars, 7 flow (zigzag/spiral), 8 key shadow,
9 layers, 10 sine, 11 spring (out/in), 12 neon (right/left), 14 radiant, 15 loop (ccw/cw), 16 colour grid, 17 snowfall, 18 meteor,
19 silent snow.

## Never sent

Reset (`0x01`), flash erase (`0xAC`), boot entry (`0x7F`, `0x30`, `0x31`) and anything firmware related. `packet()`
refuses these opcodes.


**NJ81-ED screen, 2026-11-06:** the screen erase (`0x2C`) was sent once; what it does there is not understood (the status screen
was missing for a while and still works). Pictures sent at an assumed 160x80 (announce `0xA5` + pages `0x25`) end up in the keyboard's
screen rotation, and no command is known to take a picture back out (a black frame only replaces it). Nothing is sent to that screen
until the official driver's picture and delete commands are captured. Never send `0x2C`; `packet()` refuses it.

**NJ81-ED "Clear" in the official driver (Keydous Driver v3.2.23, USB capture 2026-11-06):** one SET_REPORT, feature report ID 0
(`wValue 0x0300`): `AC 00 00 00 00 00 00 53` (bare `0xAC`, checksum at byte 7), then one GET_REPORT ~20-50 ms later, then nothing.
It removed every picture and GIF; only the status screen stays in the screen rotation. Sent only by `Royuan.clearScreen()`.
After it the keyboard sends an input report `05 2C 00 00` on interface 2 (endpoint 0x82) when the clear is done: 40.8 s and 42.8 s
after the command; the status screen comes back then, while the driver and the screen show a % progress. `Royuan.clearScreen()` waits for it.

**NJ81-ED lighting, read from the installed official driver (Keydous Driver v3.2.23, `yc500_nj81_ed`, layout `ys`):** `0x07` write /
`0x87` read; byte 1 mode, byte 2 `4 - speed` (MAXSPEED 4), byte 3 brightness 0-4, byte 4 `option << 4 | colour` (8 rainbow, 7 the RGB
in bytes 5-7, below 7 a preset: 0 white, 1 red, 2 orange, 3 yellow, 4 green, 5 #55FFFF, 6 blue), pure white sent as FA FA FA.
Modes: 0 off, 1 Always On (no speed), 2 Dynamic breathing, 3 Spectrum cycle (no colour), 4 Drift (right/left/down/up), 5 Waves ripple,
6 Stars twinkle, 7 Steady stream (z/return), 8 Shadowing, 9 Peaks rising, 10 Sine Wave, 11 Caispring Surging (out/in), 12 Flowers
Blooming (right/left), 14 Laser, 15 Peak Turn (anti-clockwise/clockwise), 16 Colorful vertical and horizontal, 17 Snow, 18 Meteor,
19 Through the snow non-trace. (13 user picture, 20-22 music / screen colour and 66 per-key colour are not in the app.)
The screen record says 160×80 RGB565, 5 picture slots (`layer 1-5`); `0x2B`/`0xAB` set/get the screen effect (64 clock, 65 CPU,
66 user picture, 67 text).

**NJ81-ED pictures and GIFs, read from the official driver (`drawFrameToKeyboardGIF`, `getTFTLCDDataRGBImg`,
`setTFTLCDDataRGBImg`):** one announce for frame 0 only, `[A5, 0, frames, delay, len b0, len b1, 0, ck, left, top, right, bottom,
left>>8, top>>8, right>>8, bottom>>8, len b2, len b3, slot 0-4]`, polled up to 10 times 100 ms apart until the reply's byte 1 is 1,
then 100 ms; then the pages of every frame, `[25, frame, frames, delay, page lo, page hi, length, ck, 56 bytes]`, 3 ms apart. The
delay is the average of the GIF's frame delays in ms (at most 255), the same in every packet. The pixels are cut to the box around
every non-black pixel of all frames (right / bottom exclusive), column by column, RGB565 high byte first. Up to 50 frames in the
driver's load path (250 in its editor). `Royuan.uploadScreen()` does exactly this.
