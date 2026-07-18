// AR Ops IR-Fire Firmware — ESP32-S3
//
// Fires a 38kHz-modulated 850nm IR pulse (TSAL6100 LED via an AO3400A
// low-side MOSFET switch) whenever a "FIRE" line arrives over USB serial
// from the phone app, and prints a periodic heartbeat line so the app knows
// it's still connected. See ../../README.md for wiring/pinout and
// ../../FLASHING.md for how to get this onto the board from Android, iOS,
// Linux, Mac, or Windows.
//
// 38kHz is not an arbitrary choice: it's the near-universal carrier
// frequency for consumer IR — every common IR receiver module (TSOP38238,
// TSOP4838, VS1838B, ...) is tuned to demodulate exactly this frequency.
// There's no receiver in this build yet (v1 is transmit-only — hit
// validation stays the existing compass/GPS check, this is a physical/
// cosmetic accompaniment), but firing at 38kHz means a receiver added later
// works with off-the-shelf parts instead of a custom carrier frequency.
//
// Board: any ESP32-S3 "Mini"/"SuperMini" dev board with native USB.
// Arduino IDE setup:
//   - Boards Manager: install "esp32 by Espressif Systems", version 3.0.0
//     or newer (the ledcAttach/ledcWrite(pin, ...) API used below is core
//     3.x's signature — core 2.x used ledcSetup/ledcAttachPin/
//     ledcWrite(channel, ...) instead and will NOT compile this as-is).
//   - Tools menu: Board = your exact ESP32-S3 board (or generic
//     "ESP32S3 Dev Module" if your board isn't listed by name); USB CDC On
//     Boot = "Enabled" (required — without this the native USB port never
//     shows up as a serial device at all, and the phone app won't find it).

const int IR_PIN = 4;            // GPIO4 → ~220R gate resistor → AO3400A gate (see README wiring)
const int IR_CARRIER_HZ = 38000;
const int IR_PWM_RES_BITS = 8;    // duty cycle resolution — 128/255 ≈ 50%
const int IR_PULSE_MS = 80;       // how long the modulated burst lasts per shot

unsigned long lastHeartbeat = 0;
const unsigned long HEARTBEAT_MS = 2000;

void irOff() {
  ledcWrite(IR_PIN, 0);
}

void fireIr() {
  ledcWrite(IR_PIN, 128); // ~50% duty @ 38kHz — the actual IR "carrier"
  delay(IR_PULSE_MS);
  irOff();
}

void setup() {
  Serial.begin(115200);
  ledcAttach(IR_PIN, IR_CARRIER_HZ, IR_PWM_RES_BITS);
  irOff();
}

void loop() {
  if (Serial.available()) {
    String line = Serial.readStringUntil('\n');
    line.trim();
    if (line == "FIRE") {
      fireIr();
      Serial.println("{\"type\":\"fired\"}");
    }
  }

  unsigned long now = millis();
  if (now - lastHeartbeat >= HEARTBEAT_MS) {
    lastHeartbeat = now;
    Serial.printf("{\"type\":\"heartbeat\",\"uptimeMs\":%lu}\n", now);
  }
}
