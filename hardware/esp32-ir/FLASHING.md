# Flashing the IR-Fire firmware onto the ESP32-S3

Flashing is a one-time setup step, done once from a computer (or Android, see
below) before the board is used with the phone app. You don't need to
re-flash it every time you use it — plug it into the phone via USB-C
afterward and it just runs.

**Honest platform limit up front: this cannot be done from iOS.** Skip to
[iOS](#ios) for why, and flash from literally any other device instead — the
board itself doesn't care what flashed it.

Three ways to get the firmware on, easiest first:

1. **Arduino IDE** (recommended if you're already editing the `.ino`) — one
   click, handles everything.
2. **Browser-based, zero install** — flash a pre-built `.bin` from Chrome/Edge,
   no tools on your machine at all.
3. **`esptool.py` CLI** — scriptable, works headless/over SSH, no IDE needed.

## 1. Arduino IDE (recommended)

Works identically on **Windows, macOS, and Linux**.

1. Install the [Arduino IDE](https://www.arduino.cc/en/software) (2.x).
2. `File → Preferences → Additional boards manager URLs`, add:
   `https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json`
3. `Tools → Board → Boards Manager`, search **esp32**, install **"esp32 by
   Espressif Systems"** — version **3.0.0 or newer** (the firmware's LEDC
   API is core-3.x-specific, see the comment at the top of `ir_fire.ino`).
4. Open `firmware/ir_fire/ir_fire.ino`.
5. `Tools` menu: select your board (or generic **"ESP32S3 Dev Module"** if
   your specific "Mini"/"SuperMini" board isn't listed by name), and set
   **USB CDC On Boot = Enabled** — without this the native USB port never
   shows up as a serial device at all.
6. Plug the board in via USB-C, select its port under `Tools → Port`, hit
   **Upload** (→ arrow icon).

## 2. Browser-based (no install, Windows/macOS/Linux/Android\*)

Uses Espressif's own web flasher — [esptool-js](https://espressif.github.io/esptool-js/),
built on the browser's [Web Serial API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Serial_API).
**Requires a Chromium-based browser** (Chrome, Edge, Brave, Opera) — Web
Serial isn't implemented in Firefox or Safari.

You need a compiled `.bin` first (the web tool flashes binaries, not
source):

- In the Arduino IDE: `Sketch → Export Compiled Binary`, then look in the
  sketch folder for `ir_fire.ino.bin` (the app image; there'll usually also
  be `ir_fire.ino.bootloader.bin` and `ir_fire.ino.partitions.bin` next to
  it — the web tool's UI lets you add all three at their respective
  offsets, see below).

Steps:

1. Open [espressif.github.io/esptool-js](https://espressif.github.io/esptool-js/) in Chrome/Edge.
2. Click **Connect**, pick the ESP32-S3's USB port from the browser's device
   picker.
3. Add the file(s) at these offsets: `0x0` → bootloader, `0x8000` →
   partitions, `0x10000` → the app binary. (If Arduino only exported one
   `.bin`, it's the app image — use offset `0x10000` for it alone; check the
   IDE's export output folder for the other two.)
4. Click **Program**.

\* **Android**: Chrome for Android does support Web Serial and can often
reach a USB-C-attached ESP32 directly — but reliability varies by phone/USB
controller and isn't guaranteed the way desktop Chrome is. If it doesn't
detect the board, use option 1 or 3 from a computer instead; you only need
to flash once.

## 3. `esptool.py` CLI (scriptable)

Works on **Windows, macOS, Linux**, and (with extra steps) **Android via
Termux**.

```bash
pip install esptool
```

Then, with the board plugged in:

```bash
esptool.py --chip esp32s3 --port <PORT> --baud 460800 write_flash -z \
  --flash_mode dio --flash_freq 80m --flash_size 4MB \
  0x0 ir_fire.ino.bootloader.bin \
  0x8000 ir_fire.ino.partitions.bin \
  0x10000 ir_fire.ino.bin
```

`<PORT>` is `/dev/ttyACM0` (or similar) on Linux, `/dev/cu.usbmodemXXXX` on
macOS, `COM<n>` on Windows (Device Manager → Ports). Adjust `--flash_size`
if your board has a different flash chip (check its silkscreen/datasheet).

Helper scripts wrapping this exact command are in `scripts/`:
[`flash.sh`](./scripts/flash.sh) (Linux/macOS) and
[`flash.ps1`](./scripts/flash.ps1) (Windows PowerShell) — both take the port
and the three `.bin` files as arguments.

**Android via Termux** (advanced/niche — most people should just flash once
from a computer instead): install [Termux](https://termux.dev/), `pip
install esptool` inside it, and grant it USB access via `termux-usb` for
the port. This is fiddly enough that it's only worth it if a computer
genuinely isn't available.

## iOS

**Not possible, on any method above.** Two independent Apple platform
restrictions both block it: Safari/WebKit has never implemented the Web
Serial API (method 2), and iOS doesn't allow apps to talk to arbitrary USB
serial accessories without Apple's MFi (Made-for-iPhone) certification —
which this hobby board obviously doesn't have (methods 1 and 3, or any
custom app, hit the same wall). There's no workaround short of the board
being MFi-certified hardware. Flash it once from a Windows/Mac/Linux/Android
device — after that, the board itself doesn't care what flashed it, and
using it day-to-day is only ever from the Android phone app anyway (the
`esp-bridge` USB module is Android-only for the same underlying reason).
