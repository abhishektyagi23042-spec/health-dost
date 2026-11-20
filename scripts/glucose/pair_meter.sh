#!/usr/bin/env bash
# scripts/glucose/pair_meter.sh
# One-time interactive pairing helper for Bluetooth SIG Glucose Profile meters on Raspberry Pi.
# Meters often require PIN authentication displayed on the meter screen or printed on the back.

set -e

MAC="$1"

if [ -z "$MAC" ]; then
    echo "========================================================"
    echo " HealthDost Glucometer Pairing Helper"
    echo "========================================================"
    echo "Usage: ./pair_meter.sh <BLUETOOTH_MAC_ADDRESS>"
    echo ""
    echo "Steps:"
    echo "1. Turn on your glucometer and place it in Bluetooth pairing mode:"
    echo "   - Roche Accu-Chek Instant: Press & hold power button until Bluetooth symbol flashes."
    echo "   - Ascensia Contour Next One / Plus Elite: Turn off, hold power button until blue light flashes."
    echo "2. Find its MAC address using: bluetoothctl devices  (or hcitool lescan)"
    echo "3. Run: ./pair_meter.sh XX:XX:XX:XX:XX:XX"
    echo "========================================================"
    exit 1
fi

echo "Preparing Bluetooth controller..."
bluetoothctl power on
bluetoothctl agent KeyboardDisplay
bluetoothctl default-agent

echo "Scanning for device $MAC..."
bluetoothctl --timeout 10 scan on || true

echo "Attempting to pair with $MAC..."
echo "NOTE: Look at the glucometer screen for a 6-digit PIN code."
echo "If prompted, enter the 6-digit PIN."

bluetoothctl pair "$MAC"
bluetoothctl trust "$MAC"

echo ""
echo "Pairing and trust completed for $MAC."
echo "Add GLUCOSE_ADDRESS=\"$MAC\" and GLUCOSE_ENABLED=1 to your environment."
