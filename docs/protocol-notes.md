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

Reset (`0x01`), flash/display erase (`0xAC`, `0x2C`), boot entry (`0x7F`, `0x30`, `0x31`) and anything firmware related. `packet()`
refuses these opcodes.
