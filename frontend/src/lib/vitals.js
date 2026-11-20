/**
 * Random integer in [min, max] inclusive.
 */
function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

/**
 * Random number in [min, max] with one decimal place.
 */
function randomDecimal(min, max) {
  return Math.round((Math.random() * (max - min) + min) * 10) / 10
}

export function statusBloodOxygen(value) {
  return value >= 95 ? 'normal' : 'low'
}

export function statusBloodPressure(systolic, diastolic) {
  if (systolic > 140 || diastolic > 90) return 'high'
  if (systolic < 90 || diastolic < 60) return 'low'
  return 'normal'
}

/** Dashboard rules: Underweight < 18.5, Healthy < 25, Overweight < 30, else Obese. Lowercase for storage. */
function statusBmi(bmi) {
  if (bmi < 18.5) return 'underweight'
  if (bmi <= 24.9) return 'healthy'
  if (bmi <= 29.9) return 'overweight'
  return 'obese'
}

/** Exported for use when setting vitals.bmi from patient profile (e.g. in dashboard). */
export function getBmiStatus(bmi) {
  return statusBmi(bmi)
}

export function statusHeartRate(value) {
  if (value > 100) return 'high'
  if (value < 60) return 'low'
  return 'normal'
}

export function statusStressLevel(value) {
  if (value <= 33) return 'low'
  if (value <= 66) return 'moderate'
  return 'high'
}

export function statusTemperature(value) {
  if (value >= 99) return 'elevated'
  if (value < 97) return 'low'
  return 'normal'
}

/**
 * Generate one set of random vitals in valid human ranges with status tags.
 * Does not include BMI; caller must set vitals.bmi from patient profile (height_cm, weight_kg).
 * @returns {{
 *   bloodOxygen: [number, string],
 *   bloodPressure: [string, string],
 *   heartRate: [number, string],
 *   stressLevel: [number, string],
 *   temperature: [number, string]
 * }}
 */
export function generateRandomVitals() {
  const bloodOxygenVal = randomInt(70, 100)
  const systolic = randomInt(80, 200)
  const diastolic = randomInt(50, 130)
  const heartRateVal = randomInt(40, 180)
  const stressVal = randomInt(0, 100)
  const tempVal = randomInt(94, 106)

  return {
    bloodOxygen: [bloodOxygenVal, statusBloodOxygen(bloodOxygenVal)],
    bloodPressure: [`${systolic}/${diastolic}`, statusBloodPressure(systolic, diastolic)],
    heartRate: [heartRateVal, statusHeartRate(heartRateVal)],
    stressLevel: [stressVal, statusStressLevel(stressVal)],
    temperature: [tempVal, statusTemperature(tempVal)],
  }
}

/**
 * Format vitals as a short string for the Gemini prompt.
 * @param {ReturnType<typeof generateRandomVitals>} vitals
 * @returns {string}
 */
export function formatVitalsForPrompt(vitals) {
  if (!vitals) return ''
  const [boVal, boStatus] = vitals.bloodOxygen
  const [bpVal, bpStatus] = vitals.bloodPressure
  const [bmiVal, bmiStatus] = vitals.bmi
  const [hrVal, hrStatus] = vitals.heartRate
  const [stressVal, stressStatus] = vitals.stressLevel
  const [tempVal, tempStatus] = vitals.temperature
  // [glucose] Format capillary blood glucose for Gemini prompt
  let glucosePrompt = 'Blood glucose (capillary, from meter): not measured.'
  const gEntry = vitals?.glucose
  const gVal = Array.isArray(gEntry) ? gEntry[0] : (typeof gEntry === 'number' ? gEntry : null)
  if (gVal != null && Number.isFinite(Number(gVal))) {
    let timeStr = ''
    const ts = vitals?.glucoseMeta?.timestamp
    if (ts) {
      try {
        const d = new Date(ts)
        if (!Number.isNaN(d.getTime())) {
          const hh = String(d.getHours()).padStart(2, '0')
          const mm = String(d.getMinutes()).padStart(2, '0')
          timeStr = ` at ${hh}:${mm}`
        }
      } catch {}
    }
    glucosePrompt = `Blood glucose (capillary, from meter): ${gVal} mg/dL${timeStr}.`
  }

  return (
    `Blood oxygen: ${boVal}% (${boStatus}). ` +
    `Blood pressure: ${bpVal} mmHg (${bpStatus}). ` +
    `BMI: ${bmiVal} (${bmiStatus}). ` +
    `Heart rate: ${hrVal} bpm (${hrStatus}). ` +
    `Stress level: ${stressVal}% (${stressStatus}). ` +
    `Temperature: ${tempVal}°F (${tempStatus}). ` +
    glucosePrompt
  )
}
