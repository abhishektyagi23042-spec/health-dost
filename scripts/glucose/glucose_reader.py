#!/usr/bin/env python3
"""
scripts/glucose/glucose_reader.py
Reads blood glucose data from standard Bluetooth SIG Glucose Profile (0x1808) meters.
Pure functions are exportable and unit-testable without bleak or hardware.
Outputs strictly JSON lines on stdout.
"""

import argparse
import asyncio
from datetime import datetime, timedelta
import json
import struct
import sys

# Standard Bluetooth SIG Glucose Profile UUIDs
GLUCOSE_SERVICE_UUID = "00001808-0000-1000-8000-00805f9b34fb"
GLUCOSE_MEASUREMENT_UUID = "00002a18-0000-1000-8000-00805f9b34fb"
GLUCOSE_CONTEXT_UUID = "00002a34-0000-1000-8000-00805f9b34fb"
GLUCOSE_FEATURE_UUID = "00002a51-0000-1000-8000-00805f9b34fb"
RACP_UUID = "00002a52-0000-1000-8000-00805f9b34fb"

# Sample Types per Bluetooth SIG Glucose Service specification
SAMPLE_TYPES = {
    0: "reserved",
    1: "capillary whole blood",
    2: "capillary plasma",
    3: "venous whole blood",
    4: "venous plasma",
    5: "arterial whole blood",
    6: "arterial plasma",
    7: "undetermined whole blood",
    8: "undetermined plasma",
    9: "interstitial fluid (isf)",
    10: "control solution",
}

# Sample Locations per Bluetooth SIG Glucose Service specification
SAMPLE_LOCATIONS = {
    0: "reserved",
    1: "finger",
    2: "alternate site testing (ast)",
    3: "earlobe",
    4: "control solution",
    15: "location not available",
}

# IEEE-11073 16-bit SFLOAT Special Values
SFLOAT_SPECIAL_VALUES = {
    0x07FE: "+INFINITY",
    0x07FF: "NaN",
    0x0800: "NRes",
    0x0801: "Reserved",
    0x0802: "-INFINITY",
}


def parse_sfloat(val: int):
    """
    Parse an IEEE-11073 16-bit SFLOAT into a Python float, or None if special value.
    Input `val` is an unsigned 16-bit integer (0..65535).
    12-bit signed mantissa (-2048..2047) and 4-bit signed exponent (-8..7).
    """
    raw_mantissa = val & 0x0FFF
    raw_exponent = (val >> 12) & 0x0F

    # Special values return None
    if raw_mantissa in SFLOAT_SPECIAL_VALUES:
        return None

    # Sign extension for 12-bit mantissa
    if raw_mantissa >= 2048:
        mantissa = raw_mantissa - 4096
    else:
        mantissa = raw_mantissa

    # Sign extension for 4-bit exponent
    if raw_exponent >= 8:
        exponent = raw_exponent - 16
    else:
        exponent = raw_exponent

    return float(mantissa) * (10.0 ** exponent)


def parse_measurement(data: bytes, device_name: str = "", address: str = "") -> dict:
    """
    Parse a 0x2A18 Glucose Measurement characteristic payload.
    Returns a dictionary conforming to the JSON reading specification.
    """
    if len(data) < 10:
        raise ValueError(f"Payload too short for glucose measurement ({len(data)} bytes)")

    flags = data[0]
    time_offset_present = bool(flags & 0x01)
    conc_present = bool(flags & 0x02)
    units_mol_per_l = bool(flags & 0x04)  # 0: kg/L, 1: mol/L
    sensor_status_present = bool(flags & 0x08)
    context_follows = bool(flags & 0x10)

    # Sequence Number (uint16 LE)
    seq = struct.unpack_from("<H", data, 1)[0]

    # Base Time (year uint16 LE, month, day, hour, minute, second)
    year, month, day, hour, minute, second = struct.unpack_from("<HBBBBB", data, 3)

    offset = 10
    time_offset_minutes = 0
    if time_offset_present:
        if len(data) < offset + 2:
            raise ValueError("Payload missing time offset bytes")
        time_offset_minutes = struct.unpack_from("<h", data, offset)[0]
        offset += 2

    # Construct datetime
    try:
        base_dt = datetime(year, month, day, hour, minute, second)
        adjusted_dt = base_dt + timedelta(minutes=time_offset_minutes)
    except (ValueError, OverflowError):
        adjusted_dt = datetime.now()

    # Timezone-aware ISO timestamp
    local_tz = datetime.now().astimezone().tzinfo
    dt_with_tz = adjusted_dt.replace(tzinfo=local_tz)
    timestamp_str = dt_with_tz.isoformat()

    mgdl = None
    raw_val = None
    unit_str = None
    sample_type_str = None
    location_str = None

    if conc_present:
        if len(data) < offset + 3:
            raise ValueError("Payload missing concentration / type-sample bytes")
        raw_sfloat = struct.unpack_from("<H", data, offset)[0]
        type_and_location = data[offset + 2]
        offset += 3

        raw_val = parse_sfloat(raw_sfloat)

        if units_mol_per_l:
            unit_str = "mol/L"
            if raw_val is not None:
                # mol/L to mg/dL: mol/L x 1000 x 18.016
                mgdl = int(round(raw_val * 1000.0 * 18.016))
        else:
            unit_str = "kg/L"
            if raw_val is not None:
                # kg/L to mg/dL: kg/L x 100000
                mgdl = int(round(raw_val * 100000.0))

        type_code = type_and_location & 0x0F
        location_code = (type_and_location >> 4) & 0x0F
        sample_type_str = SAMPLE_TYPES.get(type_code, f"type_{type_code}")
        location_str = SAMPLE_LOCATIONS.get(location_code, f"location_{location_code}")

    status_code = 0
    if sensor_status_present:
        if len(data) >= offset + 2:
            status_code = struct.unpack_from("<H", data, offset)[0]
            offset += 2

    return {
        "type": "reading",
        "seq": seq,
        "timestamp": timestamp_str,
        "mgdl": mgdl,
        "raw": raw_val,
        "unit": unit_str,
        "sampleType": sample_type_str,
        "location": location_str,
        "status": status_code,
        "contextFollows": context_follows,
        "device": device_name,
        "address": address,
    }


def emit_json(obj: dict):
    """Ensure strictly single-line JSON is written to stdout."""
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()


def run_mock(mgdl_val: int):
    """Simulate a successful reading without hardware or bleak."""
    local_tz = datetime.now().astimezone().tzinfo
    now_str = datetime.now().replace(tzinfo=local_tz).isoformat()
    raw = round(float(mgdl_val) / 100000.0, 6)

    reading = {
        "type": "reading",
        "seq": 42,
        "timestamp": now_str,
        "mgdl": int(mgdl_val),
        "raw": raw,
        "unit": "kg/L",
        "sampleType": "capillary whole blood",
        "location": "finger",
        "status": 0,
        "device": "Mock Glucose Meter",
        "address": "00:11:22:33:44:55",
    }
    emit_json(reading)
    emit_json({"type": "done", "count": 1})
    sys.exit(0)


async def ble_sync(address: str, fetch_all: bool = False):
    """Connect to a BLE glucose meter and fetch record(s)."""
    try:
        from bleak import BleakScanner, BleakClient
        from bleak.exc import BleakError, BleakDBusError
    except ImportError:
        emit_json({
            "type": "error",
            "code": "PARSE",
            "message": "The 'bleak' Python library is not installed. Run 'pip install bleak'."
        })
        sys.exit(1)

    target_address = address
    target_device_name = "Bluetooth Glucose Meter"

    # Step 1: Scan if address was not provided
    if not target_address:
        try:
            device = await BleakScanner.find_device_by_filter(
                lambda d, adv: GLUCOSE_SERVICE_UUID.lower() in [s.lower() for s in (adv.service_uuids or [])]
                or any("contour" in (d.name or "").lower() or "accu" in (d.name or "").lower() for _ in [0]),
                timeout=15.0
            )
            if not device:
                emit_json({
                    "type": "error",
                    "code": "NOT_FOUND",
                    "message": "No Bluetooth LE glucose meter found within 15 seconds."
                })
                sys.exit(1)
            target_address = device.address
            target_device_name = device.name or target_device_name
        except Exception as e:
            emit_json({
                "type": "error",
                "code": "NOT_FOUND",
                "message": f"Scan failed: {str(e)}"
            })
            sys.exit(1)

    readings = []
    racp_event = asyncio.Event()
    client = None

    try:
        client = BleakClient(target_address, timeout=12.0)
        await client.connect()
    except (BleakDBusError, BleakError, Exception) as e:
        err_msg = str(e).lower()
        if "auth" in err_msg or "bond" in err_msg or "pair" in err_msg or "security" in err_msg:
            emit_json({
                "type": "error",
                "code": "PAIRING_REQUIRED",
                "message": f"Pairing or bonding required for meter: {str(e)}"
            })
        else:
            emit_json({
                "type": "error",
                "code": "TIMEOUT" if "timed out" in err_msg else "NOT_FOUND",
                "message": f"Could not connect to meter: {str(e)}"
            })
        sys.exit(1)

    try:
        services = client.services
        name = target_device_name
        addr = target_address

        def on_measurement(_sender, data_bytes):
            try:
                reading = parse_measurement(data_bytes, device_name=name, address=addr)
                readings.append(reading)
                emit_json(reading)
            except Exception as ex:
                emit_json({"type": "error", "code": "PARSE", "message": f"Parse error: {str(ex)}"})

        def on_racp(_sender, data_bytes):
            if len(data_bytes) >= 1 and data_bytes[0] == 0x06:
                racp_event.set()

        def on_context(_sender, _data_bytes):
            pass

        # Subscribe to Glucose Measurement
        await client.start_notify(GLUCOSE_MEASUREMENT_UUID, on_measurement)

        # Subscribe to Glucose Context if available
        for char in services.characteristics.values():
            if char.uuid.lower() == GLUCOSE_CONTEXT_UUID.lower():
                try:
                    await client.start_notify(GLUCOSE_CONTEXT_UUID, on_context)
                except Exception:
                    pass

        # Subscribe to RACP indications
        await client.start_notify(RACP_UUID, on_racp)

        # Write RACP request
        # [0x01, 0x01] = Report stored records (All)
        # [0x01, 0x06] = Report stored records (Last record)
        racp_opcode = bytearray([0x01, 0x01 if fetch_all else 0x06])
        await client.write_gatt_char(RACP_UUID, racp_opcode, response=True)

        try:
            await asyncio.wait_for(racp_event.wait(), timeout=10.0)
        except asyncio.TimeoutError:
            if not readings:
                emit_json({
                    "type": "error",
                    "code": "TIMEOUT",
                    "message": "Timed out waiting for RACP response from meter."
                })
                sys.exit(1)

        emit_json({"type": "done", "count": len(readings)})
        sys.exit(0)

    except Exception as e:
        emit_json({"type": "error", "code": "PARSE", "message": str(e)})
        sys.exit(1)
    finally:
        if client and client.is_connected:
            try:
                await client.disconnect()
            except Exception:
                pass


def main():
    parser = argparse.ArgumentParser(description="HealthDost BLE Glucose Reader")
    parser.add_argument("--address", type=str, default="", help="Bluetooth MAC address of the meter")
    parser.add_argument("--last", action="store_true", default=True, help="Fetch latest record (default)")
    parser.add_argument("--all", action="store_true", default=False, help="Fetch all records")
    parser.add_argument("--mock", type=int, default=None, help="Mock reading value in mg/dL (e.g. 112)")

    args = parser.parse_args()

    if args.mock is not None:
        run_mock(args.mock)

    fetch_all = bool(args.all)
    asyncio.run(ble_sync(args.address, fetch_all=fetch_all))


if __name__ == "__main__":
    main()
