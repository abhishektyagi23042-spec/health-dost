import { promises as fs } from 'fs'
import path from 'path'

const ROOT_DIR = path.resolve(process.cwd(), '..')
const OFFLINE_ROOT = path.join(ROOT_DIR, 'offline_saves')

function getPatientDir(patientId) {
  return path.join(OFFLINE_ROOT, patientId)
}

function getJsonPath(patientId, sessionId) {
  return path.join(getPatientDir(patientId), `${sessionId}.json`)
}

function getImagePath(patientId, sessionId) {
  return path.join(getPatientDir(patientId), `${sessionId}.jpg`)
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath)
    return true
  } catch {
    return false
  }
}

export async function ensureOfflineRoot() {
  await fs.mkdir(OFFLINE_ROOT, { recursive: true })
}

export async function saveOfflineSession({ payload, screenshotBase64 }) {
  const patientId = payload?.patientId
  const sessionId = payload?.sessionId
  if (!patientId || !sessionId) throw new Error('Missing patientId/sessionId')

  const patientDir = getPatientDir(patientId)
  await fs.mkdir(patientDir, { recursive: true })
  await fs.writeFile(getJsonPath(patientId, sessionId), JSON.stringify(payload, null, 2), 'utf8')

  if (screenshotBase64) {
    const imageBuffer = Buffer.from(screenshotBase64, 'base64')
    await fs.writeFile(getImagePath(patientId, sessionId), imageBuffer)
  }
}

export async function listOfflinePatients() {
  await ensureOfflineRoot()
  const entries = await fs.readdir(OFFLINE_ROOT, { withFileTypes: true })
  const patients = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const patientId = entry.name
    const patientDir = getPatientDir(patientId)
    const files = await fs.readdir(patientDir)
    const sessionFiles = files.filter((f) => f.endsWith('.json'))
    let patientName = patientId
    if (sessionFiles.length > 0) {
      try {
        const sample = JSON.parse(await fs.readFile(path.join(patientDir, sessionFiles[0]), 'utf8'))
        patientName = sample?.patientName || patientId
      } catch {}
    }
    patients.push({ patientId, patientName, sessionCount: sessionFiles.length })
  }
  return patients
}

export async function listPatientSessions(patientId) {
  const patientDir = getPatientDir(patientId)
  if (!(await pathExists(patientDir))) return []
  const files = await fs.readdir(patientDir)
  const sessions = []
  for (const file of files) {
    if (!file.endsWith('.json')) continue
    const sessionId = file.replace(/\.json$/, '')
    try {
      const payload = JSON.parse(await fs.readFile(path.join(patientDir, file), 'utf8'))
      sessions.push({
        sessionId,
        sessionDate: payload?.sessionDate || null,
        hasScreenshot: await pathExists(getImagePath(patientId, sessionId)),
      })
    } catch {
      sessions.push({ sessionId, sessionDate: null, hasScreenshot: false })
    }
  }
  sessions.sort((a, b) => String(b.sessionId).localeCompare(String(a.sessionId)))
  return sessions
}

export async function readOfflineSession(patientId, sessionId) {
  const jsonPath = getJsonPath(patientId, sessionId)
  if (!(await pathExists(jsonPath))) return null
  const payload = JSON.parse(await fs.readFile(jsonPath, 'utf8'))
  let screenshotBase64 = ''
  const imagePath = getImagePath(patientId, sessionId)
  if (await pathExists(imagePath)) {
    screenshotBase64 = (await fs.readFile(imagePath)).toString('base64')
  }
  return { payload, screenshotBase64 }
}

export async function deleteOfflineSession(patientId, sessionId) {
  const jsonPath = getJsonPath(patientId, sessionId)
  const imagePath = getImagePath(patientId, sessionId)
  await Promise.allSettled([fs.unlink(jsonPath), fs.unlink(imagePath)])
  const patientDir = getPatientDir(patientId)
  if (await pathExists(patientDir)) {
    const remains = await fs.readdir(patientDir)
    if (remains.length === 0) {
      await fs.rmdir(patientDir)
      return { removedPatient: true }
    }
  }
  return { removedPatient: false }
}

