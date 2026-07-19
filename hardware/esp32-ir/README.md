# AR Ops IR-ID Beacon (ESP32-S3)

A small, standalone (battery/power-bank powered, no phone tether needed
during a match) device worn by each player that continuously broadcasts its
own ID as a real 850nm infrared blink pattern. When **IR mode** is enabled
(Lobby → hit-tracking toggle) and you shoot, your phone's camera scans for
that blink pattern — both while you're aiming *and* at the moment you
shoot — and decodes which player's ID it saw. That decoded ID, together
with a timestamp, gets sent to the server alongside the normal hit-attempt:
the server (still the sole authority on hits, see
`server/src/game/arops.js`) requires it to match the ID assigned to whoever
you're claiming to have hit, and to be recent, before the hit counts. It's
real physical confirmation that you were actually looking at that specific
player, not just that a GPS+compass cone math says someone was roughly in
that direction.

There's deliberately no separate IR *receiver* chip anywhere in this
design — the "receiver" is the shooter's own phone camera. Every player's
device is identical, transmit-only hardware; the asymmetry is entirely on
the software side (a camera frame-processor plugin doing the decoding, see
`apps/arops-mobile`'s `react-native-vision-camera` integration).

## What you need (per player device)

- **Board**: an ESP32-S3 "Mini"/"SuperMini" dev board (native USB, no
  separate USB-UART chip needed) — this is what the firmware and pin
  assignment below assume. A plain ESP32-S3-DevKitC works too, just adjust
  the pin if GPIO4 is used for something else on your specific board.
- **IR LED**: Vishay TSAL6100 (850nm, high-speed infrared emitter)
- **Switch**: AO3400A (N-channel logic-level MOSFET)
- **Passives**: 1× ~220Ω resistor (MOSFET gate, current-limits the GPIO
  driving it), 1× ~10kΩ resistor (gate-to-source pulldown — keeps the LED
  off while the GPIO is floating/undefined during boot or flashing), 1×
  current-limiting resistor for the LED itself (see below)
- Any USB-C power source to wear it with (power bank, battery pack) — a
  data connection is only needed once, for flashing

## Wiring / pin assignment

```
                         5V (USB VBUS) ────┬──── R_LED (see below) ──── TSAL6100 anode
                                            │
                                       TSAL6100 cathode
                                            │
                                        AO3400A drain
GPIO4 ── R_GATE (220Ω) ──── AO3400A gate
                                        AO3400A source ──── GND
                    R_PULLDOWN (10kΩ)
              AO3400A gate ──┴── GND
```

- **GPIO4** → 220Ω resistor → AO3400A **gate**. The resistor limits inrush
  current into the MOSFET's gate capacitance; without it you're relying
  purely on the GPIO driver's own current limiting.
- **AO3400A gate** also gets a 10kΩ pulldown to **GND** — during boot and
  while flashing, GPIO4's state is undefined/floating for a moment, and
  without this the LED could flicker on or (worse) stay on continuously
  during a long flash session, wasting power and heat-stressing the LED for
  no reason.
- **AO3400A drain** → TSAL6100 **cathode**. **AO3400A source** → **GND**.
  This is a *low-side switch*: the MOSFET sits between the LED and ground,
  not between the supply and the LED.
- **TSAL6100 anode** → current-limiting resistor → **5V (USB VBUS)**, *not*
  the board's 3.3V rail. Reasoning: pulling ~100mA suddenly from a small
  onboard 3.3V LDO regulator (which also powers the ESP32 chip's own logic)
  risks a brief brownout/glitch right as the LED switches — annoying and
  unnecessary when the same USB cable already brings unregulated 5V VBUS
  that doesn't feed the chip's logic supply at all. Check your specific
  board's pinout/silkscreen for its 5V/VBUS pin (not all "Mini" boards
  break it out identically).
- **Resistor value for the LED**: TSAL6100's forward voltage is ~1.35V
  around 100mA, and it's rated for that current *continuously*, not just
  pulsed — relevant here since the beacon can hold the LED on for up to
  ~1.2s straight (an all-ones ID byte's worth of data bits). From 5V:
  `(5 − 1.35) / 0.1A ≈ 36.5Ω` → use a **39Ω** standard resistor (~93mA, a
  safe margin under the continuous rating). If you only have a 3.3V-only
  board without a broken-out VBUS pin, use `(3.3 − 1.35) / 0.1A ≈ 19.5Ω` →
  a **22Ω** resistor instead (~88mA).

## Firmware

`firmware/ir_beacon/ir_beacon.ino` — see the comments at the top of that
file for the exact Arduino IDE board/core setup required (esp32 core
**3.0.0 or newer** — the LEDC API it uses is core-3.x-specific), and
[`FLASHING.md`](./FLASHING.md) for how to get it onto the board from
Android, iOS, Linux, macOS, or Windows.

**Set a unique `DEVICE_ID` (0-255) before flashing each physical board** —
it's a plain constant at the top of the sketch. Two players wearing devices
with the same ID are indistinguishable to the camera decoder.

## Beacon protocol

The LED blink pattern itself (what the camera decodes), one cycle ≈2.1s,
repeats forever:

```
[ 300ms ON ]  preamble — longer than any data bit, unambiguous start marker
[ 100ms OFF]  gap
[ 8 × 150ms ] data bits, MSB first, ON=1/OFF=0 — this device's ID
[ 500ms OFF]  idle gap before the next cycle
```

Bit timing is deliberately slow (150ms/bit, ~4-5 camera frames of margin
at 30fps) — a photodiode receiver could read microsecond-level timing, but
this needs to survive being decoded from a moving phone camera instead. The
38kHz sub-carrier riding on top of each "on" period is invisible to a
camera (it only sees average brightness per frame) — kept anyway so a
future TSOP-based photodiode receiver could read the exact same beacon
directly, no firmware changes needed.

There's also a plain-text USB-serial bench-test command (`PING\n` →
`{"type":"heartbeat","deviceId":...,"uptimeMs":...}\n`) for confirming a
board is alive and check which ID it's broadcasting without needing a
second phone's camera nearby — this is a bench-test convenience only, not
part of the gameplay path (the beacon itself needs no data connection once
flashed, only power).
