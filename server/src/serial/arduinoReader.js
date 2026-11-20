/**
 * Arduino serial reader – parses 6-line frames from Arduino Mega at 115200 baud.
 * Maintains lastGood values per field; discards "--" after real values received.
 */

import { SerialPort } from 'serialport'
import { ReadlineParser } from '@serialport/parser-readline'

const FRAME_LINES = 6
const ECG_BUFFER_MAX = 800
const ECG_CHUNK_SIZE = 20
const ECG_EMIT_MS = 100

/** Parse HR from line 1: "MAX: 105 [calculating]" or "MAX: -- [No Finger]" */
function parseHr1(line) {
  const m = line.match(/^MAX:\s*(--|\d+)\s*\[/)
  if (!m) return null
  if (m[1] === '--') return null
  const n = parseInt(m[1], 10)
  return Number.isNaN(n) ? null : n
}

/** Parse HR from line 6: integer or "--" */
function parseHr2(line) {
  const t = line.trim()
  if (t === '--') return null
  const n = parseInt(t, 10)
  return Number.isNaN(n) ? null : n
}

function isReasonableHeartRate(n) {
  // Heart rate should generally be within a human range.
  // Filters out obvious glitches like `0` from the BP sensor.
  return Number.isFinite(n) && n >= 30 && n <= 220
}

/** Parse SpO2 from line 2: "98%" or "--" */
function parseSpo2(line) {
  const m = line.match(/^(\d+)%$|^--$/)
  if (!m) return null
  if (m[1] === undefined) return null
  const n = parseInt(m[1], 10)
  return Number.isNaN(n) ? null : n
}

/** Parse temp from line 3: float or "--" */
function parseTemp(line) {
  const t = line.trim()
  if (t === '--') return null
  const n = parseFloat(t)
  return Number.isNaN(n) ? null : n
}

/** Parse stress from line 4: "15%" or "--" or "-- [calibrating]" */
function parseStress(line) {
  const m = line.match(/^(\d+)%$/)
  if (!m) return null
  const n = parseInt(m[1], 10)
  return Number.isNaN(n) ? null : n
}

/** Parse BP from line 5: "144/93 mmHg" or "--/-- mmHg" */
function parseBp(line) {
  const m = line.match(/^(\d+)\/(\d+)\s*mmHg$/)
  if (!m) return null
  const sys = parseInt(m[1], 10)
  const dia = parseInt(m[2], 10)
  if (Number.isNaN(sys) || Number.isNaN(dia)) return null
  return `${sys}/${dia}`
}

/**
 * Creates an Arduino reader that opens the serial port, parses 6-line frames,
 * maintains lastGood per field, and invokes callbacks.
 *
 * @param {Object} options
 * @param {string} options.path - Serial port path (e.g. /dev/ttyACM0)
 * @param {number} [options.baudRate=115200]
 * @param {function(Object)} options.onVitalsUpdate - Called with { heartRate, bloodOxygen, temperature, stressLevel, bloodPressure }
 * @param {function(Object)} [options.onEcgUpdate] - Called with { samples: number[] }
 * @param {function(Object)} options.onStatus - Called with { connected, port, lastFrameAt, message? }
 */
export function createArduinoReader({ path, baudRate = 115200, onVitalsUpdate, onEcgUpdate, onStatus }) {
  let port = null
  let lineBuffer = []
  let ecgBuffer = []
  let ecgChunk = []
  let lastFrameAt = null
  let lastEcgAt = null
  let lastEcgEmitAt = 0
  const lastGood = {
    heartRate: 0,
    bloodOxygen: 0,
    temperature: 0,
    stressLevel: 0,
    bloodPressure: '0/0',
  }
  let hasReceivedAnyRealValue = false

  function emitStatus(connected, message) {
    onStatus?.({
      connected,
      port: path,
      lastFrameAt: lastFrameAt ?? null,
      message,
    })
  }

  function emitVitals() {
    onVitalsUpdate?.({
      heartRate: lastGood.heartRate,
      bloodOxygen: lastGood.bloodOxygen,
      temperature: lastGood.temperature,
      stressLevel: lastGood.stressLevel,
      bloodPressure: lastGood.bloodPressure,
    })
  }

  function emitEcgChunk(force = false) {
    if (ecgChunk.length === 0) return
    const now = Date.now()
    if (!force && ecgChunk.length < ECG_CHUNK_SIZE && now - lastEcgEmitAt < ECG_EMIT_MS) return
    onEcgUpdate?.({ samples: [...ecgChunk] })
    ecgChunk = []
    lastEcgEmitAt = now
  }

  function parseEcgSample(line) {
    const m = line.match(/^E:\s*(-?\d+)$/)
    if (!m) return null
    const n = parseInt(m[1], 10)
    if (Number.isNaN(n)) return null
    return n
  }

  function processFrame(lines) {
    if (lines.length !== FRAME_LINES) return
    lastFrameAt = Date.now()

    const hr1 = parseHr1(lines[0])
    const spo2 = parseSpo2(lines[1])
    const temp = parseTemp(lines[2])
    const stress = parseStress(lines[3])
    const bp = parseBp(lines[4])
    const hr2 = parseHr2(lines[5])

    // Heart rate selection:
    // - Prefer MAX30102 (hr1) when reasonable.
    // - Only fall back to BP pulse (hr2) if hr1 is missing/unreasonable.
    // This avoids `0` pulses from the BP sensor pulling HR down to 0.
    if (hr1 !== null && isReasonableHeartRate(hr1)) {
      lastGood.heartRate = hr1
    } else if (hr2 !== null && isReasonableHeartRate(hr2)) {
      lastGood.heartRate = hr2
    }

    if (spo2 !== null) lastGood.bloodOxygen = spo2
    if (temp !== null) lastGood.temperature = temp
    if (stress !== null) lastGood.stressLevel = stress
    if (bp !== null) lastGood.bloodPressure = bp

    if (hr1 !== null || hr2 !== null || spo2 !== null || temp !== null || stress !== null || bp !== null) {
      hasReceivedAnyRealValue = true
    }

    emitVitals()
  }

  function handleLine(line) {
    const ecgSample = parseEcgSample(line)
    if (ecgSample !== null) {
      lastEcgAt = Date.now()
      ecgBuffer.push(ecgSample)
      if (ecgBuffer.length > ECG_BUFFER_MAX) {
        ecgBuffer = ecgBuffer.slice(ecgBuffer.length - ECG_BUFFER_MAX)
      }
      ecgChunk.push(ecgSample)
      emitEcgChunk(false)
      return
    }

    lineBuffer.push(line)
    while (lineBuffer.length >= FRAME_LINES) {
      // Frames must start with MAX:, otherwise we're likely misaligned due to
      // dropped/extra lines; shift until we resync.
      if (!lineBuffer[0].startsWith('MAX:')) {
        lineBuffer.shift()
        continue
      }
      const frame = lineBuffer.splice(0, FRAME_LINES)
      processFrame(frame)
    }
  }

  function openPort() {
    if (port) {
      try {
        port.close()
      } catch {}
      port = null
    }

    port = new SerialPort({ path, baudRate })

    port.once('open', () => {
      emitStatus(true)
    })

    const parser = port.pipe(new ReadlineParser({ delimiter: '\n', includeDelimiter: false }))
    parser.on('data', (line) => {
      const trimmed = (line + '').trim()
      if (!trimmed) return
      handleLine(trimmed)
    })

    port.on('close', () => {
      emitStatus(false, 'Port closed')
    })

    port.on('error', (err) => {
      emitStatus(false, err?.message ?? 'Error')
    })
  }

  function write(data) {
    if (port?.isOpen) {
      port.write(data)
      return true
    }
    return false
  }

  function resetArduino() {
    write('R\n')
  }

  function reconnect() {
    if (port) {
      port.once('close', () => {
        port = null
        openPort()
      })
      port.close()
    } else {
      openPort()
    }
  }

  return {
    open: openPort,
    write,
    resetArduino,
    reconnect,
    getLastGood: () => ({ ...lastGood }),
    getLastFrameAt: () => lastFrameAt,
    getLastEcgAt: () => lastEcgAt,
    getLastEcgBuffer: () => [...ecgBuffer],
  }
}
