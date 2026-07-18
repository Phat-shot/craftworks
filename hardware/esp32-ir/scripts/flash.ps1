# Flashes the AR Ops IR-fire firmware onto an ESP32-S3 via esptool.py.
# See ../FLASHING.md for how to get the three .bin files (Arduino IDE:
# Sketch -> Export Compiled Binary).
#
# Usage: .\flash.ps1 -Port COM5 -Bootloader ir_fire.ino.bootloader.bin -Partitions ir_fire.ino.partitions.bin -App ir_fire.ino.bin
param(
    [Parameter(Mandatory=$true)][string]$Port,
    [Parameter(Mandatory=$true)][string]$Bootloader,
    [Parameter(Mandatory=$true)][string]$Partitions,
    [Parameter(Mandatory=$true)][string]$App
)

if (-not (Get-Command esptool.py -ErrorAction SilentlyContinue)) {
    Write-Error "esptool.py not found - install it with: pip install esptool"
    exit 1
}

esptool.py --chip esp32s3 --port $Port --baud 460800 write_flash -z `
  --flash_mode dio --flash_freq 80m --flash_size 4MB `
  0x0 $Bootloader `
  0x8000 $Partitions `
  0x10000 $App
