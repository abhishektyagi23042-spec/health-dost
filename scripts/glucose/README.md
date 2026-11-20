# HealthDost Glucometer Integration (Bluetooth SIG 0x1808)

This module provides additive Bluetooth Low Energy (BLE) glucometer reading capabilities for the HealthDost kiosk.

## Supported Meters
Target meters implement the official Bluetooth SIG Glucose Profile (Service `0x1808`):
- **Roche Accu-Chek Instant** & **Accu-Chek Guide**
- **Ascensia Contour Next One** & **Contour Plus Elite**

## Verifying Meter Compatibility (nRF Connect)
Before pairing with the Raspberry Pi, verify your meter exposes the standard Glucose service:
1. Install **nRF Connect for Mobile** (available on iOS / Android).
2. Put the glucometer into Bluetooth pairing mode.
3. In nRF Connect, scan and connect to the meter.
4. Check that the service list contains **Glucose Service (`0x1808`)** with:
   - `0x2A18` Glucose Measurement (Notify)
   - `0x2A52` Record Access Control Point - RACP (Indicate & Write)
   - `0x2A51` Glucose Feature (Read)
   - `0x2A34` Glucose Measurement Context (Optional Notify)

## Prerequisites & Installation on Raspberry Pi
The Python helper requires the `bleak` library:
```bash
sudo apt-get update
sudo apt-get install -y python3-pip python3-bluez bluez
pip3 install bleak
```

## Pairing the Meter
Many meters require Bluetooth bonding with a 6-digit PIN:
1. Ensure the meter is **not** currently paired or connected to any smartphone app (e.g., delete the meter from the **mySugr** or **Contour Diabetes** app).
2. Put the meter into pairing mode:
   - **Accu-Chek Instant:** With meter off, press and hold the button until the pairing/sync symbol flashes.
   - **Contour Next One / Plus Elite:** With meter off, press and hold power until the top LED pulses blue.
3. Run the pairing helper script on the Pi:
```bash
chmod +x scripts/glucose/pair_meter.sh
./scripts/glucose/pair_meter.sh <BLUETOOTH_MAC>
```
4. When prompted by `bluetoothctl`, enter the 6-digit PIN displayed on the meter screen or printed on the back label.

## Environment Variables
Configure these in the environment (or systemd kiosk service) for the backend:
| Variable | Default | Description |
|---|---|---|
| `GLUCOSE_ENABLED` | `0` (or unset) | Set to `1` to enable glucometer features. If unset or not `1`, the kiosk works as before with the card showing `"-- not measured"`. |
| `GLUCOSE_ADDRESS` | `""` | BLE MAC address of the meter (e.g. `XX:XX:XX:XX:XX:XX`). If omitted, scans for 0x1808 up to 15s. |
| `GLUCOSE_PYTHON` | `python3` | Path to python executable (e.g. `/usr/bin/python3` or virtualenv python). |
| `GLUCOSE_MAX_AGE_MIN` | `15` | Maximum age in minutes for a reading before it is marked `stale`. |
| `GLUCOSE_MOCK` | unset | Set to a number (e.g. `112`) to simulate a reading without hardware. |

## CLI Testing
Run manual tests with the Python helper:
```bash
# Test mock mode:
python3 scripts/glucose/glucose_reader.py --mock 112

# Run parser unit tests:
python3 scripts/glucose/test_glucose_parse.py

# Live sync from a paired meter:
python3 scripts/glucose/glucose_reader.py --address "XX:XX:XX:XX:XX:XX" --last
```

## Troubleshooting
1. **Meter connects then disconnects immediately:**
   Glucometers only keep the BLE radio active for 30–60 seconds after a test strip is removed or when explicitly in "Sync" mode. Press "Sync" on the kiosk immediately after taking a test or activating the meter.
2. **"PAIRING_REQUIRED" error:**
   The meter's encryption keys changed or it is bonded to a phone. Unpair from your phone, reset the meter's Bluetooth pairing, and run `pair_meter.sh` again.
3. **"NOT_FOUND" error:**
   Ensure Bluetooth is powered on (`rfkill unblock bluetooth` and `bluetoothctl power on`). Verify the meter has battery and is actively flashing its Bluetooth indicator.
