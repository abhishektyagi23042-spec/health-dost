// [records] Store and retrieval helpers for offline patient records and USB drive browsing.
import { promises as fs } from 'fs'
import fsSync from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const OFFLINE_ROOT = path.resolve(__dirname, '../../offline_saves')
const RECORDS_ROOT = path.join(OFFLINE_ROOT, 'records')
function getUsbBaseDir() {
  return path.resolve(process.env.USB_MOUNT_DIR || '/media')
}

export async function ensureRecordsRoot() {
  await fs.mkdir(RECORDS_ROOT, { recursive: true })
}

function getPatientRecordsDir(patientId) {
  // Sanitize patientId to prevent path traversal
  const safeId = String(patientId || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_')
  return path.join(RECORDS_ROOT, safeId)
}

/**
 * Save an offline record PDF and JSON sidecar.
 */
export async function saveOfflineRecord({ patientId, metadata, pdfBase64 }) {
  if (!patientId) throw new Error('Missing patientId')
  if (!pdfBase64) throw new Error('Missing pdfBase64')

  await ensureRecordsRoot()
  const targetDir = getPatientRecordsDir(patientId)
  await fs.mkdir(targetDir, { recursive: true })

  const timestamp = metadata?.timestamp || new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 15)
  const categorySlug = String(metadata?.category || 'record').toLowerCase().replace(/[^a-z0-9]+/g, '-')
  const baseFilename = `${timestamp}_${categorySlug}`

  const pdfPath = path.join(targetDir, `${baseFilename}.pdf`)
  const jsonPath = path.join(targetDir, `${baseFilename}.json`)

  const pdfBuffer = Buffer.from(pdfBase64, 'base64')
  if (pdfBuffer.length > 25 * 1024 * 1024) {
    throw new Error('PDF exceeds 25 MB limit')
  }

  const sidecar = {
    ...metadata,
    patientId,
    timestamp,
    savedAt: new Date().toISOString(),
    sizeBytes: pdfBuffer.length,
    pdfFilename: `${baseFilename}.pdf`,
  }

  await fs.writeFile(pdfPath, pdfBuffer)
  await fs.writeFile(jsonPath, JSON.stringify(sidecar, null, 2), 'utf8')

  return { ok: true, baseFilename, sizeBytes: pdfBuffer.length }
}

/**
 * List all offline records grouped by patient or flat list for sync.
 */
export async function listOfflineRecords() {
  await ensureRecordsRoot()
  const results = []

  let patientDirs = []
  try {
    patientDirs = await fs.readdir(RECORDS_ROOT, { withFileTypes: true })
  } catch {
    return []
  }

  for (const pDir of patientDirs) {
    if (!pDir.isDirectory()) continue
    const patientId = pDir.name
    const fullDirPath = path.join(RECORDS_ROOT, patientId)
    let files = []
    try {
      files = await fs.readdir(fullDirPath)
    } catch {
      continue
    }

    const jsonFiles = files.filter((f) => f.endsWith('.json'))
    for (const jFile of jsonFiles) {
      const recordId = jFile.replace(/\.json$/, '')
      const jsonPath = path.join(fullDirPath, jFile)
      const pdfPath = path.join(fullDirPath, `${recordId}.pdf`)

      try {
        const metadata = JSON.parse(await fs.readFile(jsonPath, 'utf8'))
        let hasPdf = false
        try {
          await fs.access(pdfPath)
          hasPdf = true
        } catch {
          hasPdf = false
        }

        results.push({
          patientId,
          recordId,
          metadata,
          hasPdf,
        })
      } catch {
        // Ignore unparseable sidecars
      }
    }
  }

  // Sort descending by timestamp/savedAt
  results.sort((a, b) => String(b.recordId).localeCompare(String(a.recordId)))
  return results
}

/**
 * Read offline record PDF and metadata for syncing.
 */
export async function readOfflineRecord(patientId, recordId) {
  const safePid = String(patientId).replace(/[^a-zA-Z0-9_-]/g, '_')
  const safeRid = String(recordId).replace(/[^a-zA-Z0-9_-]/g, '_')
  const targetDir = path.join(RECORDS_ROOT, safePid)
  const jsonPath = path.join(targetDir, `${safeRid}.json`)
  const pdfPath = path.join(targetDir, `${safeRid}.pdf`)

  const metadata = JSON.parse(await fs.readFile(jsonPath, 'utf8'))
  const pdfBuffer = await fs.readFile(pdfPath)

  return {
    metadata,
    pdfBase64: pdfBuffer.toString('base64'),
    sizeBytes: pdfBuffer.length,
  }
}

/**
 * Delete an offline record after successful cloud sync.
 */
export async function deleteOfflineRecord(patientId, recordId) {
  const safePid = String(patientId).replace(/[^a-zA-Z0-9_-]/g, '_')
  const safeRid = String(recordId).replace(/[^a-zA-Z0-9_-]/g, '_')
  const targetDir = path.join(RECORDS_ROOT, safePid)
  const jsonPath = path.join(targetDir, `${safeRid}.json`)
  const pdfPath = path.join(targetDir, `${safeRid}.pdf`)

  await Promise.allSettled([fs.unlink(jsonPath), fs.unlink(pdfPath)])

  // Clean up directory if empty
  try {
    const remains = await fs.readdir(targetDir)
    if (remains.length === 0) {
      await fs.rmdir(targetDir)
    }
  } catch {}

  return { ok: true }
}

/**
 * Recursively list PDF, JPG, PNG, HEIC files on mounted USB drives under /media (max depth 3).
 */
export async function listUsbFiles() {
  const allowedExtensions = new Set(['.pdf', '.jpg', '.jpeg', '.png', '.heic'])
  const results = []
  const usbBaseDir = getUsbBaseDir()

  try {
    await fs.access(usbBaseDir)
  } catch {
    // USB base directory not mounted / found
    return []
  }

  async function walk(currentDir, depth) {
    if (depth > 3) return
    let entries = []
    try {
      entries = await fs.readdir(currentDir, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name)
      if (entry.isDirectory()) {
        await walk(fullPath, depth + 1)
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase()
        if (allowedExtensions.has(ext)) {
          try {
            const stat = await fs.stat(fullPath)
            results.push({
              name: entry.name,
              path: fullPath,
              relativePath: path.relative(usbBaseDir, fullPath).replace(/\\/g, '/'),
              sizeBytes: stat.size,
              ext: ext.replace(/^\./, ''),
              modifiedAt: stat.mtime.toISOString(),
            })
          } catch {}
        }
      }
    }
  }

  await walk(usbBaseDir, 1)
  return results
}

/**
 * Validate and resolve a file path to ensure it is strictly within USB_BASE_DIR.
 * Prevents directory traversal attacks.
 */
export function validateUsbFilePath(filePath) {
  if (!filePath || typeof filePath !== 'string') {
    throw new Error('Invalid file path')
  }

  const usbBaseDir = getUsbBaseDir()
  const resolved = path.resolve(filePath)
  const canonicalBase = path.resolve(usbBaseDir)

  // Ensure resolved path starts with canonicalBase
  if (!resolved.startsWith(canonicalBase + path.sep) && resolved !== canonicalBase) {
    throw new Error('Access denied: Path is outside USB media directory')
  }

  // Reject path traversal patterns
  if (filePath.includes('..')) {
    throw new Error('Access denied: Directory traversal detected')
  }

  if (!fsSync.existsSync(resolved)) {
    throw new Error('File not found')
  }

  const stat = fsSync.statSync(resolved)
  if (!stat.isFile()) {
    throw new Error('Target is not a file')
  }

  return resolved
}
