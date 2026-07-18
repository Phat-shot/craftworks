// AR Ops IR-ID-Beacon Firmware — ESP32-S3
//
// Continuously broadcasts this device's 8-bit ID as a 38kHz-modulated
// 850nm IR blink pattern (TSAL6100 LED via an AO3400A low-side MOSFET
// switch) — worn by a player, decoded by an OPPONENT'S phone camera (see
// apps/arops-mobile's IR frame-processor plugin) to confirm a shot was
// actually aimed at a real, specific player, not just a GPS/compass cone
// match. See ../../README.md for wiring/pinout and ../../FLASHING.md for
// how to flash this from Android, iOS, Linux, Mac, or Windows.
//
// Bit timing is deliberately slow (150ms/bit) — a photodiode-based IR
// receiver could easily read microsecond-level timing, but this needs to be
// decodable from a phone CAMERA at ~30fps, where each bit needs several
// frames of margin against motion blur and dropped frames.
//
// Packet format (one cycle ≈2.1s, repeats forever):
//   [ 300ms ON ]   preamble — longer than any data bit, unambiguous start marker
//   [ 100ms OFF]   gap
//   [ 8 × 150ms ]  data bits, MSB first, ON=1/OFF=0 — this device's ID (0-255)
//   [ 500ms OFF]   idle gap before the next cycle
//
// 38kHz sub-carrier: not needed for a camera (it just sees average
// brightness per frame — the sub-carrier is invisible at video frame
// rates) — kept anyway so a future TSOP-based photodiode receiver could
// read this same beacon directly too, no firmware changes needed.
//
// Board: any ESP32-S3 "Mini"/"SuperMini" dev board with native USB.
// Arduino IDE setup:
//   - Boards Manager: install "esp32 by Espressif Systems", version 3.0.0
//     or newer (the ledcAttach/ledcWrite(pin, ...) API used below is core
//     3.x's signature — core 2.x used ledcSetup/ledcAttachPin/
//     ledcWrite(channel, ...) instead and will NOT compile this as-is).
//   - Tools menu: Board = your exact ESP32-S3 board (or generic
//     "ESP32S3 Dev Module" if your board isn't listed by name); USB CDC On
//     Boot = "Enabled" (only needed for the serial bench-test command below
//     — the beacon itself runs standalone off any USB power source once
//     flashed, no data connection required).

// ── Per-device configuration — set a UNIQUE value per physical board ──
const uint8_t DEVICE_ID = 1; // 0-255, must be unique among all players' devices

const int IR_PIN = 4;             // GPIO4 → ~220R gate resistor → AO3400A gate (see README wiring)
const int IR_CARRIER_HZ = 38000;
const int IR_PWM_RES_BITS = 8;     // duty cycle resolution — 128/255 ≈ 50%
const int PREAMBLE_MS = 300;
const int PREAMBLE_GAP_MS = 100;
const int BIT_MS = 150;
const int IDLE_GAP_MS = 500;

void irOn()  { ledcWrite(IR_PIN, 128); } // ~50% duty @ 38kHz — the actual IR "carrier"
void irOff() { ledcWrite(IR_PIN, 0); }

void broadcastId() {
  irOn();
  delay(PREAMBLE_MS);
  irOff();
  delay(PREAMBLE_GAP_MS);

  for (int bit = 7; bit >= 0; bit--) {
    bool on = (DEVICE_ID >> bit) & 0x01;
    if (on) irOn(); else irOff();
    delay(BIT_MS);
  }
  irOff();
  delay(IDLE_GAP_MS);
}

void setup() {
  Serial.begin(115200);
  ledcAttach(IR_PIN, IR_CARRIER_HZ, IR_PWM_RES_BITS);
  irOff();
  Serial.printf("{\"type\":\"boot\",\"deviceId\":%u}\n", DEVICE_ID);
}

void loop() {
  broadcastId();

  // Bench-test only, and only checked once per ~2.1s cycle (broadcastId()
  // blocks) — the beacon itself needs no USB data connection once flashed,
  // any USB power source keeps it running. This just lets you confirm over
  // serial that it's alive and broadcasting the ID you expect, without
  // needing a second phone's camera nearby to verify.
  if (Serial.available()) {
    String line = Serial.readStringUntil('\n');
    line.trim();
    if (line == "PING") {
      Serial.printf("{\"type\":\"heartbeat\",\"deviceId\":%u,\"uptimeMs\":%lu}\n", DEVICE_ID, millis());
    }
  }
}
