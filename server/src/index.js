/**
 * HealthDost Pi server – reads Arduino serial, broadcasts vitals via Socket.IO.
 * Raspberry Pi defaults are built in; env vars can still override.
 */

import express from 'express'
import { createServer } from 'http'
import { Server } from 'socket.io'
import { spawn } from 'child_process'
import path from 'path'
import { fileURLToPath } from 'url'
import { createArduinoReader } from './serial/arduinoReader.js'
import {
  ensureOfflineRoot,
  saveOfflineSession,
  listOfflinePatients,
  listPatientSessions,
  readOfflineSession,
  deleteOfflineSession,
} from './offlineStore.js'
// [records] Import offline medical records and USB/Scanner services
import {
  ensureRecordsRoot,
  saveOfflineRecord,
  listOfflineRecords,
  readOfflineRecord,
  deleteOfflineRecord,
  listUsbFiles,
  validateUsbFilePath,
} from './recordsStore.js'
import { getScanConfig, executeScan } from './scannerService.js'
// [glucose] Import Bluetooth LE glucose service
import {
  initGlucoseService,
  syncGlucose,
  getLastGlucose,
  clearGlucose,
} from './glucose/glucoseService.js'

const DEFAULT_SERIAL_PORT = '/dev/ttyACM0'
const DEFAULT_SERIAL_BAUD = 115200
const DEFAULT_SERVER_PORT = 5175
const DEFAULT_CORS_ORIGIN = 'http://localhost:5173'
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const SHUTDOWN_SCRIPT_PATH = path.resolve(__dirname, '../../scripts/pi/shutdown_kiosk.sh')
const PRINT_VITALS_SCRIPT_PATH = path.resolve(__dirname, '../../scripts/print/print_vitals.py')

const SERIAL_PORT = process.env.SERIAL_PORT || DEFAULT_SERIAL_PORT
const SERIAL_BAUD = Number.parseInt(process.env.SERIAL_BAUD || `${DEFAULT_SERIAL_BAUD}`, 10)
const PORT = Number.parseInt(process.env.PORT || `${DEFAULT_SERVER_PORT}`, 10)
const CORS_ORIGIN = process.env.CORS_ORIGIN || DEFAULT_CORS_ORIGIN
const PRINTER_NAME = process.env.PRINTER_NAME || 'Canon_MF440_Series'

const app = express()
const httpServer = createServer(app)
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', CORS_ORIGIN)
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') {
    res.sendStatus(204)
    return
  }
  next()
})
app.use(express.json({ limit: '25mb' }))

function isLocalRequest(req) {
  const host = req.headers.host || ''
  const origin = req.headers.origin || ''
  const ip = req.ip || req.socket?.remoteAddress || ''
  const hostIsLocal = host.startsWith('localhost:') || host.startsWith('127.0.0.1:')
  const originIsLocal =
    !origin ||
    origin.startsWith('http://localhost:') ||
    origin.startsWith('http://127.0.0.1:')
  const ipIsLocal =
    ip === '127.0.0.1' ||
    ip === '::1' ||
    ip === '::ffff:127.0.0.1'
  return hostIsLocal || (originIsLocal && ipIsLocal)
}

const io = new Server(httpServer, {
  cors: {
    origin: CORS_ORIGIN,
    methods: ['GET', 'POST'],
  },
})

let lastArduinoStatus = { connected: false, port: SERIAL_PORT, lastFrameAt: null, message: null }

const reader = createArduinoReader({
  path: SERIAL_PORT,
  baudRate: SERIAL_BAUD,
  onVitalsUpdate: (vitals) => {
    io.emit('vitalsUpdate', vitals)
  },
  onEcgUpdate: (ecgPayload) => {
    io.emit('ecgUpdate', ecgPayload)
  },
  onStatus: (status) => {
    lastArduinoStatus = status
    io.emit('arduinoStatus', status)
  },
})

reader.open()
ensureOfflineRoot().catch(() => {})
// [records] Ensure offline records directory exists
ensureRecordsRoot().catch(() => {})

// [glucose] Initialize glucose service with Socket.IO
initGlucoseService(io)

// [glucose] Endpoints for glucometer reading and cache management
app.post('/api/glucose/sync', async (_req, res) => {
  const result = await syncGlucose()
  return res.status(result.status || 200).json(result.body || result)
})

app.get('/api/glucose/last', (_req, res) => {
  return res.json(getLastGlucose() || null)
})

app.post('/api/glucose/clear', (_req, res) => {
  return res.json(clearGlucose())
})

app.post('/offline-saves', async (req, res) => {
  try {
    const { payload, screenshotBase64 } = req.body ?? {}
    if (!payload || typeof payload !== 'object') {
      return res.status(400).json({ ok: false, error: 'Invalid payload' })
    }
    await saveOfflineSession({ payload, screenshotBase64: screenshotBase64 || '' })
    return res.json({ ok: true })
  } catch (err) {
    return res.status(500).json({ ok: false, error: err?.message || 'Failed to save offline session' })
  }
})

app.get('/offline-saves/patients', async (_req, res) => {
  try {
    const patients = await listOfflinePatients()
    return res.json({ ok: true, patients })
  } catch (err) {
    return res.status(500).json({ ok: false, error: err?.message || 'Failed to list patients' })
  }
})

app.get('/offline-saves/patients/:patientId/sessions', async (req, res) => {
  try {
    const sessions = await listPatientSessions(req.params.patientId)
    return res.json({ ok: true, sessions })
  } catch (err) {
    return res.status(500).json({ ok: false, error: err?.message || 'Failed to list sessions' })
  }
})

app.get('/offline-saves/patients/:patientId/sessions/:sessionId', async (req, res) => {
  try {
    const session = await readOfflineSession(req.params.patientId, req.params.sessionId)
    if (!session) return res.status(404).json({ ok: false, error: 'Session not found' })
    return res.json({ ok: true, ...session })
  } catch (err) {
    return res.status(500).json({ ok: false, error: err?.message || 'Failed to read session' })
  }
})

app.delete('/offline-saves/patients/:patientId/sessions/:sessionId', async (req, res) => {
  try {
    const result = await deleteOfflineSession(req.params.patientId, req.params.sessionId)
    return res.json({ ok: true, ...result })
  } catch (err) {
    return res.status(500).json({ ok: false, error: err?.message || 'Failed to delete session' })
  }
})

// [records] Offline medical records endpoints
app.post('/records/offline', async (req, res) => {
  try {
    const { patientId, metadata, pdfBase64 } = req.body ?? {}
    if (!patientId || !pdfBase64) {
      return res.status(400).json({ ok: false, error: 'Missing patientId or pdfBase64' })
    }
    const result = await saveOfflineRecord({ patientId, metadata, pdfBase64 })
    return res.json({ ok: true, ...result })
  } catch (err) {
    return res.status(500).json({ ok: false, error: err?.message || 'Failed to save offline record' })
  }
})

app.get('/records/offline', async (_req, res) => {
  try {
    const records = await listOfflineRecords()
    return res.json({ ok: true, records })
  } catch (err) {
    return res.status(500).json({ ok: false, error: err?.message || 'Failed to list offline records' })
  }
})

app.get('/records/offline/:patientId/:recordId', async (req, res) => {
  try {
    const record = await readOfflineRecord(req.params.patientId, req.params.recordId)
    return res.json({ ok: true, record })
  } catch (err) {
    return res.status(500).json({ ok: false, error: err?.message || 'Failed to read offline record' })
  }
})

app.delete('/records/offline/:patientId/:recordId', async (req, res) => {
  try {
    const result = await deleteOfflineRecord(req.params.patientId, req.params.recordId)
    return res.json({ ok: true, ...result })
  } catch (err) {
    return res.status(500).json({ ok: false, error: err?.message || 'Failed to delete offline record' })
  }
})

// [records] USB drive file browsing & streaming endpoints
app.get('/records/usb', async (_req, res) => {
  try {
    const files = await listUsbFiles()
    return res.json({ ok: true, files })
  } catch (err) {
    return res.status(500).json({ ok: false, error: err?.message || 'Failed to list USB files' })
  }
})

app.get('/records/usb/file', async (req, res) => {
  try {
    const targetPath = req.query.path
    const validatedPath = validateUsbFilePath(targetPath)
    return res.sendFile(validatedPath)
  } catch (err) {
    return res.status(403).json({ ok: false, error: err?.message || 'Forbidden' })
  }
})

// [records] Scanner endpoints via SANE scanimage
app.get('/scan/config', (_req, res) => {
  return res.json({ ok: true, config: getScanConfig() })
})

app.post('/scan', async (req, res) => {
  try {
    const { source = 'Flatbed' } = req.body ?? {}
    const pages = await executeScan({ source })
    return res.json({ ok: true, pages })
  } catch (err) {
    return res.status(500).json({ ok: false, error: err?.message || 'Scanning failed' })
  }
})

app.post('/app/shutdown', async (req, res) => {
  if (!isLocalRequest(req)) {
    return res.status(403).json({ ok: false, error: 'Forbidden' })
  }
  const child = spawn('/bin/bash', [SHUTDOWN_SCRIPT_PATH], {
    detached: true,
    stdio: 'ignore',
  })
  child.unref()
  return res.json({ ok: true })
})

app.post('/print-vitals', async (req, res) => {
  try {
    const payload = req.body ?? {}
    if (!payload || typeof payload !== 'object') {
      return res.status(400).json({ ok: false, error: 'Invalid JSON body' })
    }

    const child = spawn('python3', [PRINT_VITALS_SCRIPT_PATH], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PRINTER_NAME,
      },
    })

    let stderr = ''
    child.stderr.on('data', (d) => {
      stderr += String(d)
    })

    child.stdin.write(JSON.stringify(payload))
    child.stdin.end()

    child.on('error', (err) => {
      return res.status(500).json({ ok: false, error: err?.message || 'Failed to run print process' })
    })

    child.on('close', (code) => {
      if (code === 0) return res.json({ ok: true })
      return res.status(500).json({ ok: false, error: stderr.trim() || `Print failed (exit ${code})` })
    })
  } catch (err) {
    return res.status(500).json({ ok: false, error: err?.message || 'Failed to print' })
  }
})

io.on('connection', (socket) => {
  socket.emit('arduinoStatus', lastArduinoStatus)
  socket.emit('vitalsUpdate', reader.getLastGood())
  socket.emit('ecgUpdate', { samples: reader.getLastEcgBuffer() })

  // [glucose] Emit latest glucose record if available
  const lastG = getLastGlucose()
  if (lastG) {
    socket.emit('glucose', {
      mgdl: lastG.mgdl,
      timestamp: lastG.timestamp,
      seq: lastG.seq,
      device: lastG.device,
      status: 'ok',
    })
  }

  socket.on('requestReset', () => {
    reader.resetArduino()
  })

  socket.on('requestReconnect', () => {
    reader.reconnect()
  })

})

httpServer.listen(PORT, () => {
  console.log(`HealthDost server listening on port ${PORT}`)
  console.log(`Serial: ${SERIAL_PORT} @ ${SERIAL_BAUD}`)
  console.log(`CORS origin: ${CORS_ORIGIN}`)
})
