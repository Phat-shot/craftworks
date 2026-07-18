# AR Ops IR-Fire Companion (ESP32-S3)

A small USB-C-attached companion device that fires a real 850nm infrared
pulse whenever you shoot in-game with **IR mode** enabled (Lobby → hit
tracking toggle). It's a physical/cosmetic accompaniment, not a replacement
for hit validation — there's no IR *receiver* hardware yet, so the server
still validates hits exactly the way it always has (GPS + compass cone
check, see `server/src/game/arops.js`). Think of it as a real muzzle flash
for your shot, not a laser-tag sensor vest — yet. A receiver-equipped v2
(e.g. a TSOP-series demodulator per player) is a natural next step and
would slot into the same 38kHz carrier this already fires at.

Phone-side integration: `apps/arops-mobile/modules/esp-bridge` (native
Android USB-serial module) + `src/hooks/useEspSync.ts`. Pair/connect it from
the app's main-menu USB icon; the in-game status icon (top-left, left of the
watch icon) shows whether it's currently connected.

## What you need

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
- A USB-C cable to connect the board to the phone (and to your computer for
  flashing)

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
  risks a brief brownout/glitch right when you fire — annoying and
  unnecessary when the same USB cable already brings unregulated 5V VBUS
  that doesn't feed the chip's logic supply at all. Check your specific
  board's pinout/silkscreen for its 5V/VBUS pin (not all "Mini" boards
  break it out identically).
- **Resistor value for the LED**: TSAL6100's forward voltage is ~1.35V
  around 100mA. From 5V: `(5 − 1.35) / 0.1A ≈ 36.5Ω` → use a **39Ω**
  standard resistor (gives ~93mA, a safe margin under the 100mA continuous
  rating). If you only have a 3.3V-only board without a broken-out VBUS
  pin, use `(3.3 − 1.35) / 0.1A ≈ 19.5Ω` → a **22Ω** resistor instead (gives
  ~88mA) — check the datasheet before pushing higher continuous current.

## Firmware

`firmware/ir_fire/ir_fire.ino` — see the comments at the top of that file
for the exact Arduino IDE board/core setup required (esp32 core **3.0.0 or
newer** — the LEDC API it uses is core-3.x-specific), and
[`FLASHING.md`](./FLASHING.md) for how to get it onto the board from
Android, iOS, Linux, macOS, or Windows.

## Protocol

Plain newline-terminated lines over USB serial (native USB CDC-ACM, no
special baud rate negotiation needed since it's not a real UART bridge):

- phone → ESP: `FIRE\n` — fires the IR pulse
- ESP → phone: `{"type":"heartbeat","uptimeMs":...}\n` every 2s, and
  `{"type":"fired"}\n` right after a shot — the phone app doesn't parse
  these deeply yet, any line arriving is enough to show "connected".
