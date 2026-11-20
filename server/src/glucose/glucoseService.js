import { spawn } from 'child_process'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const GLUCOSE_SCRIPT_PATH = path.resolve(__dirname, '../../../scripts/glucose/glucose_reader.py')

let ioInstance = null
let lastGlucose = null
let isSyncing = false

export function initGlucoseService(io) {
  ioInstance = io
}

export function getLastGlucose() {
  return lastGlucose
}

export function clearGlucose() {
  lastGlucose = null
  if (ioInstance) {
    ioInstance.emit('glucose', {
      mgdl: null,
      timestamp: null,
      status: 'cleared',
      message: 'Glucose reading cleared',
    })
  }
  return { ok: true }
}

export async function syncGlucose() {
  const isEnabled = process.env.GLUCOSE_ENABLED === '1'
  if (!isEnabled) {
    return {
      status: 400,
      body: {
        ok: false,
        status: 'not_found',
        message: 'GLUCOSE_ENABLED is not set to 1',
      },
    }
  }

  if (isSyncing) {
    return {
      status: 409,
      body: {
        ok: false,
        status: 'error',
        message: 'Glucose sync already in progress',
      },
    }
  }

  isSyncing = true

  return new Promise((resolve) => {
    const pythonExecutable =
      process.env.GLUCOSE_PYTHON || (process.platform === 'win32' ? 'python' : 'python3')
    const args = [GLUCOSE_SCRIPT_PATH]

    if (process.env.GLUCOSE_MOCK != null && process.env.GLUCOSE_MOCK !== '') {
      args.push('--mock', String(process.env.GLUCOSE_MOCK))
    } else {
      if (process.env.GLUCOSE_ADDRESS) {
        args.push('--address', process.env.GLUCOSE_ADDRESS)
      }
      args.push('--last')
    }

    let child = null
    let stdoutData = ''
    let stderrData = ''
    let isSettled = false

    const timeoutTimer = setTimeout(() => {
      if (isSettled) return
      isSettled = true
      isSyncing = false
      if (child) {
        try {
          child.kill('SIGTERM')
        } catch {}
      }

      const payload = {
        mgdl: null,
        timestamp: null,
        status: 'timeout',
        message: 'Sync timed out after 25 seconds',
      }
      ioInstance?.emit('glucose', payload)
      resolve({ status: 504, body: { ok: false, ...payload } })
    }, 25000)

    try {
      child = spawn(pythonExecutable, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (spawnErr) {
      clearTimeout(timeoutTimer)
      isSettled = true
      isSyncing = false
      const payload = {
        mgdl: null,
        timestamp: null,
        status: 'error',
        message: spawnErr?.message || 'Failed to spawn glucose reader',
      }
      ioInstance?.emit('glucose', payload)
      return resolve({ status: 500, body: { ok: false, ...payload } })
    }

    child.stdout.on('data', (chunk) => {
      stdoutData += String(chunk)
    })

    child.stderr.on('data', (chunk) => {
      stderrData += String(chunk)
    })

    child.on('error', (err) => {
      if (isSettled) return
      clearTimeout(timeoutTimer)
      isSettled = true
      isSyncing = false
      const payload = {
        mgdl: null,
        timestamp: null,
        status: 'error',
        message: err?.message || 'Error executing glucose reader',
      }
      ioInstance?.emit('glucose', payload)
      resolve({ status: 500, body: { ok: false, ...payload } })
    })

    child.on('close', (code) => {
      if (isSettled) return
      clearTimeout(timeoutTimer)
      isSettled = true
      isSyncing = false

      // Parse JSON lines from stdout
      const lines = stdoutData.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
      const readings = []
      let lastError = null

      for (const line of lines) {
        try {
          const item = JSON.parse(line)
          if (item.type === 'reading') {
            readings.push(item)
          } else if (item.type === 'error') {
            lastError = item
          }
        } catch {
          // ignore non-json lines
        }
      }

      if (readings.length > 0) {
        // Take the latest reading reported
        const latest = readings[readings.length - 1]

        // Check stale rule:
        // "Never show a reading whose meter timestamp is older than the current session start (default 15 minutes before "Sync" is pressed, configurable)."
        const maxAgeMin = Number.parseInt(process.env.GLUCOSE_MAX_AGE_MIN || '15', 10)
        const maxAgeMs = maxAgeMin * 60 * 1000
        const readingEpoch = new Date(latest.timestamp).getTime()
        const now = Date.now()

        if (Number.isFinite(readingEpoch) && now - readingEpoch > maxAgeMs) {
          const payload = {
            mgdl: null,
            timestamp: latest.timestamp,
            status: 'stale',
            message: `Glucose reading is older than ${maxAgeMin} minutes`,
          }
          ioInstance?.emit('glucose', payload)
          return resolve({
            status: 200,
            body: { ok: false, ...payload, seq: latest.seq, device: latest.device },
          })
        }

        lastGlucose = {
          mgdl: latest.mgdl,
          timestamp: latest.timestamp,
          seq: latest.seq,
          device: latest.device,
          unit: latest.unit || 'mg/dL',
          sampleType: latest.sampleType || '',
          location: latest.location || '',
          receivedAt: new Date().toISOString(),
        }

        const payload = {
          mgdl: lastGlucose.mgdl,
          timestamp: lastGlucose.timestamp,
          seq: lastGlucose.seq,
          device: lastGlucose.device,
          status: 'ok',
          message: 'Glucose reading synced successfully',
        }

        ioInstance?.emit('glucose', payload)
        return resolve({ status: 200, body: { ok: true, ...payload } })
      }

      if (lastError) {
        const statusMap = {
          NOT_FOUND: 'not_found',
          PAIRING_REQUIRED: 'pairing_required',
          TIMEOUT: 'timeout',
          PARSE: 'error',
        }
        const status = statusMap[lastError.code] || 'error'
        const payload = {
          mgdl: null,
          timestamp: null,
          status,
          message: lastError.message || `Glucose sync error (${lastError.code})`,
        }
        ioInstance?.emit('glucose', payload)
        return resolve({ status: 200, body: { ok: false, ...payload } })
      }

      if (code !== 0) {
        const payload = {
          mgdl: null,
          timestamp: null,
          status: 'error',
          message: stderrData.trim() || `Glucose reader exited with code ${code}`,
        }
        ioInstance?.emit('glucose', payload)
        return resolve({ status: 500, body: { ok: false, ...payload } })
      }

      const payload = {
        mgdl: null,
        timestamp: null,
        status: 'not_found',
        message: 'No glucose readings returned from meter',
      }
      ioInstance?.emit('glucose', payload)
      return resolve({ status: 200, body: { ok: false, ...payload } })
    })
  })
}
