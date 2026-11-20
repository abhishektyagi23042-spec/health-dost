#!/usr/bin/env python3
"""
scripts/glucose/test_glucose_parse.py
Unit tests for Bluetooth SIG Glucose Profile parsing functions.
Tests parse_sfloat and parse_measurement with hand-built byte arrays.
"""

import os
import sys
import unittest

# Ensure scripts/glucose is in path
sys.path.insert(0, os.path.dirname(__file__))
from glucose_reader import parse_sfloat, parse_measurement


class TestGlucoseParse(unittest.TestCase):
    def test_sfloat_positive_and_negative_exponents(self):
        # 112 * 10^-5 = 0.00112
        # Mantissa = 112 (0x070), Exponent = -5 (0xB)
        val = 0xB070
        result = parse_sfloat(val)
        self.assertAlmostEqual(result, 0.00112, places=7)

        # 62 * 10^-4 = 0.0062
        # Mantissa = 62 (0x03E), Exponent = -4 (0xC)
        val_mol = 0xC03E
        result_mol = parse_sfloat(val_mol)
        self.assertAlmostEqual(result_mol, 0.0062, places=6)

        # Simple integer: 100 * 10^0 = 100
        # Mantissa = 100 (0x064), Exponent = 0
        val_int = 0x0064
        self.assertEqual(parse_sfloat(val_int), 100.0)

    def test_sfloat_special_values(self):
        # NaN (0x07FF), NRes (0x0800), +INF (0x07FE), -INF (0x0802), Reserved (0x0801)
        self.assertIsNone(parse_sfloat(0x07FF))
        self.assertIsNone(parse_sfloat(0xF7FF))  # with exponent bits set
        self.assertIsNone(parse_sfloat(0x0800))
        self.assertIsNone(parse_sfloat(0x07FE))
        self.assertIsNone(parse_sfloat(0x0802))
        self.assertIsNone(parse_sfloat(0x0801))

    def test_parse_measurement_kg_per_l_no_offset(self):
        # Flags: 0x02 (Conc present, kg/L, no time-offset, no status, no context)
        # Seq: 42 (0x002A)
        # Base time: 2026-11-11 16:40:00 (Year=2026 [0x07EA], Month=11, Day=11, Hr=16, Min=40, Sec=0)
        # Concentration: 0.00112 kg/L (0xB070 -> \x70\xB0)
        # Type & Location: 0x11 (Type 1 = capillary whole blood, Loc 1 = finger)
        data = b"\x02\x2a\x00\xea\x07\x0b\x0b\x10\x28\x00\x70\xb0\x11"
        res = parse_measurement(data, device_name="Accu-Chek Instant", address="AA:BB:CC:DD:EE:FF")

        self.assertEqual(res["type"], "reading")
        self.assertEqual(res["seq"], 42)
        self.assertEqual(res["mgdl"], 112)
        self.assertAlmostEqual(res["raw"], 0.00112, places=7)
        self.assertEqual(res["unit"], "kg/L")
        self.assertEqual(res["sampleType"], "capillary whole blood")
        self.assertEqual(res["location"], "finger")
        self.assertEqual(res["status"], 0)
        self.assertFalse(res["contextFollows"])
        self.assertEqual(res["device"], "Accu-Chek Instant")
        self.assertEqual(res["address"], "AA:BB:CC:DD:EE:FF")
        self.assertIn("16:40:00", res["timestamp"])

    def test_parse_measurement_mol_per_l_with_time_offset(self):
        # Flags: 0x07 (bit0: offset present, bit1: conc present, bit2: mol/L)
        # Seq: 100 (0x0064)
        # Base time: 2026-11-11 16:00:00
        # Time offset: +30 minutes (0x001E -> \x1e\x00) -> adjusted time 16:30:00
        # Concentration: 0.0062 mol/L (0xC03E -> \x3e\xc0)
        # Type & Location: 0x12 (Type 2 = capillary plasma, Loc 1 = finger)
        data = (
            b"\x07"  # flags
            b"\x64\x00"  # seq 100
            b"\xea\x07\x0b\x0b\x10\x00\x00"  # 2026-11-11 16:00:00
            b"\x1e\x00"  # +30 min offset
            b"\x3e\xc0"  # 0.0062 mol/L
            b"\x12"  # loc 1 (finger), type 2 (capillary plasma)
        )
        res = parse_measurement(data, device_name="Contour Plus Elite", address="11:22:33:44:55:66")

        self.assertEqual(res["seq"], 100)
        self.assertEqual(res["unit"], "mol/L")
        # 0.0062 * 1000 * 18.016 = 111.6992 -> round -> 112
        self.assertEqual(res["mgdl"], 112)
        self.assertEqual(res["sampleType"], "capillary plasma")
        self.assertEqual(res["location"], "finger")
        self.assertIn("16:30:00", res["timestamp"])

    def test_parse_measurement_special_nan(self):
        # SFLOAT NaN = 0x07FF
        data = b"\x02\x2a\x00\xea\x07\x0b\x0b\x10\x28\x00\xff\x07\x11"
        res = parse_measurement(data)
        self.assertIsNone(res["mgdl"])
        self.assertIsNone(res["raw"])

    def test_parse_measurement_context_and_status_annunciation(self):
        # Flags: 0x02 (conc) | 0x08 (status) | 0x10 (context) = 0x1A
        # Seq: 5
        # Base time: 2026-11-11 10:00:00
        # Conc: 0.00112 (0xB070 -> \x70\xB0)
        # Type/Loc: 0x11
        # Sensor status: 0x0002 (low battery / warning flag -> \x02\x00)
        data = (
            b"\x1a"
            b"\x05\x00"
            b"\xea\x07\x0b\x0b\x0a\x00\x00"
            b"\x70\xb0"
            b"\x11"
            b"\x02\x00"
        )
        res = parse_measurement(data)
        self.assertTrue(res["contextFollows"])
        self.assertEqual(res["status"], 2)
        self.assertEqual(res["mgdl"], 112)


if __name__ == "__main__":
    unittest.main()
