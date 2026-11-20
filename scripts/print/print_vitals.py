import json
import os
import subprocess
import sys
from datetime import datetime

from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas


def safe(v):
    return "" if v is None else str(v)


def main():
    data = json.load(sys.stdin)
    patient = data.get("patient", {}) or {}
    vitals = data.get("vitals", {}) or {}
    nurse = data.get("nurseName", "") or ""

    printer = os.environ.get("PRINTER_NAME", "Canon_MF440_Series")
    out = os.environ.get("OUT_PDF_PATH", "/tmp/healthdost_vitals.pdf")

    c = canvas.Canvas(out, pagesize=A4)
    width, height = A4

    y = height - 50

    def line(txt, dy=16, bold=False):
        nonlocal y
        c.setFont("Helvetica-Bold" if bold else "Helvetica", 12 if bold else 11)
        c.drawString(50, y, txt)
        y -= dy
        if y < 70:
            c.showPage()
            y = height - 50

    line("HEALTHDOST - Patient Vitals", bold=True, dy=22)
    line(f"Printed: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}", dy=16)
    if nurse:
        line(f"Nurse: {safe(nurse)}", dy=16)
    y -= 8

    line("Patient details", bold=True, dy=18)
    line(f"Name: {safe(patient.get('name'))}")
    line(f"Patient ID: {safe(patient.get('id') or patient.get('patientId'))}")
    line(f"Gender: {safe(patient.get('gender'))}")
    line(f"Height (cm): {safe(patient.get('height_cm'))}")
    line(f"Weight (kg): {safe(patient.get('weight_kg'))}")
    y -= 8

    line("Vitals", bold=True, dy=18)
    line(f"Blood Pressure: {safe(vitals.get('bloodPressure'))}")
    line(f"Heart Rate: {safe(vitals.get('heartRate'))}")
    line(f"SpO2: {safe(vitals.get('bloodOxygen'))}")
    line(f"Temperature: {safe(vitals.get('temperature'))}")
    line(f"BMI: {safe(vitals.get('bmi'))}")
    line(f"Stress Level: {safe(vitals.get('stressLevel'))}")

    # [glucose] Additive blood glucose reading in printed receipt
    glucose_entry = vitals.get("glucose") or data.get("glucose")
    glucose_meta = vitals.get("glucoseMeta") or data.get("glucoseMeta") or {}
    glucose_val = None
    if isinstance(glucose_entry, (list, tuple)) and len(glucose_entry) > 0:
        glucose_val = glucose_entry[0]
    elif isinstance(glucose_entry, (int, float)):
        glucose_val = glucose_entry

    if glucose_val is not None and str(glucose_val).strip() not in ("", "--", "None", "null"):
        time_str = ""
        meta_ts = glucose_meta.get("timestamp") if isinstance(glucose_meta, dict) else None
        if meta_ts:
            try:
                dt = datetime.fromisoformat(str(meta_ts))
                time_str = f" (meter time {dt.strftime('%H:%M')})"
            except Exception:
                time_str = ""
        line(f"Blood glucose: {glucose_val} mg/dL{time_str}")
    else:
        line("Blood glucose: --")

    diag = vitals.get("diagnosisText") or data.get("diagnosisText") or ""
    if diag:
        y -= 8
        line("Diagnosis / Notes", bold=True, dy=18)
        words = safe(diag).split()
        cur = ""
        for w in words:
            if len(cur) + 1 + len(w) > 90:
                line(cur, dy=14)
                cur = w
            else:
                cur = (cur + " " + w).strip()
        if cur:
            line(cur, dy=14)

    c.save()

    subprocess.check_call(["lp", "-d", printer, out])


if __name__ == "__main__":
    main()

