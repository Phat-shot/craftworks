#!/usr/bin/env bash
# Flashes the AR Ops IR-fire firmware onto an ESP32-S3 via esptool.py.
# See ../FLASHING.md for how to get the three .bin files (Arduino IDE:
# Sketch → Export Compiled Binary).
#
# Usage: ./flash.sh <port> <bootloader.bin> <partitions.bin> <app.bin>
# Example (Linux):  ./flash.sh /dev/ttyACM0 ir_beacon.ino.bootloader.bin ir_beacon.ino.partitions.bin ir_beacon.ino.bin
# Example (macOS):  ./flash.sh /dev/cu.usbmodem1101 ir_beacon.ino.bootloader.bin ir_beacon.ino.partitions.bin ir_beacon.ino.bin
set -euo pipefail

if [ "$#" -ne 4 ]; then
  echo "Usage: $0 <port> <bootloader.bin> <partitions.bin> <app.bin>" >&2
  exit 1
fi

PORT="$1"
BOOTLOADER="$2"
PARTITIONS="$3"
APP="$4"

if ! command -v esptool.py >/dev/null 2>&1; then
  echo "esptool.py not found — install it with: pip install esptool" >&2
  exit 1
fi

esptool.py --chip esp32s3 --port "$PORT" --baud 460800 write_flash -z \
  --flash_mode dio --flash_freq 80m --flash_size 4MB \
  0x0 "$BOOTLOADER" \
  0x8000 "$PARTITIONS" \
  0x10000 "$APP"
